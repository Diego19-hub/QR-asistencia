#!/usr/bin/env python3
"""Encrypted PostgreSQL backup helper for QR-asistencia Testing.

No arguments means simulation-only preview. A real Testing export requires an
explicit mode, exact project confirmation, an externally approved change ID,
and credentials supplied only through environment variables.
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import tomllib
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Sequence

ROOT = Path(__file__).resolve().parents[1]
TESTING_REF = "llxyziffgtqnzlguxhyt"
PRODUCTION_REF = "jawdrhewabqajxnswhkn"
APPROVAL_RE = re.compile(r"^QR-003-[A-Z0-9][A-Z0-9_-]{3,63}$")
RESTORE_PROJECT_RE = re.compile(r"^qr_backup_restore_([a-f0-9]{16})$")
RESTORE_DB_RE = re.compile(r"^qr_restore_([a-f0-9]{16})$")
CHUNK = 1024 * 1024


class BackupError(RuntimeError):
    pass


def ensure_private_directory(path: Path) -> Path:
    if not path.exists():
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        info = path.stat()
    except OSError:
        raise BackupError("No se pudo inspeccionar el directorio privado.") from None
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise BackupError("El directorio debe pertenecer al usuario actual y tener permisos 0700.")
    return path


def _gpg_homedir() -> Path:
    base = Path(tempfile.mkdtemp(prefix="qr-backup-gpg-"))
    os.chmod(base, 0o700)
    return base


def _remove_gpg_homedir(path: Path) -> None:
    """Stop the private agent before removing its socket directory."""
    gpgconf = shutil.which("gpgconf")
    if gpgconf:
        try:
            subprocess.run([gpgconf, "--homedir", str(path), "--kill", "gpg-agent"],
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=2, check=False)
        except (OSError, subprocess.TimeoutExpired):
            pass
    shutil.rmtree(path, ignore_errors=True)


def _with_passphrase_fd(args: Sequence[str], passphrase: str, **kwargs):
    read_fd, write_fd = os.pipe()
    try:
        os.write(write_fd, passphrase.encode("utf-8") + b"\n")
    finally:
        os.close(write_fd)
    try:
        return subprocess.Popen([args[0], "--passphrase-fd", str(read_fd), *args[1:]],
                                pass_fds=(read_fd,), **kwargs)
    finally:
        os.close(read_fd)


def encrypt_stream(source: BinaryIO, artifact: Path, passphrase: str,
                   homedir: Path | None = None) -> dict[str, int | str]:
    """Stream clear archive bytes directly into GPG; never writes cleartext to disk."""
    if len(passphrase) < 20:
        raise BackupError("La frase de cifrado debe tener al menos 20 caracteres.")
    ensure_private_directory(artifact.parent)
    temporary = artifact.with_name(artifact.name + ".part")
    if artifact.exists() or temporary.exists():
        raise BackupError("El destino ya existe; no se sobrescriben respaldos.")
    own_home = homedir is None
    gpg_home = homedir or _gpg_homedir()
    ensure_private_directory(gpg_home)
    plain_hash = hashlib.sha256()
    plain_bytes = 0
    try:
        with temporary.open("xb") as encrypted_output:
            os.chmod(temporary, 0o600)
            gpg = _with_passphrase_fd([
                "gpg", "--homedir", str(gpg_home), "--batch", "--yes",
                "--pinentry-mode", "loopback", "--symmetric",
                "--cipher-algo", "AES256", "--s2k-digest-algo", "SHA512",
                "--compress-algo", "none", "--output", "-",
            ], passphrase, stdin=subprocess.PIPE, stdout=encrypted_output,
                stderr=subprocess.PIPE)
            try:
                while chunk := source.read(CHUNK):
                    plain_hash.update(chunk)
                    plain_bytes += len(chunk)
                    gpg.stdin.write(chunk)
                gpg.stdin.close()
                stderr = gpg.stderr.read()
                gpg.stderr.close()
                code = gpg.wait(timeout=3600)
            except BaseException:
                gpg.kill()
                gpg.wait()
                raise
            if code:
                if b"can't connect to the gpg-agent" in stderr or b"No agent running" in stderr:
                    raise BackupError("El agente GPG local no está disponible en este entorno.")
                raise BackupError("GnuPG no pudo cifrar el respaldo.")
            encrypted_output.flush()
            os.fsync(encrypted_output.fileno())
            if stderr and b"WARNING" in stderr.upper():
                raise BackupError("GnuPG reportó una advertencia; se descartó el artefacto parcial.")
        os.replace(temporary, artifact)
        os.chmod(artifact, 0o600)
        cipher_hash = hashlib.sha256()
        with artifact.open("rb") as encrypted_input:
            for chunk in iter(lambda: encrypted_input.read(CHUNK), b""):
                cipher_hash.update(chunk)
        return {
            "plaintext_sha256": plain_hash.hexdigest(),
            "plaintext_bytes": plain_bytes,
            "ciphertext_sha256": cipher_hash.hexdigest(),
            "ciphertext_bytes": artifact.stat().st_size,
        }
    except BaseException:
        temporary.unlink(missing_ok=True)
        artifact.unlink(missing_ok=True)
        raise
    finally:
        if own_home:
            _remove_gpg_homedir(gpg_home)


def decrypt_stream(artifact: Path, passphrase: str, receiver: Sequence[str],
                   receiver_env: dict[str, str] | None = None,
                   homedir: Path | None = None) -> dict[str, int | str]:
    """Decrypt into a consumer pipe while hashing; never persists cleartext."""
    own_home = homedir is None
    gpg_home = homedir or _gpg_homedir()
    ensure_private_directory(gpg_home)
    digest = hashlib.sha256()
    plain_bytes = 0
    try:
        gpg = _with_passphrase_fd([
            "gpg", "--homedir", str(gpg_home), "--batch", "--yes",
            "--pinentry-mode", "loopback", "--output", "-",
            "--decrypt", str(artifact),
        ], passphrase, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        target = subprocess.Popen(list(receiver), stdin=subprocess.PIPE,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                  env=receiver_env)
        try:
            while chunk := gpg.stdout.read(CHUNK):
                digest.update(chunk)
                plain_bytes += len(chunk)
                target.stdin.write(chunk)
            gpg.stdout.close()
            target.stdin.close()
            gpg_error = gpg.stderr.read()
            gpg.stderr.close()
            target_error = target.stderr.read()
            target.stderr.close()
            gpg_code = gpg.wait(timeout=3600)
            target_code = target.wait(timeout=3600)
        except BaseException:
            gpg.kill()
            target.kill()
            gpg.wait()
            target.wait()
            raise
        if gpg_code:
            raise BackupError("No se pudo descifrar o verificar el respaldo.")
        if target_code:
            raise BackupError("El consumidor PostgreSQL rechazó el respaldo descifrado.")
        if gpg_error and b"WARNING" in gpg_error.upper():
            raise BackupError("GnuPG reportó una advertencia al descifrar.")
        return {"plaintext_sha256": digest.hexdigest(), "plaintext_bytes": plain_bytes}
    except BrokenPipeError as exc:
        raise BackupError("El consumidor cerró el flujo; no se guardó SQL descifrado.") from exc
    finally:
        if own_home:
            _remove_gpg_homedir(gpg_home)


def decrypt_bytes(artifact: Path, passphrase: str,
                 homedir: Path | None = None) -> tuple[bytes, str]:
    """Small-fixture helper for tests; production restore uses decrypt_stream."""
    own_home = homedir is None
    gpg_home = homedir or _gpg_homedir()
    ensure_private_directory(gpg_home)
    try:
        gpg = _with_passphrase_fd([
            "gpg", "--homedir", str(gpg_home), "--batch", "--yes",
            "--pinentry-mode", "loopback", "--output", "-",
            "--decrypt", str(artifact),
        ], passphrase, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        chunks = bytearray()
        digest = hashlib.sha256()
        while chunk := gpg.stdout.read(CHUNK):
            chunks.extend(chunk)
            digest.update(chunk)
        gpg.stdout.close()
        stderr = gpg.stderr.read()
        gpg.stderr.close()
        if gpg.wait(timeout=3600) or (stderr and b"WARNING" in stderr.upper()):
            raise BackupError("No se pudo descifrar o verificar el respaldo.")
        return bytes(chunks), digest.hexdigest()
    finally:
        if own_home:
            _remove_gpg_homedir(gpg_home)


def validate_project(project_ref: str, confirm_ref: str, approval_id: str,
                     authorized: str, ci: bool = False) -> None:
    if project_ref == PRODUCTION_REF or confirm_ref == PRODUCTION_REF:
        raise BackupError("Producción está bloqueada explícitamente.")
    if project_ref != TESTING_REF or confirm_ref != TESTING_REF:
        raise BackupError("Solo se permite confirmar exactamente el proyecto Testing autorizado.")
    if authorized != "YES" or not APPROVAL_RE.fullmatch(approval_id):
        raise BackupError("Falta la autorización externa explícita QR-003 para exportar.")
    if ci:
        raise BackupError("La exportación remota está prohibida desde CI.")


def parse_database_url(value: str, remote: bool) -> tuple[urllib.parse.ParseResult, dict[str, str]]:
    try:
        parsed = urllib.parse.urlparse(value)
        if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname or not parsed.username or not parsed.password or not parsed.path.strip("/"):
            raise ValueError
        params = urllib.parse.parse_qs(parsed.query, strict_parsing=True)
        if set(params) - {"sslmode"}:
            raise ValueError
        if remote:
            if parsed.hostname != f"db.{TESTING_REF}.supabase.co" or params.get("sslmode") != ["require"]:
                raise ValueError
        elif parsed.hostname.lower() not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError
        info = {
            "PGHOST": parsed.hostname,
            "PGPORT": str(parsed.port or 5432),
            "PGDATABASE": urllib.parse.unquote(parsed.path.lstrip("/")),
            "PGUSER": urllib.parse.unquote(parsed.username),
            "PGPASSWORD": urllib.parse.unquote(parsed.password),
            "PGSSLMODE": "require" if remote else "disable",
            "PGCONNECT_TIMEOUT": "15",
        }
        return parsed, info
    except (ValueError, TypeError):
        raise BackupError("La URL de conexión no corresponde al host permitido o tiene opciones no admitidas.") from None


def postgres_environment(connection: dict[str, str]) -> dict[str, str]:
    """Prevent inherited libpq/Supabase variables from overriding the validated DSN."""
    env = os.environ.copy()
    for key in tuple(env):
        if key.startswith("PG") or key.startswith("SUPABASE_"):
            env.pop(key, None)
    env.update(connection)
    return env


def pg_binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise BackupError(f"No se encontró {name} en PATH.")
    try:
        output = subprocess.run([path, "--version"], check=True, capture_output=True,
                                text=True, timeout=10).stdout.strip()
        major = int(re.search(r"\b(\d+)\.\d+\b", output).group(1))
    except Exception:
        raise BackupError(f"No se pudo identificar la versión de {name}.") from None
    if major != 17:
        raise BackupError(f"{name} debe ser PostgreSQL 17; se encontró otra versión mayor.")
    return path


def safe_output_dir(path_value: str) -> Path:
    path = Path(path_value).expanduser().resolve()
    try:
        path.relative_to(ROOT.resolve())
    except ValueError:
        pass
    else:
        raise BackupError("El respaldo debe almacenarse fuera del repositorio.")
    return ensure_private_directory(path)


def create_database_backup(url: str, remote: bool, output_dir: Path,
                           passphrase: str, gpg_home: Path | None = None) -> tuple[Path, Path, dict[str, object]]:
    _, pg_env = parse_database_url(url, remote)
    pg_dump = pg_binary("pg_dump")
    pg_restore = pg_binary("pg_restore")
    # Query only the server version; no application rows or identities are read here.
    probe = subprocess.run(["psql", "-X", "-A", "-t", "-c", "show server_version_num"],
                           env=postgres_environment(pg_env), capture_output=True, text=True,
                           timeout=30)
    if probe.returncode or not probe.stdout.strip().startswith("17"):
        raise BackupError("La base debe responder PostgreSQL 17; se detuvo sin exportar.")
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    nonce = os.urandom(5).hex()
    base = output_dir / f"qr-testing-{now}-{nonce}.qr-testing-backup"
    artifact = Path(str(base) + ".gpg")
    manifest = Path(str(base) + ".json")
    pg = subprocess.Popen([pg_dump, "--format=custom", "--no-owner", "--quote-all-identifiers"],
                          env=postgres_environment(pg_env), stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE)
    try:
        hashes = encrypt_stream(pg.stdout, artifact, passphrase, gpg_home)
        pg_error = pg.stderr.read()
        pg_code = pg.wait(timeout=3600)
        if pg_code:
            raise BackupError("pg_dump falló; el artefacto parcial fue eliminado.")
        if pg_error and b"WARNING" in pg_error.upper():
            raise BackupError("pg_dump reportó una advertencia; se descartó el artefacto.")
        if hashes["plaintext_bytes"] < 8:
            raise BackupError("pg_dump produjo un archivo vacío.")
        metadata: dict[str, object] = {
            "format": "PostgreSQL custom archive encrypted with GnuPG AES256",
            "scope": "database only; Storage object bytes and platform configuration excluded",
            "project_ref": TESTING_REF if remote else "local-synthetic",
            "postgres_major": 17,
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
            **hashes,
        }
        manifest_tmp = manifest.with_name(manifest.name + ".part")
        with manifest_tmp.open("x", encoding="utf-8") as output:
            os.chmod(manifest_tmp, 0o600)
            json.dump(metadata, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(manifest_tmp, manifest)
        os.chmod(manifest, 0o600)
        checksum = Path(str(artifact) + ".sha256")
        with checksum.open("x", encoding="ascii") as output:
            os.chmod(checksum, 0o600)
            output.write(f"{hashes['ciphertext_sha256']}  {artifact.name}\n")
        return artifact, manifest, metadata
    except BaseException:
        if pg.poll() is None:
            pg.kill()
            pg.wait()
        artifact.unlink(missing_ok=True)
        Path(str(artifact) + ".part").unlink(missing_ok=True)
        manifest.unlink(missing_ok=True)
        Path(str(manifest) + ".part").unlink(missing_ok=True)
        Path(str(artifact) + ".sha256").unlink(missing_ok=True)
        raise


def read_manifest(artifact: Path) -> dict[str, object]:
    manifest = Path(str(artifact).removesuffix(".gpg") + ".json")
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
        if data.get("postgres_major") != 17 or data.get("project_ref") not in {TESTING_REF, "local-synthetic"}:
            raise ValueError
        if not re.fullmatch(r"[a-f0-9]{64}", str(data.get("ciphertext_sha256", ""))):
            raise ValueError
        if not re.fullmatch(r"[a-f0-9]{64}", str(data.get("plaintext_sha256", ""))):
            raise ValueError
        return data
    except Exception:
        raise BackupError("Manifest ausente o inválido; se detuvo sin descifrar.") from None


def verify_artifact(artifact: Path, passphrase: str, gpg_home: Path | None = None) -> dict[str, int | str]:
    data = read_manifest(artifact)
    digest = hashlib.sha256()
    with artifact.open("rb") as encrypted:
        for chunk in iter(lambda: encrypted.read(CHUNK), b""):
            digest.update(chunk)
    if digest.hexdigest() != data["ciphertext_sha256"]:
        raise BackupError("SHA-256 del archivo cifrado no coincide.")
    sidecar = Path(str(artifact) + ".sha256")
    try:
        recorded = sidecar.read_text(encoding="ascii").split()[0]
    except Exception:
        raise BackupError("Falta el sidecar SHA-256 del archivo cifrado.") from None
    if recorded != digest.hexdigest():
        raise BackupError("El sidecar SHA-256 no coincide.")
    restore = pg_binary("pg_restore")
    result = decrypt_stream(artifact, passphrase, [restore, "--list", "-"], homedir=gpg_home)
    if result["plaintext_sha256"] != data["plaintext_sha256"]:
        raise BackupError("SHA-256 del archivo descifrado no coincide.")
    return result


def validate_disposable_restore_target(target_url: str, workdir_value: str,
                                       database_name: str) -> tuple[dict[str, str], Path, str]:
    match = RESTORE_DB_RE.fullmatch(database_name)
    if not match:
        raise BackupError("La base destino debe usar un nombre qr_restore_<16 hex>.")
    _, pg_env = parse_database_url(target_url, remote=False)
    workdir = Path(workdir_value).expanduser().resolve()
    if workdir == ROOT or workdir in ROOT.parents or ROOT in workdir.parents:
        # Must be a sibling temporary project, never the main checkout.
        raise BackupError("El workdir de restauración debe estar aislado fuera del repositorio.")
    config_path = workdir / "supabase" / "config.toml"
    try:
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        raise BackupError("No se encontró config.toml válido en el workdir temporal.") from None
    project_id = str(config.get("project_id", ""))
    project_match = RESTORE_PROJECT_RE.fullmatch(project_id)
    if not project_match or project_match.group(1) != match.group(1):
        raise BackupError("El proyecto debe tener ref qr_backup_restore_<mismo nonce>.")
    if (workdir / "supabase" / ".temp" / "project-ref").exists():
        raise BackupError("El workdir parece enlazado a un proyecto remoto; restauración cancelada.")
    try:
        expected_port = int(config["db"]["port"])
        actual_port = int(pg_env["PGPORT"])
    except (KeyError, TypeError, ValueError):
        raise BackupError("No se pudo comprobar el puerto local configurado.") from None
    if actual_port != expected_port:
        raise BackupError("El puerto destino no coincide con config.toml del workdir.")
    container = f"supabase_db_{project_id}"
    docker = shutil.which("docker")
    if not docker:
        raise BackupError("Docker no está disponible para verificar el stack temporal.")
    inspected = subprocess.run([docker, "inspect", "--format", "{{.State.Running}}", container],
                               stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15)
    if inspected.returncode or inspected.stdout.strip() != "true":
        raise BackupError("No se confirmó el contenedor PostgreSQL activo del stack temporal exacto.")
    published = subprocess.run([docker, "port", container, "5432/tcp"],
                               stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=15)
    bindings = [line.strip() for line in published.stdout.splitlines() if line.strip()]
    if published.returncode or not bindings:
        raise BackupError("No se pudo verificar el puerto publicado del contenedor temporal.")
    for binding in bindings:
        try:
            host, port = binding.rsplit(":", 1)
            if host.startswith("["):
                host = host[1:-1]
            if host not in {"127.0.0.1", "::1", "localhost"} or int(port) != expected_port:
                raise ValueError
        except ValueError:
            raise BackupError("El contenedor PostgreSQL no está publicado solo en loopback/puerto esperado.") from None
    return pg_env, workdir, project_id


def restore_local(artifact: Path, target_url: str, database_name: str,
                  passphrase: str, workdir_value: str) -> int:
    pg_env, _workdir, _project_id = validate_disposable_restore_target(
        target_url, workdir_value, database_name)
    psql = shutil.which("psql")
    if not psql:
        raise BackupError("No se encontró psql.")
    version = subprocess.run([psql, "-X", "-A", "-t", "-c", "show server_version_num"],
                             env=postgres_environment(pg_env), capture_output=True,
                             text=True, timeout=30)
    if version.returncode or not version.stdout.strip().startswith("17"):
        raise BackupError("El destino debe ser PostgreSQL 17 local.")
    exists = subprocess.run([psql, "-X", "-A", "-t", "-d", "postgres", "-c",
                             f"select 1 from pg_database where datname='{database_name}'"],
                            env=postgres_environment(pg_env), capture_output=True,
                            text=True, timeout=30)
    if exists.returncode or exists.stdout.strip():
        raise BackupError("La base destino ya existe o no se pudo comprobar; no se sobrescribe.")
    pg_restore = pg_binary("pg_restore")
    verify_artifact(artifact, passphrase)
    created = subprocess.run([psql, "-X", "-v", "ON_ERROR_STOP=1", "-d", "postgres",
                              "-c", f'CREATE DATABASE "{database_name}"'],
                             env=postgres_environment(pg_env), capture_output=True,
                             text=True, timeout=60)
    if created.returncode:
        raise BackupError("No se pudo crear la base local de restauración.")
    try:
        decrypt_stream(artifact, passphrase,
                       [pg_restore, "--exit-on-error", "--no-owner", "--dbname", database_name],
                       receiver_env=postgres_environment(pg_env))
    except Exception:
        subprocess.run([psql, "-X", "-v", "ON_ERROR_STOP=1", "-d", "postgres",
                        "-c", f'DROP DATABASE IF EXISTS "{database_name}"'],
                       env=postgres_environment(pg_env), capture_output=True,
                       text=True, timeout=60)
        raise
    print(f"RESTAURACIÓN LOCAL PASS: base sintética aislada {database_name}")
    return 0


def prompt_passphrase(confirm: bool) -> str:
    first = getpass.getpass("Frase GnuPG (no se mostrará): ")
    if len(first) < 20:
        raise BackupError("La frase debe contener al menos 20 caracteres.")
    if confirm and first != getpass.getpass("Repítela para confirmar: "):
        raise BackupError("Las frases no coinciden.")
    return first


def run_backup(args: argparse.Namespace) -> int:
    if args.mode == "testing":
        validate_project(os.getenv("QR_TESTING_PROJECT_REF", ""), args.confirm_project_ref or "",
                         os.getenv("QR_TESTING_BACKUP_APPROVAL_ID", ""),
                         os.getenv("QR_TESTING_BACKUP_EXPORT_AUTHORIZED", ""),
                         bool(os.getenv("CI") or os.getenv("GITHUB_ACTIONS")))
        url = os.getenv("QR_TESTING_DATABASE_URL", "")
        remote = True
    else:
        url = os.getenv("QR_BACKUP_LOCAL_DATABASE_URL", "")
        remote = False
        if not url:
            print("SIMULACIÓN: sin conexión ni exportación. Para probar, proporcione QR_BACKUP_LOCAL_DATABASE_URL de una base local sintética.")
            return 0
    parse_database_url(url, remote)
    if not args.output_dir:
        raise BackupError("Indique --output-dir fuera del repositorio.")
    output_dir = safe_output_dir(args.output_dir)
    phrase = prompt_passphrase(confirm=True)
    artifact, manifest, metadata = create_database_backup(url, remote, output_dir, phrase)
    print(f"Backup cifrado creado: {artifact.name}")
    print(f"Manifiesto: {manifest.name}")
    print(f"SHA-256 ciphertext: {metadata['ciphertext_sha256']}")
    print(f"SHA-256 plaintext: {metadata['plaintext_sha256']}")
    print(f"Bytes cifrados: {metadata['ciphertext_bytes']}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command")
    backup = sub.add_parser("backup", help="crear backup local de simulación o Testing autorizado")
    backup.add_argument("--mode", choices=("simulate", "testing"), default="simulate")
    backup.add_argument("--output-dir")
    backup.add_argument("--confirm-project-ref")
    verify = sub.add_parser("verify", help="validar SHA-256, descifrado y estructura sin guardar plaintext")
    verify.add_argument("--artifact", required=True)
    restore = sub.add_parser("restore-local", help="restaurar a una base nueva PostgreSQL 17 de loopback")
    restore.add_argument("--artifact", required=True)
    restore.add_argument("--target-env", default="QR_BACKUP_RESTORE_DATABASE_URL")
    restore.add_argument("--workdir", required=True,
                         help="workdir temporal Supabase con ref qr_backup_restore_<nonce>")
    restore.add_argument("--database-name", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    os.umask(0o077)
    argsv = list(argv if argv is not None else sys.argv[1:])
    if not argsv:
        print("SIMULACIÓN: no se conecta ni exporta datos. Use `backup --mode simulate` para una base loopback sintética.")
        return 0
    args = build_parser().parse_args(argsv)
    try:
        if args.command == "backup":
            return run_backup(args)
        if args.command == "verify":
            artifact = Path(args.artifact).expanduser().resolve()
            phrase = prompt_passphrase(confirm=False)
            result = verify_artifact(artifact, phrase)
            print(f"VERIFICADO: SHA-256 y formato PostgreSQL correctos; plaintext_bytes={result['plaintext_bytes']}")
            return 0
        if args.command == "restore-local":
            artifact = Path(args.artifact).expanduser().resolve()
            target = os.getenv(args.target_env, "")
            if not target:
                raise BackupError(f"Falta la variable {args.target_env} para un destino local loopback.")
            phrase = prompt_passphrase(confirm=False)
            return restore_local(artifact, target, args.database_name, phrase, args.workdir)
        raise BackupError("Seleccione una operación conocida.")
    except BackupError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
