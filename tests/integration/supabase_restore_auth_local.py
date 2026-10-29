#!/usr/bin/env python3
"""Strict local-only Supabase PostgreSQL/Auth restore rehearsal.

This script uses the Python standard library, the repository-pinned Supabase
CLI, local Docker, and GnuPG for a symmetric-encryption rehearsal. It never
links to, or accepts credentials for, a hosted Supabase project.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.qr_testing_backup import decrypt_bytes, encrypt_stream

REMOTE_PROJECT_IDS = {"llxyziffgtqnzlguxhyt", "jawdrhewabqajxnswhkn"}
PREFIX = "qr95d"
EXPECTED = 56
EMAILS = {
    "admin_a": "restore-admin-a@qr-asistencia.invalid",
    "admin_b": "restore-admin-b@qr-asistencia.invalid",
    "supervisor_a": "restore-supervisor-a@qr-asistencia.invalid",
    "unassigned": "restore-unassigned@qr-asistencia.invalid",
}
PASSWORDS = {role: secrets.token_urlsafe(32) for role in EMAILS}
IDS = {name: str(uuid.uuid4()) for name in (
    "company_a", "company_b", "branch_a1", "branch_a2", "branch_b1",
    "employee_a1", "employee_a2", "employee_b1", "device_a1",
    "device_a2", "device_b1", "session_a", "session_b",
)}
QR = {name: secrets.token_urlsafe(32) for name in ("a1", "a2", "b1")}
DEVICE = {name: secrets.token_urlsafe(32) for name in ("a1", "a2", "b1")}
PIN = "482951"
CHECKS: list[tuple[str, bool, str]] = []
TEMP: Path | None = None
PROJECTS: dict[str, Path] = {}
CREATED_USERS: dict[str, str] = {"source": {}, "restore": {}}
ENV: dict[str, dict[str, str]] = {}
BASELINE_CODE_QR: set[str] = set()
STARTED: set[str] = set()
START_TIME = time.monotonic()
PORT_OFFSETS: dict[str, int] = {}


def check(name: str, condition: bool, detail: str = "") -> None:
    if any(existing == name for existing, _, _ in CHECKS):
        raise RuntimeError(f"duplicate check name: {name}")
    CHECKS.append((name, bool(condition), detail))
    print(f"{'PASS' if condition else 'FAIL'} {len(CHECKS):02d}/{EXPECTED} {name}", flush=True)


def redact(text: str) -> str:
    for value in (*PASSWORDS.values(), *QR.values(), *DEVICE.values(), PIN,
                  *(e.get("SERVICE_ROLE_KEY", "") for e in ENV.values()),
                  *(e.get("ANON_KEY", "") for e in ENV.values())):
        if value:
            text = text.replace(value, "[redacted]")
    text = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._-]+", r"\1[redacted]", text)
    text = re.sub(r"sb_(?:secret|publishable)_[A-Za-z0-9_-]+", "[redacted]", text)
    return text


def run(args: list[str], *, input_text: str | None = None, timeout: int = 300,
        check_rc: bool = True, env: dict[str, str] | None = None) -> str:
    merged = os.environ.copy()
    # Remove inherited remote credentials/endpoints so even an accidental CLI
    # behavior change cannot turn this local rehearsal into a hosted operation.
    for key in tuple(merged):
        if key in {"SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_REF",
                   "SUPABASE_PROJECT_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
                   "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"}:
            merged.pop(key, None)
    merged.update({"SUPABASE_TELEMETRY_DISABLED": "1", "CI": "1"})
    if env:
        merged.update(env)
    proc = subprocess.run(args, input=input_text, text=True, capture_output=True,
                          timeout=timeout, env=merged)
    if check_rc and proc.returncode:
        # Report sanitized diagnostic only; command output may contain local keys.
        lines = [line for line in proc.stderr.splitlines() if line.strip()]
        detail = redact(" | ".join(lines[-4:]))[:700]
        raise RuntimeError(f"command failed ({proc.returncode}): {Path(args[0]).name} {args[1] if len(args)>1 else ''}; {detail or 'no diagnostic'}")
    return proc.stdout


def cli(project: str, *args: str, timeout: int = 600, check_rc: bool = True) -> str:
    assert project in PROJECTS
    return run([str(ROOT / "node_modules/.bin/supabase"), *args,
                "--workdir", str(PROJECTS[project])], timeout=timeout,
                check_rc=check_rc)


def http(base: str, path: str, *, method: str = "GET", body: object | None = None,
         bearer: str | None = None, apikey: str | None = None,
         timeout: int = 15) -> tuple[int, object, dict[str, str]]:
    data = None if body is None else json.dumps(body).encode()
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    if apikey:
        headers["apikey"] = apikey
    request = urllib.request.Request(base.rstrip("/") + path, data=data,
                                     headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()
            return response.status, decode(payload), dict(response.headers.items())
    except urllib.error.HTTPError as error:
        payload = error.read()
        return error.code, decode(payload), dict(error.headers.items())


def decode(data: bytes) -> object:
    if not data:
        return None
    try:
        return json.loads(data)
    except (ValueError, UnicodeDecodeError):
        return data.decode("utf-8", "replace")


def status_env(project: str) -> dict[str, str]:
    output = cli(project, "status", "--output", "env", timeout=60)
    values = {}
    for line in output.splitlines():
        match = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line.strip())
        if match:
            values[match.group(1)] = match.group(2).strip().strip("\"'")
    required = {"API_URL", "DB_URL", "SERVICE_ROLE_KEY", "ANON_KEY"}
    if not required.issubset(values):
        raise RuntimeError("local Supabase CLI status did not provide required variables")
    api = values["API_URL"]
    if not re.fullmatch(r"http://(?:127\.0\.0\.1|localhost):\d+", api):
        raise RuntimeError("non-loopback API URL rejected")
    if any(project_id in output for project_id in REMOTE_PROJECT_IDS):
        raise RuntimeError("remote project reference found in local CLI status")
    return values


def db(project: str, sql: str, *, role: str = "postgres", database: str = "postgres") -> str:
    name = f"supabase_db_{PREFIX}_{project}"
    if name not in docker_names():
        raise RuntimeError(f"expected isolated database container missing: {name}")
    proc = subprocess.run(["docker", "exec", "-i", name, "psql", "-X", "-v", "ON_ERROR_STOP=1",
                           "-U", role, "-d", database, "-At", "-c", sql],
                          text=True, capture_output=True, timeout=90)
    if proc.returncode:
        messages = [line for line in proc.stderr.splitlines() if line.startswith(("ERROR:", "FATAL:", "psql:"))]
        diagnostic = redact(" | ".join(messages))[:600]
        raise RuntimeError("local SQL command failed: " + (diagnostic or "PostgreSQL returned an error"))
    return proc.stdout


def docker_names() -> set[str]:
    return set(run(["docker", "ps", "--format", "{{.Names}}"], check_rc=True).splitlines())


def docker_all_names() -> set[str]:
    return set(run(["docker", "ps", "-a", "--format", "{{.Names}}"], check_rc=True).splitlines())


def docker_volumes() -> set[str]:
    return set(run(["docker", "volume", "ls", "--format", "{{.Name}}"], check_rc=True).splitlines())


def docker_networks() -> set[str]:
    return set(run(["docker", "network", "ls", "--format", "{{.Name}}"], check_rc=True).splitlines())


def pg(project: str, command: str, *args: str, input_bytes: bytes | None = None,
       timeout: int = 1200) -> bytes:
    name = f"supabase_db_{PREFIX}_{project}"
    proc = subprocess.run(["docker", "exec", "-i", name, *command.split(), *args],
                          input=input_bytes, capture_output=True, timeout=timeout)
    if proc.returncode:
        raise RuntimeError(f"database utility failed: {command}; stderr bytes={len(proc.stderr)}")
    return proc.stdout


def create_project(name: str, port_offset: int) -> Path:
    root = TEMP / name
    (root / "supabase" / "migrations").mkdir(parents=True, mode=0o700)
    text = (ROOT / "supabase/config.toml").read_text()
    text = text.replace('project_id = "codigo_QR"', f'project_id = "{PREFIX}_{name}"')
    text = re.sub(r"(?m)^(port\s*=\s*)(\d+)$",
                  lambda m: m.group(1) + str(int(m.group(2)) + port_offset), text)
    if any(remote in text for remote in REMOTE_PROJECT_IDS) or f'project_id = "{PREFIX}_{name}"' not in text:
        raise RuntimeError("temporary local config failed project ID safety check")
    (root / "supabase/config.toml").write_text(text)
    shutil.copytree(ROOT / "supabase/templates", root / "supabase/templates")
    for migration in (ROOT / "supabase/migrations").glob("*.sql"):
        shutil.copy2(migration, root / "supabase/migrations" / migration.name)
    return root


def choose_port_offset(used_ports: set[int]) -> int:
    config = (ROOT / "supabase/config.toml").read_text()
    base_ports = sorted({int(value) for value in re.findall(r"(?m)^port\s*=\s*(\d+)$", config)})
    for offset in range(1000, 11000, 25):
        ports = {port + offset for port in base_ports}
        if max(ports) >= 65536 or ports & used_ports:
            continue
        sockets = []
        try:
            for port in ports:
                sock = socket.socket()
                sock.bind(("127.0.0.1", port))
                sockets.append(sock)
        except OSError:
            continue
        finally:
            for sock in sockets:
                sock.close()
        return offset
    raise RuntimeError("no free isolated loopback port block is available")


def start_project(name: str) -> None:
    expected_id = f"{PREFIX}_{name}"
    config = (PROJECTS[name] / "supabase/config.toml").read_text()
    if f'project_id = "{expected_id}"' not in config:
        raise RuntimeError("stack config project ID mismatch")
    if any(remote in config for remote in REMOTE_PROJECT_IDS):
        raise RuntimeError("remote project ID is forbidden in stack config")
    cli(name, "start", "--exclude",
        "realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
        "--output", "env", timeout=1200)
    STARTED.add(name)
    ENV[name] = status_env(name)
    if not ENV[name]["API_URL"].startswith("http://127.0.0.1:"):
        raise RuntimeError("API URL is not loopback")


def admin_request(project: str, path: str, method: str, body: object | None = None):
    e = ENV[project]
    return http(e["API_URL"], "/auth/v1" + path, method=method, body=body,
                bearer=e["SERVICE_ROLE_KEY"], apikey=e["ANON_KEY"])


def login(project: str, role: str) -> tuple[str, str]:
    e = ENV[project]
    status, payload, _ = http(e["API_URL"], "/auth/v1/token?grant_type=password",
        method="POST", body={"email": EMAILS[role], "password": PASSWORDS[role]},
        apikey=e["ANON_KEY"])
    if status != 200 or not isinstance(payload, dict):
        return "", ""
    return str(payload.get("access_token", "")), str(payload.get("user", {}).get("id", ""))


def user_info(project: str, token: str):
    return http(ENV[project]["API_URL"], "/auth/v1/user", bearer=token,
                apikey=ENV[project]["ANON_KEY"])


def rest(project: str, table_or_rpc: str, *, token: str | None = None,
         method: str = "GET", body: object | None = None, query: str = ""):
    return http(ENV[project]["API_URL"], "/rest/v1/" + table_or_rpc + query,
                method=method, body=body,
                bearer=token or ENV[project]["ANON_KEY"], apikey=ENV[project]["ANON_KEY"])


def rpc(project: str, name: str, args: dict, token: str | None = None):
    return rest(project, "rpc/" + name, token=token, method="POST", body=args)


def seed(project: str, user_ids: dict[str, str]) -> None:
    # Synthetic fixture data, inserted only into the explicitly named local DB.
    q = lambda value: "'" + value.replace("'", "''") + "'"
    sql = f"""
    insert into public.companies(id,name) values
      ('{IDS['company_a']}','RESTORE TEST A'),('{IDS['company_b']}','RESTORE TEST B');
    insert into public.branches(id,company_id,name,timezone) values
      ('{IDS['branch_a1']}','{IDS['company_a']}','A1','America/Mexico_City'),
      ('{IDS['branch_a2']}','{IDS['company_a']}','A2','America/Mexico_City'),
      ('{IDS['branch_b1']}','{IDS['company_b']}','B1','America/Mexico_City');
    insert into public.company_memberships(id,company_id,user_id,role,active) values
      ('{uuid.uuid4()}','{IDS['company_a']}','{user_ids['admin_a']}','admin',true),
      ('{uuid.uuid4()}','{IDS['company_b']}','{user_ids['admin_b']}','admin',true),
      ('{uuid.uuid4()}','{IDS['company_a']}','{user_ids['supervisor_a']}','supervisor',true);
    insert into public.employees(id,company_id,branch_id,employee_number,first_name,last_name,active) values
      ('{IDS['employee_a1']}','{IDS['company_a']}','{IDS['branch_a1']}','REST-A1','Restore','Alpha',true),
      ('{IDS['employee_a2']}','{IDS['company_a']}','{IDS['branch_a2']}','REST-A2','Restore','Beta',true),
      ('{IDS['employee_b1']}','{IDS['company_b']}','{IDS['branch_b1']}','REST-B1','Restore','Gamma',true);
    insert into public.supervisors(company_id,membership_id) select company_id,id from public.company_memberships where user_id='{user_ids['supervisor_a']}';
    insert into public.supervisors(company_id,membership_id) select company_id,id from public.company_memberships where user_id='{user_ids['admin_b']}';
    insert into public.supervisor_branches(company_id,membership_id,branch_id) select m.company_id,m.id,'{IDS['branch_a1']}' from public.company_memberships m where m.user_id='{user_ids['supervisor_a']}';
    insert into public.authorized_devices(id,company_id,branch_id,membership_id,label,active)
      select '{IDS['device_a1']}','{IDS['company_a']}','{IDS['branch_a1']}',m.id,'synthetic A1',true from public.company_memberships m where m.user_id='{user_ids['supervisor_a']}';
    insert into public.authorized_devices(id,company_id,branch_id,membership_id,label,active)
      select '{IDS['device_a2']}','{IDS['company_a']}','{IDS['branch_a2']}',m.id,'synthetic A2',true from public.company_memberships m where m.user_id='{user_ids['supervisor_a']}';
    insert into public.authorized_devices(id,company_id,branch_id,membership_id,label,active)
      select '{IDS['device_b1']}','{IDS['company_b']}','{IDS['branch_b1']}',m.id,'synthetic B1',true from public.company_memberships m where m.user_id='{user_ids['admin_b']}';
    insert into private.device_token_hashes(device_id,token_hash) values
      ('{IDS['device_a1']}',extensions.digest(convert_to({q(DEVICE['a1'])},'UTF8'),'sha256')),
      ('{IDS['device_a2']}',extensions.digest(convert_to({q(DEVICE['a2'])},'UTF8'),'sha256')),
      ('{IDS['device_b1']}',extensions.digest(convert_to({q(DEVICE['b1'])},'UTF8'),'sha256'));
    insert into private.employee_qr_tokens(employee_id,token_hash) values
      ('{IDS['employee_a1']}',extensions.digest(convert_to({q(QR['a1'])},'UTF8'),'sha256')),
      ('{IDS['employee_a2']}',extensions.digest(convert_to({q(QR['a2'])},'UTF8'),'sha256')),
      ('{IDS['employee_b1']}',extensions.digest(convert_to({q(QR['b1'])},'UTF8'),'sha256'));
    insert into private.employee_pin_credentials(company_id,employee_id,pin_hash) values
      ('{IDS['company_a']}','{IDS['employee_a1']}',extensions.crypt('{PIN}',extensions.gen_salt('bf',4))),
      ('{IDS['company_a']}','{IDS['employee_a2']}',extensions.crypt('{PIN}',extensions.gen_salt('bf',4))),
      ('{IDS['company_b']}','{IDS['employee_b1']}',extensions.crypt('{PIN}',extensions.gen_salt('bf',4)));
    insert into public.attendance_sessions(id,company_id,employee_id,branch_id,local_work_date,timezone,status,started_at,ended_at)
      values('{IDS['session_a']}','{IDS['company_a']}','{IDS['employee_a1']}','{IDS['branch_a1']}',current_date,'America/Mexico_City','closed',now()-interval '8 hours',now()),
            ('{IDS['session_b']}','{IDS['company_b']}','{IDS['employee_b1']}','{IDS['branch_b1']}',current_date,'America/Mexico_City','closed',now()-interval '7 hours',now());
    """
    db(project, sql)


def row_count(project: str, table: str, filters: str = "") -> int:
    status, payload, _ = rest(project, table, query="?select=id" + ("&" + filters if filters else ""))
    if status != 200 or not isinstance(payload, list):
        return -1
    return len(payload)


def identity_ids(users: dict[str, str]) -> bool:
    return set(users) == set(EMAILS) and len(set(users.values())) == 4


def auth_create_source() -> dict[str, str]:
    result = {}
    for role, email in EMAILS.items():
        status, payload, _ = admin_request("source", "/admin/users", "POST",
            {"email": email, "password": PASSWORDS[role], "email_confirm": True,
            "user_metadata": {"fixture": "synthetic restore 9.5d"}})
        if status not in (200, 201) or not isinstance(payload, dict) or not payload.get("id"):
            raise RuntimeError("local Auth Admin API did not create synthetic source account")
        result[role] = str(payload["id"])
        CREATED_USERS["source"][role] = result[role]
    return result


def source_checks(users: dict[str, str]) -> dict[str, str]:
    # 1-12: auth creation, password login, JWT identity, and non-membership.
    for role in EMAILS:
        check("source_user_created_" + role, bool(users.get(role)))
        token, user_id = login("source", role)
        check("source_login_" + role, bool(token) and user_id == users[role])
        status, profile, _ = user_info("source", token) if token else (0, None, {})
        check("source_jwt_" + role, status == 200 and isinstance(profile, dict) and profile.get("id") == users[role])
    seed("source", users)
    # 13-20: row isolation via authenticated PostgREST JWTs.
    tokens = {role: login("source", role)[0] for role in EMAILS}
    for role, company_id, expected in (("admin_a", IDS["company_a"], 1),
                                       ("admin_b", IDS["company_b"], 1),
                                       ("supervisor_a", IDS["company_a"], 1),
                                       ("unassigned", IDS["company_a"], 0)):
        status, rows, _ = rest("source", "attendance_sessions", token=tokens[role],
                               query=f"?select=id&company_id=eq.{company_id}")
        count = len(rows) if isinstance(rows, list) else -1
        check("source_rls_" + role, status == 200 and count == expected)
    for role, company_id in (("admin_a", IDS["company_b"]), ("admin_b", IDS["company_a"]),
                             ("supervisor_a", IDS["company_b"])):
        status, rows, _ = rest("source", "attendance_sessions", token=tokens[role],
                               query=f"?select=id&company_id=eq.{company_id}")
        check("source_cross_tenant_" + role, status == 200 and isinstance(rows, list) and not rows)
    status, _, _ = rest("source", "attendance_sessions", token=None,
                        query=f"?select=id&company_id=eq.{IDS['company_a']}")
    # The anonymous role may receive an empty RLS-filtered read; protected RPCs
    # are explicitly checked for denial after restore below.
    anon_rows = rest("source", "attendance_sessions", token=None,
                     query=f"?select=id&company_id=eq.{IDS['company_a']}")[1]
    db_version = db("source", "select split_part(current_setting('server_version'),'.',1) || '.' || split_part(current_setting('server_version'),'.',2)").strip()
    migration_count = db("source", "select count(*) from supabase_migrations.schema_migrations").strip()
    expected_migrations = len(list((PROJECTS["source"] / "supabase" / "migrations").glob("*.sql")))
    anonymous_read_safe = (status in (401, 403)) or (
        status == 200 and isinstance(anon_rows, list) and not anon_rows)
    check("source_anonymous_postgres17_migrations",
          anonymous_read_safe and db_version.split(".", 1)[0] == "17"
          and migration_count == str(expected_migrations))
    return users


def cleanup_sql(project: str) -> None:
    # Delete only known synthetic IDs/tenant rows in FK order. The company
    # audit trigger is paused within this local cleanup transaction so deleting
    # the synthetic company cannot create a final FK-blocking audit row.
    company_ids = ",".join("'" + IDS[x] + "'" for x in ("company_a", "company_b"))
    db(project, f"""
    begin;
    alter table public.companies disable trigger audit_companies;
    delete from public.attendance_events where company_id in ({company_ids});
    delete from public.attendance_breaks where company_id in ({company_ids});
    delete from public.attendance_adjustments where company_id in ({company_ids});
    delete from public.overtime_authorizations where company_id in ({company_ids});
    delete from public.overtime_assessments where company_id in ({company_ids});
    delete from private.report_export_rate_limits where company_id in ({company_ids});
    delete from public.attendance_sessions where company_id in ({company_ids});
    delete from public.schedule_assignments where company_id in ({company_ids});
    delete from public.schedule_template_days where company_id in ({company_ids});
    delete from public.schedule_templates where company_id in ({company_ids});
    delete from public.break_rules where company_id in ({company_ids});
    delete from public.labor_rule_sets where company_id in ({company_ids});
    delete from private.device_authorization_requests where company_id in ({company_ids});
    delete from public.authorized_devices where company_id in ({company_ids});
    delete from public.supervisor_branches where company_id in ({company_ids});
    delete from public.supervisors where company_id in ({company_ids});
    delete from public.employees where company_id in ({company_ids});
    delete from public.membership_permission_overrides where company_id in ({company_ids});
    delete from public.company_memberships where company_id in ({company_ids});
    delete from public.branches where company_id in ({company_ids});
    delete from public.audit_log where company_id in ({company_ids});
    delete from public.companies where id in ({company_ids});
    alter table public.companies enable trigger audit_companies;
    commit;
    """)


def admin_verified_delete(project: str, role: str, user_id: str) -> bool:
    expected_email = EMAILS[role]
    status, account, _ = admin_request(project, "/admin/users/" + user_id, "GET")
    if status != 200 or not isinstance(account, dict) or account.get("id") != user_id or account.get("email") != expected_email:
        return False
    status, _, _ = admin_request(project, "/admin/users/" + user_id, "DELETE")
    if status not in (200, 204):
        return False
    verify_status, _, _ = admin_request(project, "/admin/users/" + user_id, "GET")
    email_sql = "'" + expected_email.replace("'", "''") + "'"
    direct_count = db(project, f"select count(*) from auth.users where id='{user_id}' or email={email_sql}").strip()
    return verify_status == 404 and direct_count == "0"


def source_cleanup(users: dict[str, str]) -> bool:
    cleanup_sql("source")
    results = [admin_verified_delete("source", role, uid) for role, uid in users.items()]
    return all(results) and db("source", f"select count(*) from public.companies where id in ('{IDS['company_a']}','{IDS['company_b']}')").strip() == "0"


def restore_database() -> tuple[Path, str, str, int, int]:
    encrypted_dump = TEMP / "synthetic.dump.gpg"
    started = time.monotonic()
    # Use the PostgreSQL 17 tool in the source container, with owner/ACL data.
    proc = subprocess.run(["docker", "exec", "supabase_db_qr95d_source", "pg_dump", "-Fc", "-U", "postgres", "-d", "postgres"], capture_output=True, timeout=900)
    if proc.returncode:
        raise RuntimeError("local pg_dump failed")
    import io
    hashes = encrypt_stream(io.BytesIO(proc.stdout), encrypted_dump,
                            (TEMP / "backup.passphrase").read_text(), TEMP / "gnupg")
    source_sha256 = str(hashes["plaintext_sha256"])
    decrypted_bytes, restored_sha256 = decrypt_bytes(
        encrypted_dump, (TEMP / "backup.passphrase").read_text(), TEMP / "gnupg")
    if restored_sha256 != source_sha256:
        raise RuntimeError("decrypted local dump SHA-256 did not match source")
    archive = subprocess.run(["docker", "exec", "-i", "supabase_db_qr95d_restore", "pg_restore", "--list"], input=decrypted_bytes, capture_output=True, timeout=120)
    # Destination container receives the archive on stdin; --list does not touch its database.
    if archive.returncode:
        raise RuntimeError("pg_restore archive listing validation failed")
    dump_ms = int((time.monotonic() - started) * 1000)
    target_names = sorted(n for n in docker_names() if n in {
        "supabase_auth_qr95d_restore", "supabase_rest_qr95d_restore", "supabase_kong_qr95d_restore"})
    keep = "supabase_db_qr95d_restore"
    for name in target_names:
        if name != keep:
            run(["docker", "stop", name], timeout=120)
    run(["docker", "exec", keep, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin",
         "-d", "template1", "-c",
         "select pg_terminate_backend(pid) from pg_stat_activity where datname='postgres' and pid<>pg_backend_pid()"], timeout=60)
    run(["docker", "exec", keep, "dropdb", "-U", "supabase_admin", "--maintenance-db=template1", "--if-exists", "postgres"], timeout=90)
    run(["docker", "exec", keep, "createdb", "-U", "supabase_admin", "--maintenance-db=template1", "--template=template0", "--owner=supabase_admin", "postgres"], timeout=90)
    restore_start = time.monotonic()
    proc = subprocess.run(["docker", "exec", "-i", keep, "pg_restore", "--exit-on-error", "-U", "supabase_admin", "-d", "postgres"], input=decrypted_bytes, capture_output=True, timeout=1200)
    if proc.returncode:
        raise RuntimeError("pg_restore into fresh template0 database failed")
    restore_ms = int((time.monotonic() - restore_start) * 1000)
    for name in target_names:
        if name != keep:
            run(["docker", "start", name], timeout=120)
    deadline = time.time() + 180
    while time.time() < deadline:
        try:
            code, _, _ = http(ENV["restore"]["API_URL"], "/auth/v1/health", timeout=3)
            if code in (200, 204):
                break
        except Exception:
            pass
        time.sleep(2)
    else:
        raise RuntimeError("restored GoTrue did not become healthy")
    return encrypted_dump, source_sha256, restored_sha256, dump_ms, restore_ms


def restored_users(source_ids: dict[str, str]) -> dict[str, str]:
    result = {}
    for role, email in EMAILS.items():
        email_sql = "'" + email.replace("'", "''") + "'"
        rows = db("restore", f"select id::text || '|' || email from auth.users where email={email_sql}")
        match = re.fullmatch(r"([0-9a-f-]+)\|([^\n]+)\n?", rows.strip())
        if not match or match.group(1) != source_ids[role] or match.group(2) != email:
            raise RuntimeError("restored Auth row did not match exact synthetic source identity")
        result[role] = match.group(1)
        CREATED_USERS["restore"][role] = match.group(1)
    return result


def target_checks(source_users: dict[str, str], restored: dict[str, str]) -> None:
    check("target_gotrue_health", http(ENV["restore"]["API_URL"], "/auth/v1/health")[0] in (200, 204))
    check("target_auth_rows_restored", identity_ids(restored) and restored == source_users)
    check("target_user_count_exact", db("restore", "select count(*) from auth.users where email like '%@qr-asistencia.invalid'").strip() == "4")
    migration_ok = True
    for migration in ("20261011232050", "20261012030630"):
        rows = db("restore", f"select count(*) from supabase_migrations.schema_migrations where version='{migration}'")
        migration_ok = migration_ok and rows.strip() == "1"
    check("target_required_migrations", migration_ok)
    tokens = {}
    for role in EMAILS:
        token, uid = login("restore", role)
        tokens[role] = token
        check("target_login_" + role, bool(token) and uid == restored[role])
        status, profile, _ = user_info("restore", token) if token else (0, None, {})
        check("target_jwt_" + role, status == 200 and isinstance(profile, dict) and profile.get("id") == restored[role])
    check("target_login_no_signup", db("restore", "select count(*) from auth.users where email like '%@qr-asistencia.invalid'").strip() == "4")
    for role, company_id, expected in (("admin_a", IDS["company_a"], 1),
                                       ("admin_b", IDS["company_b"], 1),
                                       ("supervisor_a", IDS["company_a"], 1),
                                       ("unassigned", IDS["company_a"], 0)):
        status, rows, _ = rest("restore", "attendance_sessions", token=tokens[role],
                               query=f"?select=id&company_id=eq.{company_id}")
        count = len(rows) if isinstance(rows, list) else -1
        check("target_rls_" + role, status == 200 and count == expected)
    for role, company_id in (("admin_a", IDS["company_b"]), ("admin_b", IDS["company_a"]),
                             ("supervisor_a", IDS["company_b"])):
        status, rows, _ = rest("restore", "attendance_sessions", token=tokens[role],
                               query=f"?select=id&company_id=eq.{company_id}")
        check("target_cross_tenant_" + role, status == 200 and isinstance(rows, list) and not rows)
    sup = tokens["supervisor_a"]
    for label, company, employee, branch, qr in (
        ("a1", "company_a", "employee_a1", "a1", "a1"),
        ("a2", "company_a", "employee_a2", "a2", "a2"),
        ("b1", "company_b", "employee_b1", "b1", "b1")):
        status, payload, _ = rpc("restore", "scan_employee_attendance", {
            "p_company_id": IDS[company], "p_employee_qr_token": QR[qr],
            "p_pin": PIN, "p_device_token": DEVICE[branch]}, sup)
        authorized_status = status == 200 if label == "a1" else status in (401, 403)
        check("target_scanner_" + label, authorized_status and (label != "a1" or isinstance(payload, dict)))
    args = {"p_company_id": IDS["company_a"], "p_employee_qr_token": QR["a1"],
            "p_pin": PIN, "p_device_token": DEVICE["a1"], "p_event": "clock_in",
            "p_idempotency_key": str(uuid.uuid4()), "p_break_rule_id": None}
    status, payload, _ = rpc("restore", "confirm_employee_attendance", args, sup)
    check("target_clock_in", status == 200 and isinstance(payload, dict))
    args["p_event"] = "clock_out"
    args["p_idempotency_key"] = str(uuid.uuid4())
    status, payload, _ = rpc("restore", "confirm_employee_attendance", args, sup)
    check("target_clock_out", status == 200 and isinstance(payload, dict))
    status, _, _ = rpc("restore", "record_attendance_event", {
        "p_company_id": IDS["company_a"], "p_employee_qr_token": QR["a1"],
        "p_device_token": DEVICE["a1"], "p_event": "clock_in",
        "p_idempotency_key": str(uuid.uuid4()), "p_break_rule_id": None}, sup)
    check("target_legacy_rpc_rejected", status in (401, 403))
    status, payload, _ = rpc("restore", "get_employee_credential_status", {
        "p_company_id": IDS["company_a"], "p_employee_id": IDS["employee_a1"]}, tokens["admin_a"])
    check("target_credential_status", status == 200 and isinstance(payload, dict))
    quota = rpc("restore", "consume_report_export_quota", {"p_company_id": IDS["company_a"]}, tokens["admin_a"])
    check("target_quota_own", quota[0] == 200)
    check("target_quota_cross_tenant", rpc("restore", "consume_report_export_quota", {"p_company_id": IDS["company_b"]}, tokens["admin_a"])[0] in (401, 403))
    check("target_quota_unassigned", rpc("restore", "consume_report_export_quota", {"p_company_id": IDS["company_a"]}, tokens["unassigned"])[0] in (401, 403))
    security = db("restore", "select (select relrowsecurity from pg_class where oid='private.report_export_rate_limits'::regclass)::text || '|' || has_function_privilege('anon','public.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid)','EXECUTE')::text || '|' || has_function_privilege('authenticated','public.record_attendance_event(uuid,text,text,public.attendance_event_type,uuid,uuid)','EXECUTE')::text")
    check("target_security_catalog", security.strip() == "true|false|false")
    return tokens


def target_cleanup(restored: dict[str, str]) -> bool:
    cleanup_sql("restore")
    per_user = []
    # Register each identity explicitly after verifying the restored row. Then
    # verify identity via Auth Admin GET before deleting that exact UUID.
    for role in EMAILS:
        uid = restored.get(role)
        if not uid or CREATED_USERS["restore"].get(role) != uid:
            per_user.append(False)
        else:
            per_user.append(admin_verified_delete("restore", role, uid))
    left = db("restore", "select count(*) from auth.users where email like '%@qr-asistencia.invalid'").strip()
    fixtures = db("restore", f"select (select count(*) from public.companies where id in ('{IDS['company_a']}','{IDS['company_b']}')) + (select count(*) from public.employees where id in ('{IDS['employee_a1']}','{IDS['employee_a2']}','{IDS['employee_b1']}'))")
    return all(per_user) and left == "0" and fixtures.strip() == "0"


def prepare() -> None:
    global TEMP, BASELINE_CODE_QR
    # Never operate on remote refs or the existing stack. Snapshot its names.
    names = docker_names()
    BASELINE_CODE_QR = {n for n in names if n.endswith("_codigo_QR")}
    if len(BASELINE_CODE_QR) < 4:
        raise RuntimeError("expected pre-existing codigo_QR stack was not detected; refusing to continue")
    if any("qr95d" in n for n in docker_all_names()) or any("qr95d" in v for v in docker_volumes()) or any("qr95d" in n for n in docker_networks()):
        raise RuntimeError("existing qr95d resources found; refusing to reuse them")
    cli_version = run([str(ROOT / "node_modules/.bin/supabase"), "--version"]).strip()
    if not cli_version.startswith("2."):
        raise RuntimeError("repository-local Supabase CLI unavailable")
    if shutil.which("gpg") is None:
        raise RuntimeError("GnuPG is required for the local encrypted-backup rehearsal")
    TEMP = Path(tempfile.mkdtemp(prefix="qr95d-", dir="/private/tmp"))
    os.chmod(TEMP, 0o700)
    (TEMP / "gnupg").mkdir(mode=0o700)
    (TEMP / "backup.passphrase").write_text(secrets.token_urlsafe(48))
    os.chmod(TEMP / "backup.passphrase", 0o600)
    PORT_OFFSETS["source"] = choose_port_offset(set())
    PORT_OFFSETS["restore"] = choose_port_offset(set(
        int(value) + PORT_OFFSETS["source"] for value in
        re.findall(r"(?m)^port\s*=\s*(\d+)$", (ROOT / "supabase/config.toml").read_text())))
    PROJECTS["source"] = create_project("source", PORT_OFFSETS["source"])
    PROJECTS["restore"] = create_project("restore", PORT_OFFSETS["restore"])


def teardown() -> tuple[bool, str]:
    errors = []
    # Best-effort individual Auth cleanup runs first while local Auth is alive.
    for project in ("restore", "source"):
        for role, uid in list(CREATED_USERS[project].items()):
            try:
                if project in ENV:
                    admin_verified_delete(project, role, uid)
            except Exception:
                pass
    # CLI stop is scoped only to two explicit temp workdirs; no docker prune.
    for project in ("restore", "source"):
        if project in STARTED:
            try:
                cli(project, "stop", "--no-backup", timeout=180, check_rc=False)
            except Exception:
                pass
    # Narrow fallback removes only names with this run's unique project IDs.
    try:
        for name in list(docker_all_names()):
            if name.startswith("supabase_") and (name.endswith("_qr95d_source") or name.endswith("_qr95d_restore")):
                run(["docker", "rm", "-f", name], check_rc=False, timeout=60)
        for volume in list(docker_volumes()):
            if "qr95d_source" in volume or "qr95d_restore" in volume:
                run(["docker", "volume", "rm", volume], check_rc=False, timeout=60)
        if any(n.endswith("_codigo_QR") for n in docker_names()) != bool(BASELINE_CODE_QR):
            errors.append("codigo_QR stack presence changed")
        if {n for n in docker_names() if n.endswith("_codigo_QR")} != BASELINE_CODE_QR:
            errors.append("codigo_QR container set changed")
        if any("qr95d" in n for n in docker_all_names()) or any("qr95d" in v for v in docker_volumes()):
            errors.append("temporary Docker resource remains")
        for network in list(docker_networks()):
            if "qr95d_source" in network or "qr95d_restore" in network:
                run(["docker", "network", "rm", network], check_rc=False, timeout=60)
        if any("qr95d" in network for network in docker_networks()):
            errors.append("temporary Docker network remains")
    except Exception as exc:
        errors.append("Docker teardown verification errored: " + type(exc).__name__)
    if TEMP and TEMP.exists():
        gpgconf = shutil.which("gpgconf")
        if gpgconf and (TEMP / "gnupg").exists():
            try:
                subprocess.run([gpgconf, "--homedir", str(TEMP / "gnupg"),
                                "--kill", "gpg-agent"],
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=10, check=False)
            except (OSError, subprocess.TimeoutExpired):
                errors.append("temporary GnuPG agent cleanup timed out")
        shutil.rmtree(TEMP)
    if TEMP and TEMP.exists():
        errors.append("temporary directory remains")
    return not errors, "; ".join(errors)


def main() -> int:
    failure = None
    dump_info = None
    users = {}
    restored = {}
    try:
        prepare()
        start_project("source")
        start_project("restore")
        users = auth_create_source()
        source_checks(users)
        # Dump is taken before source account/fixture cleanup, includes Auth.
        dump, source_sha256, restored_sha256, dump_ms, restore_ms = restore_database()
        dump_hash = hashlib.sha256(dump.read_bytes()).hexdigest()
        dump_info = (dump.stat().st_size, dump_hash, source_sha256, dump_ms, restore_ms)
        check("backup_archive_integrity", dump.stat().st_size > 100_000 and len(dump_hash) == 64 and not dump.read_bytes().startswith(b"PGDMP"))
        check("backup_decryption_matches_sha256", source_sha256 == restored_sha256)
        source_clean = source_cleanup(users)
        check("source_fixture_and_auth_cleanup", source_clean)
        restored = restored_users(users)
        target_checks(users, restored)
        check("target_restore_duration_recorded", dump_ms > 0 and restore_ms > 0)
        target_clean = target_cleanup(restored)
        check("target_cleanup_individual_auth_ids", target_clean)
    except Exception as exc:
        failure = f"{type(exc).__name__}: {exc}"
        print("HARNESS ERROR: " + failure, file=sys.stderr, flush=True)
    finally:
        clean, detail = teardown()
        # Teardown is a strict independent assertion, not a silent fallback.
        if len(CHECKS) < EXPECTED:
            missing = EXPECTED - len(CHECKS)
            print(f"OMITTED {missing} checks because execution stopped early", flush=True)
        if not clean:
            failure = (failure + "; " if failure else "") + detail
        print(f"TEARDOWN {'PASS' if clean else 'FAIL'}: {detail or 'temporary resources absent; codigo_QR unchanged'}", flush=True)
    result = sum(ok for _, ok, _ in CHECKS)
    failed = sum(not ok for _, ok, _ in CHECKS)
    omitted = max(0, EXPECTED - len(CHECKS))
    print(f"SUMMARY: {result}/{EXPECTED} PASS, {failed} FAIL, {omitted} SKIP; elapsed_ms={int((time.monotonic()-START_TIME)*1000)}")
    if dump_info:
        size, sha, plain_sha, dump_ms, restore_ms = dump_info
        print(f"DUMP: encrypted_bytes={size}, ciphertext_sha256={sha}, plaintext_sha256={plain_sha}, pg_dump_ms={dump_ms}, pg_restore_ms={restore_ms}")
    if failure:
        print("RUN STATUS: FAIL (" + failure + ")")
    success = not failure and clean and len(CHECKS) == EXPECTED and result == EXPECTED and failed == 0 and omitted == 0
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
