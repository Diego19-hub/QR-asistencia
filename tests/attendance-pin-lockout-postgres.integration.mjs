import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Client } = pg;
const connectionString = process.env.PIN_LOCKOUT_DATABASE_URL;
const workdir = process.env.PIN_LOCKOUT_SUPABASE_WORKDIR;

if (!connectionString || !workdir) {
  throw new Error("Set PIN_LOCKOUT_DATABASE_URL and PIN_LOCKOUT_SUPABASE_WORKDIR for disposable local PostgreSQL tests.");
}

const config = await readFile(`${workdir}/supabase/config.toml`, "utf8");
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
const dbSection = config.match(/^\[db\]([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] ?? "";
const configuredPort = Number(dbSection.match(/^port\s*=\s*(\d+)/m)?.[1]);
const url = new URL(connectionString);
const port = Number(url.port || 5432);
assert.match(projectId ?? "", /^qr_pin_lockout_disposable_[A-Za-z0-9_]+$/,
  "refusing to connect unless the Supabase project is marked disposable");
assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname), "database host must be loopback");
assert.equal(port, configuredPort, "database URL port must match the disposable project config");

function isLocalContainerAddress(address) {
  return ["127.0.0.1", "::1"].includes(address)
    || /^10\./.test(address)
    || /^192\.168\./.test(address)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address)
    || /^(fc|fd|fe80:)/i.test(address);
}

const companyA = randomUUID();
const companyB = randomUUID();
const branchA = randomUUID();
const branchB = randomUUID();
const employeeA = randomUUID();
const employeeConcurrent = randomUUID();
const employeeB = randomUUID();
const supervisorUser = randomUUID();
const supervisorMembership = randomUUID();
const deviceId = randomUUID();
const deviceToken = randomBytes(36).toString("base64url");
const qrTokenA = randomBytes(36).toString("base64url");
const qrTokenConcurrent = randomBytes(36).toString("base64url");

async function withClient(callback) {
  const client = new Client({ connectionString });
  await client.connect();
  try { return await callback(client); }
  finally { await client.end(); }
}

async function verify(companyId, employeeId, pin) {
  return withClient(async (client) => {
    const [{ rows: [{ backend_pid: backendPid }] }] = [await client.query("select pg_backend_pid() as backend_pid")];
    await client.query("begin");
    try {
      const { rows: [{ result }] } = await client.query(
        "select private.verify_employee_pin($1::uuid,$2::uuid,$3::text) as result",
        [companyId, employeeId, pin],
      );
      await client.query("commit");
      return { ...result, backendPid };
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

async function readCredential(employeeId) {
  return withClient(async (client) => {
    const { rows: [row] } = await client.query(
      "select failed_attempts::integer as failed_attempts, locked_until from private.employee_pin_credentials where employee_id=$1::uuid",
      [employeeId],
    );
    return row;
  });
}

async function scannerRpc(action, employeeQrToken, pin, suppliedDeviceToken = deviceToken) {
  return withClient(async (client) => {
    await client.query("begin");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.role','authenticated',true)");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [supervisorUser]);
      await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: "authenticated", sub: supervisorUser })]);
      const query = action === "preview"
        ? "select public.scan_employee_attendance($1::uuid,$2::text,$3::text,$4::text) as result"
        : "select public.confirm_employee_attendance($1::uuid,$2::text,$3::text,$4::text,'clock_in'::public.attendance_event_type,$5::uuid,null) as result";
      const values = action === "preview"
        ? [companyA, employeeQrToken, pin, suppliedDeviceToken]
        : [companyA, employeeQrToken, pin, suppliedDeviceToken, randomUUID()];
      const { rows: [{ result }] } = await client.query(query, values);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

await withClient(async (client) => {
    const { rows: [{ server_address: serverAddress, server_port: serverPort }] } = await client.query(
      "select inet_server_addr()::text as server_address, inet_server_port() as server_port",
    );
    assert.ok(isLocalContainerAddress(serverAddress), "PostgreSQL must report a loopback or private container address");
    assert.equal(Number(serverPort), 5432, "connected PostgreSQL must be the isolated local container database");
    await client.query("begin");
    try {
      await client.query("insert into public.companies(id,name) values ($1::uuid,'PIN integration disposable A ' || ($1::uuid)::text),($2::uuid,'PIN integration disposable B ' || ($2::uuid)::text)", [companyA, companyB]);
      await client.query("insert into public.branches(id,company_id,name,timezone) values ($1,$3,'PIN test A','UTC'),($2,$4,'PIN test B','UTC')", [branchA, branchB, companyA, companyB]);
      await client.query("insert into public.employees(id,company_id,branch_id,employee_number,first_name,last_name) values ($1,$4,$5,'PIN-LOCK-A','Prueba','Secuencial'),($2,$4,$5,'PIN-LOCK-CONCURRENT','Prueba','Concurrente'),($3,$6,$7,'PIN-LOCK-B','Prueba','Empresa B')", [employeeA, employeeConcurrent, employeeB, companyA, branchA, companyB, branchB]);
      await client.query("insert into private.employee_pin_credentials(company_id,employee_id,pin_hash) values ($1,$2,extensions.crypt('123456',extensions.gen_salt('bf',4))),($1,$3,extensions.crypt('123456',extensions.gen_salt('bf',4))),($4,$5,extensions.crypt('123456',extensions.gen_salt('bf',4)))", [companyA, employeeA, employeeConcurrent, companyB, employeeB]);
      await client.query("insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values ($1,'authenticated','authenticated',$2,'','now()','now()','now()')", [supervisorUser, `pin-lockout-${supervisorUser}@example.invalid`]);
      await client.query("insert into public.company_memberships(id,company_id,user_id,role,active) values ($1,$2,$3,'supervisor',true)", [supervisorMembership, companyA, supervisorUser]);
      await client.query("insert into public.supervisors(company_id,membership_id) values ($1,$2)", [companyA, supervisorMembership]);
      await client.query("insert into public.supervisor_branches(company_id,membership_id,branch_id) values ($1,$2,$3)", [companyA, supervisorMembership, branchA]);
      await client.query("insert into public.authorized_devices(id,company_id,branch_id,membership_id,label) values ($1,$2,$3,$4,'Disposable PIN integration device')", [deviceId, companyA, branchA, supervisorMembership]);
      await client.query("insert into private.device_token_hashes(device_id,token_hash) values ($1,extensions.digest(convert_to($2,'UTF8'),'sha256'))", [deviceId, deviceToken]);
      await client.query("insert into private.employee_qr_tokens(employee_id,token_hash) values ($1,extensions.digest(convert_to($2,'UTF8'),'sha256')),($3,extensions.digest(convert_to($4,'UTF8'),'sha256'))", [employeeA, qrTokenA, employeeConcurrent, qrTokenConcurrent]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
});

  for (let expected = 1; expected <= 4; expected += 1) {
    const action = expected % 2 === 0 ? "confirm" : "preview";
    const attempt = await scannerRpc(action, qrTokenA, "000000");
    assert.equal(attempt.pinError, "pin_invalid", `${action} attempt ${expected} should be rejected`);
    const persisted = await readCredential(employeeA);
    assert.equal(persisted.failed_attempts, expected, `attempt ${expected} must persist across transaction and connection boundaries`);
    assert.equal(persisted.locked_until, null, `attempt ${expected} should not lock early`);
  }

  const fifth = await scannerRpc("confirm", qrTokenA, "000000");
  assert.equal(fifth.pinError, "pin_locked", "fifth failure should activate lockout through confirmation");
  const fifthPersisted = await readCredential(employeeA);
  assert.equal(fifthPersisted.failed_attempts, 5);
  assert.ok(new Date(fifthPersisted.locked_until).getTime() > Date.now());
  assert.ok(new Date(fifthPersisted.locked_until).getTime() <= Date.now() + 15 * 60 * 1000 + 5000);

  assert.equal((await scannerRpc("preview", qrTokenA, "000000")).pinError, "pin_locked", "sixth request stays locked through preview");
  assert.equal((await scannerRpc("confirm", qrTokenA, "123456")).pinError, "pin_locked", "correct PIN stays locked during confirmation lockout");
  assert.equal((await readCredential(employeeA)).failed_attempts, 5);

  await withClient((client) => client.query(
    "update private.employee_pin_credentials set locked_until=clock_timestamp()-interval '1 second' where employee_id=$1::uuid",
    [employeeA],
  ));
  const afterExpiration = await scannerRpc("preview", qrTokenA, "123456");
  assert.equal(afterExpiration.employeeId, employeeA, "correct PIN is accepted by preview after expiry");
  assert.equal((await readCredential(employeeA)).failed_attempts, 0, "successful PIN resets the counter in a committed transaction");

  const simultaneous = await Promise.all(Array.from({ length: 12 }, () => scannerRpc("preview", qrTokenConcurrent, "000000")));
  assert.equal(simultaneous.filter(({ pinError }) => pinError === "pin_invalid").length, 4, "only the first four concurrent failures remain ordinary failures");
  assert.equal(simultaneous.filter(({ pinError }) => pinError === "pin_locked").length, 8, "the fifth and later concurrent requests observe lockout");
  const concurrentPersisted = await readCredential(employeeConcurrent);
  assert.equal(concurrentPersisted.failed_attempts, 5, "concurrent counter updates do not get lost or exceed the cap");
  assert.ok(new Date(concurrentPersisted.locked_until).getTime() > Date.now());

  assert.equal((await verify(companyA, employeeB, "000000")).status, "unavailable", "cross-company employee IDs are rejected");
  assert.equal((await readCredential(employeeB)).failed_attempts, 0, "cross-company attempts do not affect another tenant");

  const blockedCounts = await withClient(async (client) => {
    const { rows: [{ events, sessions }] } = await client.query(
      "select (select count(*)::integer from public.attendance_events where company_id=$1) as events, (select count(*)::integer from public.attendance_sessions where company_id=$1) as sessions",
      [companyA],
    );
    return { events, sessions };
  });
  assert.equal(blockedCounts.events, 0, "invalid or blocked confirmations never record attendance events");
  assert.equal(blockedCounts.sessions, 0, "invalid or blocked confirmations never create attendance sessions");

  await withClient((client) => client.query("update private.employee_qr_tokens set revoked_at=clock_timestamp() where employee_id=$1::uuid", [employeeA]));
  await assert.rejects(scannerRpc("preview", qrTokenA, "123456"), (error) => error.code === "P0002", "revoked QR is rejected");
  await assert.rejects(scannerRpc("preview", qrTokenConcurrent, "123456", "unauthorized-device"), (error) => error.code === "42501", "unauthorized device is rejected");

  console.log("PASS: scanner RPCs commit attempts 1–5 across transactions, enforce lockout/expiry, reject revoked or unauthorized credentials, record no blocked attendance, and serialize 12 concurrent requests.");
