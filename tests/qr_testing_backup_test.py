from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.qr_testing_backup import (
    BackupError,
    PRODUCTION_REF,
    ROOT,
    TESTING_REF,
    decrypt_bytes,
    encrypt_stream,
    main,
    parse_database_url,
    postgres_environment,
    safe_output_dir,
    validate_project,
    validate_disposable_restore_target,
    verify_artifact,
)


class BackupSafetyTests(unittest.TestCase):
    def test_default_is_simulation_and_never_invokes_external_commands(self):
        with patch("scripts.qr_testing_backup.subprocess.run", side_effect=AssertionError("external command invoked")):
            self.assertEqual(main([]), 0)

    def test_real_export_requires_external_approval_and_exact_testing_ref(self):
        with self.assertRaises(BackupError):
            validate_project(TESTING_REF, TESTING_REF, "", "", ci=False)
        with self.assertRaises(BackupError):
            validate_project(TESTING_REF, PRODUCTION_REF, "QR-003-APPROVAL-20261029", "YES")
        with self.assertRaises(BackupError):
            validate_project(PRODUCTION_REF, PRODUCTION_REF, "QR-003-APPROVAL-20261029", "YES")
        with self.assertRaises(BackupError):
            validate_project(TESTING_REF, TESTING_REF, "QR-003-APPROVAL-20261029", "YES", ci=True)
        validate_project(TESTING_REF, TESTING_REF, "QR-003-APPROVAL-20261029", "YES")

    def test_database_url_is_limited_to_local_or_exact_testing_direct_host(self):
        _, local = parse_database_url("postgresql://postgres:synthetic@127.0.0.1:54322/postgres", remote=False)
        self.assertEqual(local["PGHOST"], "127.0.0.1")
        testing = f"postgresql://postgres:synthetic@db.{TESTING_REF}.supabase.co:5432/postgres?sslmode=require"
        parsed, remote = parse_database_url(testing, remote=True)
        self.assertEqual(parsed.hostname, f"db.{TESTING_REF}.supabase.co")
        self.assertEqual(remote["PGSSLMODE"], "require")
        with self.assertRaises(BackupError):
            parse_database_url(f"postgresql://postgres:x@db.{PRODUCTION_REF}.supabase.co:5432/postgres?sslmode=require", remote=True)
        with self.assertRaises(BackupError):
            parse_database_url("postgresql://postgres:x@example.invalid/postgres", remote=False)

    def test_validated_dsn_cannot_be_overridden_by_inherited_libpq_variables(self):
        with patch.dict(os.environ, {
            "PGHOSTADDR": "198.51.100.25", "PGSERVICE": "unexpected",
            "SUPABASE_PROJECT_REF": PRODUCTION_REF,
        }, clear=False):
            result = postgres_environment({"PGHOST": "127.0.0.1", "PGSSLMODE": "disable"})
        self.assertEqual(result["PGHOST"], "127.0.0.1")
        self.assertNotIn("PGHOSTADDR", result)
        self.assertNotIn("PGSERVICE", result)
        self.assertNotIn("SUPABASE_PROJECT_REF", result)

    def test_output_directory_must_be_outside_repository(self):
        with tempfile.TemporaryDirectory(prefix="qr-backup-outside-") as outside:
            target = safe_output_dir(outside)
            self.assertEqual(os.stat(target).st_mode & 0o777, 0o700)
            shared = Path(outside) / "shared"
            shared.mkdir(mode=0o755)
            os.chmod(shared, 0o755)
            with self.assertRaises(BackupError):
                safe_output_dir(str(shared))
            self.assertEqual(os.stat(shared).st_mode & 0o777, 0o755)
        with self.assertRaises(BackupError):
            safe_output_dir(str(ROOT))

    def test_restore_requires_nonce_matched_disposable_workdir(self):
        with tempfile.TemporaryDirectory(prefix="qr-backup-workdir-") as folder:
            workdir = Path(folder)
            config = workdir / "supabase" / "config.toml"
            config.parent.mkdir()
            config.write_text('project_id = "qr_backup_restore_0123456789abcdef"\n[db]\nport = 54322\n')
            target = "postgresql://postgres:synthetic@127.0.0.1:54322/postgres"
            with self.assertRaises(BackupError):
                validate_disposable_restore_target(target, str(workdir), "qr_restore_fedcba9876543210")
            config.write_text('project_id = "ordinary_local_project"\n[db]\nport = 54322\n')
            with self.assertRaises(BackupError):
                validate_disposable_restore_target(target, str(workdir), "qr_restore_0123456789abcdef")

    def test_artifact_hash_manifest_and_sidecar_are_checked_before_decrypt(self):
        with tempfile.TemporaryDirectory(prefix="qr-backup-verify-") as folder:
            artifact = Path(folder) / "synthetic.qr-testing-backup.gpg"
            ciphertext = b"synthetic encrypted bytes"
            artifact.write_bytes(ciphertext)
            ciphertext_hash = hashlib.sha256(ciphertext).hexdigest()
            plaintext_hash = hashlib.sha256(b"synthetic SQL archive").hexdigest()
            manifest = Path(str(artifact).removesuffix(".gpg") + ".json")
            manifest.write_text(json.dumps({
                "postgres_major": 17,
                "project_ref": "local-synthetic",
                "ciphertext_sha256": ciphertext_hash,
                "plaintext_sha256": plaintext_hash,
            }))
            Path(str(artifact) + ".sha256").write_text(f"{ciphertext_hash}  {artifact.name}\n")
            with patch("scripts.qr_testing_backup.pg_binary", return_value="pg_restore"), \
                 patch("scripts.qr_testing_backup.decrypt_stream", return_value={
                     "plaintext_sha256": plaintext_hash, "plaintext_bytes": 20,
                 }) as decrypt:
                self.assertEqual(verify_artifact(artifact, "synthetic-long-passphrase"), {
                    "plaintext_sha256": plaintext_hash, "plaintext_bytes": 20,
                })
                decrypt.assert_called_once()
            Path(str(artifact) + ".sha256").write_text("0" * 64 + "  artifact\n")
            with patch("scripts.qr_testing_backup.pg_binary") as pg_binary:
                with self.assertRaises(BackupError):
                    verify_artifact(artifact, "synthetic-long-passphrase")
                pg_binary.assert_not_called()

    def test_gpg_encryption_round_trip_integrity_and_permissions(self):
        if not shutil.which("gpg"):
            self.skipTest("GnuPG is not installed")
        payload = (b"synthetic-only-test-archive\n" * 8192)
        phrase = "synthetic-test-passphrase-never-reuse-2026"
        with tempfile.TemporaryDirectory(prefix="qr-backup-unit-") as folder:
            root = Path(folder)
            artifact = root / "synthetic.gpg"
            try:
                hashes = encrypt_stream(io.BytesIO(payload), artifact, phrase)
            except BackupError as exc:
                if "agente GPG local no está disponible" in str(exc):
                    self.skipTest("sandbox denies the local GnuPG agent socket")
                raise
            decoded, decoded_hash = decrypt_bytes(artifact, phrase)
            self.assertEqual(decoded, payload)
            self.assertEqual(decoded_hash, hashlib.sha256(payload).hexdigest())
            self.assertEqual(hashes["plaintext_sha256"], decoded_hash)
            self.assertEqual(hashes["ciphertext_sha256"], hashlib.sha256(artifact.read_bytes()).hexdigest())
            self.assertEqual(os.stat(artifact).st_mode & 0o777, 0o600)
            self.assertFalse(artifact.read_bytes().startswith(b"PGDMP"))
            self.assertEqual([path.name for path in root.iterdir()], ["synthetic.gpg"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
