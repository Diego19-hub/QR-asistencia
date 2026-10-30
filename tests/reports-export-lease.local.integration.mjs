#!/usr/bin/env node
/* Strict local-only integration: isolated Supabase stack, fresh Auth users, JWT RPC race, and local HTTP route. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import { inflateSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import ExcelJS from "exceljs";
import pg from "pg";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "node_modules/.bin/supabase");
const projectId = "qrlease" + randomBytes(5).toString("hex");
const remoteIds = ["llxyziffgtqnzlguxhyt", "jawdrhewabqajxnswhkn"];
const exclude = "realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
const checks = [];
const fixtures = { users: [], companies: [] };
let temp, server, pool, apiUrl, anonKey, serviceKey, dbUrl, service, serverOutput = "";
let preexistingQrContainers;

function pass(name) { checks.push(name); process.stdout.write(`PASS ${checks.length} ${name}\n`); }
function assertLocal(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} is not a URL`); }
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname), `${label} must use loopback`);
  assert.ok(!remoteIds.some((id) => value.includes(id)), `${label} includes a prohibited remote project ID`);
}
function cliRun(args, timeout = 900_000) {
  const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", CI: "1" };
  for (const key of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_REF", "SUPABASE_PROJECT_ID", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) delete env[key];
  try { return execFileSync(cli, [...args, "--workdir", join(temp, "project")], { cwd: root, env, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (error) {
    // Preserve enough local CLI output to diagnose CI failures without leaking credentials.
    let diagnostic = `${error?.stderr ?? ""}\n${error?.stdout ?? ""}`;
    diagnostic = diagnostic
      .replace(/https?:\/\/[^\s)]+/g, "[url]")
      .replace(/postgres(?:ql)?:\/\/[^\s)]+/gi, "[database-url]")
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
      .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/gi, "[supabase-key]")
      .replace(/(?:SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|ANON_KEY|SERVICE_ROLE_KEY)\s*=\s*[^\s,]+/gi, "[credential-assignment]")
      .replace(/(?:service_role|anon|publishable)[=: ]+[A-Za-z0-9_.-]{24,}/gi, "[credential]")
      .split(/\r?\n/).filter(Boolean).slice(-10).join(" | ").slice(0, 1200);
    throw new Error(`local Supabase CLI command failed: ${args.slice(0, 2).join(" ")}${diagnostic ? `: ${diagnostic}` : " (no diagnostic output)"}`);
  }
}
async function freePort(start) {
  for (let base = start; base < start + 500; base += 10) {
    const tests = await Promise.all(Array.from({ length: 10 }, (_, n) => new Promise((done) => {
      const socket = net.createServer(); socket.once("error", () => done(false)); socket.listen(base + n, "127.0.0.1", () => socket.close(() => done(true)));
    })));
    if (tests.every(Boolean)) return base;
  }
  throw new Error("no free local port range");
}
function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => { const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/); return m ? [[m[1], m[2].replace(/^['"]|['"]$/g, "")]] : []; }));
}
async function waitForApp(url) {
  const end = Date.now() + 180_000;
  while (Date.now() < end) {
    if (server.exitCode !== null) throw new Error(`temporary Next.js server exited: ${sanitizeServerOutput(serverOutput)}`);
    try { const response = await fetch(url); if (response.status < 500) return; } catch {}
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("temporary Next.js server did not become ready");
}
function sanitizeServerOutput(text) {
  let safe = text;
  for (const secret of [anonKey, serviceKey, dbUrl]) if (secret) safe = safe.split(secret).join("[redacted]");
  safe = safe.replace(/https?:\/\/[^\s)]+/g, "[url]");
  return safe.split(/\r?\n/).filter(Boolean).slice(-8).join(" | ").slice(0, 700) || "no diagnostic";
}
async function makeUser(label, role, companyName) {
  const email = `${label}-${randomUUID()}@qr-asistencia.invalid`;
  const password = randomBytes(32).toString("base64url");
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`Auth fixture creation failed for ${label}`);
  const userId = created.data.user.id;
  fixtures.users.push(userId);
  const companyResult = await service.from("companies").insert({ name: companyName }).select("id").single();
  if (companyResult.error || !companyResult.data) throw new Error(`company fixture creation failed for ${label}`);
  const companyId = companyResult.data.id;
  fixtures.companies.push(companyId);
  const membershipResult = await service.from("company_memberships").insert({ company_id: companyId, user_id: userId, role, active: true });
  if (membershipResult.error) throw new Error(`membership fixture creation failed for ${label}`);
  const client = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) throw new Error(`real local Auth login failed for ${label} (status=${login.error?.status ?? "none"}, code=${login.error?.code ?? "none"})`);
  const identity = await client.auth.getUser();
  if (identity.error || identity.data.user?.id !== userId) throw new Error(`local JWT identity mismatch for ${label}`);
  const jar = new Map();
  const ssr = createServerClient(apiUrl, anonKey, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (items) => items.forEach(({ name, value }) => jar.set(name, value)) } });
  const ssrLogin = await ssr.auth.signInWithPassword({ email, password });
  if (ssrLogin.error) throw new Error(`local SSR cookie login failed for ${label}`);
  return { userId, companyId, client, cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
}
function rowOf(data) { return Array.isArray(data) ? data[0] : data; }
async function acquire(user, companyId, token = randomUUID()) {
  const result = await user.client.rpc("acquire_report_export_lease", { p_company_id: companyId, p_owner_token: token, p_lease_seconds: 60 });
  return { ...result, token, row: rowOf(result.data) };
}
async function quotaCount(companyId, userId) {
  const result = await pool.query("select coalesce(sum(request_count),0)::int n from private.report_export_rate_limits where company_id=$1 and user_id=$2 and window_started_at >= to_timestamp(floor(extract(epoch from clock_timestamp())/300)*300)", [companyId, userId]);
  return result.rows[0].n;
}
function extractPdfHexText(bytes) {
  const source = bytes.toString("latin1");
  const chunks = [];
  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      const inflated = inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
      for (const hex of inflated.matchAll(/<([a-f\d]{4,})>/gi)) chunks.push(Buffer.from(hex[1], "hex").toString("latin1"));
    } catch { /* Non-Flate streams carry no text used by this synthetic-content assertion. */ }
  }
  return chunks.join("");
}
async function deleteFixtures() {
  if (!service) return;
  const companyIds = [...fixtures.companies];
  const userIds = [...fixtures.users];
  for (const companyId of [...companyIds].reverse()) {
    // Remove the synthetic attendance/report and device rows in FK order
    // before deleting their supervisor memberships.
    for (const table of [
      "attendance_events", "attendance_breaks", "attendance_adjustments", "overtime_authorizations", "overtime_assessments",
      "attendance_sessions", "schedule_assignments", "schedule_template_breaks", "schedule_template_days", "schedule_templates",
      "break_rules", "authorized_devices", "supervisor_branches", "supervisors", "employees", "branches",
    ]) {
      const removed = await service.from(table).delete().eq("company_id", companyId);
      if (removed.error) throw new Error(`failed deleting synthetic ${table} fixtures`);
    }
    const memberships = await service.from("company_memberships").delete().eq("company_id", companyId);
    if (memberships.error) throw new Error("failed deleting synthetic membership");
  }
  for (const userId of [...userIds].reverse()) {
    const deleted = await service.auth.admin.deleteUser(userId);
    if (deleted.error) throw new Error("failed deleting synthetic Auth user");
  }
  for (const userId of userIds) {
    const lookup = await service.auth.admin.getUserById(userId);
    if (!lookup.error && lookup.data.user) throw new Error("synthetic Auth user still exists after cleanup");
  }
  if (companyIds.length) {
    const remaining = await service.from("company_memberships").select("id").in("company_id", companyIds);
    if (remaining.error || remaining.data?.length) throw new Error("synthetic memberships remain after cleanup");
  }
  fixtures.companies = []; fixtures.users = [];
}
function dockerList(kind) {
  const args = kind === "containers" ? ["container", "ls", "-a", "--format", "{{.Names}}"]
    : kind === "volumes" ? ["volume", "ls", "--format", "{{.Name}}"]
      : ["network", "ls", "--format", "{{.Name}}"];
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split(/\r?\n/).filter(Boolean);
}

try {
  preexistingQrContainers = dockerList("containers").filter((name) => name.includes("codigo_QR")).sort();
  temp = await mkdtemp(join(tmpdir(), "qr-export-lease-"));
  const workdir = join(temp, "project");
  await mkdir(join(workdir, "supabase", "migrations"), { recursive: true });
  await cp(join(root, "supabase/migrations"), join(workdir, "supabase/migrations"), { recursive: true });
  await cp(join(root, "supabase/tests"), join(workdir, "supabase/tests"), { recursive: true });
  await cp(join(root, "supabase/templates"), join(workdir, "supabase/templates"), { recursive: true });
  let config = await readFile(join(root, "supabase/config.toml"), "utf8");
  const base = await freePort(55_000 + Math.floor(Math.random() * 1_500));
  config = config.replace('project_id = "codigo_QR"', `project_id = "${projectId}"`)
    .replace("port = 54321", `port = ${base}`).replace("port = 54322", `port = ${base + 1}`)
    .replace("shadow_port = 54320", `shadow_port = ${base + 2}`).replace("port = 54323", `port = ${base + 3}`)
    .replace("port = 54324", `port = ${base + 4}`).replace("port = 54329", `port = ${base + 9}`).replace("port = 54327", `port = ${base + 7}`);
  await writeFile(join(workdir, "supabase/config.toml"), config, { mode: 0o600 });
  cliRun(["start", "--exclude", exclude]);
  cliRun(["db", "reset", "--local"]);
  const values = parseEnv(cliRun(["status", "--output", "env"]));
  apiUrl = values.API_URL; anonKey = values.ANON_KEY; serviceKey = values.SERVICE_ROLE_KEY; dbUrl = values.DB_URL;
  assertLocal(apiUrl, "local API"); assertLocal(dbUrl, "local database");
  assert.ok(anonKey && serviceKey && anonKey !== serviceKey);
  assert.ok(projectId.startsWith("qrlease") && !remoteIds.includes(projectId));
  pool = new pg.Pool({ connectionString: dbUrl, max: 2 }); await pool.query("select 1");
  pass("new disposable Supabase stack is loopback-only with unique project ID and ports");
  pass("all versioned migrations applied to a fresh local database");
  cliRun(["test", "db", "--local", "supabase/tests/reports_export_lease_test.sql"]);
  pass("13 pgTAP checks verify private table, RLS, grants and non-cascading global mutex");
  service = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminA = await makeUser("lease-admin-a", "admin", "Lease Synthetic A");
  const adminB = await makeUser("lease-admin-b", "admin", "Lease Synthetic B");
  const supervisor = await makeUser("lease-supervisor", "supervisor", "Lease Synthetic Supervisor");
  pass("three synthetic Auth accounts log in and their JWT identities are verified");

  const race = await Promise.all([acquire(adminA, adminA.companyId), acquire(adminB, adminB.companyId)]);
  assert.equal(race.filter((x) => !x.error && x.row?.acquired === true).length, 1);
  assert.equal(race.filter((x) => !x.error && x.row?.acquired === false).length, 1);
  const raceWinner = race.find((x) => x.row?.acquired);
  const raceOwner = raceWinner.token === race[0].token ? adminA : adminB;
  assert.equal((await raceOwner.client.rpc("release_report_export_lease", { p_company_id: raceOwner.companyId, p_owner_token: raceWinner.token })).data, true);
  pass("real PostgREST JWT race across two companies grants one global lease; release reopens it");

  const burst = await Promise.all(Array.from({ length: 12 }, async (_, i) => {
    const owner = i % 2 ? adminA : adminB;
    return { owner, ...(await acquire(owner, owner.companyId)) };
  }));
  assert.equal(burst.filter((x) => !x.error && x.row?.acquired === true).length, 1);
  assert.equal(burst.filter((x) => !x.error && x.row?.acquired === false).length, 11);
  const burstWinner = burst.find((x) => x.row?.acquired); const burstOwner = burstWinner.owner;
  assert.equal((await burstOwner.client.rpc("release_report_export_lease", { p_company_id: burstOwner.companyId, p_owner_token: burstWinner.token })).data, true);
  pass("real 12-request cross-company RPC burst yields one holder and eleven rejections");

  const oldLease = await acquire(adminA, adminA.companyId); assert.equal(oldLease.row?.acquired, true);
  await pool.query("update private.report_export_leases set acquired_at=clock_timestamp()-interval '2 minutes', renewed_at=clock_timestamp()-interval '2 minutes', expires_at=clock_timestamp()-interval '1 second' where lease_key='global'");
  const newLease = await acquire(adminB, adminB.companyId); assert.equal(newLease.row?.acquired, true);
  assert.equal((await adminA.client.rpc("renew_report_export_lease", { p_company_id: adminA.companyId, p_owner_token: oldLease.token, p_lease_seconds: 60 })).data, false);
  assert.equal((await adminA.client.rpc("release_report_export_lease", { p_company_id: adminA.companyId, p_owner_token: oldLease.token })).data, false);
  const activeLease = await pool.query("select company_id,user_id,expires_at>clock_timestamp() active from private.report_export_leases where lease_key='global'");
  assert.equal(activeLease.rows[0].company_id, adminB.companyId); assert.equal(activeLease.rows[0].user_id, adminB.userId); assert.equal(activeLease.rows[0].active, true);
  assert.equal((await adminB.client.rpc("renew_report_export_lease", { p_company_id: adminB.companyId, p_owner_token: newLease.token, p_lease_seconds: 60 })).data, true);
  assert.equal((await adminB.client.rpc("release_report_export_lease", { p_company_id: adminB.companyId, p_owner_token: newLease.token })).data, true);
  pass("abandoned lease expires, successor renews, stale owner cannot release successor");

  const foreign = await acquire(adminA, adminB.companyId); assert.equal(foreign.error?.code, "42501");
  const supervisorAttempt = await acquire(supervisor, supervisor.companyId); assert.equal(supervisorAttempt.error?.code, "42501");
  const anonymous = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anonAttempt = await anonymous.rpc("acquire_report_export_lease", { p_company_id: adminA.companyId, p_owner_token: randomUUID(), p_lease_seconds: 60 });
  assert.ok(anonAttempt.error && [401, 403].includes(anonAttempt.error.status ?? 403));
  assert.equal(Number((await pool.query("select count(*) n from private.report_export_leases")).rows[0].n), 0);
  pass("foreign-company admin, supervisor and anon are rejected without acquiring the lease");

  const nextPort = await freePort(base + 20); const appUrl = `http://127.0.0.1:${nextPort}`;
  const appRoot = join(temp, "next-app");
  await mkdir(appRoot, { recursive: true });
  await cp(join(root, "src"), join(appRoot, "src"), { recursive: true });
  for (const file of ["package.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json"]) await cp(join(root, file), join(appRoot, file));
  await symlink(join(root, "node_modules"), join(appRoot, "node_modules"), "dir");
  const nextEnv = {
    PATH: process.env.PATH,
    NODE_ENV: "development",
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(nextPort)], { cwd: appRoot, env: nextEnv, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk) => { serverOutput = (serverOutput + chunk.toString()).slice(-12_000); });
  server.stderr.on("data", (chunk) => { serverOutput = (serverOutput + chunk.toString()).slice(-12_000); });
  await waitForApp(`${appUrl}/login`);
  pass("temporary Next.js development server targets only the local Supabase stack");

  const createReportFixture = async (user, marker, branchName) => {
    const branch = await service.from("branches").insert({ company_id: user.companyId, name: branchName, timezone: "UTC" }).select("id").single();
    if (branch.error || !branch.data) throw new Error("synthetic report branch creation failed");
    const employee = await service.from("employees").insert({
      company_id: user.companyId, branch_id: branch.data.id, employee_number: `SYN-${marker}`, first_name: marker, last_name: "S", active: true,
    }).select("id").single();
    if (employee.error || !employee.data) throw new Error("synthetic report employee creation failed");
    const membership = await pool.query("select id from public.company_memberships where company_id=$1 and user_id=$2 and active", [user.companyId, user.userId]);
    if (!membership.rows[0]) throw new Error("synthetic report admin membership is missing");
    const supervisor = await service.from("supervisors").insert({ company_id: user.companyId, membership_id: membership.rows[0].id });
    if (supervisor.error) throw new Error("synthetic report device membership setup failed");
    const device = await service.from("authorized_devices").insert({
      company_id: user.companyId, branch_id: branch.data.id, membership_id: membership.rows[0].id, label: `Synthetic report device ${marker}`,
    }).select("id").single();
    if (device.error || !device.data) throw new Error("synthetic report device creation failed");
    const session = await service.from("attendance_sessions").insert({
      company_id: user.companyId, employee_id: employee.data.id, branch_id: branch.data.id, local_work_date: "2026-10-10", timezone: "UTC",
      status: "open", started_at: "2026-10-10T09:00:00Z", scheduled_minutes: 480,
    }).select("id").single();
    if (session.error || !session.data) throw new Error("synthetic report session creation failed");
    const event = await service.from("attendance_events").insert({
      company_id: user.companyId, session_id: session.data.id, event_type: "clock_in", sequence_no: 1,
      occurred_at: "2026-10-10T09:00:00Z", recorded_by: user.userId, device_id: device.data.id, idempotency_key: randomUUID(),
      metadata: { fixture: "qr004-report-export-synthetic" },
    });
    if (event.error) throw new Error("synthetic report event creation failed");
    return { ...user, branchId: branch.data.id, employeeId: employee.data.id, sessionId: session.data.id, marker };
  };
  const reportFixtureA = await createReportFixture(adminA, "TENANTA", "Synthetic report branch A");
  const reportFixtureB = await createReportFixture(adminB, "TENANTB", "Synthetic report branch B");
  const jsonReport = async (fixture) => {
    const response = await fetch(new URL(`/api/reports?companyId=${fixture.companyId}&from=2026-10-10&to=2026-10-10`, appUrl), { headers: { cookie: fixture.cookie }, redirect: "manual" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, private");
    return response.json();
  };
  const jsonA = await jsonReport(reportFixtureA);
  const jsonB = await jsonReport(reportFixtureB);
  assert.ok(jsonA.rows.some((row) => row.employeeName.includes(reportFixtureA.marker)));
  assert.ok(!JSON.stringify(jsonA).includes(reportFixtureB.marker), "company A JSON report excludes company B employee sentinel");
  assert.ok(jsonB.rows.some((row) => row.employeeName.includes(reportFixtureB.marker)));
  assert.ok(!JSON.stringify(jsonB).includes(reportFixtureA.marker), "company B JSON report excludes company A employee sentinel");
  pass("HTTP report JSON includes each tenant's synthetic session and excludes the other tenant's employee/session data");

  for (const fixture of [reportFixtureA, reportFixtureB]) {
    for (const format of ["xlsx", "pdf"]) {
      const response = await fetch(new URL(`/api/reports/export?companyId=${fixture.companyId}&from=2026-10-10&to=2026-10-10&format=${format}`, appUrl), { headers: { cookie: fixture.cookie }, redirect: "manual" });
      assert.equal(response.status, 200, `${format} export is generated for an authorized synthetic company`);
      assert.equal(response.headers.get("cache-control"), "no-store, private");
      assert.match(response.headers.get("content-disposition") ?? "", new RegExp(`\\.${format}`));
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.ok(bytes.length > 100);
      const otherMarker = fixture.companyId === reportFixtureA.companyId ? reportFixtureB.marker : reportFixtureA.marker;
      if (format === "xlsx") {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes);
        const text = workbook.worksheets.flatMap((sheet) => sheet.getSheetValues().flat()).join(" ");
        assert.ok(text.includes(fixture.marker), "Excel export contains its own synthetic employee marker");
        assert.ok(!text.includes(otherMarker), "Excel export excludes the other tenant's synthetic employee marker");
      } else {
        assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
        const text = extractPdfHexText(bytes);
        assert.ok(text.includes(fixture.marker), "PDF text streams contain their own synthetic employee marker");
        assert.ok(!text.includes(otherMarker), "PDF text streams exclude the other tenant's synthetic employee marker");
      }
      const foreignCompanyId = fixture.companyId === reportFixtureA.companyId ? reportFixtureB.companyId : reportFixtureA.companyId;
      const denied = await fetch(new URL(`/api/reports/export?companyId=${foreignCompanyId}&from=2026-10-10&to=2026-10-10&format=${format}`, appUrl), { headers: { cookie: fixture.cookie }, redirect: "manual" });
      assert.equal(denied.status, 403, "foreign-company export is denied before returning a file");
    }
  }
  pass("PDF and XLSX bytes contain own-tenant synthetic report rows, omit foreign sentinels, and reject foreign exports");

  const adminAMembershipId = (await pool.query("select id from public.company_memberships where company_id=$1 and user_id=$2", [adminA.companyId, adminA.userId])).rows[0].id;
  const override = await service.from("membership_permission_overrides").insert({
    company_id: adminA.companyId, membership_id: adminAMembershipId,
    permission_code: "reports.read", allowed: false,
  });
  if (override.error) throw new Error("could not prepare synthetic reports.read denial for export API");
  const quotaBeforePermissionDenial = await quotaCount(adminA.companyId, adminA.userId);
  const deniedExport = await fetch(new URL(`/api/reports/export?companyId=${adminA.companyId}&from=2026-10-10&to=2026-10-10&format=xlsx`, appUrl), { headers: { cookie: adminA.cookie }, redirect: "manual" });
  assert.equal(deniedExport.status, 403, "export endpoint enforces reports.read before returning a file");
  assert.equal(await quotaCount(adminA.companyId, adminA.userId), quotaBeforePermissionDenial, "denied export does not consume quota");
  assert.equal(Number((await pool.query("select count(*) n from private.report_export_leases")).rows[0].n), 0, "denied export releases its lease");
  await service.from("membership_permission_overrides").delete().eq("company_id", adminA.companyId).eq("membership_id", adminAMembershipId).eq("permission_code", "reports.read");
  pass("reports.read denial blocks export without consuming quota or retaining the global lease");

  const foreignHttp = await fetch(new URL(`/api/reports/export?companyId=${adminA.companyId}&from=2026-10-01&to=2026-10-11&format=xlsx`, appUrl), { headers: { cookie: adminB.cookie }, redirect: "manual" });
  assert.equal(foreignHttp.status, 403);
  assert.equal(Number((await pool.query("select count(*) n from private.report_export_leases")).rows[0].n), 0);
  const held = await acquire(adminA, adminA.companyId); assert.equal(held.row?.acquired, true);
  const quotaBefore = await quotaCount(adminB.companyId, adminB.userId);
  const path = `/api/reports/export?companyId=${adminB.companyId}&from=2026-10-01&to=2026-10-11&format=xlsx`;
  const blocked = await Promise.all(Array.from({ length: 8 }, () => fetch(new URL(path, appUrl), { headers: { cookie: adminB.cookie }, redirect: "manual" })));
  assert.ok(blocked.every((response) => response.status === 429 && response.headers.get("retry-after")));
  const blockedBodies = await Promise.all(blocked.map((response) => response.json()));
  assert.ok(blockedBodies.every((body) => body?.error?.code === "export_concurrency_limited"));
  assert.equal(await quotaCount(adminB.companyId, adminB.userId), quotaBefore);
  await adminA.client.rpc("release_report_export_lease", { p_company_id: adminA.companyId, p_owner_token: held.token });
  pass("HTTP cross-company request is denied; 429 concurrency burst includes Retry-After and does not consume quota");

  for (const format of ["xlsx", "pdf"]) {
    const response = await fetch(new URL(path.replace("format=xlsx", `format=${format}`), appUrl), { headers: { cookie: adminB.cookie }, redirect: "manual" });
    assert.equal(response.status, 200, `${format} route succeeds after the lease is available`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 100);
    assert.equal(format === "xlsx" ? bytes.subarray(0, 2).toString() : bytes.subarray(0, 5).toString(), format === "xlsx" ? "PK" : "%PDF-");
    assert.equal(Number((await pool.query("select count(*) n from private.report_export_leases")).rows[0].n), 0, "lease releases only after response body is consumed");
  }
  pass("HTTP XLSX/PDF complete and release the DB lease after their response bodies finish");

  const anonymousHttp = await fetch(new URL(`/api/reports/export?companyId=${adminB.companyId}&from=2026-10-01&to=2026-10-11&format=pdf`, appUrl));
  assert.equal(anonymousHttp.status, 401);
  assert.equal(Number((await pool.query("select count(*) n from private.report_export_leases")).rows[0].n), 0);
  pass("unauthenticated HTTP export fails before lease acquisition");

  const companyIds = [...fixtures.companies]; const userIds = [...fixtures.users];
  await deleteFixtures();
  const remaining = await pool.query("select count(*)::int n from public.company_memberships where company_id=any($1::uuid[])", [companyIds]);
  assert.equal(Number(remaining.rows[0].n), 0);
  for (const userId of userIds) {
    const lookup = await service.auth.admin.getUserById(userId);
    assert.ok(lookup.error || !lookup.data.user, "synthetic Auth user was removed individually");
  }
  pass("synthetic memberships and Auth identities removed; company fixtures remain only in the disposable DB volume");
  assert.equal(checks.length, 16, "all mandatory local integration checks must execute");
} catch (error) {
  process.stderr.write(`FAIL local export lease integration: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await new Promise((done) => server.once("exit", done)); }
  try { await deleteFixtures(); }
  catch (error) {
    process.stderr.write(`CLEANUP FAIL: ${error instanceof Error ? error.message : "fixture cleanup failed"}\n`);
    process.exitCode = 1;
  }
  await pool?.end().catch(() => {});
  if (temp) {
    try { cliRun(["stop", "--project-id", projectId, "--no-backup"], 300_000); }
    catch { process.stderr.write("CLEANUP FAIL: Supabase CLI could not confirm stack stop\n"); process.exitCode = 1; }
    try {
      const leftovers = ["containers", "volumes", "networks"].flatMap((kind) => dockerList(kind).filter((name) => name.includes(projectId)).map((name) => `${kind}:${name}`));
      assert.deepEqual(leftovers, [], "no temporary Docker resources remain");
      assert.deepEqual(dockerList("containers").filter((name) => name.includes("codigo_QR")).sort(), preexistingQrContainers);
      pass("temporary containers, network and volumes removed; pre-existing codigo_QR stack is unchanged");
    } catch (error) {
      process.stderr.write(`CLEANUP FAIL: ${error instanceof Error ? error.message : "resource verification failed"}\n`);
      process.exitCode = 1;
    }
    await rm(temp, { recursive: true, force: true });
  }
  if (process.exitCode === undefined || process.exitCode === 0) process.stdout.write(`RESULT ${checks.length}/17 checks passed; remote projects untouched\n`);
}
