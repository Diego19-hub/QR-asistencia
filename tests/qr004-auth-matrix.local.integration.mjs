#!/usr/bin/env node
/* Local-only disposable Supabase authorization matrix. Never links a remote project. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import pg from "pg";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "node_modules/.bin/supabase");
const projectId = `qr004_disposable_${randomBytes(6).toString("hex")}`;
// Keep Mailpit enabled. Auth invite email is captured locally and cannot leave this stack.
const excluded = "realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
const suites = [
  "attendance_integrity_test.sql",
  "employee_portal_rls_behavior_test.sql",
  "company_user_access_behavior_test.sql",
  "company_user_access_management_test.sql",
  "employee_credentials_test.sql",
  "qr004_scanner_authorization_test.sql",
];
let temp;
let startAttempted = false;
let appServer, dbPool, service, apiUrl, anonKey, serviceKey, dbUrl, appUrl, appOutput = "";

function safeCli(args, timeout = 900_000) {
  const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1", CI: "1" };
  for (const key of Object.keys(env)) if (/SUPABASE|POSTGRES|DATABASE_URL/i.test(key)) delete env[key];
  env.SUPABASE_TELEMETRY_DISABLED = "1";
  env.CI = "1";
  try {
    return execFileSync(cli, [...args, "--workdir", join(temp, "project")], {
      cwd: root, env, encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = `${error?.stderr ?? ""}\n${error?.stdout ?? ""}`
      .replace(/https?:\/\/[^\s)]+/g, "[url]")
      .replace(/postgres(?:ql)?:\/\/[^\s)]+/gi, "[database-url]")
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
      .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/gi, "[supabase-key]")
      .replace(/(?:SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|ANON_KEY|SERVICE_ROLE_KEY)\s*=\s*[^\s,]+/gi, "[credential-assignment]")
      .replace(/(?:service_role|anon|publishable)[=: ]+[A-Za-z0-9_.-]{24,}/gi, "[credential]")
      .split(/\r?\n/).filter(Boolean).slice(-8).join(" | ").slice(0, 1000);
    throw new Error(`isolated local Supabase command failed (${args.slice(0, 3).join(" ")}): ${detail || "no diagnostic"}`);
  }
}

async function freePortBlock() {
  for (let base = 56_000 + Math.floor(Math.random() * 1_500); base < 62_000; base += 10) {
    const available = await Promise.all(Array.from({ length: 10 }, (_, offset) => new Promise((resolvePort) => {
      const server = net.createServer();
      server.once("error", () => resolvePort(false));
      server.listen(base + offset, "127.0.0.1", () => server.close(() => resolvePort(true)));
    })));
    if (available.every(Boolean)) return base;
  }
  throw new Error("could not reserve a free local port block");
}

function dockerResources(kind) {
  const args = kind === "containers" ? ["container", "ls", "-a", "--format", "{{.Names}}"]
    : kind === "volumes" ? ["volume", "ls", "--format", "{{.Name}}"]
      : ["network", "ls", "--format", "{{.Name}}"];
  return execFileSync("docker", args, { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
}

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, "")]] : [];
  }));
}
async function freePort(start) {
  for (let base = start; base < start + 600; base += 10) {
    const available = await Promise.all(Array.from({ length: 10 }, (_, offset) => new Promise((resolvePort) => {
      const socket = net.createServer();
      socket.once("error", () => resolvePort(false));
      socket.listen(base + offset, "127.0.0.1", () => socket.close(() => resolvePort(true)));
    })));
    if (available.every(Boolean)) return base;
  }
  throw new Error("no free local app port block");
}
function localUrl(value, name) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} is not a URL`); }
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname), `${name} must be loopback-only`);
  assert.ok(!["llxyziffgtqnzlguxhyt", "jawdrhewabqajxnswhkn"].some((id) => value.includes(id)), `${name} contains a remote project ref`);
}
function safeServerOutput() {
  let output = appOutput;
  for (const secret of [anonKey, serviceKey, dbUrl]) if (secret) output = output.split(secret).join("[redacted]");
  return output.replace(/https?:\/\/[^\s)]+/g, "[url]").split(/\r?\n/).filter(Boolean).slice(-8).join(" | ").slice(0, 700) || "no diagnostic";
}
async function waitForNext(url) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (appServer.exitCode !== null) throw new Error(`temporary Next.js server exited: ${safeServerOutput()}`);
    try { const response = await fetch(url); if (response.status < 500) return; } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error("temporary Next.js server did not become ready");
}
async function stopNext() {
  if (!appServer || appServer.exitCode !== null) return;
  appServer.kill("SIGTERM");
  const exited = new Promise((resolveExit) => appServer.once("exit", resolveExit));
  const graceful = await Promise.race([exited.then(() => true), new Promise((resolveWait) => setTimeout(() => resolveWait(false), 4_000))]);
  if (!graceful && appServer.exitCode === null) {
    appServer.kill("SIGKILL");
    await exited;
  }
}
async function createHttpUser(label, role, companyId, { extraMemberships = [], employee = false } = {}) {
  const email = `${label}-${randomUUID()}@qr-asistencia.invalid`;
  const password = randomBytes(32).toString("base64url");
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`local Auth fixture creation failed (${label})`);
  const userId = created.data.user.id;
  const membershipRows = [];
  for (const [membershipCompanyId, membershipRole] of [[companyId, role], ...extraMemberships]) {
    const inserted = await service.from("company_memberships").insert({ company_id: membershipCompanyId, user_id: userId, role: membershipRole, active: true }).select("id,company_id,role").single();
    if (inserted.error || !inserted.data) throw new Error(`synthetic membership creation failed (${label})`);
    membershipRows.push(inserted.data);
  }
  if (employee) {
    const inserted = await service.from("employees").insert({ company_id: companyId, employee_number: `HTTP-${randomBytes(4).toString("hex")}`, first_name: "Synthetic", last_name: label, email, auth_user_id: userId, active: true }).select("id").single();
    if (inserted.error || !inserted.data) throw new Error(`synthetic employee creation failed (${label})`);
  }
  const client = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) throw new Error(`local password Auth login failed (${label}, status=${login.error?.status ?? "none"})`);
  const identity = await client.auth.getUser();
  if (identity.error || identity.data.user?.id !== userId) throw new Error(`local JWT identity mismatch (${label})`);
  const jar = new Map();
  const ssr = createServerClient(apiUrl, anonKey, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach(({ name, value }) => jar.set(name, value)),
  } });
  const ssrLogin = await ssr.auth.signInWithPassword({ email, password });
  if (ssrLogin.error) throw new Error(`local SSR session creation failed (${label})`);
  return { userId, email, companyId, memberships: membershipRows, client, cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
}
async function createAuthOnly(email) {
  const password = randomBytes(32).toString("base64url");
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("failed creating synthetic Auth identity");
  const client = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) throw new Error("synthetic identity failed local Auth login");
  return client;
}
async function snapshot(companyId) {
  const { rows } = await dbPool.query(`select
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'email',email,'expires_at',expires_at) order by id),'[]'::jsonb) from public.company_user_invitations where company_id=$1) invitations,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'actor_user_id',actor_user_id,'action',action,'entity_table',entity_table,'entity_id',entity_id,'before_data',before_data,'after_data',after_data) order by id),'[]'::jsonb) from public.audit_log where company_id=$1) audit,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'role',role,'active',active) order by id),'[]'::jsonb) from public.company_memberships where company_id=$1) memberships,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'membership_id',membership_id,'active',active,'revoked_at',revoked_at) order by id),'[]'::jsonb) from public.authorized_devices where company_id=$1) devices`, [companyId]);
  return rows[0];
}
async function request(path, { user, method = "GET", body, cookieExtra = "" } = {}) {
  const headers = {};
  if (user?.cookie) headers.cookie = [user.cookie, cookieExtra].filter(Boolean).join("; ");
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(new URL(path, appUrl), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
}

const before = Object.fromEntries(["containers", "volumes", "networks"].map((kind) => [kind, dockerResources(kind)]));
const cleanupErrors = [];
let primaryError;
try {
  temp = await mkdtemp(join(tmpdir(), "qr004-auth-matrix-"));
  const workdir = join(temp, "project");
  await mkdir(join(workdir, "supabase", "migrations"), { recursive: true });
  await mkdir(join(workdir, "supabase", "tests"), { recursive: true });
  await cp(join(root, "supabase/migrations"), join(workdir, "supabase/migrations"), { recursive: true });
  await cp(join(root, "supabase/templates"), join(workdir, "supabase/templates"), { recursive: true });
  for (const suite of suites) await cp(join(root, "supabase/tests", suite), join(workdir, "supabase/tests", suite));
  let config = await readFile(join(root, "supabase/config.toml"), "utf8");
  const base = await freePortBlock();
  config = config.replace('project_id = "codigo_QR"', `project_id = "${projectId}"`)
    .replace("port = 54321", `port = ${base}`).replace("port = 54322", `port = ${base + 1}`)
    .replace("shadow_port = 54320", `shadow_port = ${base + 2}`).replace("port = 54323", `port = ${base + 3}`)
    .replace("port = 54324", `port = ${base + 4}`).replace("port = 54329", `port = ${base + 9}`).replace("port = 54327", `port = ${base + 7}`);
  assert.match(config, new RegExp(`^project_id = "${projectId}"$`, "m"));
  await writeFile(join(workdir, "supabase/config.toml"), config, { mode: 0o600 });
  for (const kind of Object.keys(before)) {
    assert.equal(before[kind].some((name) => name.includes(projectId)), false, `random disposable project ID already exists in Docker ${kind}`);
  }
  process.stdout.write(`Disposable local project ${projectId}; no remote link.\n`);
  // A failed `start` may still have created some project containers. Always
  // attempt the scoped stop after invoking start, including partial failures.
  startAttempted = true;
  safeCli(["start", "--exclude", excluded]);
  safeCli(["db", "reset", "--local"]);
  process.stdout.write("PASS fresh disposable database with repository migrations applied locally\n");
  for (const suite of suites) {
    const output = safeCli(["test", "db", "--local", `supabase/tests/${suite}`]);
    const sql = await readFile(join(workdir, "supabase/tests", suite), "utf8");
    const plan = Number(sql.match(/select\s+plan\s*\(\s*(\d+)\s*\)/i)?.[1]);
    assert.ok(Number.isInteger(plan) && plan > 0, `${suite} must declare a pgTAP plan`);
    const summary = output.match(/\bAll\s+(\d+)\s+tests?\s+passed\b/i)?.[0]
      ?? output.split(/\r?\n/).filter((line) => /tests? passed|Looks like you failed/i.test(line)).slice(-1)[0]
      ?? `${plan} pgTAP assertions passed (CLI exited successfully)`;
    process.stdout.write(`PASS ${suite}: ${summary}\n`);
  }

  // Exercise the same API and Server Component guards used by the app. The
  // app receives only loopback Supabase endpoints and an ephemeral local key.
  const values = parseEnv(safeCli(["status", "--output", "env"]));
  apiUrl = values.API_URL; anonKey = values.ANON_KEY; serviceKey = values.SERVICE_ROLE_KEY; dbUrl = values.DB_URL;
  localUrl(apiUrl, "Supabase API URL"); localUrl(dbUrl, "Supabase database URL");
  assert.ok(anonKey && serviceKey && anonKey !== serviceKey, "local Supabase keys are available in memory");
  dbPool = new pg.Pool({ connectionString: dbUrl, max: 2 }); await dbPool.query("select 1");
  service = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const companyAResult = await service.from("companies").insert({ name: `QR004 HTTP Synthetic A ${randomUUID()}` }).select("id").single();
  const companyBResult = await service.from("companies").insert({ name: `QR004 HTTP Synthetic B ${randomUUID()}` }).select("id").single();
  if (companyAResult.error || companyBResult.error) throw new Error("failed creating synthetic HTTP test companies");
  const companyA = companyAResult.data.id, companyB = companyBResult.data.id;
  const ownerA = await createHttpUser("owner-a", "owner", companyA);
  const adminA = await createHttpUser("admin-a", "admin", companyA);
  const adminB = await createHttpUser("admin-b", "admin", companyB);
  const supervisorA = await createHttpUser("supervisor-a", "supervisor", companyA);
  const employeeA = await createHttpUser("employee-a", "employee", companyA, { employee: true });
  const multiAdmin = await createHttpUser("multi-admin", "admin", companyA, { extraMemberships: [[companyB, "admin"]] });
  const multiEmployee = await createHttpUser("multi-employee", "employee", companyA, { extraMemberships: [[companyB, "employee"]], employee: true });
  const nextPort = await freePort(base + 20); appUrl = `http://127.0.0.1:${nextPort}`;
  const appRoot = join(temp, "next-app"); await mkdir(appRoot, { recursive: true });
  await cp(join(root, "src"), join(appRoot, "src"), { recursive: true });
  for (const file of ["package.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json"]) await cp(join(root, file), join(appRoot, file));
  await symlink(join(root, "node_modules"), join(appRoot, "node_modules"), "dir");
  appServer = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(nextPort)], {
    cwd: appRoot,
    env: {
      PATH: process.env.PATH, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: apiUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey, APP_BASE_URL: appUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  appServer.stdout.on("data", (chunk) => { appOutput = (appOutput + chunk.toString()).slice(-12_000); });
  appServer.stderr.on("data", (chunk) => { appOutput = (appOutput + chunk.toString()).slice(-12_000); });
  await waitForNext(`${appUrl}/login`);
  process.stdout.write("PASS local Auth users and temporary Next.js server use only the disposable Supabase loopback endpoints\n");

  // Admin access APIs, scope selection, company.manage and rejected-write snapshots.
  let response = await request(`/api/admin/access?companyId=${companyA}`);
  assert.equal(response.status, 401);
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: supervisorA }); assert.equal(response.status, 403);
  response = await request(`/api/admin/access?companyId=${companyB}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request(`/api/admin/access`, { user: multiAdmin }); assert.equal(response.status, 400);
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  assert.ok(Array.isArray((await response.json()).users));
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminB }); assert.equal(response.status, 403);
  const beforeDenied = await snapshot(companyA);
  response = await request(`/api/admin/access?companyId=${companyA}`, { method: "POST", body: { email: `anon-${randomUUID()}@qr-asistencia.invalid`, role: "employee" } }); assert.equal(response.status, 401);
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: employeeA, method: "POST", body: { email: `denied-${randomUUID()}@qr-asistencia.invalid`, role: "employee" } }); assert.equal(response.status, 403);
  assert.deepEqual(await snapshot(companyA), beforeDenied, "wrong-role POST leaves database snapshot unchanged");
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "POST", body: { email: "bad", role: "owner", extra: true } }); assert.equal(response.status, 422);
  assert.deepEqual(await snapshot(companyA), beforeDenied, "invalid POST leaves database snapshot unchanged");
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { action: "deactivate", membershipId: adminB.memberships[0].id } }); assert.equal(response.status, 404);
  assert.deepEqual(await snapshot(companyA), beforeDenied, "cross-company PATCH leaves database snapshot unchanged");
  response = await request(`/api/admin/access?companyId=${companyA}`, { method: "PATCH", body: { action: "deactivate", membershipId: employeeA.memberships[0].id } }); assert.equal(response.status, 401);
  response = await request(`/api/admin/access/invitations/${randomUUID()}/resend?companyId=${companyA}`, { method: "POST" }); assert.equal(response.status, 401);
  const override = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "company.manage", allowed: false });
  if (override.error) throw new Error("could not prepare synthetic company.manage denial");
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 403);
  const beforeNoPermission = await snapshot(companyA);
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { action: "deactivate", membershipId: employeeA.memberships[0].id } }); assert.equal(response.status, 403);
  assert.deepEqual(await snapshot(companyA), beforeNoPermission, "company.manage denial leaves database snapshot unchanged");
  response = await request(`/api/admin/audit?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request(`/api/admin/permissions?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "company.manage");
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "POST", body: { email: `new-invite-${randomUUID()}@qr-asistencia.invalid`, role: "employee", employeeId: null } });
  assert.ok([201, 502].includes(response.status), `valid local invite returned documented success or local SMTP failure status, got ${response.status}`);
  process.stdout.write(`PASS valid local invitation route returned HTTP ${response.status} (local SMTP only)\n`);
  const inviteBody = await response.json();
  if (inviteBody.invitationId) {
    assert.equal((await dbPool.query("select id from public.company_user_invitations where id=$1 and company_id=$2", [inviteBody.invitationId, companyA])).rows[0]?.id, inviteBody.invitationId);
    response = await request(`/api/admin/access/invitations/${inviteBody.invitationId}/resend?companyId=${companyA}`, { user: supervisorA, method: "POST" }); assert.equal(response.status, 403);
    response = await request(`/api/admin/access/invitations/not-a-uuid/resend?companyId=${companyA}`, { user: adminA, method: "POST" }); assert.equal(response.status, 400);
    const beforeResend = await snapshot(companyA);
    response = await request(`/api/admin/access/invitations/${inviteBody.invitationId}/resend?companyId=${companyA}`, { user: adminA, method: "POST" }); assert.ok([200, 503].includes(response.status));
    if (response.status === 200) assert.equal((await response.json()).deliveryMode, "auth-invite");
    else assert.equal((await response.json()).error.code, "existing_account_delivery_unconfigured");
    assert.deepEqual(await snapshot(companyA), beforeResend, "resend has no database side effects");
    process.stdout.write(`PASS local invitation resend returned HTTP ${response.status} with no database side effects\n`);
    response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { action: "revoke-invitation", invitationId: inviteBody.invitationId } }); assert.equal(response.status, 200);
  }
  process.stdout.write("PASS admin access GET/POST/PATCH/resend scope, role, permission, validation and rejected-write snapshots\n");

  // API sessions and pages: requests use the real Auth cookies issued above.
  response = await request("/api/me"); assert.equal(response.status, 401);
  response = await request("/api/me", { user: employeeA }); assert.equal(response.status, 200);
  const me = await response.json(); assert.equal(me.user.id, employeeA.userId); assert.ok(me.memberships.some((item) => item.companyId === companyA));
  response = await request("/api/employee/portal"); assert.equal(response.status, 401);
  response = await request("/api/employee/portal?page=0", { user: employeeA }); assert.equal(response.status, 400);
  response = await request("/api/employee/portal", { user: adminA }); assert.equal(response.status, 403);
  response = await request("/api/employee/portal", { user: employeeA }); assert.equal(response.status, 200); assert.equal((await response.json()).linked, true);
  response = await request("/api/employee/portal", { user: multiAdmin }); assert.equal(response.status, 409);
  response = await request("/api/employee/portal", { user: multiEmployee }); assert.equal(response.status, 409);
  response = await request("/api/employee/portal", { user: multiEmployee, cookieExtra: `qr_active_membership_id=${multiEmployee.memberships[0].id}` }); assert.equal(response.status, 200);
  response = await request("/admin", { redirect: "manual" }); assert.ok([307, 308].includes(response.status)); assert.match(response.headers.get("location") ?? "", /\/login/);
  response = await request("/admin", { user: supervisorA }); assert.ok([307, 308].includes(response.status)); assert.match(response.headers.get("location") ?? "", /no-company/);
  response = await request("/admin", { user: multiAdmin }); assert.ok([307, 308].includes(response.status)); assert.match(response.headers.get("location") ?? "", /seleccionar-empresa/);
  response = await request("/admin", { user: multiAdmin, cookieExtra: `qr_active_membership_id=${multiAdmin.memberships[0].id}` }); assert.equal(response.status, 200);
  response = await request("/mi-qr", { redirect: "manual" }); assert.ok([307, 308].includes(response.status)); assert.match(response.headers.get("location") ?? "", /\/login\?next=%2Fmi-qr/);
  response = await request("/mi-qr", { user: adminA }); assert.ok([307, 308].includes(response.status)); assert.match(response.headers.get("location") ?? "", /no-company/);
  response = await request("/mi-qr", { user: multiEmployee }); assert.ok([307, 308].includes(response.status)); assert.match(response.headers.get("location") ?? "", /seleccionar-empresa/);
  response = await request("/mi-qr", { user: multiEmployee, cookieExtra: `qr_active_membership_id=${multiEmployee.memberships[0].id}` }); assert.equal(response.status, 200);
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: ownerA, method: "PATCH", body: { action: "change-role", membershipId: employeeA.memberships[0].id, role: "supervisor" } }); assert.equal(response.status, 200);
  response = await request("/api/employee/portal", { user: employeeA }); assert.equal(response.status, 403);
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: ownerA, method: "PATCH", body: { action: "change-role", membershipId: employeeA.memberships[0].id, role: "employee" } }); assert.equal(response.status, 200);
  response = await request("/api/employee/portal", { user: employeeA }); assert.equal(response.status, 200);
  assert.equal(Number((await dbPool.query("select count(*) n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_ROLE_CHANGED'", [companyA, employeeA.memberships[0].id])).rows[0].n), 2);
  // The employee's active membership can be revoked by the synthetic owner.
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: ownerA, method: "PATCH", body: { action: "deactivate", membershipId: employeeA.memberships[0].id } }); assert.equal(response.status, 200);
  response = await request("/api/me", { user: employeeA }); assert.equal(response.status, 200); assert.deepEqual((await response.json()).memberships, []);
  response = await request("/api/employee/portal", { user: employeeA }); assert.equal(response.status, 200); assert.equal((await response.json()).reason, "no_employee_membership");
  response = await request("/mi-qr", { user: employeeA }); assert.ok([307, 308].includes(response.status)); assert.match(response.headers.get("location") ?? "", /no-company/);
  process.stdout.write("PASS /api/me, employee portal, /admin and /mi-qr enforce real session, role, selection and revoked-membership state\n");

  // Audit requires company.manage; permission catalog intentionally requires
  // only an active owner/admin company membership (route contract).
  response = await request(`/api/admin/audit?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  response = await request(`/api/admin/audit?companyId=${companyB}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request(`/api/admin/audit?companyId=${companyA}&from=not-a-date`, { user: adminA }); assert.equal(response.status, 400);
  response = await request(`/api/admin/permissions?companyId=${companyA}`, { user: supervisorA }); assert.equal(response.status, 403);
  response = await request(`/api/admin/permissions?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  const catalog = await response.json(); assert.ok(Array.isArray(catalog.permissions) && Array.isArray(catalog.rolePermissions));
  response = await request(`/api/admin/permissions?companyId=${companyB}`, { user: adminA }); assert.equal(response.status, 403);
  process.stdout.write("PASS audit is company.manage-gated; permission catalog is available to active admins even when company.manage is overridden off\n");

  // Invite acceptance belongs to the authenticated RPC, while invite/password
  // Server Actions remain covered by auth-email-flow unit tests. Exercise the
  // RPC with genuine local Auth JWTs, including recipient, expiry, revocation,
  // replay and audit side effects.
  const lifecycleEmail = `lifecycle-${randomUUID()}@qr-asistencia.invalid`;
  const createdInvite = await adminA.client.rpc("create_company_user_invitation", { p_company_id: companyA, p_email: lifecycleEmail, p_role: "employee", p_employee_id: null });
  assert.ok(!createdInvite.error && createdInvite.data);
  const matchingClient = await createAuthOnly(lifecycleEmail);
  const matchingIdentity = await matchingClient.auth.getUser(); assert.ok(matchingIdentity.data.user);
  const wrongIdentity = await employeeA.client.rpc("accept_company_user_invitation", { p_invitation_id: createdInvite.data }); assert.equal(wrongIdentity.error?.code, "P0002");
  assert.equal(Number((await dbPool.query("select count(*) n from public.company_memberships where company_id=$1 and user_id=$2", [companyA, matchingIdentity.data.user.id])).rows[0].n), 0);
  assert.equal((await dbPool.query("select status from public.company_user_invitations where id=$1", [createdInvite.data])).rows[0].status, "pending");
  const accepted = await matchingClient.rpc("accept_company_user_invitation", { p_invitation_id: createdInvite.data }); assert.ok(!accepted.error);
  const replay = await matchingClient.rpc("accept_company_user_invitation", { p_invitation_id: createdInvite.data }); assert.equal(replay.error?.code, "P0002");
  const auditAcceptance = await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_INVITATION_ACCEPTED'", [companyA, createdInvite.data]); assert.equal(auditAcceptance.rows[0].n, 1);
  const expiredEmail = `expired-${randomUUID()}@qr-asistencia.invalid`;
  const expiredInvite = await adminA.client.rpc("create_company_user_invitation", { p_company_id: companyA, p_email: expiredEmail, p_role: "employee", p_employee_id: null }); assert.ok(!expiredInvite.error && expiredInvite.data);
  await dbPool.query("update public.company_user_invitations set expires_at=clock_timestamp()-interval '1 minute' where id=$1", [expiredInvite.data]);
  const expiredClient = await createAuthOnly(expiredEmail);
  const expiredAttempt = await expiredClient.rpc("accept_company_user_invitation", { p_invitation_id: expiredInvite.data }); assert.equal(expiredAttempt.error?.code, "P0002");
  const expiredIdentity = await expiredClient.auth.getUser(); assert.equal(Number((await dbPool.query("select count(*) n from public.company_memberships where company_id=$1 and user_id=$2", [companyA, expiredIdentity.data.user.id])).rows[0].n), 0);
  const revokedEmail = `revoked-${randomUUID()}@qr-asistencia.invalid`;
  const revokedInvite = await adminA.client.rpc("create_company_user_invitation", { p_company_id: companyA, p_email: revokedEmail, p_role: "employee", p_employee_id: null }); assert.ok(!revokedInvite.error && revokedInvite.data);
  const revokeResult = await adminA.client.rpc("revoke_company_user_invitation", { p_company_id: companyA, p_invitation_id: revokedInvite.data }); assert.equal(revokeResult.data, true);
  const revokedClient = await createAuthOnly(revokedEmail);
  const revokedAttempt = await revokedClient.rpc("accept_company_user_invitation", { p_invitation_id: revokedInvite.data }); assert.equal(revokedAttempt.error?.code, "P0002");
  const revokedIdentity = await revokedClient.auth.getUser(); assert.equal(Number((await dbPool.query("select count(*) n from public.company_memberships where company_id=$1 and user_id=$2", [companyA, revokedIdentity.data.user.id])).rows[0].n), 0);
  const auditRevoke = await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_INVITATION_REVOKED'", [companyA, revokedInvite.data]); assert.equal(auditRevoke.rows[0].n, 1);
  process.stdout.write("PASS invitation RPC enforces recipient, expiry, revocation, single-use and audit semantics with local JWT identities\n");
} catch (error) {
  primaryError = error;
} finally {
  try { await stopNext(); } catch (error) { cleanupErrors.push(error); }
  try { await dbPool?.end(); } catch (error) { cleanupErrors.push(error); }
  if (startAttempted) {
    try {
      // Never use `stop --all`: this project ID was checked absent before start.
      safeCli(["stop", "--project-id", projectId, "--no-backup"], 180_000);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  try {
    const after = Object.fromEntries(["containers", "volumes", "networks"].map((kind) => [kind, dockerResources(kind)]));
    for (const kind of Object.keys(before)) {
      assert.deepEqual(after[kind].filter((name) => name.includes(projectId)), [], `disposable ${kind} remain after cleanup`);
      for (const name of before[kind]) assert.ok(after[kind].includes(name), `pre-existing Docker ${kind} resource was removed: ${name}`);
    }
  } catch (error) {
    cleanupErrors.push(error);
  } finally {
    try {
      if (temp) await rm(temp, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
}

if (primaryError) {
  // Preserve the original test/start failure; cleanup diagnostics remain attached.
  if (cleanupErrors.length) primaryError.cleanupErrors = cleanupErrors;
  throw primaryError;
}
if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "temporary Supabase cleanup did not complete cleanly");
process.stdout.write("PASS temporary stack and data removed; pre-existing Docker resources preserved\n");
