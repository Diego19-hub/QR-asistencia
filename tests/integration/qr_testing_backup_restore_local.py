#!/usr/bin/env python3
"""End-to-end public-CLI backup/verify/restore rehearsal on disposable PG17."""
from __future__ import annotations

import os
import pty
import secrets
import select
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "qr_testing_backup.py"
NONCE = secrets.token_hex(8)
PROJECT_ID = f"qr_backup_restore_{NONCE}"
DATABASE_NAME = f"qr_restore_{NONCE}"
CONTAINER = f"supabase_db_{PROJECT_ID}"
NETWORK = "bridge"
PASSPHRASE = secrets.token_urlsafe(32)
WRONG_PASSPHRASE = secrets.token_urlsafe(32)
LOCAL_PASSWORD = secrets.token_urlsafe(24)
ROOT_TEMP: Path | None = None
CHECKS: list[tuple[str, bool]] = []
BASE_CONTAINERS: set[str] = set()
BASE_NETWORKS: set[str] = set()
PORT = 0
CREATED_CONTAINER_ID = ""


def check(name: str, ok: bool, detail: str = "") -> None:
    CHECKS.append((name, bool(ok)))
    suffix = f" ({detail})" if detail and not ok else ""
    print(f"{'PASS' if ok else 'FAIL'} {len(CHECKS):02d} {name}{suffix}", flush=True)
    if not ok:
        raise RuntimeError(f"failed check: {name}")


def run(args: list[str], *, input_bytes: bytes | None = None,
        env: dict[str, str] | None = None, timeout: int = 90,
        check_rc: bool = True) -> subprocess.CompletedProcess[bytes]:
    process_env = os.environ.copy()
    for key in tuple(process_env):
        if key.startswith(("PG", "SUPABASE_")):
            process_env.pop(key, None)
    process_env.update({"DOCKER_BUILDKIT": "1", "SUPABASE_TELEMETRY_DISABLED": "1"})
    if env:
        process_env.update(env)
    result = subprocess.run(args, input=input_bytes, capture_output=True,
                            timeout=timeout, env=process_env)
    if check_rc and result.returncode:
        # Never surface process output or arguments containing connection details.
        raise RuntimeError(f"local command failed: {Path(args[0]).name} exit={result.returncode}")
    return result


def docker_names(kind: str = "container") -> set[str]:
    args = ["docker", "ps", "-a", "--format", "{{.Names}}"] if kind == "container" else [
        "docker", "network", "ls", "--format", "{{.Name}}"]
    return set(run(args).stdout.decode().splitlines())


def choose_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def create_tls(directory: Path) -> None:
    directory.mkdir(mode=0o700)
    run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
         "-keyout", str(directory / "ca.key"), "-out", str(directory / "ca.crt"),
         "-days", "2", "-subj", "/CN=QR synthetic local CA",
         "-addext", "basicConstraints=critical,CA:TRUE",
         "-addext", "subjectAltName=DNS:localhost"], timeout=30)
    os.chmod(directory / "ca.key", 0o600)
    os.chmod(directory / "ca.crt", 0o600)


def start_database(tls_directory: Path) -> None:
    global PORT, CREATED_CONTAINER_ID
    PORT = choose_port()
    command = (
        "cp /tls_in/ca.crt /tmp/qr-server.crt && "
        "cp /tls_in/ca.key /tmp/qr-server.key && "
        "chown postgres:postgres /tmp/qr-server.crt /tmp/qr-server.key && "
        "chmod 600 /tmp/qr-server.key && "
        "exec /usr/local/bin/docker-entrypoint.sh postgres "
        "-c ssl=on -c ssl_min_protocol_version=TLSv1.2 "
        "-c ssl_cert_file=/tmp/qr-server.crt -c ssl_key_file=/tmp/qr-server.key"
    )
    created = run([
        "docker", "run", "--detach", "--name", CONTAINER,
        "--network", NETWORK,
        "--publish", f"127.0.0.1:{PORT}:5432",
        "--mount", f"type=bind,src={tls_directory},dst=/tls_in,readonly",
        "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
        "--entrypoint", "/bin/sh", "postgres:17", "-c", command,
    ], timeout=180, check_rc=False)
    container_id = created.stdout.decode(errors="replace").strip().splitlines()
    if container_id:
        CREATED_CONTAINER_ID = container_id[0]
    if created.returncode:
        raise RuntimeError(f"No se pudo iniciar el contenedor sintético: exit={created.returncode}")
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        status = run(["docker", "exec", CONTAINER, "pg_isready", "-U", "postgres"], check_rc=False)
        if status.returncode == 0:
            check("PostgreSQL 17 TLS local desechable inició", True)
            return
        time.sleep(1)
    raise RuntimeError("PostgreSQL 17 desechable no inició dentro del límite")


def wrapper(bin_dir: Path, name: str, body: str) -> None:
    target = bin_dir / name
    target.write_text("#!/bin/sh\nset -eu\n" + body + "\n", encoding="utf-8")
    target.chmod(0o700)


def create_wrappers(directory: Path) -> None:
    wrapper(directory, "psql", f'exec docker exec -i {CONTAINER} psql -U postgres "$@"')
    wrapper(directory, "pg_dump", f'''if [ "$QR_BACKUP_FAIL_DUMP" = 1 ]; then
  printf 'PGDMPsynthetic-partial-archive'
  exit 9
fi
if [ "${{1:-}}" = "--version" ]; then echo "pg_dump (PostgreSQL) 17.6"; exit 0; fi
exec docker exec -i {CONTAINER} pg_dump -U postgres -d postgres "$@"''')
    wrapper(directory, "pg_restore", f'''if [ "${{1:-}}" = "--version" ]; then echo "pg_restore (PostgreSQL) 17.6"; exit 0; fi
if [ "$QR_BACKUP_FAIL_RESTORE" = 1 ]; then
  for arg in "$@"; do if [ "$arg" = "--dbname" ]; then cat >/dev/null; exit 9; fi; done
fi
exec docker exec -i {CONTAINER} pg_restore -U postgres "$@" 2>"$QR_BACKUP_TEST_PGRESTORE_STDERR"''')


def public_cli(args: list[str], *, env: dict[str, str], answers: tuple[str, ...] = (),
               timeout: int = 180) -> tuple[int, str]:
    master, slave = pty.openpty()
    proc_env = os.environ.copy()
    for key in tuple(proc_env):
        if key.startswith(("PG", "SUPABASE_")):
            proc_env.pop(key, None)
    proc_env.update(env)
    proc_env["PATH"] = str(ROOT_TEMP / "bin") + os.pathsep + proc_env.get("PATH", "")
    process = subprocess.Popen([sys.executable, str(TOOL), *args], cwd=ROOT,
                               stdin=slave, stdout=slave, stderr=slave, env=proc_env,
                               close_fds=True, start_new_session=True)
    os.close(slave)
    output = bytearray()
    sent = 0
    deadline = time.monotonic() + timeout
    try:
        while process.poll() is None or select.select([master], [], [], 0)[0]:
            if time.monotonic() > deadline:
                process.kill()
                raise TimeoutError("public backup CLI timed out")
            ready, _, _ = select.select([master], [], [], 0.2)
            if not ready:
                continue
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            output.extend(chunk)
            visible = output.decode("utf-8", "replace")
            prompts = ("Frase GnuPG", "Repítela para confirmar")
            while sent < len(answers) and prompts[sent] in visible:
                os.write(master, answers[sent].encode() + b"\n")
                sent += 1
        visible_output = output.decode("utf-8", "replace")
        for secret_value in (PASSPHRASE, WRONG_PASSPHRASE, LOCAL_PASSWORD):
            visible_output = visible_output.replace(secret_value, "[redacted]")
        return process.wait(timeout=10), visible_output
    finally:
        os.close(master)
        if process.poll() is None:
            process.kill()
            process.wait()


def sql(query: str, database: str = "postgres") -> str:
    completed = run(["docker", "exec", "-i", CONTAINER, "psql", "-X", "-v",
                     "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-At"],
                    input_bytes=query.encode())
    return completed.stdout.decode().strip()


def public_tls_probe(hostname: str, ca_path: str, expect_success: bool) -> bool:
    # hostaddr pins the socket to this throwaway container; hostname remains the
    # certificate identity checked by libpq verify-full. No DNS or remote route.
    conninfo = (f"host={hostname} hostaddr=127.0.0.1 port=5432 user=postgres "
                f"dbname=postgres sslmode=verify-full sslrootcert={ca_path} connect_timeout=3")
    result = run(["docker", "exec", CONTAINER, "psql", "-X", "-A", "-t", conninfo,
                  "-c", "select 1"], check_rc=False, timeout=15)
    return (result.returncode == 0) is expect_success


def run_test() -> None:
    global ROOT_TEMP, BASE_CONTAINERS, BASE_NETWORKS
    if not shutil.which("docker") or not shutil.which("openssl") or not shutil.which("gpg"):
        raise RuntimeError("docker, openssl y gpg son requisitos de esta prueba local")
    run(["docker", "info", "--format", "{{.ServerVersion}}"], timeout=15)
    BASE_CONTAINERS = docker_names()
    BASE_NETWORKS = docker_names("network")
    if CONTAINER in BASE_CONTAINERS:
        raise RuntimeError("la identidad desechable elegida ya existe")
    ROOT_TEMP = Path(tempfile.mkdtemp(prefix="qr-backup-restore-")).resolve()
    os.chmod(ROOT_TEMP, 0o700)
    try:
        tls = ROOT_TEMP / "tls"
        create_tls(tls)
        start_database(tls)
        bin_dir = ROOT_TEMP / "bin"
        bin_dir.mkdir(mode=0o700)
        create_wrappers(bin_dir)
        workdir = ROOT_TEMP / "project"
        config = workdir / "supabase" / "config.toml"
        config.parent.mkdir(parents=True)
        config.write_text(f'project_id = "{PROJECT_ID}"\n[db]\nport = {PORT}\n', encoding="utf-8")
        output_dir = ROOT_TEMP / "artifacts"
        output_dir.mkdir(mode=0o700)
        archive = sql("""
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE EXTENSION pgcrypto;
CREATE TABLE public.qr_backup_probe (
  id integer PRIMARY KEY,
  tenant text NOT NULL,
  fingerprint text NOT NULL DEFAULT encode(digest(gen_random_uuid()::text, 'sha256'), 'hex')
);
INSERT INTO public.qr_backup_probe(id, tenant) VALUES (1, 'synthetic-a'), (2, 'synthetic-b');
ALTER TABLE public.qr_backup_probe ENABLE ROW LEVEL SECURITY;
CREATE POLICY qr_backup_probe_authenticated_read ON public.qr_backup_probe
  FOR SELECT TO authenticated USING (tenant = current_setting('qr.synthetic_tenant', true));
GRANT SELECT ON public.qr_backup_probe TO authenticated;
CREATE FUNCTION public.qr_backup_fixture_fn() RETURNS text
  LANGUAGE sql SECURITY INVOKER AS $$ SELECT 'synthetic-function-ok'::text $$;
REVOKE ALL ON FUNCTION public.qr_backup_fixture_fn() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.qr_backup_fixture_fn() TO authenticated;
SELECT 'source-ready';
""")
        check("fixture sintética con roles administrados, extensión, función, ACL y RLS", archive.endswith("source-ready"))
        source_snapshot = sql("SELECT count(*) || ':' || md5(string_agg(id::text || ':' || tenant || ':' || fingerprint, ',' ORDER BY id)) FROM public.qr_backup_probe; SELECT count(*) FROM pg_extension WHERE extname='pgcrypto';")

        base_env = {
            "QR_BACKUP_LOCAL_DATABASE_URL": f"postgresql://postgres:{LOCAL_PASSWORD}@127.0.0.1:{PORT}/postgres",
            "QR_BACKUP_RESTORE_DATABASE_URL": f"postgresql://postgres:{LOCAL_PASSWORD}@127.0.0.1:{PORT}/postgres",
            "QR_BACKUP_FAIL_DUMP": "0", "QR_BACKUP_FAIL_RESTORE": "0",
            "QR_BACKUP_TEST_CONTAINER": CONTAINER,
            "QR_BACKUP_TEST_PGRESTORE_STDERR": str(ROOT_TEMP / "pg_restore.stderr"),
        }
        code, output = public_cli(["backup", "--mode", "simulate", "--output-dir", str(output_dir)],
                                  env=base_env, answers=(PASSPHRASE, PASSPHRASE))
        artifacts = list(output_dir.glob("*.qr-testing-backup.gpg"))
        check("comando público backup produce archivo cifrado", code == 0 and len(artifacts) == 1 and "SHA-256 ciphertext" in output)
        artifact = artifacts[0]
        manifest = Path(str(artifact).removesuffix(".gpg") + ".json")
        sidecar = Path(str(artifact) + ".sha256")
        check("artefactos cifrados y privados, sin dump PostgreSQL en claro", artifact.read_bytes()[:5] != b"PGDMP" and all(p.exists() and (p.stat().st_mode & 0o777) == 0o600 for p in (artifact, manifest, sidecar)))

        code, output = public_cli(["verify", "--artifact", str(artifact)], env=base_env, answers=(PASSPHRASE,))
        check("comando público verify acepta ciphertext íntegro", code == 0 and "VERIFICADO" in output,
              f"exit={code}; {output[-500:].replace(chr(10), ' | ')}; pg_restore={Path(base_env['QR_BACKUP_TEST_PGRESTORE_STDERR']).read_text(errors='replace')[-300:] if Path(base_env['QR_BACKUP_TEST_PGRESTORE_STDERR']).exists() else 'no stderr'}")
        published = run(["docker", "port", CONTAINER, "5432/tcp"], check_rc=False)
        check("contenedor aislado expone DB solo en loopback", published.returncode == 0 and bool(published.stdout.strip()),
              f"exit={published.returncode}; {published.stdout.decode(errors='replace')[-200:]} {published.stderr.decode(errors='replace')[-200:]}")

        code, output = public_cli(["restore-local", "--artifact", str(artifact), "--workdir", str(workdir),
                                   "--database-name", DATABASE_NAME], env=base_env, answers=(PASSPHRASE,))
        check("comando público restore-local crea y restaura la base destino", code == 0 and "RESTAURACIÓN LOCAL PASS" in output,
              f"exit={code}; {output[-500:].replace(chr(10), ' | ')}; pg_restore={Path(base_env['QR_BACKUP_TEST_PGRESTORE_STDERR']).read_text(errors='replace')[-300:] if Path(base_env['QR_BACKUP_TEST_PGRESTORE_STDERR']).exists() else 'no stderr'}")
        restored = sql("SELECT count(*) FROM public.qr_backup_probe; SELECT public.qr_backup_fixture_fn(); SELECT extname FROM pg_extension WHERE extname='pgcrypto'; SELECT relrowsecurity FROM pg_class WHERE oid='public.qr_backup_probe'::regclass; SELECT polname FROM pg_policy WHERE polrelid='public.qr_backup_probe'::regclass; SELECT has_table_privilege('authenticated','public.qr_backup_probe','SELECT'); SELECT has_function_privilege('authenticated','public.qr_backup_fixture_fn()','EXECUTE'); SELECT has_function_privilege('anon','public.qr_backup_fixture_fn()','EXECUTE');", DATABASE_NAME).splitlines()
        check("filas, función, extensión, RLS, policy y permisos restaurados", restored == ["2", "synthetic-function-ok", "pgcrypto", "t", "qr_backup_probe_authenticated_read", "t", "t", "f"])
        rls_rows = [line for line in sql("SET SESSION AUTHORIZATION authenticated; SET qr.synthetic_tenant='synthetic-a'; SELECT count(*) FROM public.qr_backup_probe; SET qr.synthetic_tenant='synthetic-b'; SELECT count(*) FROM public.qr_backup_probe;", DATABASE_NAME).splitlines() if line.isdigit()]
        check("RLS limita las filas restauradas a la empresa sintética activa", rls_rows == ["1", "1"], f"filas={rls_rows!r}")
        check("snapshot del origen sintético no cambia al restaurar el destino", sql("SELECT count(*) || ':' || md5(string_agg(id::text || ':' || tenant || ':' || fingerprint, ',' ORDER BY id)) FROM public.qr_backup_probe; SELECT count(*) FROM pg_extension WHERE extname='pgcrypto';") == source_snapshot)

        local_tls = public_tls_probe("localhost", "/tmp/qr-server.crt", True)
        check("libpq verify-full acepta CA y hostname sintéticos correctos", local_tls)
        wrong_tls = public_tls_probe(f"db.llxyziffgtqnzlguxhyt.supabase.co", "/tmp/qr-server.crt", False)
        check("libpq verify-full rechaza hostname distinto con socket fijado a loopback", wrong_tls)

        code, output = public_cli(["verify", "--artifact", str(artifact)], env=base_env,
                                  answers=(WRONG_PASSPHRASE,))
        check("verify rechaza frase GnuPG incorrecta sin eco de frase", code == 2 and WRONG_PASSPHRASE not in output)

        tampered = output_dir / "tampered.qr-testing-backup.gpg"
        tampered.write_bytes(artifact.read_bytes()[:-1] + bytes([artifact.read_bytes()[-1] ^ 1]))
        tampered_manifest = output_dir / "tampered.qr-testing-backup.json"
        tampered_manifest.write_bytes(manifest.read_bytes())
        Path(str(tampered) + ".sha256").write_text(sidecar.read_text())
        code, output = public_cli(["verify", "--artifact", str(tampered)], env=base_env, answers=(PASSPHRASE,))
        check("verify rechaza ciphertext alterado", code == 2 and "no coincide" in output)

        existing_before = sql("SELECT count(*) FROM public.qr_backup_probe", DATABASE_NAME)
        code, output = public_cli(["restore-local", "--artifact", str(artifact), "--workdir", str(workdir),
                                   "--database-name", DATABASE_NAME], env=base_env, answers=(PASSPHRASE,))
        check("restore-local rechaza base destino existente sin alterarla", code == 2 and "ya existe" in output and sql("SELECT count(*) FROM public.qr_backup_probe", DATABASE_NAME) == existing_before)

        non_loopback_env = {**base_env, "QR_BACKUP_RESTORE_DATABASE_URL": "postgresql://synthetic:x@192.0.2.1:5432/postgres"}
        code, output = public_cli(["restore-local", "--artifact", str(artifact), "--workdir", str(workdir),
                                   "--database-name", DATABASE_NAME], env=non_loopback_env, answers=(PASSPHRASE,))
        check("restore-local rechaza destino fuera de loopback", code == 2 and "host permitido" in output)

        before = {p.name for p in output_dir.iterdir()}
        failed_dump_env = {**base_env, "QR_BACKUP_FAIL_DUMP": "1"}
        code, _ = public_cli(["backup", "--mode", "simulate", "--output-dir", str(output_dir)],
                             env=failed_dump_env, answers=(PASSPHRASE, PASSPHRASE))
        check("backup elimina ciphertext, manifest y sidecars parciales tras fallo de pg_dump", code == 2 and {p.name for p in output_dir.iterdir()} == before)

        sql(f'DROP DATABASE "{DATABASE_NAME}";')
        interrupted_env = {**base_env, "QR_BACKUP_FAIL_RESTORE": "1"}
        code, output = public_cli(["restore-local", "--artifact", str(artifact), "--workdir", str(workdir),
                                   "--database-name", DATABASE_NAME], env=interrupted_env, answers=(PASSPHRASE,))
        absent = sql(f"SELECT 1 FROM pg_database WHERE datname='{DATABASE_NAME}'") == ""
        check("interrupción de pg_restore elimina la base parcial", code == 2 and absent and "rechazó el respaldo" in output)

        invalid_probe = run(["docker", "exec", "-i", CONTAINER, "sh", "-c",
                             "cat > /tmp/invalid-ca.crt"], input_bytes=b"not a certificate\n", check_rc=False)
        invalid_tls = run(["docker", "exec", CONTAINER, "psql", "-X", "-A", "-t",
                           f"host=localhost hostaddr=127.0.0.1 user=postgres dbname=postgres sslmode=verify-full sslrootcert=/tmp/invalid-ca.crt",
                           "-c", "select 1"], check_rc=False, timeout=15)
        check("libpq verify-full rechaza CA ausente o inválida", invalid_probe.returncode == 0 and invalid_tls.returncode != 0)
    finally:
        if CREATED_CONTAINER_ID:
            run(["docker", "rm", "--force", CREATED_CONTAINER_ID], check_rc=False)
        if ROOT_TEMP:
            shutil.rmtree(ROOT_TEMP, ignore_errors=True)
        remaining_containers = docker_names()
        remaining_networks = docker_names("network")
        check("limpieza final conserva stacks y recursos preexistentes", remaining_containers == BASE_CONTAINERS and remaining_networks == BASE_NETWORKS)


if __name__ == "__main__":
    try:
        run_test()
    except Exception as error:
        print(f"ERROR sintético: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
    failures = [name for name, passed in CHECKS if not passed]
    print(f"RESULTADO: {len(CHECKS) - len(failures)}/{len(CHECKS)} PASS")
    sys.exit(bool(failures))
