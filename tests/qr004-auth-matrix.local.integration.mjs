#!/usr/bin/env node
/* Local-only disposable Supabase authorization matrix. Never links a remote project. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  "company_user_share_invitations_test.sql",
  "employee_credentials_test.sql",
  "qr004_scanner_authorization_test.sql",
];
let temp;
let startAttempted = false;
let appServer, dbPool, service, apiUrl, anonKey, serviceKey, dbUrl, appUrl, mailpitUrl, appOutput = "";

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
async function createHttpIdentity(email, { emailConfirmed = true } = {}) {
  const password = randomBytes(32).toString("base64url");
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("failed creating synthetic HTTP Auth identity");
  const client = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) throw new Error("synthetic HTTP identity could not establish a local Auth session");
  const jar = new Map();
  const ssr = createServerClient(apiUrl, anonKey, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach(({ name, value }) => jar.set(name, value)),
  } });
  const ssrLogin = await ssr.auth.signInWithPassword({ email, password });
  if (ssrLogin.error) throw new Error("synthetic HTTP identity could not establish an SSR session");
  if (!emailConfirmed) await dbPool.query("update auth.users set email_confirmed_at=null where id=$1", [created.data.user.id]);
  return { email, password, userId: created.data.user.id, client, cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
}
async function snapshot(companyId) {
  const { rows } = await dbPool.query(`select
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'email',email,'expires_at',expires_at,'share_token_hash',share_token_hash) order by id),'[]'::jsonb) from public.company_user_invitations where company_id=$1) invitations,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'actor_user_id',actor_user_id,'action',action,'entity_table',entity_table,'entity_id',entity_id,'before_data',before_data,'after_data',after_data) order by id),'[]'::jsonb) from public.audit_log where company_id=$1) audit,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'role',role,'active',active) order by id),'[]'::jsonb) from public.company_memberships where company_id=$1) memberships,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'membership_id',membership_id,'active',active,'revoked_at',revoked_at) order by id),'[]'::jsonb) from public.authorized_devices where company_id=$1) devices`, [companyId]);
  return rows[0];
}
async function request(path, { user, method = "GET", body, cookieExtra = "" } = {}) {
  const headers = {};
  if (user?.cookie) headers.cookie = [user.cookie, cookieExtra].filter(Boolean).join("; ");
  if (method !== "GET") headers.origin = appUrl;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(new URL(path, appUrl), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
}
async function waitForMailpitRecipient(email, expectedCount) {
  assert.ok(mailpitUrl, "local Mailpit URL is configured");
  const deadline = Date.now() + 20_000;
  let recipientCount = 0;
  while (Date.now() < deadline) {
    const response = await fetch(new URL("/api/v1/messages?limit=100", mailpitUrl));
    assert.equal(response.status, 200, "local Mailpit API is available");
    const payload = await response.json();
    const messages = Array.isArray(payload) ? payload : payload.messages;
    assert.ok(Array.isArray(messages), "local Mailpit returned its message list");
    recipientCount = messages.filter((message) => (message.To ?? message.to ?? [])
      .some((recipient) => (recipient.Address ?? recipient.address ?? "").toLowerCase() === email.toLowerCase())).length;
    if (recipientCount >= expectedCount) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  assert.equal(recipientCount, expectedCount, `Mailpit captured exactly ${expectedCount} message(s) for the synthetic recipient`);
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
  mailpitUrl = `http://127.0.0.1:${base + 4}`;
  localUrl(mailpitUrl, "Mailpit URL");
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
  const mailpitReady = await fetch(new URL("/api/v1/messages?limit=1", mailpitUrl));
  assert.equal(mailpitReady.status, 200, "isolated local Mailpit API is reachable");
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
  const inviteEmail = `new-invite-${randomUUID()}@qr-asistencia.invalid`;
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "POST", body: { email: inviteEmail, role: "employee", employeeId: null } });
  assert.equal(response.status, 201, `valid invitation with local SMTP available returns HTTP 201, got ${response.status}`);
  await waitForMailpitRecipient(inviteEmail, 1);
  process.stdout.write("PASS valid local invitation returned HTTP 201 and Mailpit captured its synthetic recipient\n");
  const inviteBody = await response.json();
  if (inviteBody.invitationId) {
    assert.equal((await dbPool.query("select id from public.company_user_invitations where id=$1 and company_id=$2", [inviteBody.invitationId, companyA])).rows[0]?.id, inviteBody.invitationId);
    response = await request(`/api/admin/access/invitations/${inviteBody.invitationId}/resend?companyId=${companyA}`, { user: supervisorA, method: "POST" }); assert.equal(response.status, 403);
    response = await request(`/api/admin/access/invitations/not-a-uuid/resend?companyId=${companyA}`, { user: adminA, method: "POST" }); assert.equal(response.status, 400);
    const beforeResend = await snapshot(companyA);
    response = await request(`/api/admin/access/invitations/${inviteBody.invitationId}/resend?companyId=${companyA}`, { user: adminA, method: "POST" });
    assert.equal(response.status, 200, `valid invitation resend with local SMTP available returns HTTP 200, got ${response.status}`);
    assert.equal((await response.json()).deliveryMode, "auth-invite");
    await waitForMailpitRecipient(inviteEmail, 2);
    assert.deepEqual(await snapshot(companyA), beforeResend, "resend has no database side effects");
    process.stdout.write("PASS local invitation resend returned HTTP 200, Mailpit captured both messages, and database state was unchanged\n");
    response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { action: "revoke-invitation", invitationId: inviteBody.invitationId } }); assert.equal(response.status, 200);
  }

  const createPendingInvite = async (email, companyId = companyA, role = "employee") => {
    const manager = companyId === companyB ? adminB : adminA;
    const created = await manager.client.rpc("create_company_user_invitation", { p_company_id: companyId, p_email: email, p_role: role, p_employee_id: null });
    if (created.error || !created.data) throw new Error("failed creating synthetic invitation for share-link coverage");
    return created.data;
  };
  const getShareLink = async (companyId, invitationId, user = adminA) => {
    const linkResponse = await request(`/api/admin/access/invitations/${invitationId}/share-link?companyId=${companyId}`, { user, method: "POST" });
    return { response: linkResponse, body: linkResponse.status === 201 ? await linkResponse.json() : null };
  };

  // Individual WhatsApp links: admin scope, token secrecy, verified identity,
  // lifecycle, concurrency, and no side effects for rejected requests.
  const shareEmail = `share-${randomUUID()}@qr-asistencia.invalid`;
  const shareInvitationId = await createPendingInvite(shareEmail);
  const beforeShareDenialsA = await snapshot(companyA), beforeShareDenialsB = await snapshot(companyB);
  response = await request(`/api/admin/access/invitations/${shareInvitationId}/share-link?companyId=${companyA}`, { method: "POST" }); assert.equal(response.status, 401);
  response = await request(`/api/admin/access/invitations/${shareInvitationId}/share-link?companyId=${companyA}`, { user: supervisorA, method: "POST" }); assert.equal(response.status, 403);
  response = await request(`/api/admin/access/invitations/${shareInvitationId}/share-link?companyId=${companyB}`, { user: adminB, method: "POST" }); assert.equal(response.status, 404);
  assert.deepEqual(await snapshot(companyA), beforeShareDenialsA, "anonymous, wrong-role, and cross-company share creation have no side effects in company A");
  assert.deepEqual(await snapshot(companyB), beforeShareDenialsB, "cross-company share creation has no side effects in company B");
  const noManage = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "company.manage", allowed: false });
  if (noManage.error) throw new Error("could not prepare synthetic company.manage share-link denial");
  const beforeSharePermissionDenial = await snapshot(companyA);
  response = await request(`/api/admin/access/invitations/${shareInvitationId}/share-link?companyId=${companyA}`, { user: adminA, method: "POST" }); assert.equal(response.status, 403);
  assert.deepEqual(await snapshot(companyA), beforeSharePermissionDenial, "company.manage denial leaves the invitation and audit state unchanged");
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "company.manage");

  const { response: shareCreatedResponse, body: shareCreated } = await getShareLink(companyA, shareInvitationId);
  assert.equal(shareCreatedResponse.status, 201);
  assert.equal(shareCreatedResponse.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(shareCreatedResponse.headers.get("referrer-policy"), "no-referrer");
  const shareUrl = new URL(shareCreated.shareUrl);
  assert.equal(shareUrl.origin, appUrl); assert.equal(shareUrl.pathname, "/invitacion/compartida"); assert.equal(shareUrl.search, "");
  const shareToken = new URLSearchParams(shareUrl.hash.slice(1)).get("t"); assert.match(shareToken, /^[A-Za-z0-9_-]{43}$/);
  const storedShare = (await dbPool.query("select share_token_hash,expires_at from public.company_user_invitations where id=$1", [shareInvitationId])).rows[0];
  const expectedShareHash = createHash("sha256").update(shareToken).digest("hex");
  assert.equal(storedShare.share_token_hash, expectedShareHash, "database stores only the SHA-256 token hash");
  assert.notEqual(storedShare.share_token_hash, shareToken);
  assert.equal(new Date(storedShare.expires_at).toISOString(), new Date(shareCreated.expiresAt).toISOString());
  assert.equal(Number((await dbPool.query("select count(*) n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_INVITATION_SHARE_LINK_CREATED'", [companyA, shareInvitationId])).rows[0].n), 1);

  const ownerOnlyEmail = `share-admin-${randomUUID()}@qr-asistencia.invalid`;
  const ownerOnlyInvitation = await ownerA.client.rpc("create_company_user_invitation", { p_company_id: companyA, p_email: ownerOnlyEmail, p_role: "admin", p_employee_id: null });
  assert.ok(!ownerOnlyInvitation.error && ownerOnlyInvitation.data);
  const beforeAdminLinkDenial = await snapshot(companyA);
  const deniedAdminLink = await getShareLink(companyA, ownerOnlyInvitation.data, adminA);
  assert.equal(deniedAdminLink.response.status, 403, "company admins cannot create WhatsApp links for administrator invitations");
  assert.deepEqual(await snapshot(companyA), beforeAdminLinkDenial, "owner-only share-link denial has no side effects");
  const ownerAdminLink = await getShareLink(companyA, ownerOnlyInvitation.data, ownerA);
  assert.equal(ownerAdminLink.response.status, 201, "owner can create a WhatsApp link for an administrator invitation");

  const beforePreview = await snapshot(companyA);
  response = await request(`/invitacion/compartida#t=${shareToken}`, { redirect: "manual" });
  assert.equal(response.status, 200, "link preview only renders the acceptance page");
  assert.deepEqual(await snapshot(companyA), beforePreview, "GET preview does not consume a token or change the database");

  const shareRecipient = await createHttpIdentity(shareEmail, { emailConfirmed: false });
  const beforeUnverified = await snapshot(companyA);
  response = await request("/api/invitations/share/accept", { user: shareRecipient, method: "POST", body: { token: shareToken } }); assert.equal(response.status, 403);
  assert.deepEqual(await snapshot(companyA), beforeUnverified, "unverified Auth identity cannot consume a share invitation");
  await dbPool.query("update auth.users set email_confirmed_at=clock_timestamp() where id=$1", [shareRecipient.userId]);
  response = await request("/api/invitations/share/accept", { user: employeeA, method: "POST", body: { token: shareToken } }); assert.equal(response.status, 404);
  assert.deepEqual(await snapshot(companyA), beforeUnverified, "wrong verified identity cannot consume a share invitation");
  const pendingShareList = await shareRecipient.client.rpc("list_my_pending_company_invitations");
  assert.ok(Array.isArray(pendingShareList.data));
  assert.equal(pendingShareList.data.find((item) => item.id === shareInvitationId)?.shareLinkAvailable, true);
  assert.equal(JSON.stringify(pendingShareList.data).includes(shareToken), false, "pending-invite list never returns the raw share token");
  response = await request("/api/invitations/share/accept", { user: shareRecipient, method: "POST", body: { token: shareToken } }); assert.equal(response.status, 200);
  const shareAccepted = await response.json(); assert.equal(shareAccepted.accepted, true); assert.equal(shareAccepted.next, "/mi-qr");
  assert.match(response.headers.get("set-cookie") ?? "", /qr_active_membership_id=/);
  const acceptedShareRow = (await dbPool.query("select status,share_token_hash from public.company_user_invitations where id=$1", [shareInvitationId])).rows[0];
  assert.equal(acceptedShareRow.status, "accepted"); assert.equal(acceptedShareRow.share_token_hash, null, "accepted token hash is cleared");
  assert.equal(Number((await dbPool.query("select count(*) n from public.company_memberships m join auth.users u on u.id=m.user_id where m.company_id=$1 and lower(u.email)=$2 and m.active", [companyA, shareEmail])).rows[0].n), 1);
  assert.equal(Number((await dbPool.query("select count(*) n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_INVITATION_ACCEPTED'", [companyA, shareInvitationId])).rows[0].n), 1);
  const afterShareAccept = await snapshot(companyA);
  response = await request("/api/invitations/share/accept", { user: shareRecipient, method: "POST", body: { token: shareToken } }); assert.equal(response.status, 404);
  assert.deepEqual(await snapshot(companyA), afterShareAccept, "reused share token has no side effects");
  const emailReplayAfterShare = await shareRecipient.client.rpc("accept_company_user_invitation", { p_invitation_id: shareInvitationId });
  assert.equal(emailReplayAfterShare.error?.code, "P0002", "WhatsApp acceptance invalidates the traditional email acceptance path");
  assert.deepEqual(await snapshot(companyA), afterShareAccept, "email replay after WhatsApp acceptance has no side effects");

  const emailWithShare = `email-with-share-${randomUUID()}@qr-asistencia.invalid`;
  const emailWithShareId = await createPendingInvite(emailWithShare);
  const { body: emailWithShareLink } = await getShareLink(companyA, emailWithShareId);
  const emailWithShareToken = new URLSearchParams(new URL(emailWithShareLink.shareUrl).hash.slice(1)).get("t");
  const emailWithShareRecipient = await createHttpIdentity(emailWithShare, { emailConfirmed: false });
  const beforeUnconfirmedEmailAccept = await snapshot(companyA);
  const unconfirmedEmailAcceptance = await emailWithShareRecipient.client.rpc("accept_company_user_invitation", { p_invitation_id: emailWithShareId });
  assert.equal(unconfirmedEmailAcceptance.error?.code, "42501", "traditional email acceptance requires a verified Auth email even when a share link exists");
  assert.deepEqual(await snapshot(companyA), beforeUnconfirmedEmailAccept, "unconfirmed email acceptance has no side effects");
  await dbPool.query("update auth.users set email_confirmed_at=clock_timestamp() where id=$1", [emailWithShareRecipient.userId]);
  const wrongEmailAcceptance = await employeeA.client.rpc("accept_company_user_invitation", { p_invitation_id: emailWithShareId });
  assert.equal(wrongEmailAcceptance.error?.code, "P0002", "traditional email acceptance still requires the exact recipient identity");
  assert.deepEqual(await snapshot(companyA), beforeUnconfirmedEmailAccept, "wrong email identity acceptance has no side effects");
  const acceptedByEmail = await emailWithShareRecipient.client.rpc("accept_company_user_invitation", { p_invitation_id: emailWithShareId });
  assert.ok(!acceptedByEmail.error, `traditional email acceptance still works when a share link exists: ${acceptedByEmail.error?.message ?? ""}`);
  const emailAcceptedRow = (await dbPool.query("select status,share_token_hash from public.company_user_invitations where id=$1", [emailWithShareId])).rows[0];
  assert.equal(emailAcceptedRow.status, "accepted"); assert.equal(emailAcceptedRow.share_token_hash, null, "email acceptance invalidates the WhatsApp token");
  assert.equal(Number((await dbPool.query("select count(*) n from public.company_memberships where company_id=$1 and user_id=$2 and active", [companyA, emailWithShareRecipient.userId])).rows[0].n), 1);
  assert.equal(Number((await dbPool.query("select count(*) n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_INVITATION_ACCEPTED'", [companyA, emailWithShareId])).rows[0].n), 1);
  const afterEmailAccept = await snapshot(companyA);
  response = await request("/api/invitations/share/accept", { user: emailWithShareRecipient, method: "POST", body: { token: emailWithShareToken } }); assert.equal(response.status, 404);
  assert.deepEqual(await snapshot(companyA), afterEmailAccept, "WhatsApp token is invalid after traditional email acceptance");

  const regeneratedEmail = `share-regenerated-${randomUUID()}@qr-asistencia.invalid`;
  const regeneratedId = await createPendingInvite(regeneratedEmail);
  const { body: firstGenerated } = await getShareLink(companyA, regeneratedId);
  const staleToken = new URLSearchParams(new URL(firstGenerated.shareUrl).hash.slice(1)).get("t");
  const { body: regenerated } = await getShareLink(companyA, regeneratedId);
  const currentToken = new URLSearchParams(new URL(regenerated.shareUrl).hash.slice(1)).get("t");
  assert.notEqual(currentToken, staleToken, "regeneration produces a new independent token");
  const regeneratedRecipient = await createHttpIdentity(regeneratedEmail);
  const beforeStaleToken = await snapshot(companyA);
  response = await request("/api/invitations/share/accept", { user: regeneratedRecipient, method: "POST", body: { token: staleToken } }); assert.equal(response.status, 404);
  assert.deepEqual(await snapshot(companyA), beforeStaleToken, "regenerated link invalidates the previous token without side effects");
  response = await request("/api/invitations/share/accept", { user: regeneratedRecipient, method: "POST", body: { token: currentToken } }); assert.equal(response.status, 200);

  const crossChannelRaceEmail = `share-cross-race-${randomUUID()}@qr-asistencia.invalid`;
  const crossChannelRaceId = await createPendingInvite(crossChannelRaceEmail);
  const { body: crossChannelRaceLink } = await getShareLink(companyA, crossChannelRaceId);
  const crossChannelRaceToken = new URLSearchParams(new URL(crossChannelRaceLink.shareUrl).hash.slice(1)).get("t");
  const crossChannelRecipient = await createHttpIdentity(crossChannelRaceEmail);
  const [whatsAppRaceResponse, emailRaceResult] = await Promise.all([
    request("/api/invitations/share/accept", { user: crossChannelRecipient, method: "POST", body: { token: crossChannelRaceToken } }),
    crossChannelRecipient.client.rpc("accept_company_user_invitation", { p_invitation_id: crossChannelRaceId }),
  ]);
  assert.ok([200, 404].includes(whatsAppRaceResponse.status), `WhatsApp race outcome is accepted once or rejected after email wins: ${whatsAppRaceResponse.status}`);
  if (emailRaceResult.error) {
    assert.equal(emailRaceResult.error.code, "P0002");
    assert.equal(whatsAppRaceResponse.status, 200, "WhatsApp wins only when the email path is rejected as already consumed");
  } else {
    assert.equal(whatsAppRaceResponse.status, 404, "email wins only when the WhatsApp token is invalidated");
  }
  const raceAcceptedRow = (await dbPool.query("select status,share_token_hash from public.company_user_invitations where id=$1", [crossChannelRaceId])).rows[0];
  assert.equal(raceAcceptedRow.status, "accepted"); assert.equal(raceAcceptedRow.share_token_hash, null);
  assert.equal(Number((await dbPool.query("select count(*) n from public.company_memberships m join auth.users u on u.id=m.user_id where m.company_id=$1 and lower(u.email)=$2 and m.active", [companyA, crossChannelRaceEmail])).rows[0].n), 1);
  assert.equal(Number((await dbPool.query("select count(*) n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_INVITATION_ACCEPTED'", [companyA, crossChannelRaceId])).rows[0].n), 1);
  const afterCrossChannelRace = await snapshot(companyA);
  if (whatsAppRaceResponse.status === 404) {
    const replayEmail = await crossChannelRecipient.client.rpc("accept_company_user_invitation", { p_invitation_id: crossChannelRaceId });
    assert.equal(replayEmail.error?.code, "P0002");
  } else {
    const replayWhatsApp = await request("/api/invitations/share/accept", { user: crossChannelRecipient, method: "POST", body: { token: crossChannelRaceToken } });
    assert.equal(replayWhatsApp.status, 404);
  }
  assert.deepEqual(await snapshot(companyA), afterCrossChannelRace, "concurrent cross-channel replay cannot add a membership or audit row");

  const expiredShareEmail = `share-expired-${randomUUID()}@qr-asistencia.invalid`;
  const expiredShareId = await createPendingInvite(expiredShareEmail);
  const { body: expiredShare } = await getShareLink(companyA, expiredShareId);
  const expiredShareToken = new URLSearchParams(new URL(expiredShare.shareUrl).hash.slice(1)).get("t");
  await dbPool.query("update public.company_user_invitations set expires_at=clock_timestamp()-interval '1 minute' where id=$1", [expiredShareId]);
  const expiredShareRecipient = await createHttpIdentity(expiredShareEmail);
  const beforeExpiredShare = await snapshot(companyA);
  response = await request("/api/invitations/share/accept", { user: expiredShareRecipient, method: "POST", body: { token: expiredShareToken } }); assert.equal(response.status, 404);
  assert.deepEqual(await snapshot(companyA), beforeExpiredShare, "expired share token is rejected without side effects");

  const revokedShareEmail = `share-revoked-${randomUUID()}@qr-asistencia.invalid`;
  const revokedShareId = await createPendingInvite(revokedShareEmail);
  const { body: revokedShare } = await getShareLink(companyA, revokedShareId);
  const revokedShareToken = new URLSearchParams(new URL(revokedShare.shareUrl).hash.slice(1)).get("t");
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { action: "revoke-invitation", invitationId: revokedShareId } }); assert.equal(response.status, 200);
  const revokedShareRecipient = await createHttpIdentity(revokedShareEmail);
  const beforeRevokedShare = await snapshot(companyA);
  response = await request("/api/invitations/share/accept", { user: revokedShareRecipient, method: "POST", body: { token: revokedShareToken } }); assert.equal(response.status, 404);
  assert.deepEqual(await snapshot(companyA), beforeRevokedShare, "revoked share token is rejected without side effects");

  const existingMemberInvitation = await dbPool.query("insert into public.company_user_invitations(company_id,email,role,invited_by) values($1,$2,'employee',$3) returning id", [companyA, employeeA.email, adminA.userId]);
  const existingMemberShareId = existingMemberInvitation.rows[0].id;
  const { body: existingMemberShare } = await getShareLink(companyA, existingMemberShareId);
  const existingMemberShareToken = new URLSearchParams(new URL(existingMemberShare.shareUrl).hash.slice(1)).get("t");
  const beforeAlreadyMember = await snapshot(companyA);
  response = await request("/api/invitations/share/accept", { user: employeeA, method: "POST", body: { token: existingMemberShareToken } }); assert.equal(response.status, 409);
  assert.deepEqual(await snapshot(companyA), beforeAlreadyMember, "existing active membership blocks share acceptance without side effects");

  const concurrentEmail = `share-race-${randomUUID()}@qr-asistencia.invalid`;
  const concurrentInvitationId = await createPendingInvite(concurrentEmail);
  const { body: concurrentShare } = await getShareLink(companyA, concurrentInvitationId);
  const concurrentToken = new URLSearchParams(new URL(concurrentShare.shareUrl).hash.slice(1)).get("t");
  const concurrentRecipient = await createHttpIdentity(concurrentEmail);
  const concurrentResults = await Promise.all([
    request("/api/invitations/share/accept", { user: concurrentRecipient, method: "POST", body: { token: concurrentToken } }),
    request("/api/invitations/share/accept", { user: concurrentRecipient, method: "POST", body: { token: concurrentToken } }),
  ]);
  assert.deepEqual(concurrentResults.map((item) => item.status).sort(), [200, 404], "concurrent accept attempts consume the invitation once");
  assert.equal(Number((await dbPool.query("select count(*) n from public.company_memberships m join auth.users u on u.id=m.user_id where m.company_id=$1 and lower(u.email)=$2 and m.active", [companyA, concurrentEmail])).rows[0].n), 1);
  assert.equal(Number((await dbPool.query("select count(*) n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_INVITATION_ACCEPTED'", [companyA, concurrentInvitationId])).rows[0].n), 1);
  process.stdout.write("PASS email and WhatsApp acceptance interoperate, invalidate each other, serialize concurrent attempts, enforce owner-only administrator links and reject regenerated tokens\n");
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
