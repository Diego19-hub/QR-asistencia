#!/usr/bin/env node
/* Local-only disposable Supabase authorization matrix. Never links a remote project. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import pg from "pg";
import { launchServerActionBrowser } from "./qr004-server-actions.browser.mjs";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "node_modules/.bin/supabase");
const e2eOnly = process.argv.includes("--e2e-only");
const performanceOnly = process.argv.includes("--performance-only");
const supervisorDeviceRlsOnly = process.argv.includes("--supervisor-device-rls-only");
const privilegedRpcAuditOnly = process.argv.includes("--privileged-rpc-audit-only");
const phase9RpcOnly = process.argv.includes("--phase9-rpc-auth-only");
const rpcSecurityCiOnly = process.argv.includes("--rpc-security-ci-only");
const phase10ResidualOnly = process.argv.includes("--phase10-residual-only");
const authorizationRacesOnly = process.argv.includes("--authorization-races-only");
const invitationFlowOnly = process.argv.includes("--invitation-flow-only");
const isolatedModes = [supervisorDeviceRlsOnly, privilegedRpcAuditOnly, phase9RpcOnly, rpcSecurityCiOnly, phase10ResidualOnly, authorizationRacesOnly].filter(Boolean);
assert.ok(isolatedModes.length <= 1 && !(isolatedModes.length && (e2eOnly || performanceOnly)), "isolated security modes cannot be combined with another mode");
const browserOnly = e2eOnly || performanceOnly;
const performanceResultsFile = process.env.QR009_RESULTS_FILE ?? join(tmpdir(), `qr009-runtime-${Date.now()}.json`);
const projectId = `qr004_disposable_${randomBytes(6).toString("hex")}`;
// Keep Mailpit enabled. Auth invite email is captured locally and cannot leave this stack.
const excluded = "realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
const auditOnlyExcluded = "gotrue,realtime,storage-api,imgproxy,kong,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor,mailpit";
const generalSuites = [
  "attendance_integrity_test.sql",
  "employee_portal_rls_behavior_test.sql",
  "company_user_access_behavior_test.sql",
  "company_user_access_management_test.sql",
  "company_user_share_invitations_test.sql",
  "employee_credentials_test.sql",
  "qr004_scanner_authorization_test.sql",
  "schedule_integrity_test.sql",
];
const rpcSecurityCiSuites = [
  "qr007_supervisor_device_rls_test.sql",
  "qr004_privileged_rpc_authorization_test.sql",
  "qr004_phase9_rpc_authorization_test.sql",
];
const phase10ResidualSuites = ["qr004_phase10_residual_authorization_test.sql"];
const suites = supervisorDeviceRlsOnly ? ["qr007_supervisor_device_rls_test.sql"]
  : privilegedRpcAuditOnly ? ["qr004_privileged_rpc_authorization_test.sql", "qr007_supervisor_device_rls_test.sql"]
    : phase9RpcOnly ? ["qr004_phase9_rpc_authorization_test.sql"]
      : rpcSecurityCiOnly ? rpcSecurityCiSuites
        : phase10ResidualOnly ? phase10ResidualSuites : authorizationRacesOnly ? [] : generalSuites;
const rpcSecurityCiExpected = new Map([
  ["qr007_supervisor_device_rls_test.sql", 27],
  ["qr004_privileged_rpc_authorization_test.sql", 26],
  ["qr004_phase9_rpc_authorization_test.sql", 62],
]);
let temp;
let startAttempted = false;
let appServer, actionBrowser, dbPool, service, apiUrl, anonKey, serviceKey, dbUrl, appUrl, mailpitUrl, appOutput = "";
let resendServer, resendUrl;
const resendMessages = [];
const resendFailRecipients = new Set();
let invitationFlowFixtures;
let attendanceSessionA, attendanceSessionB, foreignBranchSession;

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
      .split(/\r?\n/).filter(Boolean).slice(-30).join(" | ").slice(0, 4000);
    throw new Error(`isolated local Supabase command failed (${args.slice(0, 3).join(" ")}): ${detail || "no diagnostic"}`);
  }
}

async function freePortBlock() {
  const mappedPorts = dockerHostPorts();
  for (let base = 56_000 + Math.floor(Math.random() * 1_500); base < 62_000; base += 10) {
    if (Array.from({ length: 10 }, (_, offset) => base + offset).some((port) => mappedPorts.has(port))) continue;
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

function dockerHostPorts() {
  const output = execFileSync("docker", ["container", "ls", "-a", "--format", "{{.Ports}}"], { encoding: "utf8" });
  return new Set([...output.matchAll(/(?:0\.0\.0\.0|\[::\]):(\d+)->/g)].map((match) => Number(match[1])));
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
async function runPlaywrightLocal(env, secrets) {
  const playwrightArgs = [join(root, "node_modules/@playwright/test/cli.js"), "test", "--config", join(root, "playwright.config.ts")];
  if (performanceOnly) playwrightArgs.push("tests/performance/web-performance.spec.ts");
  if (process.argv.includes("--ui")) playwrightArgs.push("--ui");
  const child = spawn(process.execPath, playwrightArgs, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk.toString()).slice(-16_000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk.toString()).slice(-16_000); });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once("error", () => rejectExit(new Error("could not start the local Playwright runner")));
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
  for (const secret of secrets.filter(Boolean)) output = output.split(secret).join("[redacted synthetic credential]");
  output = output.replace(/([?&]token_hash=)[^&#\s"']+/gi, "$1[redacted]");
  output = output.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted JWT]")
    .replace(/(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]{8,}|postgres(?:ql)?:\/\/[^\s)]+)/gi, "[redacted local credential]");
  if (output.trim()) process.stdout.write(output);
  if (exitCode !== 0) throw new Error(`local Playwright suite failed (exit ${exitCode}); credentials were redacted from its output`);
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
async function createHttpUser(label, role, companyId, { extraMemberships = [], employee = false, branchId, email: suppliedEmail } = {}) {
  const email = suppliedEmail ?? `${label}-${randomUUID()}@qr-asistencia.invalid`;
  const password = randomBytes(32).toString("base64url");
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`local Auth fixture creation failed (${label})`);
  const userId = created.data.user.id;
  await markInvitationSetupComplete(userId);
  const membershipRows = [];
  for (const [membershipCompanyId, membershipRole] of [[companyId, role], ...extraMemberships]) {
    const inserted = await service.from("company_memberships").insert({ company_id: membershipCompanyId, user_id: userId, role: membershipRole, active: true }).select("id,company_id,role").single();
    if (inserted.error || !inserted.data) throw new Error(`synthetic membership creation failed (${label})`);
    membershipRows.push(inserted.data);
  }
  let employeeId;
  if (employee) {
    const inserted = await service.from("employees").insert({ company_id: companyId, employee_number: `HTTP-${randomBytes(4).toString("hex")}`, first_name: "Synthetic", last_name: label, email, auth_user_id: userId, branch_id: branchId ?? null, active: true }).select("id").single();
    if (inserted.error || !inserted.data) throw new Error(`synthetic employee creation failed (${label})`);
    employeeId = inserted.data.id;
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
  return { userId, email, password, companyId, employeeId, memberships: membershipRows, client, cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
}
async function markInvitationSetupComplete(userId) {
  const marker = new Date().toISOString();
  await dbPool.query("update auth.users set raw_app_meta_data=jsonb_set(coalesce(raw_app_meta_data,'{}'::jsonb),'{access_setup_completed_at}',to_jsonb($2::text),true) where id=$1", [userId, marker]);
}
async function createAuthOnly(email) {
  const password = randomBytes(32).toString("base64url");
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("failed creating synthetic Auth identity");
  await markInvitationSetupComplete(created.data.user.id);
  const client = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) throw new Error("synthetic identity failed local Auth login");
  return client;
}
async function createHttpIdentity(email, { emailConfirmed = true, setupCompleted = true } = {}) {
  const password = randomBytes(32).toString("base64url");
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("failed creating synthetic HTTP Auth identity");
  if (setupCompleted) await markInvitationSetupComplete(created.data.user.id);
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
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'membership_id',membership_id,'active',active,'revoked_at',revoked_at) order by id),'[]'::jsonb) from public.authorized_devices where company_id=$1) devices,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by id),'[]'::jsonb) from public.branches where company_id=$1) branches,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'employee_number',employee_number,'branch_id',branch_id,'active',active) order by id),'[]'::jsonb) from public.employees where company_id=$1) employees,
    (select coalesce(jsonb_agg(jsonb_build_object('membership_id',membership_id,'employee_id',employee_id) order by membership_id),'[]'::jsonb) from public.supervisors where company_id=$1) supervisors,
    (select coalesce(jsonb_agg(jsonb_build_object('membership_id',membership_id,'branch_id',branch_id) order by membership_id,branch_id),'[]'::jsonb) from public.supervisor_branches where company_id=$1) supervisor_branches,
    (select coalesce(jsonb_agg(jsonb_build_object('employee_id',q.employee_id,'issued_at',q.issued_at,'revoked_at',q.revoked_at) order by q.employee_id),'[]'::jsonb) from private.employee_qr_tokens q join public.employees e on e.id=q.employee_id where e.company_id=$1) employee_qr_credentials,
    (select coalesce(jsonb_agg(jsonb_build_object('employee_id',p.employee_id,'failed_attempts',p.failed_attempts,'locked_until',p.locked_until) order by p.employee_id),'[]'::jsonb) from private.employee_pin_credentials p where p.company_id=$1) employee_pin_state,
    (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'branch_id',r.branch_id,'membership_id',r.membership_id,'status',r.status,'device_id',r.device_id,'redeemed_at',r.redeemed_at) order by r.id),'[]'::jsonb) from private.device_authorization_requests r where r.company_id=$1) device_requests`, [companyId]);
  const expanded = await dbPool.query(`select
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'employee_id',employee_id,'branch_id',branch_id,'assignment_id',assignment_id,'local_work_date',local_work_date,'status',status,'started_at',started_at,'ended_at',ended_at) order by id),'[]'::jsonb) from public.attendance_sessions where company_id=$1) attendance_sessions,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'session_id',session_id,'event_type',event_type,'sequence_no',sequence_no,'idempotency_key',idempotency_key) order by id),'[]'::jsonb) from public.attendance_events where company_id=$1) attendance_events,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'session_id',session_id,'requested_by',requested_by,'reviewed_by',reviewed_by,'status',status,'reason',reason,'proposed_events',proposed_events) order by id),'[]'::jsonb) from public.attendance_adjustments where company_id=$1) attendance_adjustments,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'branch_id',branch_id,'name',name,'active',active,'effective_from',effective_from,'effective_to',effective_to) order by id),'[]'::jsonb) from public.schedule_templates where company_id=$1) schedule_templates,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'template_id',template_id,'iso_weekday',iso_weekday,'start_local',start_local,'end_local',end_local,'scheduled_minutes',scheduled_minutes) order by id),'[]'::jsonb) from public.schedule_template_days where company_id=$1) schedule_template_days,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'template_day_id',template_day_id,'break_rule_id',break_rule_id,'planned_start_local',planned_start_local,'planned_end_local',planned_end_local) order by id),'[]'::jsonb) from public.schedule_template_breaks where company_id=$1) schedule_template_breaks,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'effective_from',effective_from,'effective_to',effective_to) order by id),'[]'::jsonb) from public.break_rules where company_id=$1) break_rules,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'employee_id',employee_id,'template_id',template_id,'branch_id',branch_id,'starts_on',starts_on,'ends_on',ends_on) order by id),'[]'::jsonb) from public.schedule_assignments where company_id=$1) schedule_assignments`, [companyId]);
  const scheduleFinance = await dbPool.query(`select
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'effective_from',effective_from,'effective_to',effective_to,'settings',settings) order by id),'[]'::jsonb) from public.labor_rule_sets where company_id=$1) labor_rule_sets,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'session_id',session_id,'detected_minutes',detected_minutes,'rule_set_id',rule_set_id,'detail',detail) order by id),'[]'::jsonb) from public.overtime_assessments where company_id=$1) overtime_assessments,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'session_id',session_id,'minutes',minutes,'status',status,'requested_by',requested_by,'decided_by',decided_by,'reason',reason) order by id),'[]'::jsonb) from public.overtime_authorizations where company_id=$1) overtime_authorizations`, [companyId]);
  Object.assign(rows[0], expanded.rows[0]);
  Object.assign(rows[0], scheduleFinance.rows[0]);
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
async function getMailpitMessage(email, expectedCount = 1) {
  await waitForMailpitRecipient(email, expectedCount);
  const response = await fetch(new URL("/api/v1/messages?limit=100", mailpitUrl));
  const payload = await response.json();
  const messages = Array.isArray(payload) ? payload : payload.messages;
  const item = messages.filter((message) => (message.To ?? message.to ?? []).some((recipient) => (recipient.Address ?? recipient.address ?? "").toLowerCase() === email.toLowerCase()))
    .sort((a, b) => String(b.Created ?? b.created ?? b.Date ?? b.date ?? "").localeCompare(String(a.Created ?? a.created ?? a.Date ?? a.date ?? "")))[0];
  const id = item?.ID ?? item?.Id ?? item?.id;
  assert.ok(id, "Mailpit lists the expected synthetic message");
  const detailResponse = await fetch(new URL(`/api/v1/message/${encodeURIComponent(id)}`, mailpitUrl));
  assert.equal(detailResponse.status, 200, "Mailpit exposes the synthetic message body only to the local test runner");
  return detailResponse.json();
}
function extractConfirmationUrl(message) {
  const body = [message.HTML, message.Text, message.html, message.text, message.Body].filter((item) => typeof item === "string").join("\n");
  const candidate = body.match(/https?:\/\/[^\s"'<>]+/g)?.map((value) => value.replaceAll("&amp;", "&"))
    .find((value) => value.includes("/auth/confirm?") && value.includes("token_hash="));
  assert.ok(candidate, "synthetic email contains the fixed token-hash confirmation URL");
  const url = new URL(candidate);
  assert.equal(url.origin, appUrl, "confirmation link uses the disposable local application origin");
  assert.equal(url.pathname, "/auth/confirm");
  assert.ok(["invite", "magiclink"].includes(url.searchParams.get("type")));
  assert.ok(url.searchParams.get("token_hash"));
  assert.equal(url.hash, "", "confirmation URL has no access/refresh token fragment");
  return url.href;
}
async function startLocalResendMock() {
  resendServer = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; if (raw.length > 64_000) request.destroy(); });
    request.on("end", () => {
      let message;
      try { message = JSON.parse(raw); } catch { response.writeHead(400).end(); return; }
      const recipient = Array.isArray(message.to) ? message.to[0] : "";
      if (typeof recipient !== "string" || !recipient.endsWith("@qr-asistencia.invalid")) { response.writeHead(403).end(); return; }
      if (resendFailRecipients.has(recipient)) { response.writeHead(503).end(); return; }
      resendMessages.push(message);
      response.writeHead(200, { "content-type": "application/json" }).end('{"id":"synthetic-local-mail-id"}');
    });
  });
  await new Promise((resolveServer, rejectServer) => {
    resendServer.once("error", rejectServer);
    resendServer.listen(0, "127.0.0.1", resolveServer);
  });
  const address = resendServer.address();
  resendUrl = `http://127.0.0.1:${address.port}/emails`;
  localUrl(resendUrl, "synthetic Resend endpoint");
}

const before = Object.fromEntries(["containers", "volumes", "networks"].map((kind) => [kind, dockerResources(kind)]));
const cleanupErrors = [];
let primaryError;
try {
  temp = await mkdtemp(join(tmpdir(), "qr004-auth-matrix-"));
  const workdir = join(temp, "project");
  await mkdir(join(workdir, "supabase", "migrations"), { recursive: true });
  await mkdir(join(workdir, "supabase", "tests"), { recursive: true });
  if (supervisorDeviceRlsOnly || privilegedRpcAuditOnly || phase9RpcOnly || rpcSecurityCiOnly || phase10ResidualOnly || authorizationRacesOnly) {
    const canonicalMigrations = execFileSync("git", ["ls-files", "-z", "supabase/migrations/*.sql"], { cwd: root, encoding: "utf8" })
      .split("\0").filter(Boolean);
    const pendingReviewedMigrations = [
      "supabase/migrations/20261105172831_supervisor_device_request_authorization_lock.sql",
      "supabase/migrations/20261105234619_invitation_account_setup_required.sql",
    ];
    for (const migration of pendingReviewedMigrations) {
      if (await readFile(join(root, migration), "utf8").then(() => true, () => false) && !canonicalMigrations.includes(migration)) canonicalMigrations.push(migration);
    }
    canonicalMigrations.sort();
    assert.equal(canonicalMigrations.length, 30, "isolated auth/RLS/RPC audit requires canonical migrations plus the reviewed supervisor-device and invitation-account-setup migrations");
    for (const migration of canonicalMigrations) {
      await cp(join(root, migration), join(workdir, migration));
    }
  } else {
    await cp(join(root, "supabase/migrations"), join(workdir, "supabase/migrations"), { recursive: true });
  }
  await cp(join(root, "supabase/templates"), join(workdir, "supabase/templates"), { recursive: true });
  for (const suite of suites) await cp(join(root, "supabase/tests", suite), join(workdir, "supabase/tests", suite));
  let config = await readFile(join(root, "supabase/config.toml"), "utf8");
  const base = await freePortBlock();
  const nextPort = await freePort(base + 20);
  appUrl = `http://127.0.0.1:${nextPort}`;
  const defaultSiteUrl = 'site_url = "http://127.0.0.1:3000"';
  assert.ok(config.includes(defaultSiteUrl), "temporary Auth site_url setting exists");
  config = config.replace(defaultSiteUrl, `site_url = "${appUrl}"`);
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
  safeCli(["start", "--exclude", privilegedRpcAuditOnly || phase9RpcOnly || rpcSecurityCiOnly || phase10ResidualOnly ? auditOnlyExcluded : excluded]);
  safeCli(["db", "reset", "--local"]);
  process.stdout.write("PASS fresh disposable database with repository migrations applied locally\n");
  let rpcSecurityCiTotal = 0;
  for (const suite of browserOnly ? [] : suites) {
    const output = safeCli(["test", "db", "--local", `supabase/tests/${suite}`]);
    const sql = await readFile(join(workdir, "supabase/tests", suite), "utf8");
    const plan = Number(sql.match(/select\s+plan\s*\(\s*(\d+)\s*\)/i)?.[1]);
    if (phase10ResidualOnly) {
      assert.match(sql, /^BEGIN\s*;/im, `${suite} must start a fixture transaction`);
      assert.match(sql, /^ROLLBACK\s*;/im, `${suite} must roll back all fixtures`);
      assert.doesNotMatch(sql, /\b(?:scan_employee_attendance|confirm_employee_attendance|verify_employee_pin)\s*\(/i, `${suite} must not call scan or PIN functions`);
      assert.doesNotMatch(sql, /\bINSERT\s+INTO\s+public\.(?:attendance_sessions|attendance_events)\b/i, `${suite} must not create attendance records`);
      const tapOkCount = [...output.matchAll(/^\s*ok\s+\d+(?:\s+-.*)?$/gim)].length;
      const summaryCount = output.match(/\bTests=(\d+)\b/i)?.[1]
        ?? output.match(/\bAll\s+(\d+)\s+tests?\s+passed\b/i)?.[1];
      const observedCount = tapOkCount || (summaryCount ? Number(summaryCount) : null);
      assert.ok(Number.isInteger(plan) && plan > 0, `${suite} declares a positive pgTAP plan`);
      assert.equal(observedCount, plan, `${suite} must report every passing pgTAP assertion`);
      process.stdout.write(`ASSERTIONS ${suite}: ${observedCount}/${plan} PASS\n`);
    }
    assert.ok(Number.isInteger(plan) && plan > 0, `${suite} must declare a pgTAP plan`);
    if (rpcSecurityCiOnly) {
      assert.match(sql, /^BEGIN\s*;/im, `${suite} must start an isolated fixture transaction`);
      assert.match(sql, /^ROLLBACK\s*;/im, `${suite} must roll back its synthetic fixtures`);
      const tapOkCount = [...output.matchAll(/^\s*ok\s+\d+(?:\s+-.*)?$/gim)].length;
      const summaryCount = output.match(/\bTests=(\d+)\b/i)?.[1]
        ?? output.match(/\bAll\s+(\d+)\s+tests?\s+passed\b/i)?.[1];
      const observedCount = tapOkCount || (summaryCount ? Number(summaryCount) : null);
      assert.equal(plan, rpcSecurityCiExpected.get(suite), `${suite} declares the expected pgTAP count`);
      assert.equal(observedCount, plan, `${suite} must report every passing pgTAP assertion`);
      rpcSecurityCiTotal += observedCount;
    }
    const summary = output.match(/\bAll\s+(\d+)\s+tests?\s+passed\b/i)?.[0]
      ?? output.split(/\r?\n/).filter((line) => /tests? passed|Looks like you failed/i.test(line)).slice(-1)[0]
      ?? `${plan} pgTAP assertions passed (CLI exited successfully)`;
    process.stdout.write(`PASS ${suite}: ${summary}\n`);
  }
  if (rpcSecurityCiOnly) {
    assert.deepEqual(suites, rpcSecurityCiSuites, "unified RPC CI mode runs only the three approved suites in order");
    assert.equal(rpcSecurityCiTotal, 115, "unified RPC CI mode must pass exactly 115 pgTAP assertions");
  }

  if (phase10ResidualOnly) {
    assert.deepEqual(suites, phase10ResidualSuites, "Phase 10.2 mode runs only the residual authorization suite");
  }

  if (supervisorDeviceRlsOnly) {
    process.stdout.write("PASS isolated supervisor/device RLS-only run; no HTTP app, scan, PIN, or attendance flow started\n");
  } else if (privilegedRpcAuditOnly) {
    const values = parseEnv(safeCli(["status", "--output", "env"]));
    dbUrl = values.DB_URL;
    localUrl(dbUrl, "Supabase database URL");
    dbPool = new pg.Pool({ connectionString: dbUrl, max: 1 });
    const { rows } = await dbPool.query(`
      select n.nspname as schema_name, p.proname as function_name,
             p.oid::regprocedure::text as identity_arguments,
             pg_get_function_result(p.oid) as result_type,
             pg_get_userbyid(p.proowner) as owner,
             coalesce(p.proconfig, array[]::text[]) as settings,
             coalesce((select jsonb_agg(jsonb_build_object(
               'grantee', case when a.grantee = 0 then 'PUBLIC' else r.rolname end,
               'privilege', a.privilege_type, 'grantable', a.is_grantable
             ) order by case when a.grantee = 0 then '' else r.rolname end, a.privilege_type)
               from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               left join pg_roles r on r.oid = a.grantee), '[]'::jsonb) as acl,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
             has_schema_privilege('anon', n.oid, 'USAGE') as anon_schema_usage,
             has_schema_privilege('authenticated', n.oid, 'USAGE') as authenticated_schema_usage,
             has_schema_privilege('service_role', n.oid, 'USAGE') as service_role_schema_usage,
             pg_get_functiondef(p.oid) as definition
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and p.prokind = 'f'
         and n.nspname not in ('information_schema')
       order by n.nspname, p.proname, p.oid::regprocedure::text
    `);
    const { rows: viewRows } = await dbPool.query(`
      select n.nspname as schema_name, c.relname as view_name,
             coalesce(c.reloptions, array[]::text[]) as options,
             pg_get_userbyid(c.relowner) as owner,
             coalesce((select jsonb_agg(jsonb_build_object(
               'grantee', case when a.grantee = 0 then 'PUBLIC' else r.rolname end,
               'privilege', a.privilege_type
             ) order by case when a.grantee = 0 then '' else r.rolname end, a.privilege_type)
               from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
               left join pg_roles r on r.oid = a.grantee), '[]'::jsonb) as acl
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'v' and n.nspname not in ('information_schema','pg_catalog')
       order by n.nspname, c.relname
    `);
    const inventoryPath = process.env.QR004_PHASE8_CATALOG_FILE;
    if (inventoryPath) {
      const destination = resolve(inventoryPath);
      assert.ok(destination.startsWith("/private/tmp/"), "catalog output must stay outside the repository under /private/tmp");
      await writeFile(destination, JSON.stringify({ functions: rows, views: viewRows }, null, 2), { mode: 0o600 });
    }
    const summary = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "definition")));
    process.stdout.write(`PRIVILEGED_RPC_CATALOG_COUNT=${rows.length}\n`);
    process.stdout.write(`PRIVILEGED_RPC_CATALOG_JSON=${JSON.stringify(summary)}\n`);
    process.stdout.write("PASS effective SECURITY DEFINER catalog read from disposable local PostgreSQL only; no HTTP Auth, scan, PIN, or attendance flow started\n");
  } else if (phase9RpcOnly) {
    process.stdout.write("PASS isolated Phase 9.1 RPC authorization suite only; no HTTP Auth, QR processing, PIN verification, scan, or attendance flow started\n");
  } else if (rpcSecurityCiOnly) {
    process.stdout.write("PASS isolated RPC security CI suite: 27 + 26 + 62 = 115 pgTAP assertions; no HTTP Auth, Next.js, QR processing, PIN, scan, or attendance flow started\n");
  } else if (phase10ResidualOnly) {
    process.stdout.write("PASS isolated QR-004 Phase 10.2 authorization/audit suite only; no HTTP Auth, Next.js, QR processing, PIN, scan, or attendance flow started\n");
  } else {

  // Exercise the same API and Server Component guards used by the app. The
  // app receives only loopback Supabase endpoints and an ephemeral local key.
  const values = parseEnv(safeCli(["status", "--output", "env"]));
  apiUrl = values.API_URL; anonKey = values.ANON_KEY; serviceKey = values.SERVICE_ROLE_KEY; dbUrl = values.DB_URL;
  localUrl(apiUrl, "Supabase API URL"); localUrl(dbUrl, "Supabase database URL");
  assert.ok(anonKey && serviceKey && anonKey !== serviceKey, "local Supabase keys are available in memory");
  dbPool = new pg.Pool({ connectionString: dbUrl, max: authorizationRacesOnly ? 4 : 2 }); await dbPool.query("select 1");
  service = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const mailpitReady = await fetch(new URL("/api/v1/messages?limit=1", mailpitUrl));
  assert.equal(mailpitReady.status, 200, "isolated local Mailpit API is reachable");
  const companyAName = `QR004 HTTP Synthetic A ${randomUUID()}`;
  const companyBName = `QR004 HTTP Synthetic B ${randomUUID()}`;
  const companyAResult = await service.from("companies").insert({ name: companyAName }).select("id").single();
  const companyBResult = await service.from("companies").insert({ name: companyBName }).select("id").single();
  if (companyAResult.error || companyBResult.error) throw new Error("failed creating synthetic HTTP test companies");
  const companyA = companyAResult.data.id, companyB = companyBResult.data.id;
  const branchAResult = await service.from("branches").insert({ company_id: companyA, name: `HTTP Branch A ${randomUUID()}`, timezone: "America/Mexico_City" }).select("id").single();
  const branchBResult = await service.from("branches").insert({ company_id: companyB, name: `HTTP Branch B ${randomUUID()}`, timezone: "America/Mexico_City" }).select("id").single();
  if (branchAResult.error || branchBResult.error) throw new Error("failed creating synthetic HTTP branches");
  const branchA = branchAResult.data.id, branchB = branchBResult.data.id;
  const otherBranchAResult = await service.from("branches").insert({ company_id: companyA, name: `HTTP Branch A2 ${randomUUID()}`, timezone: "America/Mexico_City" }).select("id").single();
  if (otherBranchAResult.error || !otherBranchAResult.data) throw new Error("failed creating second synthetic branch for branch-scope verification");
  const otherBranchA = otherBranchAResult.data.id;
  const ownerA = await createHttpUser("owner-a", "owner", companyA);
  const adminA = await createHttpUser("admin-a", "admin", companyA);
  const adminB = await createHttpUser("admin-b", "admin", companyB);
  const supervisorA = await createHttpUser("supervisor-a", "supervisor", companyA);
  const supervisorB = await createHttpUser("supervisor-b", "supervisor", companyB);
  const employeeA = await createHttpUser("employee-a", "employee", companyA, { employee: true, branchId: branchA });
  const employeeB = await createHttpUser("employee-b", "employee", companyB, { employee: true, branchId: branchB });
  const multiAdmin = await createHttpUser("multi-admin", "admin", companyA, { extraMemberships: [[companyB, "admin"]] });
  const multiEmployee = await createHttpUser("multi-employee", "employee", companyA, { extraMemberships: [[companyB, "employee"]], employee: true });

  // Exercise attendance adjustment RLS with a supervisor assigned to one
  // synthetic branch and sessions in both authorized and unauthorized branches.
  const supervisorRecord = await service.from("supervisors").insert({ company_id: companyA, membership_id: supervisorA.memberships[0].id });
  if (supervisorRecord.error) throw new Error(`failed creating synthetic supervisor record (${supervisorRecord.error.code ?? "unknown"})`);
  const assignedBranch = await service.from("supervisor_branches").insert({ company_id: companyA, membership_id: supervisorA.memberships[0].id, branch_id: branchA });
  if (assignedBranch.error) throw new Error(`failed preparing synthetic supervisor branch scope (${assignedBranch.error.code ?? "unknown"})`);
  if (!browserOnly && !authorizationRacesOnly) {
  const sessionNow = new Date();
  const sessionBase = { company_id: companyA, employee_id: employeeA.employeeId, local_work_date: sessionNow.toISOString().slice(0, 10), timezone: "America/Mexico_City", status: "closed", started_at: new Date(sessionNow.getTime() - 60_000).toISOString(), ended_at: sessionNow.toISOString(), scheduled_minutes: 480 };
  const sessionAResult = await service.from("attendance_sessions").insert({ ...sessionBase, branch_id: branchA }).select("id").single();
  const sessionOtherBranchResult = await service.from("attendance_sessions").insert({ ...sessionBase, branch_id: otherBranchA }).select("id").single();
  const sessionBResult = await service.from("attendance_sessions").insert({ ...sessionBase, company_id: companyB, employee_id: employeeB.employeeId, branch_id: branchB }).select("id").single();
  if ([sessionAResult, sessionOtherBranchResult, sessionBResult].some((result) => result.error || !result.data)) throw new Error("failed creating closed synthetic attendance sessions");
  attendanceSessionA = sessionAResult.data.id;
  foreignBranchSession = sessionOtherBranchResult.data.id;
  attendanceSessionB = sessionBResult.data.id;
  const beforeAdjustmentDenial = await snapshot(companyA);
  const branchScopeProbe = await supervisorA.client.from("attendance_adjustments").insert({ company_id: companyA, session_id: foreignBranchSession, requested_by: supervisorA.userId, reason: "Synthetic branch-scope probe", proposed_events: [] }).select("id").maybeSingle();
  assert.equal(branchScopeProbe.error?.code, "42501", "supervisor cannot submit an adjustment for an unassigned branch");
  assert.deepEqual(await snapshot(companyA), beforeAdjustmentDenial, "cross-branch adjustment denial leaves sessions, adjustments, and audit state unchanged");
  process.stdout.write("PASS adjustment RLS rejects a synthetic supervisor write to another branch of the same company\n");
  const allowedBranchAdjustment = await supervisorA.client.from("attendance_adjustments").insert({ company_id: companyA, session_id: attendanceSessionA, requested_by: supervisorA.userId, reason: "Synthetic authorized correction", proposed_events: [] }).select("id").single();
  if (allowedBranchAdjustment.error || !allowedBranchAdjustment.data) throw new Error("supervisor could not submit correction within assigned branch");
  const beforeReviewDenial = await snapshot(companyA);
  const unauthorizedReview = await supervisorA.client.rpc("review_attendance_adjustment", { p_adjustment_id: allowedBranchAdjustment.data.id, p_approve: true, p_review_note: "Synthetic unauthorized review" });
  assert.equal(unauthorizedReview.error?.code, "42501", "supervisor without review permission cannot approve a correction");
  assert.deepEqual(await snapshot(companyA), beforeReviewDenial, "unauthorized correction review leaves status and audit unchanged");
  const reviewAuditCount = Number((await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_table='attendance_adjustments' and entity_id=$2", [companyA, allowedBranchAdjustment.data.id])).rows[0].n);
  const ownerReview = await ownerA.client.rpc("review_attendance_adjustment", { p_adjustment_id: allowedBranchAdjustment.data.id, p_approve: true, p_review_note: "Synthetic authorized review" });
  assert.ok(!ownerReview.error, `authorized owner review succeeds (${ownerReview.error?.code ?? "ok"})`);
  const reviewedAdjustment = await service.from("attendance_adjustments").select("status,reviewed_by").eq("id", allowedBranchAdjustment.data.id).single();
  assert.deepEqual(reviewedAdjustment.data, { status: "approved", reviewed_by: ownerA.userId });
  const reviewAuditAfter = Number((await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_table='attendance_adjustments' and entity_id=$2", [companyA, allowedBranchAdjustment.data.id])).rows[0].n);
  assert.equal(reviewAuditAfter, reviewAuditCount + 1, "authorized correction review creates one audit entry");
  const syntheticLegacyAdjustment = await service.from("attendance_adjustments").insert({ company_id: companyA, session_id: foreignBranchSession, requested_by: supervisorA.userId, reason: "Synthetic historical foreign-branch correction", proposed_events: [] }).select("id").single();
  if (syntheticLegacyAdjustment.error || !syntheticLegacyAdjustment.data) throw new Error("failed creating synthetic historical adjustment for read-scope check");
  const foreignBranchAdjustmentRead = await supervisorA.client.from("attendance_adjustments").select("id").eq("id", syntheticLegacyAdjustment.data.id);
  if (foreignBranchAdjustmentRead.error || (foreignBranchAdjustmentRead.data ?? []).length !== 0) throw new Error("supervisor can read an adjustment for an unassigned branch");
  const ownerBranchAssignments = await service.from("supervisor_branches").select("branch_id").eq("company_id", companyA).eq("membership_id", ownerA.memberships[0].id);
  if (ownerBranchAssignments.error || (ownerBranchAssignments.data ?? []).length !== 0) throw new Error("synthetic owner unexpectedly has a supervisor branch assignment");
  const crossBranchCompanyReview = await ownerA.client.rpc("review_attendance_adjustment", { p_adjustment_id: syntheticLegacyAdjustment.data.id, p_approve: true, p_review_note: "Synthetic company-scope review" });
  assert.ok(!crossBranchCompanyReview.error, `company reviewer can review a correction from another branch (${crossBranchCompanyReview.error?.code ?? "ok"})`);
  const companyReviewedAdjustment = await service.from("attendance_adjustments").select("status,reviewed_by").eq("id", syntheticLegacyAdjustment.data.id).single();
  assert.deepEqual(companyReviewedAdjustment.data, { status: "approved", reviewed_by: ownerA.userId }, "review_attendance_adjustment authorization is company-level rather than supervisor-branch-scoped");
  const noAttendanceAdjust = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "attendance.adjust", allowed: false });
  if (noAttendanceAdjust.error) throw new Error("could not prepare synthetic attendance.adjust denial");
  const beforeAdminAdjustmentDenial = await snapshot(companyA);
  const adminAdjustmentDenied = await adminA.client.from("attendance_adjustments").insert({ company_id: companyA, session_id: attendanceSessionA, requested_by: adminA.userId, reason: "Synthetic denied correction", proposed_events: [] }).select("id").maybeSingle();
  assert.equal(adminAdjustmentDenied.error?.code, "42501", "company.read alone cannot substitute for attendance.adjust");
  assert.deepEqual(await snapshot(companyA), beforeAdminAdjustmentDenial, "specific permission denial leaves correction and audit state unchanged");
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "attendance.adjust");
  }
  const appRoot = join(temp, "next-app"); await mkdir(appRoot, { recursive: true });
  await cp(join(root, "src"), join(appRoot, "src"), { recursive: true });
  // This route exists only in the isolated temporary app. It renders actual
  // Next Server Action forms for actions that otherwise have no standalone form
  // (notably setAdminMembership); Next generates and validates every action ID.
  const actionHarnessDir = join(appRoot, "src/app/qr004-action-harness");
  await mkdir(actionHarnessDir, { recursive: true });
  await writeFile(join(actionHarnessDir, "page.tsx"), `
import { signIn, signOut } from "@/app/(auth)/login/actions";
import { chooseMembership } from "@/app/(auth)/seleccionar-empresa/actions";
import { acceptInvitation, setInvitationPassword } from "@/app/(auth)/invitacion/actions";
import { setAdminMembership } from "@/app/(admin)/admin/actions";
import { signOutEmployee } from "@/app/(employee)/mi-qr/actions";
export default async function ServerActionHarness({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const value = (name: string) => typeof query[name] === "string" ? query[name] as string : "";
  // Capturing a primitive is serializable for the nested Server Action; do
  // not close over the helper function itself in the encrypted action payload.
  const requestedAdminMembershipId = value("adminMembershipId");
  async function employeeSignOut() { "use server"; await signOutEmployee(); }
  async function updateAdminMembership() {
    "use server";
    const allowed = await setAdminMembership(requestedAdminMembershipId);
    // Only synthetic test action result; never log IDs, tokens or cookies.
    console.info("QR004_LOCAL_ADMIN_ACTION_RESULT:" + (allowed ? "ALLOWED" : "DENIED"));
  }
  return <main>
    <form id="sign-in" action={signIn}><input name="email" type="email" /><input name="password" type="password" /><input type="hidden" name="next" value={value("next")} /><button type="submit">Sign in</button></form>
    <form id="sign-out" action={signOut}><button type="submit">Sign out</button></form>
    <form id="sign-out-employee" action={employeeSignOut}><button type="submit">Sign out employee</button></form>
    <form id="choose-membership" action={chooseMembership}><input type="hidden" name="membershipId" value={value("membershipId")} /><input type="hidden" name="next" value={value("next")} /><button type="submit">Choose membership</button></form>
    <form id="accept-invitation" action={acceptInvitation}><input type="hidden" name="invitationId" value={value("invitationId")} /><button type="submit">Accept invitation</button></form>
    <form id="set-invitation-password" action={setInvitationPassword}><input name="fullName" type="text" /><input name="password" type="password" /><input name="confirmation" type="password" /><button type="submit">Set invitation password</button></form>
    <form id="set-admin-membership" action={updateAdminMembership}><button type="submit">Set admin membership</button></form>
  </main>;
}
`, { mode: 0o600 });
  for (const file of ["package.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json"]) await cp(join(root, file), join(appRoot, file));
  await symlink(join(root, "node_modules"), join(appRoot, "node_modules"), "dir");
  const startNext = async (adminServiceKey = serviceKey) => {
    appOutput = "";
    const nextArgs = performanceOnly
      ? [join(root, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(nextPort)]
      : [join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(nextPort)];
    if (performanceOnly) {
      const build = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "build", "--webpack"], {
        cwd: appRoot,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: apiUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: adminServiceKey, APP_BASE_URL: appUrl },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buildOutput = "";
      build.stdout.on("data", (chunk) => { buildOutput = (buildOutput + chunk.toString()).slice(-8_000); });
      build.stderr.on("data", (chunk) => { buildOutput = (buildOutput + chunk.toString()).slice(-8_000); });
      const buildExit = await new Promise((resolveExit, rejectExit) => {
        build.once("error", () => rejectExit(new Error("could not start isolated Next.js production build")));
        build.once("exit", (code) => resolveExit(code ?? 1));
      });
      if (buildExit !== 0) {
        for (const secret of [anonKey, adminServiceKey, dbUrl].filter(Boolean)) buildOutput = buildOutput.split(secret).join("[redacted]");
        throw new Error(`isolated Next.js production build failed (${buildExit}): ${buildOutput.replace(/https?:\/\/[^\s)]+/g, "[url]").split(/\r?\n/).filter(Boolean).slice(-8).join(" | ").slice(0, 800)}`);
      }
      process.stdout.write("PASS isolated Next.js production build completed with loopback-only Supabase configuration\n");
    }
    appServer = spawn(process.execPath, nextArgs, {
      cwd: appRoot,
      env: {
        PATH: process.env.PATH, NODE_ENV: performanceOnly ? "production" : "development", NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_SUPABASE_URL: apiUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey,
        SUPABASE_SERVICE_ROLE_KEY: adminServiceKey, APP_BASE_URL: appUrl,
        ...(invitationFlowOnly ? { QR_AUTH_LOCAL_TEST: "1", QR_AUTH_LOCAL_RESEND_URL: resendUrl, RESEND_API_KEY: "synthetic-resend-test-key", INVITATION_FROM_EMAIL: "QR Tests <no-reply@qr-asistencia.invalid>" } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    appServer.stdout.on("data", (chunk) => { appOutput = (appOutput + chunk.toString()).slice(-12_000); });
    appServer.stderr.on("data", (chunk) => { appOutput = (appOutput + chunk.toString()).slice(-12_000); });
    await waitForNext(`${appUrl}/login`);
  };
  if (invitationFlowOnly) await startLocalResendMock();
  await startNext();
  process.stdout.write("PASS local Auth users and temporary Next.js server use only the disposable Supabase loopback endpoints\n");

  if (browserOnly) {
    const readAttendanceSnapshot = async () => {
      const snapshot = {};
      for (const table of ["attendance_sessions", "attendance_events"]) {
        const result = await service.from(table).select("*").order("id");
        if (result.error) throw new Error(`could not inspect local synthetic ${table} snapshot (${result.error.code ?? "unknown"})`);
        snapshot[table] = result.data ?? [];
      }
      return snapshot;
    };
    const unassigned = await createHttpIdentity(`e2e-unassigned-${randomUUID()}@qr-asistencia.invalid`);
    const unlinkedEmployee = await createHttpUser("e2e-unlinked-employee", "employee", companyA);
    const inactiveMembership = await createHttpUser("e2e-inactive-supervisor", "supervisor", companyA);
    const inactiveUpdate = await service.from("company_memberships").update({ active: false }).eq("id", inactiveMembership.memberships[0].id);
    if (inactiveUpdate.error) throw new Error("could not seed an inactive synthetic membership");
    const inactiveEmployee = await createHttpUser("e2e-inactive-employee", "employee", companyA, { employee: true, branchId: branchA });
    const inactiveEmployeeUpdate = await service.from("company_memberships").update({ active: false }).eq("id", inactiveEmployee.memberships[0].id);
    if (inactiveEmployeeUpdate.error) throw new Error("could not seed an inactive synthetic employee membership");
    const noBranchSupervisor = await createHttpUser("e2e-no-branch-supervisor", "supervisor", companyA);
    const noBranchRecord = await service.from("supervisors").insert({ company_id: companyA, membership_id: noBranchSupervisor.memberships[0].id });
    if (noBranchRecord.error) throw new Error("could not seed a supervisor without a branch");
    const networkSupervisor = await createHttpUser("e2e-network-supervisor", "supervisor", companyA);
    const networkSupervisorRecord = await service.from("supervisors").insert({ company_id: companyA, membership_id: networkSupervisor.memberships[0].id });
    const networkSupervisorBranch = await service.from("supervisor_branches").insert({ company_id: companyA, membership_id: networkSupervisor.memberships[0].id, branch_id: branchA });
    if (networkSupervisorRecord.error || networkSupervisorBranch.error) throw new Error("could not seed network-retry synthetic supervisor");
    const revokedSupervisor = await createHttpUser("e2e-revoked-supervisor", "supervisor", companyA);
    const revokedRecord = await service.from("supervisors").insert({ company_id: companyA, membership_id: revokedSupervisor.memberships[0].id });
    const revokedBranch = await service.from("supervisor_branches").insert({ company_id: companyA, membership_id: revokedSupervisor.memberships[0].id, branch_id: branchA });
    if (revokedRecord.error || revokedBranch.error) throw new Error("could not seed a revocable synthetic supervisor");
    const multiSupervisor = await createHttpUser("e2e-multi-supervisor", "supervisor", companyA, { extraMemberships: [[companyB, "supervisor"]] });
    for (const [companyId, membership, branchId] of [[companyA, multiSupervisor.memberships[0], branchA], [companyB, multiSupervisor.memberships[1], branchB]]) {
      const supervisor = await service.from("supervisors").insert({ company_id: companyId, membership_id: membership.id });
      const branch = await service.from("supervisor_branches").insert({ company_id: companyId, membership_id: membership.id, branch_id: branchId });
      if (supervisor.error || branch.error) throw new Error("could not seed multi-company synthetic supervisor scope");
    }

    if (performanceOnly) {
      const perfEmployees = Array.from({ length: 500 }, (_, index) => ({
        company_id: companyA, branch_id: branchA,
        employee_number: `QR009-${String(index + 1).padStart(4, "0")}`,
        first_name: "Synthetic", last_name: `Benchmark${index + 1}`, active: true,
      }));
      for (let offset = 0; offset < perfEmployees.length; offset += 100) {
        const inserted = await service.from("employees").insert(perfEmployees.slice(offset, offset + 100));
        if (inserted.error) throw new Error(`could not prepare synthetic SQL benchmark rows (${inserted.error.code ?? "unknown"})`);
      }
      process.stdout.write("PASS SQL benchmark fixture: 500 synthetic employees in local company A; no attendance rows created\n");
    }
    const performanceAttendanceSnapshot = performanceOnly ? await readAttendanceSnapshot() : null;
    if (performanceOnly) {
      for (const table of ["attendance_sessions", "attendance_events"]) {
        assert.deepEqual(performanceAttendanceSnapshot[table], [], `QR-009 performance-only requires an empty local ${table} table before browsing`);
      }
    }
    const childEnv = {
      PATH: process.env.PATH ?? "",
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      ...(process.env.CI ? { CI: process.env.CI } : {}),
      ...(process.env.QR004_CHROME_BIN ? { QR004_CHROME_BIN: process.env.QR004_CHROME_BIN } : {}),
      ...(process.env.QR004_CHROME_NO_SANDBOX === "1" ? { QR004_CHROME_NO_SANDBOX: "1" } : {}),
      QR005_BASE_URL: appUrl,
      QR005_SUPABASE_URL: apiUrl,
      QR005_MAILPIT_URL: mailpitUrl,
      QR005_RESULTS_DIR: join(temp, "playwright-results"),
      QR005_ADMIN_EMAIL: adminA.email,
      QR005_ADMIN_PASSWORD: adminA.password,
      QR005_ADMIN_B_EMAIL: adminB.email,
      QR005_ADMIN_B_PASSWORD: adminB.password,
      QR005_SUPERVISOR_EMAIL: supervisorA.email,
      QR005_SUPERVISOR_PASSWORD: supervisorA.password,
      QR005_SUPERVISOR_MEMBERSHIP_ID: supervisorA.memberships[0].id,
      QR005_EMPLOYEE_EMAIL: employeeA.email,
      QR005_EMPLOYEE_PASSWORD: employeeA.password,
      QR005_UNLINKED_EMPLOYEE_EMAIL: unlinkedEmployee.email,
      QR005_UNLINKED_EMPLOYEE_PASSWORD: unlinkedEmployee.password,
      QR005_NO_MEMBERSHIP_EMAIL: unassigned.email,
      QR005_NO_MEMBERSHIP_PASSWORD: unassigned.password,
      QR005_INACTIVE_MEMBERSHIP_EMAIL: inactiveMembership.email,
      QR005_INACTIVE_MEMBERSHIP_PASSWORD: inactiveMembership.password,
      QR005_INACTIVE_EMPLOYEE_EMAIL: inactiveEmployee.email,
      QR005_INACTIVE_EMPLOYEE_PASSWORD: inactiveEmployee.password,
      QR005_MULTI_ADMIN_EMAIL: multiAdmin.email,
      QR005_MULTI_ADMIN_PASSWORD: multiAdmin.password,
      QR005_MULTI_SUPERVISOR_EMAIL: multiSupervisor.email,
      QR005_MULTI_SUPERVISOR_PASSWORD: multiSupervisor.password,
      QR005_NO_BRANCH_SUPERVISOR_EMAIL: noBranchSupervisor.email,
      QR005_NO_BRANCH_SUPERVISOR_PASSWORD: noBranchSupervisor.password,
      QR005_NETWORK_SUPERVISOR_EMAIL: networkSupervisor.email,
      QR005_NETWORK_SUPERVISOR_PASSWORD: networkSupervisor.password,
      QR005_REVOKED_SUPERVISOR_EMAIL: revokedSupervisor.email,
      QR005_REVOKED_SUPERVISOR_PASSWORD: revokedSupervisor.password,
      QR005_REVOKED_SUPERVISOR_MEMBERSHIP_ID: revokedSupervisor.memberships[0].id,
      QR005_COMPANY_A_ID: companyA,
      QR005_COMPANY_B_ID: companyB,
      QR005_BRANCH_A_ID: branchA,
      QR005_BRANCH_B_ID: branchB,
      QR005_COMPANY_A_NAME: companyAName,
      QR005_COMPANY_B_NAME: companyBName,
      QR005_FOREIGN_MEMBERSHIP_ID: adminB.memberships[0].id,
      ...(performanceOnly ? {
        QR009_PERFORMANCE_ONLY: "1",
        QR009_BASE_COMMIT: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
        QR009_DATABASE_URL: dbUrl,
        QR009_RESULTS_FILE: performanceResultsFile,
        QR009_ADMIN_USER_ID: adminA.userId,
        QR009_BRANCH_ID: branchA,
      } : {}),
    };
    await mkdir(childEnv.QR005_RESULTS_DIR, { recursive: true, mode: 0o700 });
    await runPlaywrightLocal(childEnv, [
      adminA.email, adminA.password, supervisorA.email, supervisorA.password, employeeA.email, employeeA.password,
      unlinkedEmployee.email, unlinkedEmployee.password, unassigned.email, unassigned.password,
      inactiveMembership.email, inactiveMembership.password, multiAdmin.email, multiAdmin.password,
      multiSupervisor.email, multiSupervisor.password,
      networkSupervisor.email, networkSupervisor.password,
      noBranchSupervisor.email, noBranchSupervisor.password, revokedSupervisor.email, revokedSupervisor.password,
      serviceKey, anonKey, dbUrl,
    ]);
    if (performanceOnly) {
      const after = await readAttendanceSnapshot();
      assert.deepEqual(after, performanceAttendanceSnapshot, "QR-009 performance-only must not create or modify attendance sessions/events");
      for (const table of ["attendance_sessions", "attendance_events"]) {
        assert.deepEqual(after[table], [], `QR-009 performance-only must leave local ${table} empty after browsing`);
      }
      process.stdout.write("PASS QR-009 performance-only preserved full local attendance snapshots; both tables remain empty\n");
    }
    process.stdout.write(`PASS ${performanceOnly ? "QR-009 performance" : "QR-005 browser"} tests used disposable Auth identities, loopback services, and temporary reports only\n`);
  } else if (authorizationRacesOnly) {
    // Targeted local-only R10-05 coverage: administrative access route guards,
    // real Next Server Actions, and a row-lock-controlled revoke/accept race.
    // This mode deliberately does not seed or touch attendance rows or PIN state.
    let targetedAssertions = 0;
    const verify = Object.fromEntries(["equal", "notEqual", "deepEqual", "ok"].map((method) => [method, (...args) => {
      targetedAssertions += 1;
      return assert[method](...args);
    }]));
    const accessSnapshot = async (membershipIds, companyId) => {
      const memberships = await dbPool.query("select id,role,active from public.company_memberships where id=any($1::uuid[]) order by id", [membershipIds]);
      const audit = await dbPool.query("select action,entity_id from public.audit_log where company_id=$1 and entity_id=any($2::uuid[]) order by action,entity_id", [companyId, membershipIds]);
      return { memberships: memberships.rows, audit: audit.rows };
    };
    const adminApiSnapshot = async (companyId) => {
      const result = await dbPool.query(`select jsonb_build_object(
        'branches',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from (select id,name,timezone,active from public.branches where company_id=$1) t),
        'employees',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from (select id,employee_number,first_name,last_name,branch_id,active from public.employees where company_id=$1) t),
        'templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from (select id,branch_id,name,active from public.schedule_templates where company_id=$1) t),
        'days',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from (select id,template_id,iso_weekday,start_local,end_local,scheduled_minutes from public.schedule_template_days where company_id=$1) t),
        'breaks',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from (select id,template_day_id,break_rule_id,planned_start_local,planned_end_local,planned_minutes from public.schedule_template_breaks where company_id=$1) t),
        'assignments',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from (select id,employee_id,template_id,branch_id,starts_on,ends_on from public.schedule_assignments where company_id=$1) t),
        'supervisors',(select coalesce(jsonb_agg(to_jsonb(t) order by t.membership_id),'[]'::jsonb) from (select membership_id,employee_id from public.supervisors where company_id=$1) t),
        'supervisor_branches',(select coalesce(jsonb_agg(to_jsonb(t) order by t.membership_id,t.branch_id),'[]'::jsonb) from (select membership_id,branch_id from public.supervisor_branches where company_id=$1) t),
        'devices',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from (select id,membership_id,branch_id,active,revoked_at from public.authorized_devices where company_id=$1) t),
        'device_requests',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from (select id,membership_id,branch_id,status,device_id,redeemed_at from private.device_authorization_requests where company_id=$1) t),
        'audit',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'action',action,'entity_table',entity_table,'entity_id',entity_id) order by id),'[]'::jsonb) from public.audit_log where company_id=$1)
      ) state`, [companyId]);
      return result.rows[0].state;
    };
    const targetB = await createHttpUser("r1005-foreign-target", "employee", companyB);
    const targetA = await createHttpUser("r1005-authorized-target", "employee", companyA);
    let response = await request(`/api/admin/access?companyId=${companyA}`);
    verify.equal(response.status, 401, "anonymous admin access read is rejected");
    response = await request(`/api/admin/access?companyId=${companyA}`, { user: supervisorA });
    verify.equal(response.status, 403, "supervisor role cannot read administrative access data");
    response = await request(`/api/admin/access?companyId=${companyB}`, { user: adminA });
    verify.equal(response.status, 403, "company A administrator cannot query company B access data");
    const foreignBefore = await accessSnapshot([targetB.memberships[0].id], companyB);
    response = await request(`/api/admin/access?companyId=${companyA}`, {
      user: adminA, method: "PATCH", body: { action: "deactivate", membershipId: targetB.memberships[0].id },
    });
    verify.equal(response.status, 404, "foreign membership identifier is not found in the selected tenant");
    verify.deepEqual(await accessSnapshot([targetB.memberships[0].id], companyB), foreignBefore, "foreign-ID rejection leaves membership and audit unchanged");
    const permissionDenied = await service.from("membership_permission_overrides").insert({
      company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "company.manage", allowed: false,
    });
    verify.equal(permissionDenied.error, null, "local fixture explicitly revokes company.manage");
    const deniedBefore = await accessSnapshot([targetA.memberships[0].id], companyA);
    response = await request(`/api/admin/access?companyId=${companyA}`, {
      user: adminA, method: "PATCH", body: { action: "deactivate", membershipId: targetA.memberships[0].id },
    });
    verify.equal(response.status, 403, "revoked company.manage rejects membership mutation");
    verify.deepEqual(await accessSnapshot([targetA.memberships[0].id], companyA), deniedBefore, "permission rejection has no membership or audit side effects");
    verify.equal((await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "company.manage")).error, null);
    response = await request(`/api/admin/access?companyId=${companyA}`, {
      user: ownerA, method: "PATCH", body: { action: "deactivate", membershipId: targetA.memberships[0].id },
    });
    verify.equal(response.status, 200, "authorized owner can deactivate a same-tenant synthetic member");
    const authorizedAfter = await accessSnapshot([targetA.memberships[0].id], companyA);
    verify.equal(authorizedAfter.memberships[0]?.active, false, "authorized change persisted to PostgreSQL");
    verify.equal(authorizedAfter.audit.filter((row) => row.action === "USER_ACCESS_DEACTIVATED").length, 1, "authorized change writes one audit record");
    process.stdout.write("PASS R10-05 admin access HTTP: anonymous/role/tenant/foreign-ID/permission denials, no-side-effect snapshots, authorized write and audit\n");

    // HTTP/Auth matrix for branch, employee, and schedule APIs. These fixtures
    // intentionally omit attendance sessions/events and never call scan/PIN.
    let apiBeforeA = await adminApiSnapshot(companyA);
    let apiBeforeB = await adminApiSnapshot(companyB);
    response = await request(`/api/branches?companyId=${companyA}`);
    verify.equal(response.status, 401, "anonymous branch listing is rejected");
    response = await request(`/api/branches?companyId=${companyA}`, { user: supervisorA });
    verify.equal(response.status, 403, "supervisor cannot access administration branch list");
    response = await request(`/api/branches?companyId=${companyA}`, { user: adminA });
    verify.equal(response.status, 200, "active administrator can list own branches");
    const branchList = await response.json();
    verify.equal(branchList.items.some((branch) => branch.id === branchB), false, "branch listing excludes another tenant");
    const inactiveBranchInsert = await service.from("branches").insert({ company_id: companyA, name: `R1005 inactive branch ${randomUUID()}`, timezone: "America/Mexico_City", active: false }).select("id").single();
    if (inactiveBranchInsert.error || !inactiveBranchInsert.data?.id) throw new Error("failed preparing an inactive synthetic branch");
    const inactiveBranchId = inactiveBranchInsert.data.id;
    apiBeforeA = await adminApiSnapshot(companyA);
    apiBeforeB = await adminApiSnapshot(companyB);
    response = await request(`/api/branches?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { id: branchB, active: false } });
    verify.equal(response.status, 404, "administrator cannot update a foreign branch by identifier");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "foreign branch update leaves tenant A and audit unchanged");
    verify.deepEqual(await adminApiSnapshot(companyB), apiBeforeB, "foreign branch update leaves tenant B and audit unchanged");
    response = await request(`/api/branches?companyId=${companyA}`, { user: adminA, method: "POST", body: { name: `R1005 invalid timezone ${randomUUID()}`, timezone: "Not/A_Real_Zone" } });
    verify.equal(response.status, 422, "invalid IANA timezone is rejected");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "invalid branch input has no database or audit side effects");
    const branchPermission = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "company.manage", allowed: false });
    if (branchPermission.error) throw new Error("failed preparing synthetic company.manage denial for branch APIs");
    response = await request(`/api/branches?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { id: branchA, active: false } });
    verify.equal(response.status, 403, "revoked company.manage blocks branch update");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "branch permission rejection has no data or audit side effects");
    await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "company.manage");
    response = await request(`/api/branches?companyId=${companyA}`, { user: adminA, method: "POST", body: { name: `R1005 branch ${randomUUID()}`, timezone: "America/Mexico_City" } });
    verify.equal(response.status, 201, "authorized administrator can create a branch");
    const createdBranch = (await response.json()).item;
    verify.equal((await dbPool.query("select company_id from public.branches where id=$1", [createdBranch.id])).rows[0]?.company_id, companyA, "created branch persists only in authorized tenant");
    response = await request(`/api/branches?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { id: createdBranch.id, active: false } });
    verify.equal(response.status, 200, "authorized administrator can deactivate a same-tenant branch");
    response = await request(`/api/branches?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { id: createdBranch.id, active: true } });
    verify.equal(response.status, 200, "authorized administrator can reactivate a same-tenant branch");

    response = await request(`/api/employees?companyId=${companyA}`);
    verify.equal(response.status, 401, "anonymous employee listing is rejected");
    response = await request(`/api/employees?companyId=${companyA}`, { user: supervisorA });
    verify.equal(response.status, 403, "supervisor cannot read the administrative employee list");
    response = await request(`/api/employees?companyId=${companyA}`, { user: adminA });
    verify.equal(response.status, 200, "active administrator can list employees in own tenant");
    const employeeList = await response.json();
    verify.equal(employeeList.items.some((employee) => employee.id === employeeB.employeeId), false, "employee listing excludes another tenant");
    response = await request(`/api/employees?companyId=${companyA}&branchId=${branchB}`, { user: adminA });
    verify.equal(response.status, 403, "employee filter rejects a branch from another company");
    response = await request(`/api/employees/${employeeB.employeeId}?companyId=${companyA}`, { user: adminA });
    verify.equal(response.status, 404, "foreign employee ID is not disclosed");
    apiBeforeA = await adminApiSnapshot(companyA);
    apiBeforeB = await adminApiSnapshot(companyB);
    response = await request(`/api/employees?companyId=${companyA}`, { user: adminA, method: "POST", body: { employee_number: `R1005-X-${randomUUID()}`, first_name: "Synthetic", last_name: "Foreign Branch", branch_id: branchB } });
    verify.equal(response.status, 422, "employee creation rejects a foreign branch");
    response = await request(`/api/employees?companyId=${companyA}`, { user: adminA, method: "POST", body: { employee_number: `R1005-I-${randomUUID()}`, first_name: "Synthetic", last_name: "Inactive Branch", branch_id: inactiveBranchId } });
    verify.equal(response.status, 422, "employee creation rejects an inactive branch");
    response = await request(`/api/employees/${employeeA.employeeId}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { branch_id: branchB } });
    verify.equal(response.status, 422, "employee update rejects cross-company reassignment");
    response = await request(`/api/employees/${employeeB.employeeId}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { first_name: "Rejected foreign edit" } });
    verify.equal(response.status, 404, "foreign employee update is not found in selected tenant");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "rejected employee writes leave tenant A and audit unchanged");
    verify.deepEqual(await adminApiSnapshot(companyB), apiBeforeB, "rejected employee writes leave tenant B and audit unchanged");
    response = await request(`/api/employees?companyId=${companyA}`, { user: adminA, method: "POST", body: { employee_number: `R1005-OK-${randomUUID()}`, first_name: "Synthetic", last_name: "Allowed Employee", branch_id: branchA } });
    verify.equal(response.status, 201, "authorized administrator can create a synthetic employee");
    const createdEmployee = (await response.json()).item;
    response = await request(`/api/employees/${createdEmployee.id}?companyId=${companyA}`, { user: adminA });
    verify.equal(response.status, 200, "authorized administrator can read a same-tenant employee record");
    response = await request(`/api/employees/${createdEmployee.id}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { first_name: "Synthetic Edited" } });
    verify.equal(response.status, 200, "authorized administrator can edit a same-tenant employee");
    verify.equal((await response.json()).item.first_name, "Synthetic Edited", "authorized employee update persists");

    const scheduleDate = new Date().toISOString().slice(0, 10);
    const schedulePayload = (branchId, name) => ({ branchId, name, kind: "fixed", workdayType: "day", entryToleranceMinutes: 5, effectiveFrom: scheduleDate, effectiveTo: null, revisionOf: null, days: [{ weekday: 1, start: "09:00", end: "17:00", breaks: [] }] });
    response = await request(`/api/schedules?companyId=${companyA}`);
    verify.equal(response.status, 401, "anonymous schedule listing is rejected");
    response = await request(`/api/schedules?companyId=${companyA}`, { user: supervisorA });
    verify.equal(response.status, 403, "supervisor role cannot access administrative schedules");
    response = await request(`/api/schedules?companyId=${companyA}`, { user: adminA });
    verify.equal(response.status, 200, "administrator can read own schedules");
    verify.equal((await response.json()).items.some((template) => template.branch_id === branchB), false, "schedule listing excludes a foreign tenant");
    apiBeforeA = await adminApiSnapshot(companyA);
    apiBeforeB = await adminApiSnapshot(companyB);
    response = await request(`/api/schedules?companyId=${companyA}`, { user: adminA, method: "POST", body: schedulePayload(branchB, `R1005 foreign ${randomUUID()}`) });
    verify.equal(response.status, 422, "schedule creation rejects a foreign branch");
    response = await request(`/api/schedules?companyId=${companyA}`, { user: adminA, method: "POST", body: schedulePayload(inactiveBranchId, `R1005 inactive ${randomUUID()}`) });
    verify.equal(response.status, 422, "schedule creation rejects an inactive branch");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "invalid schedule creates no template, assignment, or audit side effect");
    verify.deepEqual(await adminApiSnapshot(companyB), apiBeforeB, "cross-company schedule denial leaves tenant B unchanged");
    const schedulePermission = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "schedules.manage", allowed: false });
    if (schedulePermission.error) throw new Error("failed preparing synthetic schedules.manage denial");
    response = await request(`/api/schedules?companyId=${companyA}`, { user: adminA, method: "POST", body: schedulePayload(branchA, `R1005 denied ${randomUUID()}`) });
    verify.equal(response.status, 403, "explicit schedules.manage revocation rejects schedule creation");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "permission-denied schedule write leaves templates, assignments, and audit unchanged");
    await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "schedules.manage");
    response = await request(`/api/schedules?companyId=${companyA}`, { user: adminA, method: "POST", body: schedulePayload(branchA, `R1005 delete candidate ${randomUUID()}`) });
    verify.equal(response.status, 201, "authorized administrator can prepare an unassigned same-tenant schedule for deletion");
    const deleteCandidate = (await response.json()).item;
    apiBeforeA = await adminApiSnapshot(companyA);
    apiBeforeB = await adminApiSnapshot(companyB);
    response = await request(`/api/schedules/${deleteCandidate.id}?companyId=${companyA}`, { method: "DELETE" });
    verify.equal(response.status, 401, "anonymous schedule deletion is rejected");
    response = await request(`/api/schedules/${deleteCandidate.id}?companyId=${companyA}`, { user: adminB, method: "DELETE" });
    verify.equal(response.status, 403, "foreign-tenant administrator cannot delete a schedule through tenant A scope");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "anonymous and foreign-tenant schedule deletion leave tenant A unchanged");
    verify.deepEqual(await adminApiSnapshot(companyB), apiBeforeB, "rejected schedule deletion leaves tenant B unchanged");
    const deletePermission = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "schedules.manage", allowed: false });
    if (deletePermission.error) throw new Error("failed preparing synthetic schedules.manage denial for schedule deletion");
    response = await request(`/api/schedules/${deleteCandidate.id}?companyId=${companyA}`, { user: adminA, method: "DELETE" });
    verify.equal(response.status, 403, "explicit schedules.manage revocation rejects schedule deletion");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "permission-denied schedule deletion leaves schedule and audit unchanged");
    verify.deepEqual(await adminApiSnapshot(companyB), apiBeforeB, "permission-denied schedule deletion leaves tenant B unchanged");
    verify.equal((await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "schedules.manage")).error, null);
    response = await request(`/api/schedules/${deleteCandidate.id}?companyId=${companyA}`, { user: adminA, method: "DELETE" });
    verify.equal(response.status, 200, "authorized administrator can delete an unassigned same-tenant schedule");
    verify.equal((await response.json()).status, "deleted", "successful schedule deletion reports its confirmed outcome");
    const afterScheduleDeleteA = await adminApiSnapshot(companyA);
    verify.equal(afterScheduleDeleteA.templates.some((item) => item.id === deleteCandidate.id), false, "authorized schedule deletion removes only the intended template");
    verify.equal(afterScheduleDeleteA.audit.filter((item) => item.entity_id === deleteCandidate.id).length > apiBeforeA.audit.filter((item) => item.entity_id === deleteCandidate.id).length, true, "authorized schedule deletion records an audit effect");
    verify.deepEqual(await adminApiSnapshot(companyB), apiBeforeB, "authorized schedule deletion leaves tenant B unchanged");
    response = await request(`/api/schedules?companyId=${companyA}`, { user: adminA, method: "POST", body: schedulePayload(branchA, `R1005 allowed ${randomUUID()}`) });
    verify.equal(response.status, 201, "authorized administrator can create a schedule in an active own branch");
    const createdSchedule = (await response.json()).item;
    verify.equal((await dbPool.query("select company_id from public.schedule_templates where id=$1", [createdSchedule.id])).rows[0]?.company_id, companyA, "created schedule persists only in selected tenant");
    response = await request(`/api/schedules/${createdSchedule.id}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { active: false } });
    verify.equal(response.status, 200, "authorized administrator can change schedule status");
    response = await request(`/api/schedules/${createdSchedule.id}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { active: true } });
    verify.equal(response.status, 200, "authorized administrator can restore schedule status");
    response = await request(`/api/schedules/${createdSchedule.id}?companyId=${companyB}`, { user: adminB, method: "PATCH", body: { active: false } });
    verify.equal(response.status, 404, "schedule identifier cannot cross tenant boundary");
    response = await request(`/api/schedules/assignments?companyId=${companyA}`, { user: adminA, method: "POST", body: { branchId: branchA, templateId: createdSchedule.id, employeeIds: [createdEmployee.id], startsOn: scheduleDate, endsOn: null } });
    verify.equal(response.status, 201, "authorized administrator can assign a schedule to a same-tenant employee");
    verify.equal((await response.json()).items.length, 1, "schedule assignment persists one authorized assignment");
    apiBeforeA = await adminApiSnapshot(companyA);
    apiBeforeB = await adminApiSnapshot(companyB);
    response = await request(`/api/schedules/assignments?companyId=${companyA}`, { user: adminA, method: "POST", body: { branchId: branchB, templateId: createdSchedule.id, employeeIds: [employeeB.employeeId], startsOn: scheduleDate, endsOn: null } });
    verify.equal(response.status, 422, "schedule assignment rejects foreign tenant branch and employee IDs");
    response = await request(`/api/schedules/assignments?companyId=${companyA}&employeeId=${employeeB.employeeId}`, { user: adminA });
    verify.equal(response.status, 200, "assignment lookup for foreign employee stays within selected tenant");
    verify.deepEqual((await response.json()).items, [], "assignment lookup does not disclose foreign employee assignments");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "rejected assignment leaves tenant A and audit unchanged");
    verify.deepEqual(await adminApiSnapshot(companyB), apiBeforeB, "rejected assignment leaves tenant B and audit unchanged");

    // Supervisor assignments and device administration are exercised here in
    // isolation from scanner context, attendance, PIN, and scan operations.
    apiBeforeA = await adminApiSnapshot(companyA);
    apiBeforeB = await adminApiSnapshot(companyB);
    response = await request(`/api/supervisors?companyId=${companyA}`);
    verify.equal(response.status, 401, "anonymous supervisor assignment listing is rejected");
    response = await request(`/api/supervisors?companyId=${companyA}`, { user: employeeA });
    verify.equal(response.status, 403, "employee cannot read supervisor assignment administration");
    response = await request(`/api/supervisors?companyId=${companyA}`, { user: adminA });
    verify.equal(response.status, 200, "same-company administrator can list supervisor assignments");
    verify.equal(response.headers.get("cache-control"), "no-store");
    const supervisorList = await response.json();
    verify.equal(supervisorList.data.supervisors.some((item) => item.membershipId === supervisorB.memberships[0].id), false, "supervisor list does not disclose another tenant membership");
    response = await request(`/api/supervisors?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { membershipId: supervisorA.memberships[0].id, branchId: branchB, assigned: true } });
    verify.equal(response.status, 409, "supervisor cannot be assigned to a branch from another tenant");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "foreign-branch supervisor assignment rejection has no data or audit side effects");
    verify.deepEqual(await adminApiSnapshot(companyB), apiBeforeB, "foreign-branch assignment rejection leaves target tenant unchanged");
    const noDeviceManage = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "devices.manage", allowed: false });
    if (noDeviceManage.error) throw new Error("failed preparing synthetic devices.manage denial");
    response = await request(`/api/supervisors?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { membershipId: supervisorA.memberships[0].id, branchId: branchA, assigned: false } });
    verify.equal(response.status, 403, "revoked devices.manage prevents supervisor branch mutation");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "permission-denied supervisor assignment has no side effects");
    verify.equal((await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "devices.manage")).error, null);
    response = await request(`/api/supervisors?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { membershipId: supervisorA.memberships[0].id, branchId: branchA, assigned: false } });
    verify.equal(response.status, 200, "authorized administrator can unassign a supervisor branch");
    verify.equal((await adminApiSnapshot(companyA)).supervisor_branches.some((row) => row.membership_id === supervisorA.memberships[0].id && row.branch_id === branchA), false, "supervisor branch unassignment persists");
    response = await request(`/api/supervisors?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { membershipId: supervisorA.memberships[0].id, branchId: branchA, assigned: true } });
    verify.equal(response.status, 200, "authorized administrator can restore a supervisor branch assignment");

    const deviceChallenge = randomBytes(32).toString("base64url");
    const deviceRequestResult = await supervisorA.client.rpc("request_supervisor_device", { p_company_id: companyA, p_branch_id: branchA, p_label: "Synthetic QR-004 targeted device", p_challenge: deviceChallenge });
    verify.ok(!deviceRequestResult.error && deviceRequestResult.data?.requestId, "active synthetic supervisor can request a device through its RPC");
    const deviceRequestId = deviceRequestResult.data.requestId;
    apiBeforeA = await adminApiSnapshot(companyA);
    apiBeforeB = await adminApiSnapshot(companyB);
    response = await request(`/api/supervisor-devices?companyId=${companyA}`);
    verify.equal(response.status, 401, "anonymous device administration read is rejected");
    response = await request(`/api/supervisor-devices?companyId=${companyA}`, { user: supervisorA });
    verify.equal(response.status, 403, "supervisor cannot administer device requests");
    response = await request(`/api/supervisor-devices?companyId=${companyA}`, { user: adminA });
    verify.equal(response.status, 200, "authorized administrator can read device requests and devices");
    const deviceList = await response.json();
    verify.equal(deviceList.requests.some((item) => item.id === deviceRequestId && item.status === "pending"), true, "device request is scoped to its company");
    verify.equal(JSON.stringify(deviceList).includes(deviceChallenge), false, "device administration response does not expose the raw challenge");
    const deniedDeviceManage = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "devices.manage", allowed: false });
    if (deniedDeviceManage.error) throw new Error("failed preparing synthetic devices.manage denial for device review");
    response = await request(`/api/supervisor-devices?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { requestId: deviceRequestId, approve: true } });
    verify.equal(response.status, 403, "revoked devices.manage blocks approval");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "revoked device permission leaves request, devices and audit unchanged");
    verify.equal((await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "devices.manage")).error, null);
    response = await request(`/api/supervisor-devices?companyId=${companyA}`, { user: adminB, method: "PATCH", body: { requestId: deviceRequestId, approve: true } });
    verify.equal(response.status, 403, "administrator in another tenant cannot select company A to approve its request");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "foreign request review leaves source tenant unchanged");
    verify.deepEqual(await adminApiSnapshot(companyB), apiBeforeB, "foreign request review leaves actor tenant unchanged");
    response = await request(`/api/supervisor-devices?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { requestId: "not-a-uuid", approve: true } });
    verify.equal(response.status, 422, "malformed device review input is rejected");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "malformed device review has no side effects");
    response = await request(`/api/supervisor-devices?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { requestId: deviceRequestId, approve: true } });
    verify.equal(response.status, 200, "authorized administrator can approve a same-company device request");
    const approvedDeviceId = (await response.json()).request.deviceId;
    verify.ok(approvedDeviceId, "approved request creates an authorized device");
    verify.equal((await adminApiSnapshot(companyA)).device_requests.find((item) => item.id === deviceRequestId)?.status, "approved", "approval transition persists");
    const approvedSnapshot = await adminApiSnapshot(companyA);
    response = await request(`/api/supervisor-devices/${approvedDeviceId}?companyId=${companyA}`, { user: supervisorA, method: "DELETE" });
    verify.equal(response.status, 403, "supervisor role cannot revoke an authorized device");
    verify.deepEqual(await adminApiSnapshot(companyA), approvedSnapshot, "role-denied revocation has no effects");
    const revokePermission = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "devices.manage", allowed: false });
    if (revokePermission.error) throw new Error("failed preparing synthetic devices.manage denial for device revoke");
    response = await request(`/api/supervisor-devices/${approvedDeviceId}?companyId=${companyA}`, { user: adminA, method: "DELETE" });
    verify.equal(response.status, 403, "revoked devices.manage blocks device revocation");
    verify.deepEqual(await adminApiSnapshot(companyA), approvedSnapshot, "permission-denied device revocation has no effects");
    verify.equal((await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "devices.manage")).error, null);
    response = await request(`/api/supervisor-devices/${approvedDeviceId}?companyId=${companyB}`, { user: adminB, method: "DELETE" });
    verify.equal(response.status, 409, "another tenant cannot revoke device by foreign ID");
    verify.deepEqual(await adminApiSnapshot(companyA), approvedSnapshot, "foreign device revoke leaves source tenant unchanged");
    response = await request(`/api/supervisor-devices/${approvedDeviceId}?companyId=${companyA}`, { user: adminA, method: "DELETE" });
    verify.equal(response.status, 200, "authorized administrator can revoke a same-company device");
    verify.equal((await adminApiSnapshot(companyA)).devices.find((device) => device.id === approvedDeviceId)?.active, false, "device revocation is persisted");
    const revokedSnapshot = await adminApiSnapshot(companyA);
    response = await request(`/api/supervisor-devices/${approvedDeviceId}?companyId=${companyA}`, { user: adminA, method: "DELETE" });
    verify.equal(response.status, 409, "repeated device revocation is rejected");
    verify.deepEqual(await adminApiSnapshot(companyA), revokedSnapshot, "repeated device revocation does not duplicate audit or state changes");
    process.stdout.write("PASS R10-05 supervisor/device HTTP/Auth: branch assignment, request approval, tenant/role/permission denials, revocation and no-side-effect snapshots\n");

    const seedAssignedSupervisor = async (label) => {
      const user = await createHttpUser(label, "supervisor", companyA);
      const supervisor = await service.from("supervisors").insert({ company_id: companyA, membership_id: user.memberships[0].id });
      const branch = await service.from("supervisor_branches").insert({ company_id: companyA, membership_id: user.memberships[0].id, branch_id: branchA });
      if (supervisor.error || branch.error) throw new Error("failed preparing a synthetic assigned supervisor");
      return user;
    };
    const membershipRequestRaceSupervisor = await seedAssignedSupervisor("r1005-membership-device-request-race-supervisor");
    const membershipRequestRaceTx = await dbPool.connect();
    let membershipRequestRaceCommitted = false;
    let membershipRequestRacePromise;
    try {
      await membershipRequestRaceTx.query("begin");
      await membershipRequestRaceTx.query("set local role authenticated");
      await membershipRequestRaceTx.query("select set_config('request.jwt.claim.role','authenticated',true)");
      await membershipRequestRaceTx.query("select set_config('request.jwt.claim.sub',$1,true)", [adminA.userId]);
      await membershipRequestRaceTx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: "authenticated", sub: adminA.userId })]);
      const deactivation = await membershipRequestRaceTx.query("select public.deactivate_company_membership($1,$2) changed", [companyA, membershipRequestRaceSupervisor.memberships[0].id]);
      verify.equal(deactivation.rows[0]?.changed, true, "synthetic administrator begins membership revocation before request race");
      membershipRequestRacePromise = request("/api/supervisor/device-requests", {
        user: membershipRequestRaceSupervisor, method: "POST", body: { companyId: companyA, branchId: branchA, label: "Synthetic request during revocation" },
      });
      const requestWaitsOnRevocation = async () => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const waiting = await dbPool.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%request_supervisor_device%' limit 1");
          if (waiting.rowCount) return true;
          await new Promise((resolveWait) => setTimeout(resolveWait, 40));
        }
        return false;
      };
      const lockWait = await Promise.race([requestWaitsOnRevocation(), membershipRequestRacePromise.then(() => false)]);
      verify.equal(lockWait, true, "device request waits on its authorization rows during in-flight membership revocation");
      await membershipRequestRaceTx.query("commit");
      membershipRequestRaceCommitted = true;
      const deniedRequest = await membershipRequestRacePromise;
      verify.equal(deniedRequest.status, 403, "device enrollment is denied after membership revocation commits");
    } finally {
      if (!membershipRequestRaceCommitted) await membershipRequestRaceTx.query("rollback").catch(() => {});
      await Promise.allSettled([membershipRequestRacePromise].filter(Boolean));
      membershipRequestRaceTx.release();
    }
    const membershipRequestRaceState = await dbPool.query(`select m.active,
      (select count(*)::int from private.device_authorization_requests r where r.company_id=m.company_id and r.membership_id=m.id) requests,
      (select count(*)::int from public.audit_log a where a.company_id=m.company_id and a.entity_id=m.id and a.action='DEVICE_AUTHORIZATION_REQUESTED') request_audits,
      (select count(*)::int from public.audit_log a where a.company_id=m.company_id and a.entity_id=m.id and a.action='USER_ACCESS_DEACTIVATED') revocation_audits
      from public.company_memberships m where m.id=$1`, [membershipRequestRaceSupervisor.memberships[0].id]);
    verify.deepEqual(membershipRequestRaceState.rows[0], { active: false, requests: 0, request_audits: 0, revocation_audits: 1 }, "revocation race leaves no pending request/device-request audit after access is removed");
    verify.deepEqual((await adminApiSnapshot(companyB)).device_requests, [], "membership/device request race has no cross-tenant effects");
    process.stdout.write("PASS supervisor device enrollment serializes with membership revocation and leaves no post-revocation request or audit\n");

    const roleChangeRaceSupervisor = await seedAssignedSupervisor("r1005-role-device-request-race-supervisor");
    const roleChangeRaceTx = await dbPool.connect();
    let roleChangeRaceCommitted = false;
    let roleChangeRacePromise;
    try {
      await roleChangeRaceTx.query("begin");
      await roleChangeRaceTx.query("set local role authenticated");
      await roleChangeRaceTx.query("select set_config('request.jwt.claim.role','authenticated',true)");
      await roleChangeRaceTx.query("select set_config('request.jwt.claim.sub',$1,true)", [ownerA.userId]);
      await roleChangeRaceTx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: "authenticated", sub: ownerA.userId })]);
      const changedRole = await roleChangeRaceTx.query("select public.change_company_membership_role($1,$2,'employee'::public.company_role) changed", [companyA, roleChangeRaceSupervisor.memberships[0].id]);
      verify.equal(changedRole.rows[0]?.changed, true, "synthetic owner begins supervisor role revocation before request race");
      roleChangeRacePromise = request("/api/supervisor/device-requests", {
        user: roleChangeRaceSupervisor, method: "POST", body: { companyId: companyA, branchId: branchA, label: "Synthetic request during role change" },
      });
      const requestWaitsOnRoleChange = async () => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const waiting = await dbPool.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%request_supervisor_device%' limit 1");
          if (waiting.rowCount) return true;
          await new Promise((resolveWait) => setTimeout(resolveWait, 40));
        }
        return false;
      };
      const roleLockWait = await Promise.race([requestWaitsOnRoleChange(), roleChangeRacePromise.then(() => false)]);
      verify.equal(roleLockWait, true, "device request waits for in-flight supervisor role change");
      await roleChangeRaceTx.query("commit");
      roleChangeRaceCommitted = true;
      const deniedRequest = await roleChangeRacePromise;
      verify.equal(deniedRequest.status, 403, "device enrollment is denied after supervisor role change commits");
    } finally {
      if (!roleChangeRaceCommitted) await roleChangeRaceTx.query("rollback").catch(() => {});
      await Promise.allSettled([roleChangeRacePromise].filter(Boolean));
      roleChangeRaceTx.release();
    }
    const roleChangeRaceState = await dbPool.query(`select m.role::text role,
      (select count(*)::int from private.device_authorization_requests r where r.company_id=m.company_id and r.membership_id=m.id) requests,
      (select count(*)::int from public.audit_log a where a.company_id=m.company_id and a.entity_id=m.id and a.action='DEVICE_AUTHORIZATION_REQUESTED') request_audits,
      (select count(*)::int from public.audit_log a where a.company_id=m.company_id and a.entity_id=m.id and a.action='USER_ROLE_CHANGED') role_audits
      from public.company_memberships m where m.id=$1`, [roleChangeRaceSupervisor.memberships[0].id]);
    verify.deepEqual(roleChangeRaceState.rows[0], { role: "employee", requests: 0, request_audits: 0, role_audits: 1 }, "role-change race leaves no request or request audit after supervisor privileges are removed");
    verify.deepEqual((await adminApiSnapshot(companyB)).device_requests, [], "role-change/device request race has no cross-tenant effects");
    process.stdout.write("PASS supervisor device enrollment serializes with supervisor role change and leaves no unauthorized request\n");

    const branchRequestRaceSupervisor = await seedAssignedSupervisor("r1005-branch-device-request-race-supervisor");
    const branchRequestRaceTx = await dbPool.connect();
    let branchRequestRaceCommitted = false;
    let branchRequestRacePromise;
    try {
      await branchRequestRaceTx.query("begin");
      await branchRequestRaceTx.query("set local role authenticated");
      await branchRequestRaceTx.query("select set_config('request.jwt.claim.role','authenticated',true)");
      await branchRequestRaceTx.query("select set_config('request.jwt.claim.sub',$1,true)", [ownerA.userId]);
      await branchRequestRaceTx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: "authenticated", sub: ownerA.userId })]);
      const unassigned = await branchRequestRaceTx.query("select public.set_supervisor_branch($1,$2,$3,false) result", [companyA, branchRequestRaceSupervisor.memberships[0].id, branchA]);
      verify.equal(unassigned.rows[0]?.result?.assigned, false, "synthetic owner begins supervisor branch revocation before request race");
      branchRequestRacePromise = request("/api/supervisor/device-requests", {
        user: branchRequestRaceSupervisor, method: "POST", body: { companyId: companyA, branchId: branchA, label: "Synthetic request during branch removal" },
      });
      const requestWaitsOnBranchRemoval = async () => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const waiting = await dbPool.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%request_supervisor_device%' limit 1");
          if (waiting.rowCount) return true;
          await new Promise((resolveWait) => setTimeout(resolveWait, 40));
        }
        return false;
      };
      const branchLockWait = await Promise.race([requestWaitsOnBranchRemoval(), branchRequestRacePromise.then(() => false)]);
      verify.equal(branchLockWait, true, "device request waits for in-flight supervisor branch removal");
      await branchRequestRaceTx.query("commit");
      branchRequestRaceCommitted = true;
      const deniedRequest = await branchRequestRacePromise;
      verify.equal(deniedRequest.status, 403, "device enrollment is denied after branch removal commits");
    } finally {
      if (!branchRequestRaceCommitted) await branchRequestRaceTx.query("rollback").catch(() => {});
      await Promise.allSettled([branchRequestRacePromise].filter(Boolean));
      branchRequestRaceTx.release();
    }
    const branchRequestRaceState = await dbPool.query(`select
      (select count(*)::int from public.supervisor_branches sb where sb.company_id=m.company_id and sb.membership_id=m.id and sb.branch_id=$2) assigned,
      (select count(*)::int from private.device_authorization_requests r where r.company_id=m.company_id and r.membership_id=m.id) requests,
      (select count(*)::int from public.audit_log a where a.company_id=m.company_id and a.entity_id=m.id and a.action='DEVICE_AUTHORIZATION_REQUESTED') request_audits,
      (select count(*)::int from public.audit_log a where a.company_id=m.company_id and a.entity_id=m.id and a.action='SUPERVISOR_BRANCH_UNASSIGNED') unassign_audits
      from public.company_memberships m where m.id=$1`, [branchRequestRaceSupervisor.memberships[0].id, branchA]);
    verify.deepEqual(branchRequestRaceState.rows[0], { assigned: 0, requests: 0, request_audits: 0, unassign_audits: 1 }, "branch-removal race leaves no request/audit after assignment is removed");
    verify.deepEqual((await adminApiSnapshot(companyB)).device_requests, [], "branch-removal/device request race has no cross-tenant effects");
    process.stdout.write("PASS supervisor device enrollment serializes with branch unassignment and leaves no unauthorized request\n");

    const pendingSupervisor = await seedAssignedSupervisor("r1005-pending-device-supervisor");
    const pendingChallenge = randomBytes(32).toString("base64url");
    const pendingRequest = await pendingSupervisor.client.rpc("request_supervisor_device", {
      p_company_id: companyA, p_branch_id: branchA, p_label: "Synthetic pending before branch removal", p_challenge: pendingChallenge,
    });
    verify.ok(!pendingRequest.error && pendingRequest.data?.requestId, "synthetic supervisor creates a pending device request before branch removal");
    response = await request("/api/supervisors?companyId=" + companyA, {
      user: adminA, method: "PATCH", body: { membershipId: pendingSupervisor.memberships[0].id, branchId: branchA, assigned: false },
    });
    verify.equal(response.status, 200, "authorized administrator can remove the synthetic supervisor branch");
    const pendingAfterUnassignment = await dbPool.query(`select r.status,r.reviewed_at is not null reviewed,
      r.reviewed_by is not null reviewer_recorded,
      (select count(*)::int from public.authorized_devices d where d.company_id=r.company_id and d.membership_id=r.membership_id) devices,
      (select count(*)::int from public.audit_log a where a.company_id=r.company_id and a.entity_id=r.id and a.action='DEVICE_AUTHORIZATION_APPROVED') approvals
      from private.device_authorization_requests r where r.id=$1`, [pendingRequest.data.requestId]);
    verify.deepEqual(pendingAfterUnassignment.rows[0], { status: "rejected", reviewed: true, reviewer_recorded: true, devices: 0, approvals: 0 }, "branch removal rejects an unresolved request without creating an authorized device");
    const afterPendingUnassignment = await adminApiSnapshot(companyA);
    response = await request("/api/supervisor-devices?companyId=" + companyA, {
      user: adminA, method: "PATCH", body: { requestId: pendingRequest.data.requestId, approve: true },
    });
    verify.equal(response.status, 409, "a request cannot be approved after its supervisor loses the branch assignment");
    verify.deepEqual(await adminApiSnapshot(companyA), afterPendingUnassignment, "post-unassignment approval rejection has no device, request, or audit side effects");

    const raceSupervisor = await seedAssignedSupervisor("r1005-device-revocation-race-supervisor");
    const branchRaceChallenge = randomBytes(32).toString("base64url");
    const branchRaceRequest = await raceSupervisor.client.rpc("request_supervisor_device", {
      p_company_id: companyA, p_branch_id: branchA, p_label: "Synthetic controlled branch revocation race", p_challenge: branchRaceChallenge,
    });
    verify.ok(!branchRaceRequest.error && branchRaceRequest.data?.requestId, "race fixture has a pending synthetic device request");
    const deviceRaceBlocker = await dbPool.connect();
    let deviceRaceBlockerCommitted = false;
    let deviceUnassignmentPromise;
    let deviceApprovalPromise;
    const waitForDeviceRaceRpc = async (fragment) => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const waiting = await dbPool.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike $1 limit 1", [`%${fragment}%`]);
        if (waiting.rowCount) return;
        await new Promise((resolveWait) => setTimeout(resolveWait, 40));
      }
      throw new Error(`timed out waiting for local ${fragment} authorization transaction`);
    };
    try {
      await deviceRaceBlocker.query("begin");
      await deviceRaceBlocker.query("select id from private.device_authorization_requests where id=$1 for update", [branchRaceRequest.data.requestId]);
      deviceUnassignmentPromise = request("/api/supervisors?companyId=" + companyA, {
        user: adminA, method: "PATCH", body: { membershipId: raceSupervisor.memberships[0].id, branchId: branchA, assigned: false },
      });
      await waitForDeviceRaceRpc("set_supervisor_branch");
      deviceApprovalPromise = request("/api/supervisor-devices?companyId=" + companyA, {
        user: adminA, method: "PATCH", body: { requestId: branchRaceRequest.data.requestId, approve: true },
      });
      await waitForDeviceRaceRpc("review_supervisor_device_request");
      await deviceRaceBlocker.query("commit");
      deviceRaceBlockerCommitted = true;
      const [unassignmentResponse, approvalResponse] = await Promise.all([deviceUnassignmentPromise, deviceApprovalPromise]);
      verify.equal(unassignmentResponse.status, 200, "queued branch unassignment completes successfully");
      verify.equal(approvalResponse.status, 409, "queued device approval observes the committed branch revocation and fails closed");
    } finally {
      if (!deviceRaceBlockerCommitted) await deviceRaceBlocker.query("rollback").catch(() => {});
      await Promise.allSettled([deviceUnassignmentPromise, deviceApprovalPromise].filter(Boolean));
      deviceRaceBlocker.release();
    }
    const branchRaceState = await dbPool.query(`select r.status,
      (select count(*)::int from public.authorized_devices d where d.company_id=r.company_id and d.membership_id=r.membership_id) devices,
      (select count(*)::int from public.authorized_devices d where d.company_id=r.company_id and d.membership_id=r.membership_id and d.active) active_devices,
      (select count(*)::int from public.audit_log a where a.company_id=r.company_id and a.entity_id=r.id and a.action='DEVICE_AUTHORIZATION_APPROVED') approvals,
      (select count(*)::int from public.audit_log a where a.company_id=r.company_id and a.entity_id=r.membership_id and a.action='SUPERVISOR_BRANCH_UNASSIGNED') unassignments
      from private.device_authorization_requests r where r.id=$1`, [branchRaceRequest.data.requestId]);
    verify.deepEqual(branchRaceState.rows[0], { status: "rejected", devices: 0, active_devices: 0, approvals: 0, unassignments: 1 }, "serialized branch revocation wins against approval without device or approval audit side effects");
    verify.deepEqual((await adminApiSnapshot(companyB)).device_requests, [], "the device revocation race does not create state in the other synthetic tenant");

    const inactiveBranch = await service.from("branches").insert({ company_id: companyA, name: `R1005 inactive supervisor branch ${randomUUID()}`, timezone: "America/Mexico_City", active: true }).select("id").single();
    if (inactiveBranch.error || !inactiveBranch.data?.id) throw new Error("failed preparing a second synthetic supervisor branch");
    const inactiveBranchSupervisor = await createHttpUser("r1005-inactive-device-branch-supervisor", "supervisor", companyA);
    const inactiveSupervisorRecord = await service.from("supervisors").insert({ company_id: companyA, membership_id: inactiveBranchSupervisor.memberships[0].id });
    const inactiveAssignment = await service.from("supervisor_branches").insert({ company_id: companyA, membership_id: inactiveBranchSupervisor.memberships[0].id, branch_id: inactiveBranch.data.id });
    if (inactiveSupervisorRecord.error || inactiveAssignment.error) throw new Error("failed assigning synthetic supervisor to the temporary branch");
    const inactiveChallenge = randomBytes(32).toString("base64url");
    const inactiveRequest = await inactiveBranchSupervisor.client.rpc("request_supervisor_device", {
      p_company_id: companyA, p_branch_id: inactiveBranch.data.id, p_label: "Synthetic device for inactive branch guard", p_challenge: inactiveChallenge,
    });
    verify.ok(!inactiveRequest.error && inactiveRequest.data?.requestId, "supervisor can request a device before the assigned branch is deactivated");
    response = await request("/api/supervisor-devices?companyId=" + companyA, {
      user: adminA, method: "PATCH", body: { requestId: inactiveRequest.data.requestId, approve: true },
    });
    verify.equal(response.status, 200, "authorized administrator approves a device while its branch remains active");
    const inactiveRedeem = await inactiveBranchSupervisor.client.rpc("redeem_supervisor_device", { p_company_id: companyA, p_challenge: inactiveChallenge });
    verify.equal(inactiveRedeem.data?.status, "authorized", "synthetic device challenge is redeemed before branch deactivation");
    const activeContext = await inactiveBranchSupervisor.client.rpc("get_supervisor_scanner_context", { p_company_id: companyA, p_device_token: inactiveChallenge });
    verify.equal(activeContext.data?.authorized, true, "active branch and assigned device are authorized before deactivation");
    const beforeInactiveBranchUpdateB = await adminApiSnapshot(companyB);
    response = await request("/api/branches?companyId=" + companyA, { user: adminA, method: "PATCH", body: { id: inactiveBranch.data.id, active: false } });
    verify.equal(response.status, 200, "authorized administrator deactivates the assigned synthetic branch");
    const inactiveContext = await inactiveBranchSupervisor.client.rpc("get_supervisor_scanner_context", { p_company_id: companyA, p_device_token: inactiveChallenge });
    verify.equal(inactiveContext.data?.authorized, false, "scanner context stops authorizing a device when its branch is inactive");
    verify.deepEqual(await adminApiSnapshot(companyB), beforeInactiveBranchUpdateB, "branch deactivation and device context checks do not affect tenant B");
    process.stdout.write("PASS supervisor device lifecycle: pending revocation, ordered approval race, inactive branch denial and cross-tenant snapshots; no scan/PIN/attendance call\n");

    // QR credential issuance/revocation is tested without reading PIN status or
    // invoking either PIN endpoint. Snapshots contain only QR hashes in memory.
    const qrPath = `/api/employees/${employeeA.employeeId}/qr?companyId=${companyA}`;
    const qrSnapshot = async () => {
      const result = await dbPool.query(`select
        (select coalesce(jsonb_agg(jsonb_build_object('employee_id',q.employee_id,'issued_at',q.issued_at,'revoked_at',q.revoked_at) order by q.employee_id),'[]'::jsonb) from private.employee_qr_tokens q where q.employee_id=any($1::uuid[])) qr,
        (select coalesce(jsonb_agg(jsonb_build_object('action',a.action,'entity_id',a.entity_id) order by a.id),'[]'::jsonb) from public.audit_log a where a.company_id=$2 and a.entity_id=any($1::uuid[]) and a.entity_table='employees') audit`, [[employeeA.employeeId, employeeB.employeeId], companyA]);
      return result.rows[0];
    };
    apiBeforeA = await adminApiSnapshot(companyA);
    apiBeforeB = await adminApiSnapshot(companyB);
    let qrBefore = await qrSnapshot();
    response = await request(qrPath, { method: "POST", body: {} });
    verify.equal(response.status, 401, "anonymous QR credential issuance is rejected");
    response = await request(qrPath, { user: employeeA, method: "POST", body: {} });
    verify.equal(response.status, 403, "employee cannot issue an administrative QR credential");
    response = await request(`/api/employees/${employeeB.employeeId}/qr?companyId=${companyA}`, { user: adminA, method: "POST", body: {} });
    verify.equal(response.status, 404, "administrator cannot issue a credential for another tenant employee");
    verify.deepEqual(await qrSnapshot(), qrBefore, "rejected QR credential requests leave credential state and audit unchanged");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "rejected QR requests leave tenant A admin state unchanged");
    verify.deepEqual(await adminApiSnapshot(companyB), apiBeforeB, "foreign QR request leaves tenant B unchanged");
    const noEmployeeManageCredential = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "employees.manage", allowed: false });
    if (noEmployeeManageCredential.error) throw new Error("failed preparing synthetic employees.manage denial for QR credential");
    response = await request(qrPath, { user: adminA, method: "POST", body: {} });
    verify.equal(response.status, 403, "revoked employees.manage blocks QR credential issuance");
    verify.deepEqual(await qrSnapshot(), qrBefore, "permission-denied QR issuance has no token or audit side effects");
    verify.equal((await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "employees.manage")).error, null);
    response = await request(qrPath, { user: adminA, method: "POST", body: {} });
    verify.equal(response.status, 200, "authorized administrator can issue a QR credential");
    verify.equal(response.headers.get("cache-control"), "no-store, private");
    const issuedQr = await response.json();
    verify.equal(typeof issuedQr.token, "string", "raw QR token is returned to the authorized caller once");
    verify.equal(JSON.stringify(issuedQr.credential).includes(issuedQr.token), false, "credential metadata does not repeat raw QR token");
    const issuedQrHash = createHash("sha256").update(issuedQr.token).digest("hex");
    verify.equal((await dbPool.query("select encode(token_hash,'hex') hash from private.employee_qr_tokens where employee_id=$1", [employeeA.employeeId])).rows[0]?.hash === issuedQrHash, true, "only the QR token hash is persisted");
    const activeQrSnapshot = await qrSnapshot();
    response = await request(qrPath, { user: adminA, method: "POST", body: {} });
    verify.equal(response.status, 409, "duplicate QR issuance requires explicit replacement");
    verify.deepEqual(await qrSnapshot(), activeQrSnapshot, "duplicate QR issuance has no state or audit effect");
    response = await request(qrPath, { user: adminA, method: "POST", body: { replace: true } });
    verify.equal(response.status, 200, "authorized explicit QR replacement succeeds");
    const replacementQr = await response.json();
    verify.notEqual(replacementQr.token, issuedQr.token, "replacement rotates the raw QR token");
    const replacedHash = (await dbPool.query("select encode(token_hash,'hex') hash from private.employee_qr_tokens where employee_id=$1", [employeeA.employeeId])).rows[0]?.hash;
    verify.equal(replacedHash === createHash("sha256").update(replacementQr.token).digest("hex"), true, "replacement persists only the new token hash");
    verify.equal(replacedHash !== issuedQrHash, true, "previous raw token hash is invalidated by replacement");
    response = await request(qrPath, { user: adminA, method: "DELETE" });
    verify.equal(response.status, 200, "authorized administrator can revoke a QR credential");
    verify.ok((await dbPool.query("select revoked_at from private.employee_qr_tokens where employee_id=$1", [employeeA.employeeId])).rows[0]?.revoked_at, "QR revocation timestamp is persisted");
    process.stdout.write("PASS QR-004 employee QR credentials HTTP/Auth: tenant/role/permission guards, one-time token hashing, rotation, revocation and snapshots; PIN endpoints untouched\n");

    const inactiveApiAdmin = await createHttpUser("r1005-inactive-admin", "admin", companyA);
    await service.from("company_memberships").update({ active: false }).eq("id", inactiveApiAdmin.memberships[0].id);
    apiBeforeA = await adminApiSnapshot(companyA);
    response = await request(`/api/branches?companyId=${companyA}`, { user: inactiveApiAdmin });
    verify.equal(response.status, 403, "inactive membership cannot read branches");
    response = await request(`/api/employees?companyId=${companyA}`, { user: inactiveApiAdmin });
    verify.equal(response.status, 403, "inactive membership cannot read employees");
    response = await request(`/api/schedules?companyId=${companyA}`, { user: inactiveApiAdmin });
    verify.equal(response.status, 403, "inactive membership cannot read schedules");
    verify.deepEqual(await adminApiSnapshot(companyA), apiBeforeA, "inactive-membership denials have no business-data or audit effects");
    process.stdout.write("PASS R10-05 HTTP/Auth priority routes: branches, employees and schedules enforce tenant, role, active-branch and permission boundaries with snapshots\n");

    actionBrowser = await launchServerActionBrowser(appUrl);
    const actionRaceUser = await createHttpUser("r1005-action-multi-admin", "admin", companyA, { extraMemberships: [[companyB, "admin"]] });
    await actionBrowser.navigate("/login");
    await actionBrowser.runForm("form", { email: actionRaceUser.email, password: actionRaceUser.password });
    await actionBrowser.waitForPath("/seleccionar-empresa");
    await actionBrowser.navigate(`/qr004-action-harness?membershipId=${encodeURIComponent(actionRaceUser.memberships[1].id)}`);
    await actionBrowser.runForm("#choose-membership");
    await actionBrowser.waitForPath("/admin");
    verify.equal((await actionBrowser.getCookies()).find((cookie) => cookie.name === "qr_active_membership_id")?.value, actionRaceUser.memberships[1].id, "real chooseMembership action selects caller-owned active tenant B membership");
    await actionBrowser.navigate(`/qr004-action-harness?adminMembershipId=${encodeURIComponent(actionRaceUser.memberships[0].id)}`);
    await actionBrowser.runForm("#set-admin-membership");
    await actionBrowser.waitForActiveMembership(actionRaceUser.memberships[0].id);
    verify.equal((await actionBrowser.fetchJson(`/api/company?companyId=${companyA}`)).status, 200, "authorized Server Action membership switch grants the expected tenant context");
    response = await request(`/api/admin/access?companyId=${companyA}`, {
      user: ownerA, method: "PATCH", body: { action: "change-role", membershipId: actionRaceUser.memberships[0].id, role: "supervisor" },
    });
    verify.equal(response.status, 200, "owner can change the synthetic account role while its Auth session remains active");
    verify.equal((await actionBrowser.fetchJson(`/api/company?companyId=${companyA}`)).status, 403, "role change invalidates stale administrative authority despite the active-membership cookie");
    await actionBrowser.navigate(`/qr004-action-harness?adminMembershipId=${encodeURIComponent(actionRaceUser.memberships[0].id)}`);
    await actionBrowser.runForm("#set-admin-membership");
    verify.equal((await actionBrowser.getCookies()).find((cookie) => cookie.name === "qr_active_membership_id")?.value, actionRaceUser.memberships[0].id, "setAdminMembership does not replace the stale cookie after its membership loses admin role");
    verify.equal((await actionBrowser.fetchJson(`/api/company?companyId=${companyA}`)).status, 403, "failed admin membership action cannot restore privilege after role revocation");
    await actionBrowser.navigate(`/qr004-action-harness?membershipId=${encodeURIComponent(actionRaceUser.memberships[0].id)}`);
    await actionBrowser.runForm("#choose-membership");
    await actionBrowser.waitForPath("/scanner");
    verify.equal((await actionBrowser.fetchJson(`/api/company?companyId=${companyA}`)).status, 403, "choosing an active supervisor membership does not restore administrative API access");
    process.stdout.write("PASS real Next Server Actions: tenant selection, role-change stale-cookie denial, role-correct destination and server reauthorization\n");

    const raceEmail = `r1005-revocation-race-${randomUUID()}@qr-asistencia.invalid`;
    const raceInvite = await adminA.client.rpc("create_company_user_invitation", { p_company_id: companyA, p_email: raceEmail, p_role: "employee", p_employee_id: null });
    verify.equal(raceInvite.error, null, "synthetic invitation is created through the authenticated administrator RPC");
    const raceRecipient = await createHttpIdentity(raceEmail);
    await actionBrowser.close();
    actionBrowser = await launchServerActionBrowser(appUrl);
    await actionBrowser.navigate("/login");
    await actionBrowser.runForm("form", { email: raceRecipient.email, password: raceRecipient.password });
    await actionBrowser.waitForPath("/invitacion");
    await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(raceInvite.data)}`);
    const blocker = await dbPool.connect();
    const revoker = await dbPool.connect();
    let acceptPromise;
    let revokePromise;
    let blockerCommitted = false;
    let revokerCommitted = false;
    try {
      await blocker.query("begin");
      await blocker.query("select id from public.company_user_invitations where id=$1 for update", [raceInvite.data]);
      await revoker.query("begin");
      await revoker.query("set local role authenticated");
      await revoker.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','authenticated',true), set_config('request.jwt.claims',$2,true)", [adminA.userId, JSON.stringify({ role: "authenticated", sub: adminA.userId })]);
      revokePromise = revoker.query("select public.revoke_company_user_invitation($1,$2) as revoked", [companyA, raceInvite.data]);
      const waitForDatabaseLock = async (fragment) => {
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const waiting = await dbPool.query("select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike $1 limit 1", [`%${fragment}%`]);
          if (waiting.rowCount) return;
          await new Promise((resolveWait) => setTimeout(resolveWait, 40));
        }
        throw new Error(`timed out waiting for the local ${fragment} transaction to queue on the invitation row`);
      };
      await waitForDatabaseLock("revoke_company_user_invitation");
      acceptPromise = actionBrowser.runForm("#accept-invitation");
      await waitForDatabaseLock("accept_company_user_invitation");
      await blocker.query("commit");
      blockerCommitted = true;
      const revoked = await revokePromise;
      verify.equal(revoked.rows[0]?.revoked, true, "authenticated SQL revocation wins the queued row-lock race");
      await revoker.query("commit");
      revokerCommitted = true;
      await acceptPromise;
      await actionBrowser.waitForPath("error=expired");
    } finally {
      if (!blockerCommitted) await blocker.query("rollback").catch(() => {});
      if (!revokerCommitted) await revoker.query("rollback").catch(() => {});
      await Promise.allSettled([revokePromise, acceptPromise].filter(Boolean));
      blocker.release();
      revoker.release();
    }
    const raceState = await dbPool.query(`select i.status,
      (select count(*)::int from public.company_memberships m where m.company_id=i.company_id and m.user_id=$2 and m.active) memberships,
      (select count(*)::int from public.audit_log a where a.company_id=i.company_id and a.entity_id=i.id and a.action='USER_INVITATION_ACCEPTED') accept_audit,
      (select count(*)::int from public.audit_log a where a.company_id=i.company_id and a.entity_id=i.id and a.action='USER_INVITATION_REVOKED') revoke_audit
      from public.company_user_invitations i where i.id=$1`, [raceInvite.data, raceRecipient.userId]);
    verify.deepEqual(raceState.rows[0], { status: "revoked", memberships: 0, accept_audit: 0, revoke_audit: 1 }, "revocation-before-acceptance is atomic: no membership or acceptance audit is written");
    process.stdout.write("PASS real Server Action acceptance loses a controlled two-session PostgreSQL row-lock race to prior revocation; no membership/acceptance audit side effects\n");

    const setupEmail = `r1005-password-action-${randomUUID()}@qr-asistencia.invalid`;
    const setupIdentity = await createHttpIdentity(setupEmail);
    await dbPool.query("update auth.users set invited_at=clock_timestamp(), raw_app_meta_data=raw_app_meta_data-'access_setup_completed_at' where id=$1", [setupIdentity.userId]);
    const setupInvite = await adminA.client.rpc("create_company_user_invitation", { p_company_id: companyA, p_email: setupEmail, p_role: "employee", p_employee_id: null });
    verify.equal(setupInvite.error, null);
    await actionBrowser.close();
    actionBrowser = await launchServerActionBrowser(appUrl);
    await actionBrowser.navigate("/login");
    await actionBrowser.runForm("form", { email: setupIdentity.email, password: setupIdentity.password });
    await actionBrowser.waitForPath("/invitacion");
    const preSetup = await dbPool.query("select status from public.company_user_invitations where id=$1", [setupInvite.data]);
    await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(setupInvite.data)}`);
    await actionBrowser.runForm("#accept-invitation");
    await actionBrowser.waitForPath("error=password");
    const rejectedSetup = await dbPool.query(`select i.status,
      (select count(*)::int from public.company_memberships m where m.company_id=i.company_id and m.user_id=$2 and m.active) memberships,
      (select count(*)::int from public.audit_log a where a.company_id=i.company_id and a.entity_id=i.id and a.action='USER_INVITATION_ACCEPTED') accept_audit
      from public.company_user_invitations i where i.id=$1`, [setupInvite.data, setupIdentity.userId]);
    verify.deepEqual(rejectedSetup.rows[0], { status: "pending", memberships: 0, accept_audit: 0 }, "acceptInvitation Server Action rejects before password setup without side effects");
    await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(setupInvite.data)}`);
    await actionBrowser.runForm("#set-invitation-password", { fullName: "Synthetic Setup User", password: "synthetic-final-password-123", confirmation: "synthetic-final-password-123" });
    await actionBrowser.waitForPath("setup=complete");
    const appSetup = await dbPool.query("select raw_app_meta_data->>'access_setup_completed_at' marker from auth.users where id=$1", [setupIdentity.userId]);
    verify.ok(appSetup.rows[0].marker, "password Server Action persists its server-owned setup marker");
    verify.deepEqual(preSetup.rows, [{ status: "pending" }], "password setup alone does not accept or mutate the invitation");
    await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(setupInvite.data)}`);
    await actionBrowser.runForm("#accept-invitation");
    await actionBrowser.waitForPath("/mi-qr");
    const completedSetup = await dbPool.query(`select i.status,
      (select count(*)::int from public.company_memberships m where m.company_id=i.company_id and m.user_id=$2 and m.active) memberships,
      (select count(*)::int from public.audit_log a where a.company_id=i.company_id and a.entity_id=i.id and a.action='USER_INVITATION_ACCEPTED') accept_audit
      from public.company_user_invitations i where i.id=$1`, [setupInvite.data, setupIdentity.userId]);
    verify.deepEqual(completedSetup.rows[0], { status: "accepted", memberships: 1, accept_audit: 1 }, "password setup followed by the real acceptance Server Action commits one membership and audit");
    process.stdout.write("PASS setInvitationPassword then acceptInvitation actions preserve the setup gate and single-accept transaction\n");
    process.stdout.write(`PASS targeted local authorization race mode: ${targetedAssertions} assertions; no attendance sessions/events, PIN verification, scan, remote links, or remote credentials\n`);
  } else {

  // Exercise real Server Actions through forms rendered and submitted by
  // Chrome/React/Next. The action-harness route exists only inside appRoot.
  const actionAdmin = await createHttpUser("server-action-admin", "admin", companyA);
  const actionMultiAdmin = await createHttpUser("server-action-multi-admin", "admin", companyA, { extraMemberships: [[companyB, "admin"]] });
  const actionEmployee = await createHttpUser("server-action-employee", "employee", companyA, { employee: true, branchId: branchA });
  actionBrowser = await launchServerActionBrowser(appUrl);

  await actionBrowser.navigate("/login?next=https%3A%2F%2Fattacker.invalid%2Fredirect");
  await actionBrowser.runForm("form", { email: actionAdmin.email, password: "intentionally-wrong-synthetic-password" });
  await actionBrowser.waitForPath("error=credentials");
  assert.equal((await actionBrowser.getCookies()).some((cookie) => cookie.name === "qr_active_membership_id"), false, "failed local sign-in does not create an active-membership cookie");
  await actionBrowser.navigate("/login?next=https%3A%2F%2Fattacker.invalid%2Fredirect");
  await actionBrowser.runForm("form", { email: actionAdmin.email, password: actionAdmin.password });
  const actionAdminUrl = await actionBrowser.waitForPath("/admin");
  assert.equal(new URL(actionAdminUrl).origin, appUrl, "valid sign-in ignores an external next destination");
  const activeCookie = (await actionBrowser.getCookies()).find((cookie) => cookie.name === "qr_active_membership_id");
  assert.equal(activeCookie?.value, actionAdmin.memberships[0].id);
  assert.equal(activeCookie?.httpOnly, true);
  assert.equal(activeCookie?.sameSite, "Lax");
  assert.equal(activeCookie?.path, "/");
  let actionCompany = await actionBrowser.fetchJson(`/api/company?companyId=${companyA}`);
  assert.equal(actionCompany.status, 200, "real sign-in creates an authenticated SSR session accepted by the API");
  assert.equal(actionCompany.body.item.id, companyA);
  await actionBrowser.clickButtonText("Cerrar sesión");
  await actionBrowser.waitForPath("/login");
  assert.equal((await actionBrowser.getCookies()).some((cookie) => cookie.name === "qr_active_membership_id"), false, "admin sign-out removes the HttpOnly membership cookie");
  assert.equal((await actionBrowser.fetchJson(`/api/company?companyId=${companyA}`)).status, 401, "admin sign-out invalidates the Auth session");

  // Even if a client tampers with the membershipId in a native action form,
  // chooseMembership is bound to the authenticated user and active memberships.
  await actionBrowser.navigate(`/qr004-action-harness?membershipId=${encodeURIComponent(adminB.memberships[0].id)}`);
  await actionBrowser.runForm("#choose-membership");
  await actionBrowser.waitForPath("/login", "unauthenticated membership selection must return to login");
  assert.equal((await actionBrowser.getCookies()).some((cookie) => cookie.name === "qr_active_membership_id"), false);
  await actionBrowser.navigate("/login");
  await actionBrowser.runForm("form", { email: actionMultiAdmin.email, password: actionMultiAdmin.password });
  await actionBrowser.waitForPath("/seleccionar-empresa");
  await actionBrowser.runForm("form:has(input[name='membershipId'])", { membershipId: adminB.memberships[0].id });
  await actionBrowser.waitForPath("error=invalid");
  assert.equal((await actionBrowser.getCookies()).some((cookie) => cookie.name === "qr_active_membership_id"), false, "foreign membershipId cannot create an administrative session");
  await actionBrowser.navigate("/seleccionar-empresa");
  await actionBrowser.runForm("form:nth-of-type(2)");
  await actionBrowser.waitForPath("/admin");
  let membershipCookie = (await actionBrowser.getCookies()).find((cookie) => cookie.name === "qr_active_membership_id");
  assert.equal(membershipCookie?.value, actionMultiAdmin.memberships[1].id, "a user can select their own second-company membership");
  actionCompany = await actionBrowser.fetchJson(`/api/company?companyId=${companyB}`);
  assert.equal(actionCompany.body.item.id, companyB);
  await actionBrowser.navigate(`/qr004-action-harness?adminMembershipId=${encodeURIComponent(actionMultiAdmin.memberships[0].id)}`);
  await actionBrowser.runForm("#set-admin-membership");
  try {
    await actionBrowser.waitForActiveMembership(actionMultiAdmin.memberships[0].id);
  } catch (error) {
    const status = [...appOutput.matchAll(/QR004_LOCAL_ADMIN_ACTION_RESULT:(ALLOWED|DENIED)/g)].at(-1)?.[1] ?? "NOT_OBSERVED";
    throw new Error(`local valid-company switch did not commit cookie; Server Action result: ${status}`, { cause: error });
  }
  membershipCookie = (await actionBrowser.getCookies()).find((cookie) => cookie.name === "qr_active_membership_id");
  assert.equal(membershipCookie?.value, actionMultiAdmin.memberships[0].id, "setAdminMembership switches to the caller's own active admin membership");
  await actionBrowser.navigate(`/qr004-action-harness?adminMembershipId=${encodeURIComponent(adminB.memberships[0].id)}`);
  await actionBrowser.runForm("#set-admin-membership");
  membershipCookie = (await actionBrowser.getCookies()).find((cookie) => cookie.name === "qr_active_membership_id");
  assert.equal(membershipCookie?.value, actionMultiAdmin.memberships[0].id, "setAdminMembership leaves the active membership unchanged for a foreign ID");
  await service.from("company_memberships").update({ active: false }).eq("id", actionMultiAdmin.memberships[0].id);
  actionCompany = await actionBrowser.fetchJson(`/api/company?companyId=${companyA}`);
  assert.equal(actionCompany.status, 403, "revoking the selected membership removes access despite the stale cookie");
  await actionBrowser.navigate(`/qr004-action-harness?membershipId=${encodeURIComponent(actionMultiAdmin.memberships[0].id)}`);
  await actionBrowser.runForm("#choose-membership");
  await actionBrowser.waitForPath("error=invalid");
  assert.equal((await actionBrowser.getCookies()).find((cookie) => cookie.name === "qr_active_membership_id")?.value, actionMultiAdmin.memberships[0].id, "chooseMembership cannot replace a valid cookie with an inactive/revoked membership");
  await actionBrowser.navigate(`/qr004-action-harness?adminMembershipId=${encodeURIComponent(actionMultiAdmin.memberships[1].id)}`);
  await actionBrowser.runForm("#set-admin-membership");
  try {
    await actionBrowser.waitForActiveMembership(actionMultiAdmin.memberships[1].id);
  } catch (error) {
    const status = [...appOutput.matchAll(/QR004_LOCAL_ADMIN_ACTION_RESULT:(ALLOWED|DENIED)/g)].at(-1)?.[1] ?? "NOT_OBSERVED";
    throw new Error(`local valid-company switch did not commit cookie; Server Action result: ${status}`, { cause: error });
  }
  membershipCookie = (await actionBrowser.getCookies()).find((cookie) => cookie.name === "qr_active_membership_id");
  assert.equal(membershipCookie?.value, actionMultiAdmin.memberships[1].id, "a remaining active membership can replace a revoked selection");
  await service.from("company_memberships").update({ active: true }).eq("id", actionMultiAdmin.memberships[0].id);

  await actionBrowser.clickButtonText("Cerrar sesión").catch(async () => {
    await actionBrowser.navigate("/admin");
    await actionBrowser.clickButtonText("Cerrar sesión");
  });
  await actionBrowser.waitForPath("/login");
  await actionBrowser.navigate("/login");
  await actionBrowser.runForm("form", { email: actionEmployee.email, password: actionEmployee.password });
  await actionBrowser.waitForPath("/mi-qr");
  const employeeMembershipCookie = (await actionBrowser.getCookies()).find((cookie) => cookie.name === "qr_active_membership_id");
  assert.equal(employeeMembershipCookie?.value, actionEmployee.memberships[0].id);
  await actionBrowser.navigate(`/qr004-action-harness?membershipId=${encodeURIComponent(adminA.memberships[0].id)}`);
  await actionBrowser.runForm("#choose-membership");
  await actionBrowser.waitForPath("error=invalid");
  membershipCookie = (await actionBrowser.getCookies()).find((cookie) => cookie.name === "qr_active_membership_id");
  assert.equal(membershipCookie?.value, actionEmployee.memberships[0].id, "employee cannot select another user's administrative membership");
  await actionBrowser.navigate(`/qr004-action-harness?adminMembershipId=${encodeURIComponent(adminA.memberships[0].id)}`);
  await actionBrowser.runForm("#set-admin-membership");
  membershipCookie = (await actionBrowser.getCookies()).find((cookie) => cookie.name === "qr_active_membership_id");
  assert.equal(membershipCookie?.value, actionEmployee.memberships[0].id, "employee cannot replace their active cookie with an admin membership");
  await actionBrowser.navigate("/mi-qr");
  await actionBrowser.clickButtonText("Cerrar sesión");
  await actionBrowser.waitForPath("/login");
  assert.equal((await actionBrowser.getCookies()).some((cookie) => cookie.name === "qr_active_membership_id"), false, "employee sign-out removes the active-membership cookie");
  assert.equal((await actionBrowser.fetchJson("/api/me")).status, 401, "employee sign-out invalidates its Auth session");
  await actionBrowser.navigate(`/qr004-action-harness?adminMembershipId=${encodeURIComponent(adminA.memberships[0].id)}`);
  await actionBrowser.runForm("#set-admin-membership");
  assert.equal((await actionBrowser.getCookies()).some((cookie) => cookie.name === "qr_active_membership_id"), false, "anonymous setAdminMembership does not create a membership cookie");
  await actionBrowser.navigate("/login");
  await actionBrowser.runForm("form", { email: actionAdmin.email, password: actionAdmin.password });
  await actionBrowser.waitForPath("/admin");
  await actionBrowser.navigate(`/qr004-action-harness?next=${encodeURIComponent("https://attacker.invalid/redirect")}`);
  await actionBrowser.runForm("#sign-in", { email: actionAdmin.email, password: actionAdmin.password });
  const externalNextResult = await actionBrowser.waitForPath("/admin");
  assert.equal(new URL(externalNextResult).origin, appUrl, "a user-controlled next field cannot redirect outside the local app");
  await actionBrowser.clickButtonText("Cerrar sesión");
  await actionBrowser.waitForPath("/login");
  process.stdout.write("PASS dynamic Server Actions: sign-in/out, closed redirects, cookie attributes, own/foreign/revoked memberships, employee/admin role boundaries, and post-sign-out denial\n");

  let response;
  // Company settings and dashboard APIs: real local Auth sessions, company
  // permission overrides, PostgreSQL RLS, two synthetic tenants, and branch
  // scoped attendance data with timezone-local work dates.
  const inactiveBranchResult = await service.from("branches").insert({ company_id: companyA, name: `HTTP Inactive Branch ${randomUUID()}`, timezone: "America/Mexico_City", active: false }).select("id").single();
  if (inactiveBranchResult.error || !inactiveBranchResult.data) throw new Error("failed creating inactive synthetic dashboard branch");
  const inactiveBranchA = inactiveBranchResult.data.id;
  const pacificBranchResult = await service.from("branches").insert({ company_id: companyA, name: `HTTP Pacific Branch ${randomUUID()}`, timezone: "Pacific/Kiritimati", active: true }).select("id").single();
  if (pacificBranchResult.error || !pacificBranchResult.data) throw new Error("failed creating synthetic dashboard branch with a distinct timezone");
  const pacificBranchA = pacificBranchResult.data.id;
  const dashboardEmployeeA2 = await service.from("employees").insert({ company_id: companyA, branch_id: otherBranchA, employee_number: `DASH-${randomBytes(4).toString("hex")}`, first_name: "Synthetic", last_name: "TenantA-OtherBranch", active: true }).select("id").single();
  const dashboardEmployeePacific = await service.from("employees").insert({ company_id: companyA, branch_id: pacificBranchA, employee_number: `DASH-${randomBytes(4).toString("hex")}`, first_name: "Synthetic", last_name: "TenantA-Pacific", active: true }).select("id").single();
  const dashboardEmployeeB = await service.from("employees").insert({ company_id: companyB, branch_id: branchB, employee_number: `DASH-${randomBytes(4).toString("hex")}`, first_name: "Synthetic", last_name: "TenantB-SecretMovement", active: true }).select("id").single();
  if (dashboardEmployeeA2.error || dashboardEmployeePacific.error || dashboardEmployeeB.error) throw new Error("failed creating synthetic dashboard employees");
  const dashboardDeviceOwnerA = await service.from("supervisors").insert({ company_id: companyA, membership_id: ownerA.memberships[0].id });
  const dashboardDeviceAdminB = await service.from("supervisors").insert({ company_id: companyB, membership_id: adminB.memberships[0].id });
  if (dashboardDeviceOwnerA.error || dashboardDeviceAdminB.error) throw new Error("failed creating synthetic dashboard device authorization fixtures");
  const dashboardDeviceA = await service.from("authorized_devices").insert({ company_id: companyA, branch_id: branchA, membership_id: ownerA.memberships[0].id, label: "Synthetic dashboard device A" }).select("id").single();
  const dashboardDeviceA2 = await service.from("authorized_devices").insert({ company_id: companyA, branch_id: otherBranchA, membership_id: ownerA.memberships[0].id, label: "Synthetic dashboard device A2" }).select("id").single();
  const dashboardDevicePacific = await service.from("authorized_devices").insert({ company_id: companyA, branch_id: pacificBranchA, membership_id: ownerA.memberships[0].id, label: "Synthetic dashboard device Pacific" }).select("id").single();
  const dashboardDeviceB = await service.from("authorized_devices").insert({ company_id: companyB, branch_id: branchB, membership_id: adminB.memberships[0].id, label: "Synthetic dashboard device B" }).select("id").single();
  if ([dashboardDeviceA, dashboardDeviceA2, dashboardDevicePacific, dashboardDeviceB].some((result) => result.error || !result.data)) throw new Error("failed creating synthetic dashboard devices");
  const dashboardNow = new Date();
  const dashboardInstant = dashboardNow.toISOString();
  const dateInZone = (date, timeZone) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const makeDashboardSession = async ({ companyId, employeeId, branchId, deviceId, timezone, recordedBy, closed, label }) => {
    const start = new Date(dashboardNow.getTime() - 5 * 60_000);
    const session = await service.from("attendance_sessions").insert({
      company_id: companyId, employee_id: employeeId, branch_id: branchId,
      local_work_date: dateInZone(dashboardNow, timezone), timezone,
      status: "open", started_at: start.toISOString(), scheduled_minutes: 480,
    }).select("id").single();
    if (session.error || !session.data) throw new Error(`failed creating synthetic ${label} dashboard session`);
    const clockIn = await service.from("attendance_events").insert({
      company_id: companyId, session_id: session.data.id, event_type: "clock_in", sequence_no: 1,
      occurred_at: start.toISOString(), recorded_by: recordedBy, device_id: deviceId, idempotency_key: randomUUID(),
      metadata: { fixture: "qr004-dashboard-synthetic" },
    }).select("id").single();
    if (clockIn.error || !clockIn.data) throw new Error(`failed creating synthetic ${label} dashboard clock-in`);
    let clockOutId = null;
    if (closed) {
      const clockOut = await service.from("attendance_events").insert({
        company_id: companyId, session_id: session.data.id, event_type: "clock_out", sequence_no: 2,
        occurred_at: dashboardInstant, recorded_by: recordedBy, device_id: deviceId, idempotency_key: randomUUID(),
        metadata: { fixture: "qr004-dashboard-synthetic" },
      }).select("id").single();
      if (clockOut.error || !clockOut.data) throw new Error(`failed creating synthetic ${label} dashboard clock-out`);
      clockOutId = clockOut.data.id;
      const closedSession = await service.from("attendance_sessions").update({ status: "closed", ended_at: dashboardInstant }).eq("id", session.data.id);
      if (closedSession.error) throw new Error(`failed closing synthetic ${label} dashboard session`);
    }
    return { sessionId: session.data.id, clockInId: clockIn.data.id, clockOutId };
  };
  const dashboardAOpen = await makeDashboardSession({ companyId: companyA, employeeId: employeeA.employeeId, branchId: branchA, deviceId: dashboardDeviceA.data.id, timezone: "America/Mexico_City", recordedBy: ownerA.userId, closed: false, label: "company A branch A open" });
  const dashboardAClosed = await makeDashboardSession({ companyId: companyA, employeeId: dashboardEmployeeA2.data.id, branchId: otherBranchA, deviceId: dashboardDeviceA2.data.id, timezone: "America/Mexico_City", recordedBy: ownerA.userId, closed: true, label: "company A branch A2 closed" });
  const dashboardAPacificClosed = await makeDashboardSession({ companyId: companyA, employeeId: dashboardEmployeePacific.data.id, branchId: pacificBranchA, deviceId: dashboardDevicePacific.data.id, timezone: "Pacific/Kiritimati", recordedBy: ownerA.userId, closed: true, label: "company A Pacific branch closed" });
  const dashboardBClosed = await makeDashboardSession({ companyId: companyB, employeeId: dashboardEmployeeB.data.id, branchId: branchB, deviceId: dashboardDeviceB.data.id, timezone: "America/Mexico_City", recordedBy: adminB.userId, closed: true, label: "company B closed" });
  const companyRecord = async (id) => (await dbPool.query("select id,name,legal_name,rfc,updated_at from public.companies where id=$1", [id])).rows[0];
  const companyAndDataSnapshot = async (id) => ({ company: await companyRecord(id), data: await snapshot(id) });

  response = await request(`/api/company?companyId=${companyA}`); assert.equal(response.status, 401);
  response = await request(`/api/company?companyId=${companyA}`, { user: supervisorA }); assert.equal(response.status, 403);
  response = await request(`/api/company?companyId=${companyA}`, { user: employeeA }); assert.equal(response.status, 403);
  response = await request(`/api/company?companyId=${companyB}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request("/api/company", { user: multiAdmin }); assert.equal(response.status, 400, "multiple admin memberships require explicit company selection");
  response = await request(`/api/company?companyId=${companyB}`, { user: multiAdmin }); assert.equal(response.status, 200);
  assert.equal((await response.json()).item.id, companyB, "multi-company admin can select its own second tenant");
  response = await request("/api/company", { user: adminA }); assert.equal(response.status, 200);
  assert.equal((await response.json()).item.id, companyA, "single-company admin resolves its sole active company without a selector");
  response = await request(`/api/company?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).canManage, true);
  response = await request(`/api/company?companyId=${companyA}`, { user: adminB }); assert.equal(response.status, 403);

  const validCompanyPayload = { name: `Synthetic Company A Updated ${randomUUID()}`, legalName: "Synthetic Tenant A LLC", rfc: "SYN010101ABC" };
  const beforeCompanyRoleDenialsA = await companyAndDataSnapshot(companyA);
  response = await request(`/api/company?companyId=${companyA}`, { method: "PATCH", body: validCompanyPayload }); assert.equal(response.status, 401);
  response = await request(`/api/company?companyId=${companyA}`, { user: supervisorA, method: "PATCH", body: validCompanyPayload }); assert.equal(response.status, 403);
  response = await request(`/api/company?companyId=${companyA}`, { user: employeeA, method: "PATCH", body: validCompanyPayload }); assert.equal(response.status, 403);
  assert.deepEqual(await companyAndDataSnapshot(companyA), beforeCompanyRoleDenialsA, "anonymous and non-admin PATCH denials preserve company and audit snapshots");
  response = await request(`/api/company?companyId=${companyA}`, { user: adminA, method: "PATCH", body: validCompanyPayload }); assert.equal(response.status, 200);
  assert.equal((await response.json()).item.name, validCompanyPayload.name);
  const persistedCompanyA = await companyRecord(companyA);
  assert.deepEqual({ id: persistedCompanyA.id, name: persistedCompanyA.name, legal_name: persistedCompanyA.legal_name, rfc: persistedCompanyA.rfc }, {
    id: companyA, name: validCompanyPayload.name, legal_name: validCompanyPayload.legalName, rfc: validCompanyPayload.rfc,
  }, "authorized HTTP PATCH persists through PostgreSQL");
  const directAllowedCompanyUpdate = await adminA.client.from("companies").update({ legal_name: "Synthetic direct RLS update" }).eq("id", companyA).select("id,legal_name").single();
  assert.deepEqual(directAllowedCompanyUpdate.data, { id: companyA, legal_name: "Synthetic direct RLS update" }, "authenticated PostgreSQL RLS permits company update when company.manage is effective");

  const beforeInvalidCompanyWritesA = await companyAndDataSnapshot(companyA);
  for (const [payload, label] of [
    [{ name: "  ", legalName: null, rfc: null }, "empty name"],
    [{ name: "x".repeat(181), legalName: null, rfc: null }, "overlong name"],
    [{ name: "Valid", legalName: "x".repeat(241), rfc: null }, "overlong legal name"],
    [{ name: "Valid", legalName: null, rfc: "INVALID" }, "invalid RFC"],
    [{ name: "Valid", legalName: null, rfc: null, companyId: companyB }, "unexpected foreign company field"],
  ]) {
    response = await request(`/api/company?companyId=${companyA}`, { user: adminA, method: "PATCH", body: payload });
    assert.equal(response.status, 422, `company PATCH rejects ${label}`);
  }
  assert.deepEqual(await companyAndDataSnapshot(companyA), beforeInvalidCompanyWritesA, "invalid company patches preserve company and audit/data snapshots");

  const companyManageOverride = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "company.manage", allowed: false });
  if (companyManageOverride.error) throw new Error("could not prepare synthetic company.manage denial");
  const beforeCompanyPermissionDenialA = await companyAndDataSnapshot(companyA), beforeCompanyPermissionDenialB = await companyAndDataSnapshot(companyB);
  response = await request(`/api/company?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  const readOnlyCompany = await response.json();
  assert.equal(readOnlyCompany.canManage, false, "GET reports company.manage denial without blocking company.read");
  assert.equal(response.headers.get("cache-control"), "no-store");
  response = await request(`/api/company?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { name: "Unauthorized synthetic mutation", legalName: null, rfc: null } }); assert.equal(response.status, 403);
  const directDeniedCompanyUpdate = await adminA.client.from("companies").update({ name: "Unauthorized direct mutation" }).eq("id", companyA).select("id");
  assert.ok(directDeniedCompanyUpdate.error?.code === "42501" || (directDeniedCompanyUpdate.data ?? []).length === 0, "PostgreSQL RLS rejects direct company update without company.manage");
  response = await request(`/api/company?companyId=${companyB}`, { user: adminA, method: "PATCH", body: { name: "Foreign synthetic mutation", legalName: null, rfc: null } }); assert.equal(response.status, 403);
  assert.deepEqual(await companyAndDataSnapshot(companyA), beforeCompanyPermissionDenialA, "API and RLS permission denials preserve tenant A snapshot");
  assert.deepEqual(await companyAndDataSnapshot(companyB), beforeCompanyPermissionDenialB, "foreign company selection cannot modify tenant B");
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "company.manage");

  await service.from("company_memberships").update({ active: false }).eq("id", adminA.memberships[0].id);
  const beforeInactiveCompanyMembershipA = await companyAndDataSnapshot(companyA);
  response = await request(`/api/company?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request(`/api/company?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { name: "Revoked API mutation", legalName: null, rfc: null } }); assert.equal(response.status, 403);
  const inactiveCompanyMembershipPatch = await adminA.client.from("companies").update({ name: "Revoked direct mutation" }).eq("id", companyA).select("id");
  assert.ok(inactiveCompanyMembershipPatch.error?.code === "42501" || (inactiveCompanyMembershipPatch.data ?? []).length === 0, "inactive membership cannot directly update company through RLS");
  assert.deepEqual(await companyAndDataSnapshot(companyA), beforeInactiveCompanyMembershipA, "inactive membership API and RLS denials preserve company and audit snapshots");
  await service.from("company_memberships").update({ active: true }).eq("id", adminA.memberships[0].id);
  assert.deepEqual(await companyRecord(companyA), beforeCompanyPermissionDenialA.company, "rejected company operations do not alter target values");
  process.stdout.write("PASS company GET/PATCH enforce Auth, active admin membership, company selection, company.manage at API and RLS, input validation, no-store, and zero-write rejection snapshots\n");

  const expectedActiveCount = async (companyId, branchId = null) => {
    let query = service.from("employees").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("active", true);
    if (branchId) query = query.eq("branch_id", branchId);
    const result = await query;
    if (result.error) throw new Error("failed counting synthetic dashboard employees");
    return result.count ?? 0;
  };
  const expectedDashboardSessionCounts = async (companyId, branchId = null) => {
    let query = service.from("attendance_sessions").select("employee_id,branch_id,status,local_work_date,timezone").eq("company_id", companyId);
    if (branchId) query = query.eq("branch_id", branchId);
    const result = await query;
    if (result.error) throw new Error("failed reading synthetic dashboard session counts");
    const sessions = result.data ?? [];
    return {
      openShifts: new Set(sessions.filter((session) => session.status === "open").map((session) => session.employee_id)).size,
      completedToday: sessions.filter((session) => session.status === "closed" && session.local_work_date === dateInZone(new Date(), session.timezone)).length,
    };
  };
  response = await request(`/api/dashboard/summary?companyId=${companyA}`); assert.equal(response.status, 401);
  response = await request(`/api/dashboard/summary?companyId=${companyA}`, { user: employeeA }); assert.equal(response.status, 403);
  response = await request(`/api/dashboard/summary?companyId=${companyA}`, { user: supervisorA }); assert.equal(response.status, 403);
  response = await request(`/api/dashboard/summary?companyId=${companyB}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request("/api/dashboard/summary", { user: multiAdmin }); assert.equal(response.status, 400);
  response = await request(`/api/dashboard/summary?companyId=${companyB}`, { user: multiAdmin }); assert.equal(response.status, 200);
  const dashboardB = await response.json();
  assert.equal(dashboardB.company.id, companyB);
  assert.ok(dashboardB.movements.some((movement) => movement.employee === "Synthetic TenantB-SecretMovement"));
  assert.equal(dashboardB.movements.some((movement) => movement.employee.includes("TenantA-")), false, "tenant B dashboard excludes tenant A movements");
  response = await request(`/api/dashboard/summary?companyId=${companyA}`, { user: adminB }); assert.equal(response.status, 403);
  response = await request(`/api/dashboard/summary?companyId=${companyA}&branchId=not-a-uuid`, { user: adminA }); assert.equal(response.status, 400);
  response = await request(`/api/dashboard/summary?companyId=${companyA}&branchId=${branchB}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request(`/api/dashboard/summary?companyId=${companyA}&branchId=${inactiveBranchA}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request(`/api/dashboard/summary?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const dashboardA = await response.json();
  assert.equal(dashboardA.company.id, companyA);
  assert.deepEqual(dashboardA.branches.map((branch) => branch.id).sort(), [branchA, otherBranchA, pacificBranchA].sort(), "only active company A branches are returned");
  assert.equal(dashboardA.stats.activeEmployees, await expectedActiveCount(companyA));
  const expectedDashboardA = await expectedDashboardSessionCounts(companyA);
  assert.equal(dashboardA.stats.openShifts, expectedDashboardA.openShifts, "unfiltered open shift count is limited to tenant A");
  assert.equal(dashboardA.stats.completedToday, expectedDashboardA.completedToday, "completed-today count matches each session's timezone-local work date");
  assert.ok(dashboardA.movements.some((movement) => movement.employee === "Synthetic employee-a"));
  assert.ok(dashboardA.movements.some((movement) => movement.employee === "Synthetic TenantA-OtherBranch"));
  assert.equal(dashboardA.movements.some((movement) => movement.employee.includes("TenantB-")), false, "tenant A recent movements exclude tenant B employee names");
  assert.equal(dashboardA.movements.some((movement) => [dashboardBClosed.clockInId, dashboardBClosed.clockOutId].includes(movement.id)), false, "tenant A recent movements exclude tenant B event IDs");

  response = await request(`/api/dashboard/summary?companyId=${companyA}&branchId=${branchA}`, { user: adminA }); assert.equal(response.status, 200);
  const dashboardBranchA = await response.json();
  assert.equal(dashboardBranchA.stats.activeEmployees, await expectedActiveCount(companyA, branchA));
  const expectedDashboardBranchA = await expectedDashboardSessionCounts(companyA, branchA);
  assert.equal(dashboardBranchA.stats.openShifts, expectedDashboardBranchA.openShifts, "branch A open shift count matches the selected branch");
  assert.equal(dashboardBranchA.stats.completedToday, expectedDashboardBranchA.completedToday, "branch A completed-today count excludes other branches and respects local work dates");
  assert.ok(dashboardBranchA.movements.some((movement) => movement.id === dashboardAOpen.clockInId));
  assert.equal(dashboardBranchA.movements.some((movement) => movement.id === dashboardAClosed.clockInId || movement.id === dashboardAClosed.clockOutId), false, "branch A movement list excludes branch A2 events");
  assert.equal(dashboardBranchA.movements.some((movement) => movement.employee.includes("TenantB-")), false);
  response = await request(`/api/dashboard/summary?companyId=${companyA}&branchId=${otherBranchA}`, { user: adminA }); assert.equal(response.status, 200);
  const dashboardBranchA2 = await response.json();
  assert.equal(dashboardBranchA2.stats.activeEmployees, await expectedActiveCount(companyA, otherBranchA));
  const expectedDashboardBranchA2 = await expectedDashboardSessionCounts(companyA, otherBranchA);
  assert.equal(dashboardBranchA2.stats.openShifts, expectedDashboardBranchA2.openShifts);
  assert.equal(dashboardBranchA2.stats.completedToday, expectedDashboardBranchA2.completedToday, "branch A2 completed count matches its timezone-local sessions only");
  assert.ok(dashboardBranchA2.movements.some((movement) => movement.id === dashboardAClosed.clockOutId));
  assert.equal(dashboardBranchA2.movements.some((movement) => movement.id === dashboardAOpen.clockInId), false, "branch A2 movement list excludes branch A events");
  response = await request(`/api/dashboard/summary?companyId=${companyA}&branchId=${pacificBranchA}`, { user: adminA }); assert.equal(response.status, 200);
  const dashboardPacific = await response.json();
  assert.equal(dashboardPacific.dateReference, "Pacific/Kiritimati");
  assert.equal(dashboardPacific.operatingDate, dateInZone(new Date(), "Pacific/Kiritimati"), "dashboard presents the operating date in the selected branch timezone");
  assert.equal(dashboardPacific.stats.completedToday, 1, "Pacific branch date filter counts its local-date session across UTC boundary");
  assert.ok(dashboardPacific.movements.some((movement) => movement.id === dashboardAPacificClosed.clockOutId));
  assert.equal(dashboardPacific.movements.some((movement) => movement.id === dashboardAClosed.clockOutId || movement.id === dashboardAOpen.clockInId), false, "Pacific branch filter excludes other branch events");

  await service.from("company_memberships").update({ active: false }).eq("id", adminA.memberships[0].id);
  response = await request(`/api/dashboard/summary?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 403);
  await service.from("company_memberships").update({ active: true }).eq("id", adminA.memberships[0].id);
  const directTenantRead = await adminA.client.from("attendance_events").select("id,company_id").eq("company_id", companyB);
  assert.equal(directTenantRead.error, null);
  assert.deepEqual(directTenantRead.data, [], "authenticated company A user cannot read company B events through PostgreSQL RLS");
  const directOwnTenantRead = await adminA.client.from("attendance_events").select("id,company_id").eq("company_id", companyA);
  assert.equal(directOwnTenantRead.error, null);
  assert.ok(directOwnTenantRead.data.some((event) => event.id === dashboardAOpen.clockInId), "authorized tenant A PostgreSQL query can read its own event");
  for (const table of ["employees", "attendance_sessions", "attendance_events"]) {
    const foreignRows = await adminA.client.from(table).select("id,company_id").eq("company_id", companyB);
    assert.equal(foreignRows.error, null, `${table} foreign-tenant read query succeeds without exposing rows`);
    assert.deepEqual(foreignRows.data, [], `PostgreSQL RLS hides company B ${table} from company A user`);
  }
  assert.equal(dashboardA.movements.some((movement) => movement.id === dashboardBClosed.clockInId), false, "HTTP summary excludes tenant B event identifiers");
  assert.equal(JSON.stringify(dashboardA).includes(dashboardBClosed.sessionId), false, "HTTP summary does not expose tenant B session identifiers");
  assert.equal(JSON.stringify(dashboardA).includes(dashboardEmployeeB.data.id), false, "HTTP summary does not expose tenant B employee identifiers");
  process.stdout.write("PASS dashboard HTTP/Auth and direct PostgreSQL RLS isolate two tenants, active/inactive/foreign branches, synthetic employees/sessions/events, date-local counts and no-store responses\n");

  // Reports API matrix: role, selected company, active membership, filters,
  // tenant isolation and the reports.read boundary are tested independently
  // from direct attendance.read access through PostgreSQL RLS.
  const reportDate = dateInZone(dashboardNow, "America/Mexico_City");
  const reportPath = (companyId, query = "") => `/api/reports?companyId=${companyId}&from=${reportDate}&to=${reportDate}${query}`;
  response = await request(reportPath(companyA)); assert.equal(response.status, 401, "anonymous reports request is rejected");
  response = await request(reportPath(companyA), { user: supervisorA }); assert.equal(response.status, 403, "supervisor cannot access administrative reports");
  response = await request(reportPath(companyA), { user: employeeA }); assert.equal(response.status, 403, "employee cannot access administrative reports");
  response = await request(reportPath(companyA), { user: adminB }); assert.equal(response.status, 403, "an administrator from company B cannot select company A reports");
  response = await request(`/api/reports?from=${reportDate}&to=${reportDate}`, { user: multiAdmin });
  assert.equal(response.status, 400, "multi-company administrators must select a company explicitly");
  response = await request(reportPath(companyA), { user: multiAdmin }); assert.equal(response.status, 200, "multi-company admin can select its authorized company");
  assert.equal(response.headers.get("cache-control"), "no-store, private");

  response = await request(reportPath(companyA)); assert.equal(response.status, 401);
  response = await request(`/api/reports?companyId=${companyA}&from=2026-02-31&to=2026-03-01`, { user: adminA }); assert.equal(response.status, 400, "impossible report date is rejected");
  response = await request(`/api/reports?companyId=${companyA}&from=2030-01-02&to=2030-01-01`, { user: adminA }); assert.equal(response.status, 400, "reversed date range is rejected");
  response = await request(`/api/reports?companyId=${companyA}&from=2025-01-01&to=2026-10-30`, { user: adminA }); assert.equal(response.status, 400, "report ranges over 366 days are rejected");
  response = await request(`/api/reports?companyId=${companyA}&from=${reportDate}&to=${reportDate}&status=secret`, { user: adminA }); assert.equal(response.status, 400, "unknown report status is rejected");
  response = await request(`/api/reports?companyId=${companyA}&from=${reportDate}&to=${reportDate}&branchId=invalid`, { user: adminA }); assert.equal(response.status, 400, "malformed branch identifier is rejected");
  response = await request(`/api/reports?companyId=${companyA}&from=${reportDate}&to=${reportDate}&employeeId=invalid`, { user: adminA }); assert.equal(response.status, 400, "malformed employee identifier is rejected");
  response = await request(reportPath(companyA, `&branchId=${branchB}`), { user: adminA }); assert.equal(response.status, 403, "foreign-company branch filter is rejected");
  response = await request(reportPath(companyA, `&employeeId=${dashboardEmployeeB.data.id}`), { user: adminA }); assert.equal(response.status, 403, "foreign-company employee filter is rejected");

  response = await request(reportPath(companyA), { user: adminA }); assert.equal(response.status, 200, "authorized admin can read own-company reports");
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  const reportA = await response.json();
  assert.ok(reportA.rows.some((row) => row.sessionId === dashboardAOpen.sessionId), "company A report contains its synthetic open session");
  assert.ok(reportA.rows.some((row) => row.sessionId === dashboardAClosed.sessionId), "company A report contains its synthetic closed session");
  assert.equal(JSON.stringify(reportA).includes(dashboardBClosed.sessionId), false, "company A JSON report excludes company B sessions");
  assert.equal(JSON.stringify(reportA).includes(dashboardEmployeeB.data.id), false, "company A JSON report excludes company B employees");
  assert.equal(JSON.stringify(reportA).includes(dashboardBClosed.clockInId), false, "company A JSON report excludes company B events");
  response = await request(reportPath(companyA, `&branchId=${otherBranchA}`), { user: adminA }); assert.equal(response.status, 200);
  const branchReport = await response.json();
  assert.ok(branchReport.rows.some((row) => row.sessionId === dashboardAClosed.sessionId));
  assert.equal(branchReport.rows.some((row) => row.sessionId === dashboardAOpen.sessionId), false, "branch filter excludes other branch sessions");
  response = await request(reportPath(companyA, `&employeeId=${employeeA.employeeId}`), { user: adminA }); assert.equal(response.status, 200);
  const employeeReport = await response.json();
  assert.ok(employeeReport.rows.every((row) => row.employeeId === employeeA.employeeId), "employee filter limits report rows to that employee");
  response = await request(reportPath(companyA, "&status=closed"), { user: adminA }); assert.equal(response.status, 200);
  const closedReport = await response.json();
  assert.ok(closedReport.rows.length > 0 && closedReport.rows.every((row) => row.status === "closed" && !row.incomplete), "closed filter excludes open and incomplete sessions");
  response = await request(reportPath(companyA, "&status=open"), { user: adminA }); assert.equal(response.status, 200);
  assert.ok((await response.json()).rows.every((row) => row.status === "open"), "open filter excludes closed sessions");
  response = await request(reportPath(companyB), { user: adminB }); assert.equal(response.status, 200);
  const reportB = await response.json();
  assert.ok(reportB.rows.some((row) => row.sessionId === dashboardBClosed.sessionId));
  assert.equal(JSON.stringify(reportB).includes(dashboardAOpen.sessionId), false, "company B JSON report excludes company A sessions");

  const wasAdminActive = await service.from("company_memberships").update({ active: false }).eq("id", adminA.memberships[0].id);
  if (wasAdminActive.error) throw new Error("failed preparing inactive synthetic report membership");
  response = await request(reportPath(companyA), { user: adminA }); assert.equal(response.status, 403, "inactive admin membership denies reports");
  await service.from("company_memberships").update({ active: true }).eq("id", adminA.memberships[0].id);

  // Reproduce and then prevent the report-permission bypass: attendance.read
  // remains effective in RLS, but it must not substitute for reports.read.
  const reportPermissionDenied = await service.from("membership_permission_overrides").insert({
    company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "reports.read", allowed: false,
  });
  if (reportPermissionDenied.error) throw new Error("failed preparing synthetic reports.read denial");
  const attendanceReadWithReportsDenied = await adminA.client.from("attendance_session_totals")
    .select("session_id").eq("company_id", companyA).eq("session_id", dashboardAOpen.sessionId);
  assert.equal(attendanceReadWithReportsDenied.error, null, "attendance.read remains independently authorized through PostgreSQL RLS");
  assert.equal(attendanceReadWithReportsDenied.data?.length, 1, "the synthetic admin can read own-tenant attendance under attendance.read");
  const beforeReportPermissionDenial = await snapshot(companyA);
  response = await request(reportPath(companyA), { user: adminA });
  assert.equal(response.status, 403, "explicit reports.read denial blocks HTTP report access");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const deniedReport = await response.json();
  assert.equal(deniedReport.error.code, "reports_forbidden");
  assert.doesNotMatch(JSON.stringify(deniedReport), /SQLSTATE|permission.*override|membership_permission/i, "report denial does not disclose internal authorization details");
  assert.deepEqual(await snapshot(companyA), beforeReportPermissionDenial, "denied report request has no database side effects");
  assert.equal(attendanceReadWithReportsDenied.data?.length, 1, "the separate attendance.read RLS permission remains usable");
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA)
    .eq("membership_id", adminA.memberships[0].id).eq("permission_code", "reports.read");
  process.stdout.write("PASS reports GET/Auth and PostgreSQL RLS: roles, membership, company selection, filters, tenant/session/event isolation, reports.read enforcement and no-side-effect denials\n");

  // Labor-rule validity and overtime authorization permissions. Route reads
  // and writes use Auth sessions; direct table operations use the same
  // authenticated clients to exercise PostgreSQL grants and RLS independently.
  const rulePayload = (name, effectiveFrom, effectiveTo) => ({
    name, effectiveFrom, effectiveTo, lateGraceMinutes: 5, earlyDepartureGraceMinutes: 5,
    restWeekdays: [7], dayStartsAt: "06:00", nightStartsAt: "20:00",
    overtimeDetection: true, overtimeThresholdMinutes: 15, overtimeRecognition: "authorization_only",
  });
  const beforeRuleDenialsA = await snapshot(companyA), beforeRuleDenialsB = await snapshot(companyB);
  response = await request(`/api/schedules/rules?companyId=${companyA}`); assert.equal(response.status, 401);
  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: supervisorA }); assert.equal(response.status, 403);
  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: employeeA }); assert.equal(response.status, 403);
  response = await request(`/api/schedules/rules?companyId=${companyB}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request("/api/schedules/rules", { user: multiAdmin }); assert.equal(response.status, 400);
  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual((await response.json()).items, [], "empty baseline exposes no rules before synthetic setup");

  response = await request(`/api/schedules/rules?companyId=${companyA}`, { method: "POST", body: rulePayload("Anonymous rule", "2090-01-01", "2090-12-31") }); assert.equal(response.status, 401);
  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: supervisorA, method: "POST", body: rulePayload("Supervisor rule", "2090-01-01", "2090-12-31") }); assert.equal(response.status, 403);
  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: employeeA, method: "POST", body: rulePayload("Employee rule", "2090-01-01", "2090-12-31") }); assert.equal(response.status, 403);
  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: adminA, method: "POST", body: { name: "Invalid synthetic rule", effectiveFrom: "2090-01-01" } }); assert.equal(response.status, 422);
  response = await request(`/api/schedules/rules?companyId=${companyB}`, { user: adminA, method: "POST", body: rulePayload("Cross-company synthetic rule", "2090-01-01", "2090-12-31") }); assert.equal(response.status, 403);
  assert.deepEqual(await snapshot(companyA), beforeRuleDenialsA, "anonymous, wrong-role and invalid rule requests have no side effects");
  assert.deepEqual(await snapshot(companyB), beforeRuleDenialsB, "denied labor-rule requests do not alter the other company");

  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: adminA, method: "POST", body: rulePayload(`Synthetic labor rule A ${randomUUID()}`, "2020-01-01", "2040-12-31") }); assert.equal(response.status, 201);
  const laborRuleA = (await response.json()).item;
  assert.equal(laborRuleA.settings.overtime.thresholdMinutes, 15);
  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: adminA, method: "POST", body: rulePayload(`Synthetic later labor rule A ${randomUUID()}`, "2041-01-01", "2090-12-31") }); assert.equal(response.status, 201);
  const laterLaborRuleA = (await response.json()).item;
  response = await request(`/api/schedules/rules?companyId=${companyB}`, { user: adminB, method: "POST", body: rulePayload(`Synthetic labor rule B ${randomUUID()}`, "2020-01-01", "2040-12-31") }); assert.equal(response.status, 201);
  const laborRuleB = (await response.json()).item;
  const beforeForeignRuleOpsB = await snapshot(companyB);
  response = await request(`/api/schedules/rules?companyId=${companyB}`, { user: adminB }); assert.equal(response.status, 200);
  const rulesB = await response.json();
  assert.ok(rulesB.items.some((item) => item.id === laborRuleB.id));
  assert.equal(rulesB.items.some((item) => item.id === laborRuleA.id), false, "company B rules API excludes company A rules");
  const directRulesA = await adminA.client.from("labor_rule_sets").select("id,company_id");
  assert.equal(directRulesA.error, null);
  assert.deepEqual(directRulesA.data.map((item) => item.id).sort(), [laborRuleA.id, laterLaborRuleA.id].sort(), "PostgreSQL RLS exposes only company A rules to its admin");
  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: adminA, method: "POST", body: rulePayload("Synthetic overlapping rule", "2035-01-01", "2045-12-31") }); assert.equal(response.status, 409);
  const companyARulesBeforeOverlap = await snapshot(companyA);
  assert.deepEqual(companyARulesBeforeOverlap.labor_rule_sets.map((rule) => rule.id).sort(), [laborRuleA.id, laterLaborRuleA.id].sort(), "overlapping labor-rule creation creates no row");
  assert.equal((await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_table='labor_rule_sets'", [companyA])).rows[0].n, 2, "overlap rejection creates no labor-rule audit event");

  response = await request(`/api/schedules/rules/${laborRuleA.id}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { effectiveTo: "2030-12-31" } }); assert.equal(response.status, 200);
  assert.equal((await response.json()).item.effective_to, "2030-12-31");
  response = await request(`/api/schedules/rules/${laborRuleA.id}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { effectiveTo: "2045-12-31" } }); assert.equal(response.status, 409);
  response = await request(`/api/schedules/rules/${laborRuleA.id}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { effectiveTo: "2019-12-31" } }); assert.equal(response.status, 422);
  const deniedDirectRuleDelete = await adminA.client.from("labor_rule_sets").delete().eq("id", laborRuleA.id).select("id");
  assert.ok(deniedDirectRuleDelete.error?.code === "42501" || (deniedDirectRuleDelete.data ?? []).length === 0, "direct labor-rule DELETE cannot bypass the guarded deletion RPC");
  const companyARulesAfterPatch = await snapshot(companyA);
  assert.deepEqual(companyARulesAfterPatch.labor_rule_sets.map(({ id, effective_to }) => ({ id, effective_to })).sort((a, b) => a.id.localeCompare(b.id)), [
    { id: laborRuleA.id, effective_to: "2030-12-31" }, { id: laterLaborRuleA.id, effective_to: "2090-12-31" },
  ].sort((a, b) => a.id.localeCompare(b.id)), "overlap, invalid date, and direct-delete denials preserve labor-rule state");
  assert.equal((await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_table='labor_rule_sets'", [companyA])).rows[0].n, 3, "only successful rule creates and patch produce labor-rule audit rows");
  response = await request(`/api/schedules/rules/${laborRuleB.id}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { effectiveTo: "2030-12-31" } }); assert.equal(response.status, 404);
  response = await request(`/api/schedules/rules/${laborRuleB.id}?companyId=${companyA}`, { user: adminA, method: "DELETE" }); assert.equal(response.status, 404);
  assert.deepEqual(await snapshot(companyB), beforeForeignRuleOpsB, "foreign rule IDs cannot modify another company's rules or audit log");

  const ruleManageOverride = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "company.manage", allowed: false });
  if (ruleManageOverride.error) throw new Error("could not prepare synthetic company.manage denial for labor rules");
  const companyReadDuringRuleOverride = await adminA.client.rpc("current_user_has_company_permission", { p_company_id: companyA, p_permission: "company.read" });
  assert.equal(companyReadDuringRuleOverride.data, true, "company.read stays allowed while company.manage is explicitly revoked");
  const beforeRulePermissionDenial = await snapshot(companyA);
  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, [], "RLS does not expose labor rules to an admin lacking company.manage");
  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: adminA, method: "POST", body: rulePayload("Denied synthetic rule", "2050-01-01", "2060-12-31") }); assert.equal(response.status, 403);
  response = await request(`/api/schedules/rules/${laborRuleA.id}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { effectiveTo: "2030-12-31" } }); assert.equal(response.status, 404, "RLS-hidden PATCH target is reported as not found");
  response = await request(`/api/schedules/rules/${laborRuleA.id}?companyId=${companyA}`, { user: adminA, method: "DELETE" }); assert.equal(response.status, 403);
  assert.deepEqual(await snapshot(companyA), beforeRulePermissionDenial, "company.manage-denied rule operations preserve rows and audit events");
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "company.manage");

  const inactiveRulesAdmin = await createHttpUser("inactive-rules-admin", "admin", companyA);
  await service.from("company_memberships").update({ active: false }).eq("id", inactiveRulesAdmin.memberships[0].id);
  const beforeInactiveRuleAdmin = await snapshot(companyA);
  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: inactiveRulesAdmin }); assert.equal(response.status, 403);
  response = await request(`/api/schedules/rules?companyId=${companyA}`, { user: inactiveRulesAdmin, method: "POST", body: rulePayload("Inactive HTTP rule", "2050-01-01", "2060-12-31") }); assert.equal(response.status, 403);
  const inactiveRuleWrite = await inactiveRulesAdmin.client.from("labor_rule_sets").insert({ company_id: companyA, name: "Inactive synthetic rule", effective_from: "2050-01-01", settings: {} }).select("id");
  assert.ok(inactiveRuleWrite.error?.code === "42501" || (inactiveRuleWrite.data ?? []).length === 0, "inactive admin membership cannot write labor rules directly");
  assert.deepEqual(await snapshot(companyA), beforeInactiveRuleAdmin, "inactive admin requests and direct RLS denial preserve company data and audit");

  const assessmentFixture = await service.from("overtime_assessments").insert({ company_id: companyA, session_id: attendanceSessionA, detected_minutes: 75, rule_set_id: laborRuleA.id, detail: { fixture: "qr004-synthetic-overtime" } }).select("id").single();
  if (assessmentFixture.error || !assessmentFixture.data) throw new Error("failed creating a synthetic overtime assessment");
  const authFixture = await ownerA.client.from("overtime_authorizations").insert({ company_id: companyA, session_id: attendanceSessionA, minutes: 30, status: "pending", requested_by: employeeA.userId, reason: "Synthetic overtime approval test" }).select("id").single();
  if (authFixture.error || !authFixture.data) throw new Error(`authorized owner could not insert synthetic overtime authorization (${authFixture.error?.code ?? "unknown"})`);
  const overtimeLocalDateResult = await service.from("attendance_sessions").select("local_work_date").eq("id", attendanceSessionA).single();
  if (overtimeLocalDateResult.error || !overtimeLocalDateResult.data) throw new Error("failed reading synthetic overtime session local date");
  const rulesToday = overtimeLocalDateResult.data.local_work_date;
  const beforeOvertimeAdminDenialsA = await snapshot(companyA), beforeOvertimeAdminDenialsB = await snapshot(companyB);
  const deniedOvertimeInsert = await adminA.client.from("overtime_authorizations").insert({ company_id: companyA, session_id: attendanceSessionA, minutes: 12, status: "pending", requested_by: adminA.userId, reason: "Denied synthetic request" }).select("id");
  assert.ok(deniedOvertimeInsert.error?.code === "42501" || (deniedOvertimeInsert.data ?? []).length === 0, "admin without overtime.manage cannot insert an authorization directly");
  const deniedOvertimeUpdate = await adminA.client.from("overtime_authorizations").update({ minutes: 29 }).eq("id", authFixture.data.id).select("id");
  assert.ok(deniedOvertimeUpdate.error?.code === "42501" || (deniedOvertimeUpdate.data ?? []).length === 0, "admin without overtime.manage cannot update an authorization directly");
  const deniedOvertimeDelete = await adminA.client.from("overtime_authorizations").delete().eq("id", authFixture.data.id).select("id");
  assert.ok(deniedOvertimeDelete.error?.code === "42501" || (deniedOvertimeDelete.data ?? []).length === 0, "admin without overtime.manage cannot delete an authorization directly");
  const deniedForeignOvertimeInsert = await ownerA.client.from("overtime_authorizations").insert({ company_id: companyB, session_id: dashboardBClosed.sessionId, minutes: 10, status: "pending", requested_by: ownerA.userId, reason: "Foreign synthetic request" }).select("id");
  assert.ok(deniedForeignOvertimeInsert.error?.code === "42501" || (deniedForeignOvertimeInsert.data ?? []).length === 0, "owner of company A cannot write an authorization for company B");
  assert.deepEqual(await snapshot(companyA), beforeOvertimeAdminDenialsA, "denied direct overtime writes leave authorization and audit snapshots unchanged");
  assert.deepEqual(await snapshot(companyB), beforeOvertimeAdminDenialsB, "cross-company overtime denial leaves the target tenant unchanged");

  const employeeOwnOvertime = await employeeA.client.from("overtime_authorizations").select("id,company_id,session_id").eq("id", authFixture.data.id);
  assert.equal(employeeOwnOvertime.error, null);
  assert.deepEqual(employeeOwnOvertime.data, [{ id: authFixture.data.id, company_id: companyA, session_id: attendanceSessionA }], "employee read policy exposes only authorizations on the employee's own session");
  const adminOvertimeHidden = await adminA.client.from("overtime_authorizations").select("id").eq("id", authFixture.data.id);
  assert.equal(adminOvertimeHidden.error, null);
  assert.deepEqual(adminOvertimeHidden.data, [], "admin role without overtime.manage cannot read overtime authorization details through Postgres");

  response = await request("/api/schedules/overtime"); assert.equal(response.status, 401);
  response = await request(`/api/schedules/overtime?from=${rulesToday}&to=${rulesToday}`, { user: employeeA }); assert.equal(response.status, 403);
  response = await request(`/api/schedules/overtime?from=${rulesToday}&to=${rulesToday}`, { user: supervisorA }); assert.equal(response.status, 403);
  response = await request(`/api/schedules/overtime?from=${rulesToday}&to=${rulesToday}&companyId=${companyB}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request(`/api/schedules/overtime?from=${rulesToday}&to=${rulesToday}`, { user: multiAdmin }); assert.equal(response.status, 400);
  response = await request(`/api/schedules/overtime?from=${rulesToday}&to=${rulesToday}&companyId=${companyA}`, { user: inactiveRulesAdmin }); assert.equal(response.status, 403);
  response = await request(`/api/schedules/overtime?from=${rulesToday}&to=${rulesToday}&companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const adminOvertime = await response.json();
  const adminOvertimeItem = adminOvertime.items.find((item) => item.session_id === attendanceSessionA);
  assert.ok(adminOvertimeItem, "company admin can read company-scoped attendance overtime metrics");
  assert.equal(adminOvertimeItem.detectedMinutes, 60, "admin sees detected overtime after the effective labor-rule threshold");
  assert.deepEqual(adminOvertimeItem.authorizations, [], "API does not expose authorization details that RLS hides from this admin role");
  assert.equal(adminOvertime.items.some((item) => item.session_id === dashboardBClosed.sessionId), false, "overtime API does not disclose another company's sessions");
  response = await request(`/api/schedules/overtime?from=${rulesToday}&to=${rulesToday}&companyId=${companyB}`, { user: adminB }); assert.equal(response.status, 200);
  const overtimeB = await response.json();
  assert.equal(overtimeB.items.some((item) => item.session_id === dashboardAClosed.sessionId), false, "company B overtime response excludes company A sessions");
  response = await request(`/api/schedules/overtime?from=not-a-date&to=${rulesToday}&companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 400);
  response = await request(`/api/schedules/overtime?from=2026-02-30&to=${rulesToday}&companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 400, "calendar-invalid date is rejected before querying Postgres");
  response = await request(`/api/schedules/overtime?from=${rulesToday}&to=2020-01-01&companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 400);

  const beforeOvertimeApproval = await snapshot(companyA);
  const allowedOvertimeUpdate = await ownerA.client.from("overtime_authorizations").update({ status: "approved", decided_by: ownerA.userId, decided_at: new Date().toISOString() }).eq("id", authFixture.data.id).select("id,status,minutes").single();
  assert.deepEqual(allowedOvertimeUpdate.data, { id: authFixture.data.id, status: "approved", minutes: 30 }, "owner with overtime.manage can directly approve a synthetic authorization");
  const overtimeAfterApproval = await snapshot(companyA);
  assert.notDeepEqual(overtimeAfterApproval.overtime_authorizations, beforeOvertimeApproval.overtime_authorizations);
  response = await request(`/api/schedules/overtime?from=${rulesToday}&to=${rulesToday}&companyId=${companyA}`, { user: ownerA }); assert.equal(response.status, 200);
  const ownerOvertimeItem = (await response.json()).items.find((item) => item.session_id === attendanceSessionA);
  assert.equal(ownerOvertimeItem.approvedMinutes, 30);
  assert.equal(ownerOvertimeItem.recognizedMinutes, 30);

  const overtimeManageOverride = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: ownerA.memberships[0].id, permission_code: "overtime.manage", allowed: false });
  if (overtimeManageOverride.error) throw new Error("could not prepare explicit synthetic overtime.manage denial");
  const beforeRevokedOvertimePermission = await snapshot(companyA);
  const overrideOvertimeInsert = await ownerA.client.from("overtime_authorizations").insert({ company_id: companyA, session_id: attendanceSessionA, minutes: 9, status: "pending", requested_by: ownerA.userId, reason: "Explicitly denied synthetic request" }).select("id");
  assert.ok(overrideOvertimeInsert.error?.code === "42501" || (overrideOvertimeInsert.data ?? []).length === 0, "explicit overtime.manage denial blocks owner direct INSERT");
  const overrideOvertimeUpdate = await ownerA.client.from("overtime_authorizations").update({ minutes: 31 }).eq("id", authFixture.data.id).select("id");
  assert.ok(overrideOvertimeUpdate.error?.code === "42501" || (overrideOvertimeUpdate.data ?? []).length === 0, "explicit overtime.manage denial blocks owner direct UPDATE");
  const overrideOvertimeDelete = await ownerA.client.from("overtime_authorizations").delete().eq("id", authFixture.data.id).select("id");
  assert.ok(overrideOvertimeDelete.error?.code === "42501" || (overrideOvertimeDelete.data ?? []).length === 0, "explicit overtime.manage denial blocks owner direct DELETE");
  assert.deepEqual(await snapshot(companyA), beforeRevokedOvertimePermission, "explicit overtime.manage denial has no authorization or audit side effects");
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", ownerA.memberships[0].id).eq("permission_code", "overtime.manage");

  const beforeBlockedRuleDeletion = await snapshot(companyA);
  response = await request(`/api/schedules/rules/${laborRuleA.id}?companyId=${companyA}`, { user: adminA, method: "DELETE" }); assert.equal(response.status, 409);
  assert.deepEqual(await snapshot(companyA), beforeBlockedRuleDeletion, "a rule referenced by overtime history cannot be deleted or generate a denial audit event");
  const directDeleteRule = await ownerA.client.from("labor_rule_sets").delete().eq("id", laborRuleB.id).select("id");
  assert.ok(directDeleteRule.error?.code === "42501" || (directDeleteRule.data ?? []).length === 0, "even owner cannot directly delete labor rules around the guarded RPC");
  response = await request(`/api/schedules/rules/${laborRuleB.id}?companyId=${companyB}`, { user: adminB, method: "DELETE" }); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()), { status: "deleted" }, "authorized unused rule can be deleted through guarded RPC");
  const remainingRuleA = await service.from("labor_rule_sets").select("id").eq("id", laborRuleA.id).single();
  assert.equal(remainingRuleA.data.id, laborRuleA.id, "blocked historical rule remains available");
  const beforeAuthorizedOvertimeDelete = await snapshot(companyA);
  const authorizedOvertimeDelete = await ownerA.client.from("overtime_authorizations").delete().eq("id", authFixture.data.id).select("id").single();
  assert.equal(authorizedOvertimeDelete.data.id, authFixture.data.id, "owner with overtime.manage can directly delete an authorization");
  assert.equal((await snapshot(companyA)).overtime_authorizations.length, beforeAuthorizedOvertimeDelete.overtime_authorizations.length - 1, "authorized direct delete removes only its own synthetic authorization");
  process.stdout.write("PASS labor-rule Auth/RLS, effective-date overlap, guarded historical deletion, overtime read scope, direct overtime.manage writes, tenant isolation and snapshots\n");

  // Attendance read APIs, scanner device gate, correction RLS, and rejected
  // operation snapshots. Scanner requests use a dummy well-shaped QR and PIN,
  // but an invalid device is rejected before QR/PIN validation in the RPC.
  const today = new Date().toISOString().slice(0, 10);
  response = await request(`/api/attendance?companyId=${companyA}&from=${today}&to=${today}`); assert.equal(response.status, 401);
  response = await request(`/api/attendance/${attendanceSessionA}?companyId=${companyA}`); assert.equal(response.status, 401);
  response = await request(`/api/attendance?companyId=${companyA}&from=${today}&to=${today}`, { user: employeeA }); assert.equal(response.status, 403);
  response = await request(`/api/attendance?companyId=${companyA}&from=${today}&to=${today}`, { user: supervisorA }); assert.equal(response.status, 403);
  response = await request(`/api/attendance?companyId=${companyB}&from=${today}&to=${today}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request(`/api/attendance?from=${today}&to=${today}`, { user: multiAdmin }); assert.equal(response.status, 400);
  response = await request(`/api/attendance?companyId=${companyA}&from=${today}&to=${today}`, { user: adminA }); assert.equal(response.status, 200);
  const attendanceA = await response.json();
  assert.ok(attendanceA.items.some((item) => item.sessionId === attendanceSessionA || item.session_id === attendanceSessionA));
  assert.equal(attendanceA.items.some((item) => item.sessionId === attendanceSessionB || item.session_id === attendanceSessionB), false, "attendance listing excludes a different company");
  response = await request(`/api/attendance?companyId=${companyA}&branchId=${branchA}&from=${today}&to=${today}`, { user: adminA }); assert.equal(response.status, 200);
  const branchAttendance = await response.json();
  assert.ok(branchAttendance.items.some((item) => item.sessionId === attendanceSessionA || item.session_id === attendanceSessionA));
  assert.equal(branchAttendance.items.some((item) => item.sessionId === foreignBranchSession || item.session_id === foreignBranchSession), false, "branch filter excludes another synthetic branch");
  response = await request(`/api/attendance?companyId=${companyA}&branchId=${branchB}&from=${today}&to=${today}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request(`/api/attendance/${attendanceSessionA}?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  response = await request(`/api/attendance/${attendanceSessionB}?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 404);
  response = await request(`/api/attendance/${attendanceSessionA}?companyId=${companyB}`, { user: adminB }); assert.equal(response.status, 404);
  response = await request(`/api/attendance?companyId=${companyA}&from=bad&to=${today}`, { user: adminA }); assert.equal(response.status, 400);

  const beforeScanDenialsA = await snapshot(companyA), beforeScanDenialsB = await snapshot(companyB);
  response = await request("/api/attendance/scan", { method: "POST", body: { action: "preview", companyId: companyA, qrToken: "x".repeat(40), pin: "123456" } }); assert.equal(response.status, 401);
  response = await request("/api/attendance/scan", { user: employeeA, method: "POST", body: { action: "preview", companyId: companyA, qrToken: "x".repeat(40), pin: "123456" } }); assert.equal(response.status, 403);
  response = await request("/api/attendance/scan", { user: supervisorA, method: "POST", cookieExtra: `qr_device_${companyA}=invalid-synthetic-device`, body: { action: "preview", companyId: companyA, qrToken: "x".repeat(40), pin: "123456" } }); assert.equal(response.status, 403);
  assert.deepEqual(await snapshot(companyA), beforeScanDenialsA, "scanner rejects anonymous, employee, and unauthorized-device requests without attendance, PIN, or audit side effects");
  assert.deepEqual(await snapshot(companyB), beforeScanDenialsB, "scanner denial cannot modify another company");

  // Schedule endpoints: real Auth sessions, company selection, branch scope,
  // role/permission checks, direct RLS calls, and zero-write rejection snapshots.
  response = await request("/api/schedules"); assert.equal(response.status, 401);
  response = await request(`/api/schedules?companyId=${companyA}`, { user: supervisorA }); assert.equal(response.status, 403);
  response = await request(`/api/schedules?companyId=${companyA}`, { user: employeeA }); assert.equal(response.status, 403);
  response = await request(`/api/schedules?companyId=${companyB}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request("/api/schedules", { user: multiAdmin }); assert.equal(response.status, 400);
  response = await request(`/api/schedules?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  const schedulesA = await response.json();
  assert.equal(schedulesA.items.some((item) => item.branch_id === branchB), false, "schedule listing does not expose another company");
  response = await request(`/api/schedules?companyId=${companyB}`, { user: multiAdmin }); assert.equal(response.status, 200);
  assert.equal((await response.json()).items.some((item) => item.branch_id === branchA), false, "multi-company selection scopes schedule results");

  const schedulePayload = (branchId, name) => ({ branchId, name, kind: "fixed", workdayType: "day", entryToleranceMinutes: 5, effectiveFrom: today, effectiveTo: null, revisionOf: null, days: [{ weekday: 1, start: "09:00", end: "17:00", breaks: [{ name: "Comida sintética", start: "12:00", end: "12:30", countsAsWork: false, requiresQr: false, required: false, maxMinutes: null }] }] });
  const beforeScheduleSetupA = await snapshot(companyA), beforeScheduleSetupB = await snapshot(companyB);
  response = await request(`/api/schedules?companyId=${companyA}`, { user: adminA, method: "POST", body: schedulePayload(branchB, `Rejected ${randomUUID()}`) }); assert.equal(response.status, 422);
  response = await request(`/api/schedules?companyId=${companyA}`, { user: adminA, method: "POST", body: { branchId: branchA, name: "" } }); assert.equal(response.status, 422);
  assert.deepEqual(await snapshot(companyA), beforeScheduleSetupA, "invalid and cross-company schedule creation has no side effects");
  assert.deepEqual(await snapshot(companyB), beforeScheduleSetupB, "cross-company schedule creation cannot modify the target tenant");

  const deniedSchedulePermission = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "schedules.manage", allowed: false });
  if (deniedSchedulePermission.error) throw new Error("could not prepare synthetic schedules.manage denial");
  const beforeSchedulePermissionDenial = await snapshot(companyA);
  response = await request(`/api/schedules?companyId=${companyA}`, { user: adminA, method: "POST", body: schedulePayload(branchA, `Denied ${randomUUID()}`) }); assert.equal(response.status, 403);
  assert.deepEqual(await snapshot(companyA), beforeSchedulePermissionDenial, "API schedule denial leaves templates, assignments, and audit unchanged");
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "schedules.manage");

  response = await request(`/api/schedules?companyId=${companyA}`, { user: adminA, method: "POST", body: schedulePayload(branchA, `Synthetic A ${randomUUID()}`) }); assert.equal(response.status, 201);
  const templateA = (await response.json()).item;
  response = await request(`/api/schedules?companyId=${companyB}`, { user: adminB, method: "POST", body: schedulePayload(branchB, `Synthetic B ${randomUUID()}`) }); assert.equal(response.status, 201);
  const templateB = (await response.json()).item;
  assert.equal((await service.from("schedule_templates").select("company_id").eq("id", templateA.id).single()).data.company_id, companyA);
  assert.equal((await service.from("schedule_templates").select("company_id").eq("id", templateB.id).single()).data.company_id, companyB);

  // Direct PostgREST writes exercise the table policies independently of the
  // API's transactional RPC. First prove all four table paths still work with
  // schedules.manage, then revoke only that permission while company.read
  // remains granted and prove insert/update are blocked by RLS.
  const companyReadBeforeOverride = await adminA.client.from("companies").select("id").eq("id", companyA).single();
  assert.deepEqual(companyReadBeforeOverride.data, { id: companyA }, "admin retains company.read before the schedule permission override");
  const directTemplate = await adminA.client.from("schedule_templates").insert({ company_id: companyA, branch_id: branchA, name: `Direct allowed ${randomUUID()}`, kind: "fixed" }).select("id").single();
  assert.ok(!directTemplate.error && directTemplate.data?.id, "authorized direct insert succeeds for schedule_templates");
  const directDay = await adminA.client.from("schedule_template_days").insert({ company_id: companyA, template_id: directTemplate.data.id, iso_weekday: 2, start_local: "09:00", end_local: "17:00", scheduled_minutes: 480 }).select("id").single();
  assert.ok(!directDay.error && directDay.data?.id, "authorized direct insert succeeds for schedule_template_days");
  const directRule = await service.from("break_rules").insert({ company_id: companyA, code: `DIRECT_${randomUUID().slice(0, 8)}`, name: "Regla sintética directa", effective_from: today, counts_as_work: false, required: false }).select("id").single();
  if (directRule.error || !directRule.data?.id) throw new Error("failed to prepare synthetic break rule for direct RLS checks");
  const directBreak = await adminA.client.from("schedule_template_breaks").insert({ company_id: companyA, template_day_id: directDay.data.id, break_rule_id: directRule.data.id, planned_start_local: "12:00", planned_end_local: "12:30", planned_minutes: 30 }).select("id").single();
  assert.ok(!directBreak.error && directBreak.data?.id, "authorized direct insert succeeds for schedule_template_breaks");
  const assignmentTemplate = await service.from("schedule_templates").insert({ company_id: companyA, branch_id: branchA, name: `Assignment fixture ${randomUUID()}`, kind: "fixed" }).select("id").single();
  if (assignmentTemplate.error || !assignmentTemplate.data?.id) throw new Error("failed to prepare synthetic assignment template");
  const assignmentDay = await service.from("schedule_template_days").insert({ company_id: companyA, template_id: assignmentTemplate.data.id, iso_weekday: 3, start_local: "09:00", end_local: "17:00", scheduled_minutes: 480 }).select("id").single();
  if (assignmentDay.error || !assignmentDay.data?.id) throw new Error("failed to prepare synthetic assignment day");
  const directAssignmentEmployee = await service.from("employees").insert({ company_id: companyA, employee_number: `DIRECT-${randomBytes(4).toString("hex")}`, first_name: "Synthetic", last_name: "Direct assignment", branch_id: branchA, active: true }).select("id").single();
  if (directAssignmentEmployee.error || !directAssignmentEmployee.data?.id) throw new Error("failed to prepare synthetic employee for direct assignment RLS checks");
  const directAssignment = await adminA.client.from("schedule_assignments").insert({ company_id: companyA, employee_id: directAssignmentEmployee.data.id, template_id: assignmentTemplate.data.id, branch_id: branchA, starts_on: "2095-01-01", ends_on: "2095-12-31", timezone: "America/Mexico_City", kind: "fixed", planned_start_local: "09:00", planned_end_local: "17:00", planned_minutes: 480 }).select("id").single();
  assert.ok(!directAssignment.error && directAssignment.data?.id, `authorized direct insert succeeds for schedule_assignments (${directAssignment.error?.code ?? "ok"}: ${directAssignment.error?.message ?? ""})`);
  const validTemplateUpdate = await adminA.client.from("schedule_templates").update({ name: `Direct updated ${randomUUID()}` }).eq("id", directTemplate.data.id).select("id").single();
  assert.ok(!validTemplateUpdate.error && validTemplateUpdate.data?.id, "authorized direct update succeeds for schedule_templates");
  const validDayUpdate = await adminA.client.from("schedule_template_days").update({ scheduled_minutes: 479 }).eq("id", directDay.data.id).select("id").single();
  assert.ok(!validDayUpdate.error && validDayUpdate.data?.id, "authorized direct update succeeds for schedule_template_days");
  const validAssignmentUpdate = await adminA.client.from("schedule_assignments").update({ ends_on: "2095-11-30" }).eq("id", directAssignment.data.id).select("id").single();
  assert.ok(!validAssignmentUpdate.error && validAssignmentUpdate.data?.id, "authorized direct update succeeds for schedule_assignments");
  const validBreakUpdate = await adminA.client.from("schedule_template_breaks").update({ planned_start_local: "12:15" }).eq("id", directBreak.data.id).select("id").single();
  assert.ok(!validBreakUpdate.error && validBreakUpdate.data?.id, "authorized direct update succeeds for schedule_template_breaks");

  const directBreakRuleDenied = await service.from("break_rules").insert({ company_id: companyA, code: `DENIED_${randomUUID().slice(0, 8)}`, name: "Regla sintética para rechazo", effective_from: today, counts_as_work: false, required: false }).select("id").single();
  if (directBreakRuleDenied.error || !directBreakRuleDenied.data?.id) throw new Error("failed to prepare second synthetic break rule for denied insert");
  const beforeDirectRlsDenialsA = await snapshot(companyA), beforeDirectRlsDenialsB = await snapshot(companyB);
  const revokedSchedulePermission = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "schedules.manage", allowed: false });
  if (revokedSchedulePermission.error) throw new Error("could not revoke synthetic admin schedules.manage permission");
  const companyReadAfterOverride = await adminA.client.from("companies").select("id").eq("id", companyA).single();
  assert.deepEqual(companyReadAfterOverride.data, { id: companyA }, "company.read remains permitted while schedules.manage is explicitly denied");
  const assertDeniedRlsWrite = (result, label) => {
    if (result.error) assert.equal(result.error.code, "42501", `${label} returns SQLSTATE 42501`);
    else assert.equal((result.data ?? []).length, 0, `${label} affects no rows under RLS`);
  };
  const deniedTemplateInsert = await adminA.client.from("schedule_templates").insert({ company_id: companyA, branch_id: branchA, name: `Direct denied ${randomUUID()}`, kind: "fixed" }).select("id");
  assertDeniedRlsWrite(deniedTemplateInsert, "schedule_templates insert");
  const deniedDayInsert = await adminA.client.from("schedule_template_days").insert({ company_id: companyA, template_id: directTemplate.data.id, iso_weekday: 7, start_local: "10:00", end_local: "18:00", scheduled_minutes: 480 }).select("id");
  assertDeniedRlsWrite(deniedDayInsert, "schedule_template_days insert");
  const deniedAssignmentInsert = await adminA.client.from("schedule_assignments").insert({ company_id: companyA, employee_id: directAssignmentEmployee.data.id, template_id: assignmentTemplate.data.id, branch_id: branchA, starts_on: "2096-01-01", ends_on: "2096-12-31", timezone: "America/Mexico_City", kind: "fixed", planned_start_local: "10:00", planned_end_local: "18:00", planned_minutes: 480 }).select("id");
  assert.ok(deniedAssignmentInsert.error?.code === "42501" || deniedAssignmentInsert.error?.code === "23503", "schedule_assignments insert is rejected by permission RLS or its authorization-aware template guard");
  const deniedBreakInsert = await adminA.client.from("schedule_template_breaks").insert({ company_id: companyA, template_day_id: directDay.data.id, break_rule_id: directBreakRuleDenied.data.id, planned_start_local: "13:00", planned_end_local: "13:30", planned_minutes: 30 }).select("id");
  assertDeniedRlsWrite(deniedBreakInsert, "schedule_template_breaks insert");

  const deniedTemplateUpdate = await adminA.client.from("schedule_templates").update({ name: `Denied update ${randomUUID()}` }).eq("id", directTemplate.data.id).select("id");
  assertDeniedRlsWrite(deniedTemplateUpdate, "schedule_templates update");
  const deniedDayUpdate = await adminA.client.from("schedule_template_days").update({ scheduled_minutes: 479 }).eq("id", directDay.data.id).select("id");
  assertDeniedRlsWrite(deniedDayUpdate, "schedule_template_days update");
  const deniedAssignmentUpdate = await adminA.client.from("schedule_assignments").update({ ends_on: "2095-10-31" }).eq("id", directAssignment.data.id).select("id");
  assertDeniedRlsWrite(deniedAssignmentUpdate, "schedule_assignments update");
  const deniedBreakUpdate = await adminA.client.from("schedule_template_breaks").update({ planned_start_local: "12:15" }).eq("id", directBreak.data.id).select("id");
  assertDeniedRlsWrite(deniedBreakUpdate, "schedule_template_breaks update");
  assert.deepEqual(await snapshot(companyA), beforeDirectRlsDenialsA, "direct schedule insert/update denials leave company A data and audit unchanged");
  assert.deepEqual(await snapshot(companyB), beforeDirectRlsDenialsB, "direct schedule denials leave company B data and audit unchanged");
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "schedules.manage");
  process.stdout.write("PASS direct inserts and updates on all four schedule tables require schedules.manage; valid direct inserts remain available to authorized admins\n");

  response = await request(`/api/schedules?companyId=${companyA}&branchId=${otherBranchA}`, { user: adminA }); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, [], "branch filter returns no schedules from an unselected branch");
  response = await request(`/api/schedules/${templateA.id}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { active: false } }); assert.equal(response.status, 200);
  assert.equal((await response.json()).item.active, false);
  response = await request(`/api/schedules/${templateA.id}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { active: true } }); assert.equal(response.status, 200);
  assert.equal((await response.json()).item.active, true);

  response = await request(`/api/schedules/assignments?companyId=${companyA}`, { user: employeeA, method: "POST", body: { branchId: branchA, templateId: templateA.id, employeeIds: [employeeA.employeeId], startsOn: today, endsOn: null } }); assert.equal(response.status, 403);
  response = await request(`/api/schedules/assignments?companyId=${companyA}`, { method: "POST", body: { branchId: branchA, templateId: templateA.id, employeeIds: [employeeA.employeeId], startsOn: today, endsOn: null } }); assert.equal(response.status, 401);
  const beforeForeignAssignmentA = await snapshot(companyA), beforeForeignAssignmentB = await snapshot(companyB);
  response = await request(`/api/schedules/assignments?companyId=${companyA}`, { user: adminA, method: "POST", body: { branchId: branchB, templateId: templateB.id, employeeIds: [employeeB.employeeId], startsOn: today, endsOn: null } }); assert.equal(response.status, 422);
  response = await request(`/api/schedules/assignments?companyId=${companyA}`, { user: adminA, method: "POST", body: { branchId: otherBranchA, templateId: templateA.id, employeeIds: [employeeA.employeeId], startsOn: today, endsOn: null } }); assert.equal(response.status, 422);
  response = await request(`/api/schedules/${templateB.id}?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { active: false } }); assert.equal(response.status, 404);
  assert.deepEqual(await snapshot(companyA), beforeForeignAssignmentA, "foreign template, employee, branch, and schedule IDs cannot create/update tenant A data");
  assert.deepEqual(await snapshot(companyB), beforeForeignAssignmentB, "rejected assignment and update cannot mutate tenant B");

  const beforeSupervisorScheduleDenial = await snapshot(companyA);
  const supervisorScheduleRpc = await supervisorA.client.rpc("save_schedule_template", {
    p_company_id: companyA, p_branch_id: branchA, p_name: `Denied supervisor ${randomUUID()}`, p_kind: "fixed", p_workday_type: "day",
    p_entry_tolerance_minutes: 0, p_effective_from: today, p_effective_to: null,
    p_days: [{ weekday: 1, start_local: "09:00", end_local: "17:00", scheduled_minutes: 480, breaks: [] }], p_revision_of: null,
  });
  assert.equal(supervisorScheduleRpc.error?.code, "42501", "supervisor role cannot call schedule management RPC without schedules.manage");
  assert.deepEqual(await snapshot(companyA), beforeSupervisorScheduleDenial, "role-denied schedule RPC leaves schedules and audit unchanged");
  await service.from("company_memberships").update({ active: false }).eq("id", supervisorA.memberships[0].id);
  const beforeRevokedSupervisorWrite = await snapshot(companyA);
  const revokedSupervisorAdjustment = await supervisorA.client.from("attendance_adjustments").insert({ company_id: companyA, session_id: attendanceSessionA, requested_by: supervisorA.userId, reason: "Synthetic revoked correction", proposed_events: [] });
  assert.equal(revokedSupervisorAdjustment.error?.code, "42501", "revoked supervisor membership cannot submit corrections");
  assert.deepEqual(await snapshot(companyA), beforeRevokedSupervisorWrite, "revoked membership cannot alter corrections or audit");
  await service.from("company_memberships").update({ active: true }).eq("id", supervisorA.memberships[0].id);

  response = await request(`/api/schedules/assignments?companyId=${companyA}`, { user: adminA, method: "POST", body: { branchId: branchA, templateId: templateA.id, employeeIds: [employeeA.employeeId], startsOn: today, endsOn: null } }); assert.equal(response.status, 201);
  response = await request(`/api/schedules/assignments?companyId=${companyA}&employeeId=${employeeB.employeeId}`, { user: adminA }); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, [], "assignment lookup does not disclose an employee from another tenant");
  const monday = new Date(`${today}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);
  response = await request(`/api/schedules/calendar?companyId=${companyA}&weekStart=${weekStart}&branchId=${branchA}`, { user: adminA }); assert.equal(response.status, 200);
  const calendar = await response.json();
  assert.equal(calendar.weekStart, weekStart);
  assert.ok(calendar.days.some((day) => day.rows.some((row) => row.employee.id === employeeA.employeeId && row.assignment?.templateName === templateA.name)));
  assert.equal(response.headers.get("cache-control"), "no-store", "schedule calendar responses are not cached");
  assert.equal(calendar.days.flatMap((day) => day.rows).some((row) => row.employee.id === employeeB.employeeId), false, "calendar does not disclose another tenant's employees");
  assert.ok(calendar.branches.every((branch) => branch.active), "calendar branch metadata excludes inactive branches");

  const calendarQuery = (companyId, start = weekStart, selectedBranch = branchA) =>
    `/api/schedules/calendar?companyId=${companyId}&weekStart=${start}${selectedBranch ? `&branchId=${selectedBranch}` : ""}`;
  const beforeCalendarDenialsA = await snapshot(companyA), beforeCalendarDenialsB = await snapshot(companyB);
  response = await request(calendarQuery(companyA)); assert.equal(response.status, 401, "anonymous calendar request is denied");
  response = await request(calendarQuery(companyA), { user: employeeA }); assert.equal(response.status, 403, "employee cannot read admin schedule calendar");
  response = await request(calendarQuery(companyA), { user: supervisorA }); assert.equal(response.status, 403, "supervisor without admin schedule scope is denied");
  response = await request(calendarQuery(companyA), { user: adminB }); assert.ok([403, 404].includes(response.status), "another tenant's admin cannot read tenant A calendar");
  response = await request(calendarQuery(companyA, weekStart, branchB), { user: adminA });
  assert.equal(response.status, 200, "foreign branch filter is safely scoped to the selected tenant");
  const foreignBranchCalendar = await response.json();
  assert.ok(foreignBranchCalendar.days.every((day) => day.rows.length === 0), "foreign branch filter returns no schedule rows");
  assert.ok(foreignBranchCalendar.branches.every((branch) => branch.id !== branchB), "foreign branch metadata is not disclosed");
  response = await request(calendarQuery(companyA, weekStart, inactiveBranchA), { user: adminA });
  assert.equal(response.status, 200, "inactive branch filter is safely scoped");
  const inactiveBranchCalendar = await response.json();
  assert.ok(inactiveBranchCalendar.days.every((day) => day.rows.length === 0), "inactive branch filter returns no schedule rows");
  assert.ok(inactiveBranchCalendar.branches.every((branch) => branch.id !== inactiveBranchA), "inactive branch metadata is excluded");
  response = await request(calendarQuery(companyA, "2026-02-30", branchA), { user: adminA }); assert.equal(response.status, 400, "impossible calendar date is rejected");
  const nonMonday = new Date(`${weekStart}T00:00:00.000Z`);
  nonMonday.setUTCDate(nonMonday.getUTCDate() + 1);
  response = await request(calendarQuery(companyA, nonMonday.toISOString().slice(0, 10), branchA), { user: adminA }); assert.equal(response.status, 400, "calendar week must start on Monday");
  response = await request(calendarQuery(companyA, weekStart, "not-a-uuid"), { user: adminA }); assert.equal(response.status, 400, "malformed branch filter is rejected");
  assert.deepEqual(await snapshot(companyA), beforeCalendarDenialsA, "calendar denials and non-matching filters do not mutate tenant A");
  assert.deepEqual(await snapshot(companyB), beforeCalendarDenialsB, "calendar denials and non-matching filters do not mutate tenant B");

  const inactiveAdmin = await createHttpUser("inactive-admin", "admin", companyA);
  await service.from("company_memberships").update({ active: false }).eq("id", inactiveAdmin.memberships[0].id);
  const beforeInactiveAdmin = await snapshot(companyA);
  response = await request(`/api/schedules?companyId=${companyA}`, { user: inactiveAdmin }); assert.equal(response.status, 403);
  response = await request(`/api/attendance?companyId=${companyA}&from=${today}&to=${today}`, { user: inactiveAdmin }); assert.equal(response.status, 403);
  assert.deepEqual(await snapshot(companyA), beforeInactiveAdmin, "revoked admin membership cannot read or mutate schedule data");
  process.stdout.write("PASS attendance, scanner, correction-RLS, and schedule HTTP/Auth matrix enforces tenant/branch/role/permission boundaries with zero-write rejection snapshots\n");

  // Employee and branch routes were previously covered only by static/unit
  // checks. Exercise their real SSR Auth boundary and tenant/branch scoping.
  response = await request("/api/employees"); assert.equal(response.status, 401);
  response = await request("/api/employees", { user: supervisorA }); assert.equal(response.status, 403);
  response = await request("/api/employees", { user: adminA }); assert.equal(response.status, 200);
  const employeesA = await response.json();
  assert.ok(employeesA.items.some((item) => item.id === employeeA.employeeId));
  assert.equal(employeesA.items.some((item) => item.id === employeeB.employeeId), false, "employee listing does not disclose another tenant");
  response = await request(`/api/employees?branchId=${branchB}`, { user: adminA }); assert.equal(response.status, 403);
  response = await request(`/api/employees/${employeeB.employeeId}`, { user: adminA }); assert.equal(response.status, 404);
  const beforeEmployeeDenialsA = await snapshot(companyA), beforeEmployeeDenialsB = await snapshot(companyB);
  response = await request("/api/employees", { user: adminA, method: "POST", body: { employee_number: `CROSS-${randomUUID()}`, first_name: "Synthetic", last_name: "Rejected", branch_id: branchB } });
  assert.equal(response.status, 422, "employee creation rejects a branch from another company");
  response = await request(`/api/employees/${employeeB.employeeId}`, { user: adminA, method: "PATCH", body: { first_name: "Cross Tenant Mutation" } }); assert.equal(response.status, 404);
  response = await request(`/api/employees/${employeeA.employeeId}`, { user: adminA, method: "PATCH", body: { branch_id: branchB } }); assert.equal(response.status, 422);
  assert.deepEqual(await snapshot(companyA), beforeEmployeeDenialsA, "rejected employee requests leave tenant A unchanged");
  assert.deepEqual(await snapshot(companyB), beforeEmployeeDenialsB, "rejected employee requests leave tenant B unchanged");

  response = await request("/api/branches"); assert.equal(response.status, 401);
  response = await request("/api/branches", { user: supervisorA }); assert.equal(response.status, 403);
  response = await request("/api/branches", { user: adminA }); assert.equal(response.status, 200);
  const branchesA = await response.json();
  assert.ok(branchesA.items.some((item) => item.id === branchA));
  assert.equal(branchesA.items.some((item) => item.id === branchB), false, "branch listing does not disclose another tenant");
  const noBranchManage = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "company.manage", allowed: false });
  if (noBranchManage.error) throw new Error("could not prepare synthetic branch-management denial");
  const beforeBranchDenial = await snapshot(companyA);
  response = await request("/api/branches", { user: adminA, method: "POST", body: { name: `Denied Branch ${randomUUID()}`, timezone: "UTC" } }); assert.equal(response.status, 403);
  assert.deepEqual(await snapshot(companyA), beforeBranchDenial, "company.manage denial cannot create a branch");
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "company.manage");
  response = await request("/api/branches", { user: adminA, method: "PATCH", body: { id: branchB, active: false } }); assert.equal(response.status, 404);
  assert.equal((await service.from("branches").select("active").eq("id", branchB).single()).data.active, true, "cross-tenant branch update leaves the target active");
  process.stdout.write("PASS employee and branch APIs enforce anonymous/role checks, tenant and branch boundaries, company.manage, and zero-write rejections\n");

  // Supervisors and device-management APIs must scope rows by the selected
  // company and enforce the devices.manage permission inside the RPC layer.
  response = await request("/api/supervisors"); assert.equal(response.status, 401);
  response = await request("/api/supervisors", { user: supervisorA }); assert.equal(response.status, 403);
  response = await request("/api/supervisors", { user: adminA }); assert.equal(response.status, 200);
  const supervisorList = (await response.json()).data;
  assert.ok(supervisorList.supervisors.some((item) => item.membershipId === supervisorA.memberships[0].id));
  assert.equal(supervisorList.supervisors.some((item) => item.membershipId === supervisorB.memberships[0].id), false, "supervisor listing does not disclose another tenant");
  response = await request("/api/supervisors", { user: adminA, method: "PATCH", body: { membershipId: supervisorB.memberships[0].id, branchId: branchB, assigned: true } }); assert.equal(response.status, 409);
  assert.deepEqual(await snapshot(companyA), beforeBranchDenial, "foreign supervisor assignment rejection creates no supervisor branch or audit row");
  response = await request("/api/supervisors", { user: adminA, method: "PATCH", body: { membershipId: supervisorA.memberships[0].id, branchId: branchA, assigned: true } }); assert.equal(response.status, 200);
  const assignedSupervisor = (await response.json()).data;
  assert.equal(assignedSupervisor.assigned, true);
  assert.deepEqual((await service.from("supervisor_branches").select("company_id,branch_id").eq("membership_id", supervisorA.memberships[0].id).single()).data, { company_id: companyA, branch_id: branchA });
  response = await request("/api/employees", { user: adminA, method: "POST", body: { employee_number: `HTTP-CREATED-${randomUUID()}`, first_name: "Synthetic", last_name: "Created", branch_id: branchA } }); assert.equal(response.status, 201);
  const createdEmployee = (await response.json()).item;
  assert.equal(createdEmployee.branch_id, branchA);
  assert.equal((await service.from("employees").select("company_id,branch_id").eq("id", createdEmployee.id).single()).data.company_id, companyA);
  response = await request("/api/branches", { user: adminA, method: "POST", body: { name: `HTTP Created ${randomUUID()}`, timezone: "UTC" } }); assert.equal(response.status, 201);
  const createdBranch = (await response.json()).item;
  assert.equal((await service.from("branches").select("company_id").eq("id", createdBranch.id).single()).data.company_id, companyA);
  response = await request("/api/supervisor-devices"); assert.equal(response.status, 401);
  response = await request("/api/supervisor-devices", { user: supervisorA }); assert.equal(response.status, 403);
  response = await request("/api/supervisor-devices", { user: adminA }); assert.equal(response.status, 200);
  const deviceLists = await response.json(); assert.ok(Array.isArray(deviceLists.requests) && Array.isArray(deviceLists.devices));
  const noDeviceManage = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "devices.manage", allowed: false });
  if (noDeviceManage.error) throw new Error("could not prepare synthetic device-management denial");
  response = await request("/api/supervisor-devices", { user: adminA }); assert.equal(response.status, 403);
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "devices.manage");

  // Employee QR credentials and PIN administration: use only synthetic
  // employees, never verify a wrong PIN or modify lockout state.
  const qrPath = `/api/employees/${employeeA.employeeId}/qr?companyId=${companyA}`;
  const pinPath = `/api/employees/${employeeA.employeeId}/pin?companyId=${companyA}`;
  const beforeCredentialDenialsA = await snapshot(companyA), beforeCredentialDenialsB = await snapshot(companyB);
  response = await request(qrPath); assert.equal(response.status, 401);
  response = await request(qrPath, { user: employeeA }); assert.equal(response.status, 403);
  response = await request(qrPath, { user: inactiveAdmin }); assert.equal(response.status, 403, "inactive admin membership cannot read credential status");
  response = await request(`/api/employees/${employeeA.employeeId}/qr?companyId=${companyA}`, { user: adminB }); assert.equal(response.status, 403);
  response = await request(`/api/employees/${employeeB.employeeId}/qr?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 404);
  response = await request(pinPath, { method: "PUT", body: { pin: "123456" } }); assert.equal(response.status, 401);
  response = await request(pinPath, { user: employeeA, method: "PUT", body: { pin: "123456" } }); assert.equal(response.status, 403);
  response = await request(`/api/employees/${employeeB.employeeId}/pin?companyId=${companyA}`, { user: adminA, method: "PUT", body: { pin: "123456" } }); assert.equal(response.status, 404);
  response = await request(pinPath, { user: adminA, method: "PUT", body: { pin: "123" } }); assert.equal(response.status, 422);
  assert.deepEqual(await snapshot(companyA), beforeCredentialDenialsA, "anonymous, wrong-role, foreign-tenant, and malformed PIN/QR requests have no credential, lockout, or audit side effects");
  assert.deepEqual(await snapshot(companyB), beforeCredentialDenialsB, "cross-company credential requests do not alter the target tenant");

  const noEmployeeManage = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "employees.manage", allowed: false });
  if (noEmployeeManage.error) throw new Error("could not prepare synthetic employees.manage denial");
  const beforeCredentialPermissionDenial = await snapshot(companyA);
  response = await request(qrPath, { user: adminA, method: "POST", body: {} }); assert.equal(response.status, 403);
  response = await request(pinPath, { user: adminA, method: "PUT", body: { pin: "123456" } }); assert.equal(response.status, 403);
  const directCredentialDenied = await adminA.client.rpc("issue_employee_qr_token", { p_company_id: companyA, p_employee_id: employeeA.employeeId, p_token_hash_hex: createHash("sha256").update(randomBytes(32)).digest("hex"), p_replace: false });
  assert.equal(directCredentialDenied.error?.code, "42501", "direct QR issue RPC enforces employees.manage independently of the API");
  assert.deepEqual(await snapshot(companyA), beforeCredentialPermissionDenial, "employees.manage denial leaves QR/PIN credentials, lockout and audit unchanged");
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "employees.manage");

  const inactiveEmployee = await service.from("employees").insert({ company_id: companyA, branch_id: branchA, employee_number: `INACTIVE-${randomUUID()}`, first_name: "Synthetic", last_name: "Inactive", active: false }).select("id").single();
  if (inactiveEmployee.error || !inactiveEmployee.data) throw new Error("failed to create synthetic inactive employee");
  const beforeInactiveCredential = await snapshot(companyA);
  response = await request(`/api/employees/${inactiveEmployee.data.id}/qr?companyId=${companyA}`, { user: adminA, method: "POST", body: {} }); assert.equal(response.status, 409);
  response = await request(`/api/employees/${inactiveEmployee.data.id}/pin?companyId=${companyA}`, { user: adminA, method: "PUT", body: { pin: "123456" } }); assert.equal(response.status, 409);
  assert.deepEqual(await snapshot(companyA), beforeInactiveCredential, "inactive employees cannot receive QR credentials");

  response = await request(qrPath, { user: adminA }); assert.equal(response.status, 200);
  const qrStatus = await response.json();
  assert.deepEqual(qrStatus.credential, { employeeActive: true, qrStatus: "not_issued", issuedAt: null, revokedAt: null, pinConfigured: false });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(JSON.stringify(qrStatus).includes("token_hash"), false);
  const issuedQrResponse = await request(qrPath, { user: adminA, method: "POST", body: {} }); assert.equal(issuedQrResponse.status, 200);
  assert.equal(issuedQrResponse.headers.get("cache-control"), "no-store, private");
  const issuedQr = await issuedQrResponse.json(); assert.match(issuedQr.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(issuedQr.credential).includes(issuedQr.token), false, "QR status payload does not repeat the one-time token");
  const issuedQrHash = createHash("sha256").update(issuedQr.token).digest("hex");
  const storedQrHash = (await dbPool.query("select encode(token_hash,'hex') hash from private.employee_qr_tokens where employee_id=$1", [employeeA.employeeId])).rows[0]?.hash;
  assert.equal(storedQrHash, issuedQrHash, "database stores only the SHA-256 QR token hash");
  assert.notEqual(storedQrHash, issuedQr.token);
  const beforeDuplicateQr = await snapshot(companyA);
  response = await request(qrPath, { user: adminA, method: "POST", body: {} }); assert.equal(response.status, 409);
  assert.deepEqual(await snapshot(companyA), beforeDuplicateQr, "duplicate QR issue without replace has no side effects");
  const regeneratedQrResponse = await request(qrPath, { user: adminA, method: "POST", body: { replace: true } }); assert.equal(regeneratedQrResponse.status, 200);
  const regeneratedQr = await regeneratedQrResponse.json(); assert.notEqual(regeneratedQr.token, issuedQr.token);
  const regeneratedHash = createHash("sha256").update(regeneratedQr.token).digest("hex");
  assert.equal((await dbPool.query("select encode(token_hash,'hex') hash from private.employee_qr_tokens where employee_id=$1", [employeeA.employeeId])).rows[0].hash, regeneratedHash);
  assert.equal(Number((await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_id=$2 and action in ('EMPLOYEE_QR_ISSUED','EMPLOYEE_QR_REGENERATED')", [companyA, employeeA.employeeId])).rows[0].n), 2);
  const repeatedQrHash = (await dbPool.query("select encode(token_hash,'hex') hash from private.employee_qr_tokens where employee_id=$1", [employeeA.employeeId])).rows[0].hash;
  response = await request(qrPath, { user: adminA, method: "DELETE" }); assert.equal(response.status, 200);
  assert.equal((await response.json()).credential.qrStatus, "revoked");
  assert.equal((await dbPool.query("select revoked_at is not null revoked from private.employee_qr_tokens where employee_id=$1", [employeeA.employeeId])).rows[0].revoked, true);
  const afterQrRevoke = await snapshot(companyA);
  response = await request(qrPath, { user: adminA, method: "DELETE" }); assert.equal(response.status, 200, "repeated QR revoke is an idempotent no-op");
  assert.deepEqual(await snapshot(companyA), afterQrRevoke, "repeated QR revoke creates no duplicate audit event");
  assert.equal((await dbPool.query("select encode(token_hash,'hex') hash from private.employee_qr_tokens where employee_id=$1", [employeeA.employeeId])).rows[0].hash, repeatedQrHash, "revocation preserves only the digest, never a raw token");
  process.stdout.write("PASS employee QR credential APIs enforce Auth/role/tenant/permission, one-time no-store token disclosure, replacement, revocation and hash-only persistence; PIN endpoint denials preserve lockout state\n");

  // Supervisor enrollment lifecycle with real local Auth cookies and direct
  // RPC checks. No attendance scan or PIN verification is performed here.
  const deviceRequestBody = { companyId: companyA, branchId: branchA, label: "Synthetic supervisor browser" };
  const beforeDeviceDenialsA = await snapshot(companyA), beforeDeviceDenialsB = await snapshot(companyB);
  response = await request("/api/supervisor/device-requests", { method: "POST", body: deviceRequestBody }); assert.equal(response.status, 401);
  response = await request("/api/supervisor/device-requests", { user: employeeA, method: "POST", body: deviceRequestBody }); assert.equal(response.status, 403);
  response = await request("/api/supervisor/device-requests", { user: adminA, method: "POST", body: deviceRequestBody }); assert.equal(response.status, 403);
  response = await request("/api/supervisor/device-requests", { user: supervisorA, method: "POST", body: { ...deviceRequestBody, branchId: branchB } }); assert.equal(response.status, 403);
  response = await request("/api/supervisor/device-requests", { user: supervisorA, method: "POST", body: { ...deviceRequestBody, companyId: companyB, branchId: branchB } }); assert.equal(response.status, 403, "supervisor cannot create a device request by selecting another tenant");
  response = await request("/api/supervisor/device-requests", { user: supervisorA, method: "POST", body: { ...deviceRequestBody, label: "   " } }); assert.equal(response.status, 422);
  const forbiddenDeviceRequest = await supervisorA.client.rpc("request_supervisor_device", { p_company_id: companyB, p_branch_id: branchB, p_label: "Cross tenant synthetic", p_challenge: randomBytes(32).toString("base64url") });
  assert.equal(forbiddenDeviceRequest.error?.code, "42501", "direct request RPC rejects a foreign company and branch");
  const forbiddenDeviceReview = await employeeA.client.rpc("review_supervisor_device_request", { p_company_id: companyA, p_request_id: randomUUID(), p_approve: true });
  assert.equal(forbiddenDeviceReview.error?.code, "42501", "direct review RPC rejects an employee without devices.manage");
  assert.deepEqual(await snapshot(companyA), beforeDeviceDenialsA, "anonymous, wrong-role, wrong-branch and malformed device requests create no request, device, or audit rows");
  assert.deepEqual(await snapshot(companyB), beforeDeviceDenialsB, "foreign-company device request has no cross-tenant side effects");

  const deviceRequestResponse = await request("/api/supervisor/device-requests", { user: supervisorA, method: "POST", body: deviceRequestBody });
  assert.equal(deviceRequestResponse.status, 200);
  const deviceRequestPayload = await deviceRequestResponse.json();
  const deviceRequestId = deviceRequestPayload.request?.requestId;
  assert.ok(deviceRequestId); assert.equal(deviceRequestPayload.request.status, "pending");
  assert.equal(JSON.stringify(deviceRequestPayload).includes("challenge"), false, "device enrollment response omits the raw challenge");
  const challengeCookieMatch = deviceRequestResponse.headers.get("set-cookie")?.match(new RegExp(`qr_enroll_${companyA}=([^;]+)`));
  assert.ok(challengeCookieMatch, "device enrollment challenge is returned only as an HttpOnly cookie");
  const challengeCookieHeader = deviceRequestResponse.headers.get("set-cookie") ?? "";
  assert.match(challengeCookieHeader, /HttpOnly/i); assert.match(challengeCookieHeader, /SameSite=Lax/i); assert.match(challengeCookieHeader, /Path=\/api/i);
  const enrollmentChallenge = decodeURIComponent(challengeCookieMatch[1]);
  assert.match(enrollmentChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(deviceRequestResponse.headers.get("cache-control"), "no-store");
  const storedChallengeHash = (await dbPool.query("select encode(challenge_hash,'hex') hash from private.device_authorization_requests where id=$1", [deviceRequestId])).rows[0].hash;
  assert.equal(storedChallengeHash, createHash("sha256").update(enrollmentChallenge).digest("hex"), "database stores only the device challenge hash");
  assert.notEqual(storedChallengeHash, enrollmentChallenge);
  const duplicateDeviceRequest = await request("/api/supervisor/device-requests", { user: supervisorA, method: "POST", cookieExtra: `qr_enroll_${companyA}=${encodeURIComponent(enrollmentChallenge)}`, body: deviceRequestBody });
  assert.equal(duplicateDeviceRequest.status, 200);
  assert.equal((await duplicateDeviceRequest.json()).request.requestId, deviceRequestId, "same browser challenge returns the existing pending request");
  assert.equal(Number((await dbPool.query("select count(*)::int n from private.device_authorization_requests where membership_id=$1 and challenge_hash=decode($2,'hex')", [supervisorA.memberships[0].id, storedChallengeHash])).rows[0].n), 1);

  const noDevicesManage = await service.from("membership_permission_overrides").insert({ company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "devices.manage", allowed: false });
  if (noDevicesManage.error) throw new Error("could not prepare synthetic devices.manage denial");
  const beforeDevicePermissionDenial = await snapshot(companyA);
  response = await request("/api/supervisor-devices?companyId=" + companyA, { user: adminA }); assert.equal(response.status, 403);
  response = await request("/api/supervisor-devices?companyId=" + companyA, { user: adminA, method: "PATCH", body: { requestId: deviceRequestId, approve: true } }); assert.equal(response.status, 403);
  const directReviewDenied = await adminA.client.rpc("review_supervisor_device_request", { p_company_id: companyA, p_request_id: deviceRequestId, p_approve: true });
  assert.equal(directReviewDenied.error?.code, "42501", "direct device review RPC enforces devices.manage");
  assert.deepEqual(await snapshot(companyA), beforeDevicePermissionDenial, "devices.manage denial leaves the pending request, device and audit unchanged");
  await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "devices.manage");

  const beforeForeignReviewA = await snapshot(companyA), beforeForeignReviewB = await snapshot(companyB);
  const foreignReview = await adminB.client.rpc("review_supervisor_device_request", { p_company_id: companyB, p_request_id: deviceRequestId, p_approve: true });
  assert.equal(foreignReview.error?.code, "P0002", "another tenant cannot resolve a request by foreign request ID");
  assert.deepEqual(await snapshot(companyA), beforeForeignReviewA);
  assert.deepEqual(await snapshot(companyB), beforeForeignReviewB);
  response = await request("/api/supervisor-devices?companyId=" + companyA, { user: adminA }); assert.equal(response.status, 200);
  const beforeDeviceApproval = await snapshot(companyA);
  response = await request("/api/supervisor-devices?companyId=" + companyA, { user: adminA, method: "PATCH", body: { requestId: deviceRequestId, approve: true } }); assert.equal(response.status, 200);
  const approved = (await response.json()).request; assert.equal(approved.status, "approved"); assert.ok(approved.deviceId);
  assert.equal(Number((await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_id=$2 and action='DEVICE_AUTHORIZATION_APPROVED'", [companyA, deviceRequestId])).rows[0].n), 1);
  const afterDeviceApproval = await snapshot(companyA);
  assert.notDeepEqual(afterDeviceApproval.devices, beforeDeviceApproval.devices, "approved request creates one authorized device");
  const repeatedReview = await adminA.client.rpc("review_supervisor_device_request", { p_company_id: companyA, p_request_id: deviceRequestId, p_approve: true });
  assert.equal(repeatedReview.error?.code, "23514", "reviewing an already resolved device request is rejected");
  assert.deepEqual(await snapshot(companyA), afterDeviceApproval, "repeated review creates no duplicate device or audit event");

  const redemption = await supervisorA.client.rpc("redeem_supervisor_device", { p_company_id: companyA, p_challenge: enrollmentChallenge });
  assert.equal(redemption.data?.status, "authorized");
  assert.equal(JSON.stringify(redemption.data).includes(enrollmentChallenge), false, "redemption does not return the device token");
  const deviceTokenHash = (await dbPool.query("select encode(token_hash,'hex') hash from private.device_token_hashes where device_id=$1", [approved.deviceId])).rows[0]?.hash;
  assert.equal(deviceTokenHash, storedChallengeHash, "device token table contains the challenge digest only");
  const scannerContext = await supervisorA.client.rpc("get_supervisor_scanner_context", { p_company_id: companyA, p_device_token: enrollmentChallenge });
  assert.equal(scannerContext.data?.authorized, true, "authorized challenge is the only device token accepted for its active supervisor and branch");
  const scannerContextPath = `/api/supervisor/scanner/context?companyId=${companyA}`;
  response = await request(scannerContextPath); assert.equal(response.status, 401, "anonymous scanner context is rejected");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  response = await request(scannerContextPath, { user: adminA }); assert.equal(response.status, 403, "administrator cannot use the supervisor scanner context");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  response = await request(scannerContextPath, { user: employeeA }); assert.equal(response.status, 403, "employee cannot use the supervisor scanner context");
  response = await request(`/api/supervisor/scanner/context?companyId=${companyB}`, { user: supervisorA }); assert.equal(response.status, 403, "supervisor cannot select a foreign company");
  response = await request(scannerContextPath, { user: supervisorA }); assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, private");
  const unpairedScannerContext = await response.json();
  assert.equal(unpairedScannerContext.contexts[0].authorized, false, "active supervisor without a device cookie receives an unauthorized context");
  response = await request(scannerContextPath, { user: supervisorA, cookieExtra: `qr_device_${companyA}=forged-synthetic-device-token` }); assert.equal(response.status, 200);
  assert.equal((await response.json()).contexts[0].authorized, false, "a manipulated device cookie does not authorize scanning");
  const beforeInvalidScannerOrigin = await snapshot(companyA);
  const invalidScannerOrigin = await fetch(new URL(scannerContextPath, appUrl), {
    method: "POST", headers: { cookie: supervisorA.cookie, origin: "https://attacker.invalid" },
  });
  assert.equal(invalidScannerOrigin.status, 403, "scanner context POST rejects a foreign Origin");
  assert.match(invalidScannerOrigin.headers.get("cache-control") ?? "", /no-store/i, "rejected scanner POST is not cacheable");
  assert.deepEqual(await snapshot(companyA), beforeInvalidScannerOrigin, "invalid-origin scanner request has no side effects");

  const additionalSupervisorMembership = await service.from("company_memberships")
    .insert({ company_id: companyB, user_id: supervisorA.userId, role: "supervisor", active: true })
    .select("id").single();
  if (additionalSupervisorMembership.error || !additionalSupervisorMembership.data) throw new Error("failed creating multi-company synthetic supervisor membership");
  response = await request(scannerContextPath, { user: supervisorA }); assert.equal(response.status, 409, "multi-company supervisor must select an active membership");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  response = await request(scannerContextPath, { user: supervisorA, cookieExtra: `qr_active_membership_id=${supervisorA.memberships[0].id}` }); assert.equal(response.status, 200, "selected own supervisor membership restores context access");
  response = await request(`/api/supervisor/scanner/context?companyId=${companyB}`, { user: supervisorA, cookieExtra: `qr_active_membership_id=${supervisorA.memberships[0].id}` }); assert.equal(response.status, 403, "selected company cannot be overridden by another membership's company ID");

  const httpChallenge = randomBytes(32).toString("base64url");
  const httpRequest = await supervisorA.client.rpc("request_supervisor_device", {
    p_company_id: companyA, p_branch_id: branchA, p_label: "Synthetic HTTP context device", p_challenge: httpChallenge,
  });
  assert.ok(!httpRequest.error && httpRequest.data?.requestId, "synthetic context device request exists");
  const httpApproval = await adminA.client.rpc("review_supervisor_device_request", {
    p_company_id: companyA, p_request_id: httpRequest.data.requestId, p_approve: true,
  });
  assert.ok(!httpApproval.error && httpApproval.data?.deviceId, "synthetic context device is approved before HTTP challenge redemption");
  const httpRedeemResponse = await fetch(new URL(scannerContextPath, appUrl), {
    method: "POST",
    headers: {
      cookie: `${supervisorA.cookie}; qr_active_membership_id=${supervisorA.memberships[0].id}; qr_enroll_${companyA}=${encodeURIComponent(httpChallenge)}`,
      origin: appUrl, "x-forwarded-proto": "https",
    },
  });
  assert.equal(httpRedeemResponse.status, 200, "approved local enrollment challenge redeems through the actual scanner context route");
  assert.equal(httpRedeemResponse.headers.get("cache-control"), "no-store, private");
  const httpRedeemedContext = await httpRedeemResponse.json();
  assert.equal(httpRedeemedContext.contexts[0].authorized, true);
  assert.equal(httpRedeemedContext.contexts[0].requestStatus, "authorized");
  assert.equal(JSON.stringify(httpRedeemedContext).includes(httpChallenge), false, "scanner context response never returns raw device challenge");
  const httpSetCookie = httpRedeemResponse.headers.get("set-cookie") ?? "";
  assert.match(httpSetCookie, new RegExp(`qr_device_${companyA}=`), "successful POST stores the device token in its cookie");
  assert.match(httpSetCookie, /HttpOnly/i);
  assert.match(httpSetCookie, /Secure/i, "forwarded HTTPS marks the device cookie Secure");
  assert.match(httpSetCookie, /SameSite=lax/i);
  assert.match(httpSetCookie, /Path=\/api/i);
  assert.equal((await dbPool.query("select status,redeemed_at is not null redeemed from private.device_authorization_requests where id=$1", [httpRequest.data.requestId])).rows[0]?.redeemed, true, "HTTP challenge redemption is persisted once");
  assert.equal(Number((await dbPool.query("select count(*)::int n from private.device_token_hashes where device_id=$1", [httpApproval.data.deviceId])).rows[0].n), 1, "HTTP redemption stores only one device-token hash");
  const afterHttpRedemption = await snapshot(companyA);
  const httpDeviceCookie = httpSetCookie.match(new RegExp(`qr_device_${companyA}=([^;,]+)`))?.[1];
  assert.ok(httpDeviceCookie, "device cookie value is present only in Set-Cookie");
  response = await request(scannerContextPath, { user: supervisorA, cookieExtra: `qr_active_membership_id=${supervisorA.memberships[0].id}; qr_device_${companyA}=${httpDeviceCookie}` });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).contexts[0].authorized, true, "issued device cookie authorizes only its server-recorded device");
  const repeatedHttpRedemption = await fetch(new URL(scannerContextPath, appUrl), {
    method: "POST", headers: {
      cookie: `${supervisorA.cookie}; qr_active_membership_id=${supervisorA.memberships[0].id}; qr_enroll_${companyA}=${encodeURIComponent(httpChallenge)}`,
      origin: appUrl, "x-forwarded-proto": "https",
    },
  });
  assert.equal(repeatedHttpRedemption.status, 200, "repeated HTTP redemption is handled without creating another authorization");
  assert.equal((await repeatedHttpRedemption.json()).contexts[0].authorized, false, "replayed challenge does not mint a second device cookie");
  assert.deepEqual(await snapshot(companyA), afterHttpRedemption, "replayed HTTP redemption creates no additional request, device or audit changes");

  const noDeviceContext = await supervisorA.client.rpc("get_supervisor_scanner_context", { p_company_id: companyA, p_device_token: null });
  assert.equal(noDeviceContext.data?.authorized, false);
  const beforeReplayRedemption = await snapshot(companyA);
  const replayRedemption = await supervisorA.client.rpc("redeem_supervisor_device", { p_company_id: companyA, p_challenge: enrollmentChallenge });
  assert.equal(replayRedemption.data?.status, "approved", "redeemed device enrollment cannot mint a second token");
  assert.deepEqual(await snapshot(companyA), beforeReplayRedemption, "repeated redemption has no device or audit side effects");

  const secondChallenge = randomBytes(32).toString("base64url");
  const secondDeviceRequest = await supervisorA.client.rpc("request_supervisor_device", { p_company_id: companyA, p_branch_id: branchA, p_label: "Synthetic rejected request", p_challenge: secondChallenge });
  assert.ok(!secondDeviceRequest.error && secondDeviceRequest.data?.requestId);
  response = await request("/api/supervisor-devices?companyId=" + companyA, { user: adminA, method: "PATCH", body: { requestId: secondDeviceRequest.data.requestId, approve: false } }); assert.equal(response.status, 200);
  assert.equal((await response.json()).request.status, "rejected");
  const repeatedRejection = await adminA.client.rpc("review_supervisor_device_request", { p_company_id: companyA, p_request_id: secondDeviceRequest.data.requestId, p_approve: false });
  assert.equal(repeatedRejection.error?.code, "23514");

  const raceChallenge = randomBytes(32).toString("base64url");
  const raceRequest = await supervisorA.client.rpc("request_supervisor_device", { p_company_id: companyA, p_branch_id: branchA, p_label: "Synthetic concurrent approval", p_challenge: raceChallenge });
  assert.ok(!raceRequest.error && raceRequest.data?.requestId);
  const concurrentReview = await Promise.all([
    adminA.client.rpc("review_supervisor_device_request", { p_company_id: companyA, p_request_id: raceRequest.data.requestId, p_approve: true }),
    adminA.client.rpc("review_supervisor_device_request", { p_company_id: companyA, p_request_id: raceRequest.data.requestId, p_approve: true }),
  ]);
  assert.equal(concurrentReview.filter((result) => !result.error).length, 1, "concurrent device approvals create exactly one authorized device");
  assert.equal(concurrentReview.filter((result) => result.error?.code === "23514").length, 1, "the losing concurrent approval observes the resolved state");
  assert.equal(Number((await dbPool.query("select count(*)::int n from public.authorized_devices where company_id=$1 and membership_id=$2", [companyA, supervisorA.memberships[0].id])).rows[0].n), 3, "the first approval, HTTP-context approval and single concurrent winner create exactly three devices");
  assert.equal(Number((await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_id=$2 and action='DEVICE_AUTHORIZATION_APPROVED'", [companyA, raceRequest.data.requestId])).rows[0].n), 1);

  const beforeCrossTenantRevokeA = await snapshot(companyA), beforeCrossTenantRevokeB = await snapshot(companyB);
  response = await request(`/api/supervisor-devices/${approved.deviceId}?companyId=${companyB}`, { user: adminB, method: "DELETE" }); assert.equal(response.status, 409);
  assert.deepEqual(await snapshot(companyA), beforeCrossTenantRevokeA);
  assert.deepEqual(await snapshot(companyB), beforeCrossTenantRevokeB);
  response = await request(`/api/supervisor-devices/${approved.deviceId}?companyId=${companyA}`, { user: supervisorA, method: "DELETE" }); assert.equal(response.status, 403);
  assert.deepEqual(await snapshot(companyA), beforeCrossTenantRevokeA, "wrong role cannot revoke a device");
  response = await request(`/api/supervisor-devices/${approved.deviceId}?companyId=${companyA}`, { user: adminA, method: "DELETE" }); assert.equal(response.status, 200);
  assert.equal((await response.json()).device.active, false);
  const afterDeviceRevoke = await snapshot(companyA);
  assert.equal((await dbPool.query("select active,revoked_at is not null revoked from public.authorized_devices where id=$1", [approved.deviceId])).rows[0].active, false);
  assert.equal((await dbPool.query("select status from private.device_authorization_requests where id=$1", [deviceRequestId])).rows[0].status, "revoked");
  assert.equal(Number((await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_id=$2 and action='SUPERVISOR_DEVICE_REVOKED'", [companyA, approved.deviceId])).rows[0].n), 1);
  const revokedContext = await supervisorA.client.rpc("get_supervisor_scanner_context", { p_company_id: companyA, p_device_token: enrollmentChallenge });
  assert.equal(revokedContext.data?.authorized, false, "revocation immediately removes scanner authorization");
  response = await request(scannerContextPath, { user: supervisorA, cookieExtra: `qr_active_membership_id=${supervisorA.memberships[0].id}; qr_device_${companyA}=${encodeURIComponent(enrollmentChallenge)}` });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).contexts[0].authorized, false, "revoked device cookie cannot authorize the HTTP scanner context");
  const repeatedRevoke = await adminA.client.rpc("revoke_supervisor_device", { p_company_id: companyA, p_device_id: approved.deviceId });
  assert.equal(repeatedRevoke.error?.code, "P0002");
  assert.deepEqual(await snapshot(companyA), afterDeviceRevoke, "repeated device revocation has no duplicate audit side effects");

  const beforeSupervisorDeactivation = await snapshot(companyA);
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { action: "deactivate", membershipId: supervisorA.memberships[0].id } }); assert.equal(response.status, 200);
  response = await request(scannerContextPath, { user: supervisorA, cookieExtra: `qr_active_membership_id=${supervisorA.memberships[0].id}; qr_device_${companyA}=${encodeURIComponent(enrollmentChallenge)}` });
  assert.equal(response.status, 403, "revoked supervisor membership blocks the HTTP scanner context despite stale cookies");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  assert.deepEqual(await dbPool.query("select active from public.company_memberships where id=$1", [supervisorA.memberships[0].id]).then((result) => result.rows[0]), { active: false });
  const devicesAfterMembershipRevoke = await service.from("authorized_devices").select("id,active,revoked_at").eq("company_id", companyA).eq("membership_id", supervisorA.memberships[0].id);
  assert.ok(!devicesAfterMembershipRevoke.error && devicesAfterMembershipRevoke.data.length > 0);
  assert.ok(devicesAfterMembershipRevoke.data.every((device) => !device.active && device.revoked_at), "revoking supervisor membership deactivates every associated device");
  const requestsAfterMembershipRevoke = await dbPool.query("select status from private.device_authorization_requests where company_id=$1 and membership_id=$2", [companyA, supervisorA.memberships[0].id]);
  assert.ok(requestsAfterMembershipRevoke.rows.every((item) => ["rejected", "revoked"].includes(item.status)), "revoking supervisor membership resolves all outstanding device requests");
  assert.notDeepEqual(await snapshot(companyA), beforeSupervisorDeactivation, "membership revocation records the access transition and device revocations");
  const beforeInactiveSupervisorRequest = await snapshot(companyA);
  const inactiveSupervisorRequest = await supervisorA.client.rpc("request_supervisor_device", { p_company_id: companyA, p_branch_id: branchA, p_label: "Synthetic revoked supervisor", p_challenge: randomBytes(32).toString("base64url") });
  assert.equal(inactiveSupervisorRequest.error?.code, "42501", "revoked supervisor membership cannot request another device through the RPC");
  assert.deepEqual(await snapshot(companyA), beforeInactiveSupervisorRequest, "revoked membership cannot create a request, device or audit event");
  const beforeInactiveSupervisorHttpRequestA = await snapshot(companyA), beforeInactiveSupervisorHttpRequestB = await snapshot(companyB);
  response = await request("/api/supervisor/device-requests", { user: supervisorA, method: "POST", body: deviceRequestBody });
  assert.equal(response.status, 403, "revoked supervisor membership cannot create a device request through the HTTP route");
  assert.deepEqual(await snapshot(companyA), beforeInactiveSupervisorHttpRequestA, "HTTP request after membership revocation has no company A side effects");
  assert.deepEqual(await snapshot(companyB), beforeInactiveSupervisorHttpRequestB, "HTTP request after membership revocation has no company B side effects");
  assert.equal((await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_ACCESS_DEACTIVATED'", [companyA, supervisorA.memberships[0].id])).rows[0].n, 1);
  process.stdout.write("PASS supervisor membership revocation invalidates approved devices and blocks subsequent enrollment without side effects\n");
  process.stdout.write("PASS device enrollment, approval/rejection, challenge redemption, tenant/branch/permission guards, duplicate/concurrent review, revocation and no-side-effect snapshots\n");

  // Admin access APIs, scope selection, company.manage and rejected-write snapshots.
  response = await request(`/api/admin/access?companyId=${companyA}`);
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
  if (invitationFlowOnly) {
    const anon = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const publicSignup = await anon.auth.signUp({ email: `public-signup-${randomUUID()}@qr-asistencia.invalid`, password: "synthetic-public-password" });
    assert.ok(publicSignup.error || !publicSignup.data.session, "public signup remains disabled without an invitation");
    if (publicSignup.data.user?.id) assert.equal((await dbPool.query("select count(*)::int n from auth.users where id=$1", [publicSignup.data.user.id])).rows[0].n, 0, "disabled public signup creates no Auth identity");
  }
  const employeeForInvite = await service.from("employees").insert({ company_id: companyA, branch_id: branchA, employee_number: `INV-${randomBytes(4).toString("hex")}`, first_name: "Expediente", last_name: "Autoritativo", email: inviteEmail, active: true }).select("id").single();
  if (employeeForInvite.error || !employeeForInvite.data?.id) throw new Error("failed creating synthetic employee linked to new-account invitation");
  response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "POST", body: { email: inviteEmail, role: "employee", employeeId: employeeForInvite.data.id } });
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
    if (invitationFlowOnly) {
      const newAccountMessage = await getMailpitMessage(inviteEmail, 2);
      const newAccountUrl = extractConfirmationUrl(newAccountMessage);
      assert.equal(new URL(newAccountUrl).searchParams.get("type"), "invite", "new identity receives Supabase Auth invite confirmation");
      invitationFlowFixtures = { inviteId: inviteBody.invitationId, inviteEmail, employeeId: employeeForInvite.data.id, newAccountUrl };
    }
    process.stdout.write("PASS local invitation resend returned HTTP 200, Mailpit captured both messages, and database state was unchanged\n");
    if (!invitationFlowOnly) {
      response = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "PATCH", body: { action: "revoke-invitation", invitationId: inviteBody.invitationId } }); assert.equal(response.status, 200);
    }
  }

  if (invitationFlowOnly) {
    const existingEmail = `existing-invite-${randomUUID()}@qr-asistencia.invalid`;
    const existingIdentity = await createHttpIdentity(existingEmail, { setupCompleted: false });
    const existingInviteResponse = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "POST", body: { email: existingEmail, role: "employee", employeeId: null } });
    assert.equal(existingInviteResponse.status, 201, "existing Auth identity receives an invitation through the magic-link delivery path");
    const existingInviteBody = await existingInviteResponse.json();
    assert.equal(existingInviteBody.deliveryMode, "magic-link");
    const existingMessage = resendMessages.findLast((message) => Array.isArray(message.to) && message.to[0] === existingEmail);
    assert.ok(existingMessage, "existing-account magic link is captured by the loopback mail double");
    invitationFlowFixtures.existing = { email: existingEmail, password: existingIdentity.password, userId: existingIdentity.userId, inviteId: existingInviteBody.invitationId, confirmationUrl: extractConfirmationUrl(existingMessage) };
    assert.equal(new URL(invitationFlowFixtures.existing.confirmationUrl).searchParams.get("type"), "magiclink", "existing identity receives a Supabase magic link");

    const failedEmail = `delivery-failure-${randomUUID()}@qr-asistencia.invalid`;
    const failedIdentity = await createHttpIdentity(failedEmail);
    resendFailRecipients.add(failedEmail);
    const failedResponse = await request(`/api/admin/access?companyId=${companyA}`, { user: adminA, method: "POST", body: { email: failedEmail, role: "employee", employeeId: null } });
    assert.equal(failedResponse.status, 502, "mail-provider failure is reported as delivery failure");
    assert.match((await failedResponse.json()).message, /no se entregó el correo/i, "delivery failure message does not claim the invitee can sign in");
    const failedInvitationResult = await dbPool.query("select id,status from public.company_user_invitations where company_id=$1 and email=$2", [companyA, failedEmail]);
    const failedInvitation = failedInvitationResult.rows[0];
    assert.equal(failedInvitation?.status, "pending", "delivery failure leaves the invitation pending for retry");
    const failedBeforeResend = await snapshot(companyA);
    resendFailRecipients.delete(failedEmail);
    const retryResponse = await request(`/api/admin/access/invitations/${failedInvitation.id}/resend?companyId=${companyA}`, { user: adminA, method: "POST" });
    assert.equal(retryResponse.status, 200, "resending after the synthetic provider recovers delivers the existing-account magic link");
    assert.equal((await retryResponse.json()).deliveryMode, "magic-link");
    assert.deepEqual(await snapshot(companyA), failedBeforeResend, "successful resend changes no invitation, membership, or audit state");
    assert.ok(resendMessages.some((message) => Array.isArray(message.to) && message.to[0] === failedEmail), "resend payload reaches only the local mail double");
    invitationFlowFixtures.failed = { email: failedEmail, userId: failedIdentity.userId, invitationId: failedInvitation.id };
  }

  if (invitationFlowOnly) {
    await actionBrowser.close();
    actionBrowser = await launchServerActionBrowser(appUrl);
    assert.ok(invitationFlowFixtures?.newAccountUrl, "new account invite email was captured locally before the acceptance flow");
    await actionBrowser.close();
    actionBrowser = await launchServerActionBrowser(appUrl);
    await actionBrowser.navigate(invitationFlowFixtures.newAccountUrl);
    const confirmationPage = await actionBrowser.bodyText();
    assert.match(confirmationPage, /Confirmar invitación/);
    await actionBrowser.runForm("form");
    await actionBrowser.waitForPath("/invitacion");
    let onboardingPage = await actionBrowser.bodyText();
    assert.match(onboardingPage, /Completar cuenta y aceptar invitación/);
    assert.match(onboardingPage, new RegExp(invitationFlowFixtures.inviteEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(onboardingPage, /Correo confirmado por Supabase Auth/);
    assert.match(onboardingPage, /Nombre completo/);
    assert.doesNotMatch(onboardingPage, /<input[^>]+name="email"/i);
    const newAccountBeforeInvalid = await snapshot(companyA);
    await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(invitationFlowFixtures.inviteId)}`);
    await actionBrowser.runForm("#set-invitation-password", { fullName: "A", password: "synthetic-valid-password", confirmation: "synthetic-valid-password" });
    await actionBrowser.waitForPath("error=name");
    await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(invitationFlowFixtures.inviteId)}`);
    await actionBrowser.runForm("#set-invitation-password", { fullName: "Synthetic New Employee", password: "synthetic-password-one", confirmation: "synthetic-password-two" });
    await actionBrowser.waitForPath("error=password-match");
    await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(invitationFlowFixtures.inviteId)}`);
    await actionBrowser.runForm("#set-invitation-password", { fullName: "Synthetic New Employee", password: "short", confirmation: "short" });
    await actionBrowser.waitForPath("error=password");
    assert.deepEqual(await snapshot(companyA), newAccountBeforeInvalid, "invalid name/password submissions preserve invitation, membership, employee and audit snapshots");
    const unconfiguredNew = await dbPool.query("select raw_app_meta_data->>'access_setup_completed_at' marker from auth.users where email=$1", [invitationFlowFixtures.inviteEmail]);
    assert.equal(unconfiguredNew.rows[0]?.marker ?? null, null, "invalid input does not write the trusted setup marker");
    await actionBrowser.navigate("/invitacion");
    await actionBrowser.runForm("form:has(input[name='fullName'])", { fullName: "  Nuevo   Usuario Sintético ", password: "synthetic-new-account-password", confirmation: "synthetic-new-account-password" });
    await actionBrowser.waitForPath("setup=complete");
    onboardingPage = await actionBrowser.bodyText();
    assert.match(onboardingPage, /Cuenta configurada/);
    await actionBrowser.runForm("form:has(input[name='invitationId'])");
    await actionBrowser.waitForPath("/mi-qr");
    const acceptedNewAccount = await dbPool.query(`select u.raw_user_meta_data->>'full_name' full_name,
      u.email_confirmed_at is not null email_confirmed,
      i.status,
      e.first_name,e.last_name,e.auth_user_id,
      (select count(*)::int from public.audit_log a where a.company_id=i.company_id and a.entity_id=i.id and a.action='USER_INVITATION_ACCEPTED') accept_audits
      from auth.users u join public.company_user_invitations i on i.email=u.email
      join public.employees e on e.id=$1 where u.id=(select accepted_by from public.company_user_invitations where id=$2) and i.id=$2`,
    [invitationFlowFixtures.employeeId, invitationFlowFixtures.inviteId]);
    assert.deepEqual(acceptedNewAccount.rows[0], { full_name: "Nuevo Usuario Sintético", email_confirmed: true, status: "accepted", first_name: "Expediente", last_name: "Autoritativo", auth_user_id: acceptedNewAccount.rows[0]?.auth_user_id, accept_audits: 1 }, "new invite confirms identity, stores presentation name, preserves employee record name, and accepts once");
    assert.ok(acceptedNewAccount.rows[0]?.auth_user_id, "acceptance links only the employee expediente attached to this invite");
    process.stdout.write("PASS new account: Auth invite via Mailpit, explicit /auth/confirm POST, verified identity, validated name/password, server setup marker, employee-name preservation and one-time acceptance\n");

    await actionBrowser.clickButtonText("Cerrar sesión");
    await actionBrowser.waitForPath("/login");
    const existingFlow = invitationFlowFixtures.existing;
    await actionBrowser.navigate(existingFlow.confirmationUrl);
    await actionBrowser.runForm("form");
    await actionBrowser.waitForPath("/invitacion");
    onboardingPage = await actionBrowser.bodyText();
    assert.match(onboardingPage, /Completar cuenta y aceptar invitación/);
    assert.match(onboardingPage, new RegExp(existingFlow.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await actionBrowser.runForm("form:has(input[name='fullName'])", { fullName: "Cuenta Existente Sintética", password: "synthetic-existing-account-password", confirmation: "synthetic-existing-account-password" });
    await actionBrowser.waitForPath("setup=complete");
    await actionBrowser.navigate("/invitacion");
    await actionBrowser.runForm("form:has(input[name='invitationId'])");
    await actionBrowser.waitForPath("/mi-qr");
    const acceptedExisting = await dbPool.query(`select i.status,
      u.raw_user_meta_data->>'full_name' full_name,
      u.raw_app_meta_data->>'access_setup_completed_at' marker,
      (select count(*)::int from public.company_memberships m where m.company_id=i.company_id and m.user_id=u.id and m.active) memberships,
      (select count(*)::int from public.audit_log a where a.company_id=i.company_id and a.entity_id=i.id and a.action='USER_INVITATION_ACCEPTED') accept_audits
      from public.company_user_invitations i join auth.users u on lower(u.email)=lower(i.email) where i.id=$1`, [existingFlow.inviteId]);
    assert.equal(acceptedExisting.rows[0]?.status, "accepted", "existing account magic link leads to successful one-time invitation acceptance");
    assert.equal(acceptedExisting.rows[0]?.full_name, "Cuenta Existente Sintética", "existing account name is stored in presentation user metadata");
    assert.ok(acceptedExisting.rows[0]?.marker, "existing account receives the server-owned setup marker only after password action");
    assert.deepEqual([acceptedExisting.rows[0]?.memberships, acceptedExisting.rows[0]?.accept_audits], [1, 1], "existing-account acceptance creates one membership and one audit event");
    process.stdout.write("PASS existing account: local magic link, password/name setup, authenticated acceptance and one membership/audit\n");

    await actionBrowser.clickButtonText("Cerrar sesión");
    await actionBrowser.waitForPath("/login");
    const noInviteIdentity = await createHttpIdentity(`no-pending-invite-${randomUUID()}@qr-asistencia.invalid`, { setupCompleted: false });
    await actionBrowser.navigate("/login");
    await actionBrowser.runForm("form", { email: noInviteIdentity.email, password: noInviteIdentity.password });
    await actionBrowser.waitForPath("error=no-company");
    await actionBrowser.navigate("/qr004-action-harness");
    const noInviteBefore = await snapshot(companyA);
    await actionBrowser.runForm("#set-invitation-password", { fullName: "Synthetic Without Invitation", password: "synthetic-no-invite-password", confirmation: "synthetic-no-invite-password" });
    await actionBrowser.waitForPath("error=invitation");
    assert.deepEqual(await snapshot(companyA), noInviteBefore, "account setup without a pending invitation makes no invitation/membership/audit change");
    assert.equal((await dbPool.query("select raw_app_meta_data->>'access_setup_completed_at' marker from auth.users where id=$1", [noInviteIdentity.userId])).rows[0]?.marker ?? null, null, "setup without invitation cannot set the server-owned marker");

    await actionBrowser.navigate("/qr004-action-harness");
    await actionBrowser.clickButtonText("Sign out");
    await actionBrowser.waitForPath("/login");
    const unconfirmedEmail = `unconfirmed-setup-${randomUUID()}@qr-asistencia.invalid`;
    const unconfirmedIdentity = await createHttpIdentity(unconfirmedEmail, { setupCompleted: false });
    const unconfirmedInvitation = await adminA.client.rpc("create_company_user_invitation", { p_company_id: companyA, p_email: unconfirmedEmail, p_role: "employee", p_employee_id: null });
    assert.equal(unconfirmedInvitation.error, null, "synthetic admin creates invite for unconfirmed-email scenario");
    await actionBrowser.navigate("/login");
    await actionBrowser.runForm("form", { email: unconfirmedEmail, password: unconfirmedIdentity.password });
    await actionBrowser.waitForPath("/invitacion");
    await dbPool.query("update auth.users set email_confirmed_at=null where id=$1", [unconfirmedIdentity.userId]);
    const unconfirmedBefore = await snapshot(companyA);
    await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(unconfirmedInvitation.data)}`);
    await actionBrowser.runForm("#set-invitation-password", { fullName: "Unconfirmed Synthetic", password: "synthetic-unconfirmed-password", confirmation: "synthetic-unconfirmed-password" });
    await actionBrowser.waitForPath("error=email");
    assert.deepEqual(await snapshot(companyA), unconfirmedBefore, "unconfirmed identity cannot set profile/password or accept invitation");
    assert.equal((await dbPool.query("select raw_app_meta_data->>'access_setup_completed_at' marker from auth.users where id=$1", [unconfirmedIdentity.userId])).rows[0]?.marker ?? null, null, "unconfirmed identity does not receive setup marker");
    process.stdout.write("PASS setup action rejects uninvited and unconfirmed identities before profile, marker, membership or audit writes\n");
    await actionBrowser.navigate("/qr004-action-harness");
    await actionBrowser.runForm("#sign-out");
    await actionBrowser.waitForPath("/login");
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

  // Baseline reproduction for the review finding: both granted RPC paths used
  // to accept an invited Auth identity with no server-controlled setup marker.
  const bypassEmail = `setup-bypass-${randomUUID()}@qr-asistencia.invalid`;
  const bypassIdentity = await createHttpIdentity(bypassEmail);
  const bypassClient = bypassIdentity.client;
  const bypassUser = await bypassClient.auth.getUser(); assert.ok(bypassUser.data.user);
  await dbPool.query("update auth.users set invited_at=clock_timestamp(), raw_app_meta_data=raw_app_meta_data-'access_setup_completed_at' where id=$1", [bypassUser.data.user.id]);
  assert.equal((await bypassClient.auth.updateUser({ data: { access_setup_completed_at: new Date().toISOString() } })).error, null, "identity can forge only user_metadata");
  assert.equal((await dbPool.query("select raw_app_meta_data->>'access_setup_completed_at' marker from auth.users where id=$1", [bypassUser.data.user.id])).rows[0].marker, null, "forged user_metadata does not create the protected app_metadata marker");
  const bypassInviteId = await createPendingInvite(bypassEmail);
  const beforeDirectSetupDenial = await snapshot(companyA);
  const bypassDirectResult = await bypassClient.rpc("accept_company_user_invitation", { p_invitation_id: bypassInviteId });
  assert.equal(bypassDirectResult.error?.code, "42501", "direct Data API RPC rejects invited identity without server-owned setup marker");
  assert.doesNotMatch(bypassDirectResult.error?.message ?? "", /access_setup_completed_at|raw_app_meta_data|SQLSTATE/i, "direct RPC error does not expose Auth metadata internals");
  assert.deepEqual(await snapshot(companyA), beforeDirectSetupDenial, "direct RPC setup denial leaves invitation, memberships and audit unchanged");
  assert.equal(Number((await dbPool.query("select count(*) n from public.company_memberships where company_id=$1 and user_id=$2", [companyA, bypassIdentity.userId])).rows[0].n), 0);
  await dbPool.query("update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{access_setup_completed_at}',to_jsonb('not-a-timestamp'::text),true) where id=$1", [bypassIdentity.userId]);
  assert.equal((await bypassClient.rpc("accept_company_user_invitation", { p_invitation_id: bypassInviteId })).error?.code, "42501", "malformed server metadata cannot satisfy setup");
  await dbPool.query("update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{access_setup_completed_at}',to_jsonb((clock_timestamp()+interval '1 day')::text),true) where id=$1", [bypassIdentity.userId]);
  assert.equal((await bypassClient.rpc("accept_company_user_invitation", { p_invitation_id: bypassInviteId })).error?.code, "42501", "future setup metadata cannot satisfy setup");
  await dbPool.query("update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{access_setup_completed_at}',to_jsonb('-infinity'::text),true) where id=$1", [bypassIdentity.userId]);
  assert.equal((await bypassClient.rpc("accept_company_user_invitation", { p_invitation_id: bypassInviteId })).error?.code, "42501", "non-finite setup timestamps cannot satisfy setup");
  assert.deepEqual(await snapshot(companyA), beforeDirectSetupDenial, "malformed and future marker denials also have no side effects");

  const bypassShareEmail = `setup-share-bypass-${randomUUID()}@qr-asistencia.invalid`;
  const bypassShareIdentity = await createHttpIdentity(bypassShareEmail);
  const bypassShareClient = bypassShareIdentity.client;
  const bypassShareUser = await bypassShareClient.auth.getUser(); assert.ok(bypassShareUser.data.user);
  await dbPool.query("update auth.users set invited_at=clock_timestamp(), raw_app_meta_data=raw_app_meta_data-'access_setup_completed_at' where id=$1", [bypassShareUser.data.user.id]);
  assert.equal((await bypassShareClient.auth.updateUser({ data: { access_setup_completed_at: new Date().toISOString() } })).error, null);
  assert.equal((await dbPool.query("select raw_app_meta_data->>'access_setup_completed_at' marker from auth.users where id=$1", [bypassShareUser.data.user.id])).rows[0].marker, null);
  const bypassShareInviteId = await createPendingInvite(bypassShareEmail);
  const bypassShareToken = randomBytes(32).toString("base64url");
  const bypassShareTokenHash = createHash("sha256").update(bypassShareToken).digest("hex");
  const bypassShareIssued = await adminA.client.rpc("set_company_user_invitation_share_link", { p_company_id: companyA, p_invitation_id: bypassShareInviteId, p_token_hash: bypassShareTokenHash });
  assert.ok(!bypassShareIssued.error);
  const beforeShareSetupDenial = await snapshot(companyA);
  const shareRouteDenial = await request("/api/invitations/share/accept", { user: bypassShareIdentity, method: "POST", body: { token: bypassShareToken } });
  assert.equal(shareRouteDenial.status, 403, "shared invitation HTTP route maps SQL authorization denial to 403");
  const shareRouteDenialBody = await shareRouteDenial.json();
  assert.equal(shareRouteDenialBody.error.code, "invitation_forbidden");
  assert.doesNotMatch(JSON.stringify(shareRouteDenialBody), /setup_completed|raw_app_meta_data|42501|SQLSTATE/i, "shared invitation route does not expose SQL internals");
  assert.deepEqual(await snapshot(companyA), beforeShareSetupDenial, "shared route denial preserves invitation token, memberships and audit");
  const bypassShareResult = await bypassShareClient.rpc("accept_company_user_share_invitation", { p_token_hash: bypassShareTokenHash });
  assert.equal(bypassShareResult.error?.code, "42501", "shared-link RPC rejects invited identity without server-owned setup marker");
  assert.deepEqual(await snapshot(companyA), beforeShareSetupDenial, "shared RPC denial rolls back token clearing and leaves no audit or membership");
  assert.equal(Number((await dbPool.query("select count(*) n from public.company_memberships where company_id=$1 and user_id=$2", [companyA, bypassShareIdentity.userId])).rows[0].n), 0);
  process.stdout.write("PASS email/share invitation RPCs deny setup bypass; HTTP denial is sanitized and rejected attempts have no side effects\n");

  // Invitation actions run through the actual invitation page or a temporary
  // rendered native-action form, never by fabricating Next's action protocol.
  const actionInviteEmail = `server-action-invite-${randomUUID()}@qr-asistencia.invalid`;
  const actionInvitee = await createHttpUser("server-action-invitee", "employee", companyB, {
    email: actionInviteEmail, employee: true, branchId: branchB,
  });
  const actionInviteId = await createPendingInvite(actionInviteEmail, companyA, "employee");
  const beforeWrongActionAcceptance = await snapshot(companyA);
  await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(actionInviteId)}`);
  await actionBrowser.runForm("#accept-invitation");
  await actionBrowser.waitForPath("/login", "anonymous acceptInvitation must return to login");
  assert.deepEqual(await snapshot(companyA), beforeWrongActionAcceptance, "anonymous acceptInvitation leaves invitation, membership, and audit snapshots unchanged");
  await actionBrowser.navigate("/login");
  await actionBrowser.runForm("form", { email: actionAdmin.email, password: actionAdmin.password });
  await actionBrowser.waitForPath("/admin");
  await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(actionInviteId)}`);
  await actionBrowser.runForm("#accept-invitation");
  await actionBrowser.waitForPath("error=expired", "wrong authenticated identity must receive the safe invitation denial");
  assert.match(await actionBrowser.bodyText(), /La invitación venció o fue revocada\. Solicita una nueva\./, "wrong identity sees a safe invitation denial message");
  assert.deepEqual(await snapshot(companyA), beforeWrongActionAcceptance, "another authenticated identity cannot accept an invite or create audit/membership side effects");
  await actionBrowser.navigate("/qr004-action-harness");
  await actionBrowser.runForm("#sign-out");
  await actionBrowser.waitForPath("/login");

  await actionBrowser.navigate("/login");
  await actionBrowser.runForm("form", { email: actionInvitee.email, password: actionInvitee.password });
  await actionBrowser.waitForPath("/invitacion");
  assert.match(await actionBrowser.bodyText(), /Confirma que esta invitación corresponde a tu cuenta/);
  await actionBrowser.runForm("form:has(input[name='invitationId'])");
  await actionBrowser.waitForPath("/seleccionar-empresa");
  const acceptedActionMembership = await dbPool.query("select id from public.company_memberships where company_id=$1 and user_id=$2 and active", [companyA, actionInvitee.userId]);
  assert.equal(acceptedActionMembership.rowCount, 1, "valid invited identity accepts through the actual invitation page");
  const acceptedActionMembershipId = acceptedActionMembership.rows[0].id;
  const acceptedActionAudit = await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_INVITATION_ACCEPTED'", [companyA, actionInviteId]);
  assert.equal(acceptedActionAudit.rows[0].n, 1, "valid Server Action acceptance records exactly one audit event");
  await actionBrowser.navigate(`/qr004-action-harness?membershipId=${encodeURIComponent(acceptedActionMembershipId)}`);
  await actionBrowser.runForm("#choose-membership");
  await actionBrowser.waitForPath("/mi-qr");
  assert.equal((await actionBrowser.getCookies()).find((cookie) => cookie.name === "qr_active_membership_id")?.value, acceptedActionMembershipId, "invite acceptance leads to an explicit valid membership selection");
  await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(actionInviteId)}`);
  await actionBrowser.runForm("#accept-invitation");
  await actionBrowser.waitForPath("error=expired", "replayed accepted invitation must be safely denied");
  assert.match(await actionBrowser.bodyText(), /La invitación venció o fue revocada\. Solicita una nueva\./, "replayed invitation shows a safe denial message");
  assert.equal((await dbPool.query("select count(*)::int n from public.company_memberships where company_id=$1 and user_id=$2 and active", [companyA, actionInvitee.userId])).rows[0].n, 1, "replaying acceptInvitation does not duplicate membership");
  assert.equal((await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_INVITATION_ACCEPTED'", [companyA, actionInviteId])).rows[0].n, 1, "replaying acceptInvitation does not duplicate audit entries");
  await actionBrowser.navigate("/mi-qr");
  await actionBrowser.clickButtonText("Cerrar sesión");
  await actionBrowser.waitForPath("/login");

  for (const state of ["expired", "revoked"]) {
    const email = `server-action-${state}-${randomUUID()}@qr-asistencia.invalid`;
    const identity = await createHttpIdentity(email);
    const invitationId = await createPendingInvite(email, companyA, "employee");
    if (state === "expired") {
      await dbPool.query("update public.company_user_invitations set expires_at=clock_timestamp()-interval '1 minute' where id=$1", [invitationId]);
    } else {
      const revoked = await adminA.client.rpc("revoke_company_user_invitation", { p_company_id: companyA, p_invitation_id: invitationId });
      assert.equal(revoked.data, true, "synthetic invitation revocation succeeds before the denied action");
    }
    const beforeRejectedState = await snapshot(companyA);
    await actionBrowser.navigate("/login");
    await actionBrowser.runForm("form", { email, password: identity.password });
    await actionBrowser.waitForPath("error=no-company");
    await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(invitationId)}`);
    await actionBrowser.runForm("#accept-invitation");
    await actionBrowser.waitForPath("error=expired", `${state} invitation action must show a safe unavailable-invitation denial`);
    assert.match(await actionBrowser.bodyText(), /La invitación venció o fue revocada\. Solicita una nueva\./, `${state} invitation displays the safe denial message`);
    assert.deepEqual(await snapshot(companyA), beforeRejectedState, `${state} Server Action rejection preserves invitation, membership and audit snapshots`);
    assert.equal((await dbPool.query("select count(*)::int n from public.company_memberships where company_id=$1 and user_id=$2", [companyA, identity.userId])).rows[0].n, 0, `${state} invitation cannot create membership`);
  }

  // Reproduce user_metadata tampering, then verify that the server-controlled
  // app_metadata marker and server-side accept guard prevent bypassing setup.
  const forgedSetupEmail = `server-action-setup-${randomUUID()}@qr-asistencia.invalid`;
  const forgedSetupIdentity = await createHttpIdentity(forgedSetupEmail, { setupCompleted: false });
  await dbPool.query("update auth.users set invited_at=clock_timestamp(), raw_app_meta_data=raw_app_meta_data-'access_setup_completed_at' where id=$1", [forgedSetupIdentity.userId]);
  const forgedMetadata = await forgedSetupIdentity.client.auth.updateUser({ data: { access_setup_completed_at: new Date().toISOString() } });
  assert.equal(forgedMetadata.error, null, "synthetic Auth user can modify user_metadata");
  const forgedSetupInviteId = await createPendingInvite(forgedSetupEmail, companyA, "employee");
  await actionBrowser.navigate("/login");
  await actionBrowser.runForm("form", { email: forgedSetupEmail, password: forgedSetupIdentity.password });
  await actionBrowser.waitForPath("/invitacion");
  const forgedSetupPage = await actionBrowser.bodyText();
  assert.match(forgedSetupPage, /Completar cuenta y aceptar invitación/, "user-controlled user_metadata cannot hide the required setup form");
  const beforeSetupGuard = await snapshot(companyA);
  await actionBrowser.runForm("form:has(input[name='invitationId'])", { invitationId: forgedSetupInviteId });
  await actionBrowser.waitForPath("error=password");
  assert.deepEqual(await snapshot(companyA), beforeSetupGuard, "server-side accept guard rejects a forged metadata marker without side effects");
  assert.equal((await dbPool.query("select count(*)::int n from public.company_memberships where company_id=$1 and user_id=$2 and active", [companyA, forgedSetupIdentity.userId])).rows[0].n, 0);
  await actionBrowser.runForm("form:has(input[name='password'])", { fullName: "Synthetic Setup User", password: "synthetic-invalid-password", confirmation: "synthetic-mismatch-password" });
  await actionBrowser.waitForPath("error=password");
  assert.deepEqual(await snapshot(companyA), beforeSetupGuard, "mismatched password submissions do not mutate invitation state");
  await actionBrowser.runForm("form:has(input[name='password'])", { fullName: "Synthetic Setup User", password: "synthetic-new-password-123", confirmation: "synthetic-new-password-123" });
  const setupUser = await service.auth.admin.getUserById(forgedSetupIdentity.userId);
  const setupActionUrl = new URL(await actionBrowser.currentUrl());
  assert.ok(setupUser.data.user?.app_metadata?.access_setup_completed_at, `real password action must persist server metadata before redirect (path=${setupActionUrl.pathname}${setupActionUrl.search}; invited=${Boolean(setupUser.data.user?.invited_at)}; appMarker=${Boolean(setupUser.data.user?.app_metadata?.access_setup_completed_at)})`);
  await actionBrowser.waitForPath("setup=complete");
  assert.ok(setupUser.data.user?.app_metadata?.access_setup_completed_at, "only the server action writes the protected app_metadata completion marker");
  const persistedSetupMarker = await dbPool.query("select raw_app_meta_data->>'access_setup_completed_at' marker from auth.users where id=$1", [forgedSetupIdentity.userId]);
  assert.equal(persistedSetupMarker.rows[0].marker, setupUser.data.user.app_metadata.access_setup_completed_at, "the marker checked by PostgreSQL is the server-written raw_app_meta_data value");
  assert.ok(setupUser.data.user?.user_metadata?.access_setup_completed_at, "the forgery remains in user_metadata but is not trusted");
  const repeatedPasswordSetupBefore = setupUser.data.user.app_metadata.access_setup_completed_at;
  await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(forgedSetupInviteId)}`);
  await actionBrowser.runForm("#set-invitation-password", { fullName: "Changed Synthetic Name", password: "another-synthetic-password-456", confirmation: "another-synthetic-password-456" });
  await actionBrowser.waitForPath("error=invalid");
  const repeatedPasswordSetupAfter = await service.auth.admin.getUserById(forgedSetupIdentity.userId);
  assert.equal(repeatedPasswordSetupAfter.data.user?.app_metadata?.access_setup_completed_at, repeatedPasswordSetupBefore, "completed setup cannot be rewritten through a repeated Server Action");
  await actionBrowser.navigate("/invitacion");
  await actionBrowser.runForm("form:has(input[name='invitationId'])");
  await actionBrowser.waitForPath("/mi-qr");
  assert.equal((await dbPool.query("select count(*)::int n from public.company_memberships where company_id=$1 and user_id=$2 and active", [companyA, forgedSetupIdentity.userId])).rows[0].n, 1, "valid setup then accepts the matching invitation exactly once");
  assert.equal((await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_INVITATION_ACCEPTED'", [companyA, forgedSetupInviteId])).rows[0].n, 1);
  const passwordLogin = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  assert.equal((await passwordLogin.auth.signInWithPassword({ email: forgedSetupEmail, password: "synthetic-new-password-123" })).error, null, "password saved by the real Server Action authenticates successfully");

  // Exercise SQLSTATE 42501 mapping through the real Server Action after it
  // passes the app_metadata gate; the inviter loses company.manage meanwhile.
  const sqlDeniedActionEmail = `server-action-sql-denied-${randomUUID()}@qr-asistencia.invalid`;
  const sqlDeniedActionIdentity = await createHttpIdentity(sqlDeniedActionEmail);
  const sqlDeniedActionInvite = await createPendingInvite(sqlDeniedActionEmail, companyA, "employee");
  const revokeInviterPermission = await service.from("membership_permission_overrides").insert({
    company_id: companyA, membership_id: adminA.memberships[0].id, permission_code: "company.manage", allowed: false,
  });
  assert.equal(revokeInviterPermission.error, null, "synthetic permission override makes the SQL inviter check fail");
  const beforeSqlDeniedAction = await snapshot(companyA);
  await actionBrowser.clickButtonText("Cerrar sesión");
  await actionBrowser.waitForPath("/login");
  await actionBrowser.navigate("/login");
  await actionBrowser.runForm("form", { email: sqlDeniedActionEmail, password: sqlDeniedActionIdentity.password });
  await actionBrowser.waitForPath("/invitacion");
  await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(sqlDeniedActionInvite)}`);
  await actionBrowser.runForm("#accept-invitation");
  await actionBrowser.waitForPath("error=forbidden");
  const sqlDeniedActionBody = await actionBrowser.bodyText();
  assert.match(sqlDeniedActionBody, /La invitación ya no puede aceptarse/);
  assert.doesNotMatch(sqlDeniedActionBody, /42501|SQLSTATE|company\.manage|raw_app_meta_data/i, "Server Action renders a generic authorization error");
  assert.deepEqual(await snapshot(companyA), beforeSqlDeniedAction, "SQL authorization error through Server Action has no side effects");
  assert.equal((await service.from("membership_permission_overrides").delete().eq("company_id", companyA).eq("membership_id", adminA.memberships[0].id).eq("permission_code", "company.manage")).error, null);

  // Simulate the second Auth call failing: password update succeeds through the
  // user's session, but an invalid local service key cannot write app_metadata.
  const partialSetupEmail = `server-action-partial-setup-${randomUUID()}@qr-asistencia.invalid`;
  const partialSetupIdentity = await createHttpIdentity(partialSetupEmail);
  await dbPool.query("update auth.users set invited_at=clock_timestamp(), raw_app_meta_data=raw_app_meta_data-'access_setup_completed_at' where id=$1", [partialSetupIdentity.userId]);
  const partialSetupInvite = await createPendingInvite(partialSetupEmail, companyA, "employee");
  const beforePartialSetup = await snapshot(companyA);
  // This error page has no logout control. Start a fresh disposable browser
  // profile instead of inventing a Server Action request or reusing its cookie.
  await actionBrowser.close();
  actionBrowser = await launchServerActionBrowser(appUrl);
  await stopNext();
  await startNext(anonKey);
  await actionBrowser.navigate("/login");
  await actionBrowser.runForm("form", { email: partialSetupEmail, password: partialSetupIdentity.password });
  await actionBrowser.waitForPath("/invitacion");
  await actionBrowser.runForm("form:has(input[name='password'])", { fullName: "Synthetic Partial User", password: "synthetic-first-password-123", confirmation: "synthetic-first-password-123" });
  await actionBrowser.waitForPath("error=setup-retry");
  assert.equal((await dbPool.query("select raw_app_meta_data->>'access_setup_completed_at' marker from auth.users where id=$1", [partialSetupIdentity.userId])).rows[0].marker, null, "failed administrative marker write leaves protected marker absent");
  assert.deepEqual(await snapshot(companyA), beforePartialSetup, "partial password setup does not accept or mutate the invitation");
  const firstPasswordLogin = await partialSetupIdentity.client.auth.signInWithPassword({ email: partialSetupEmail, password: "synthetic-first-password-123" });
  assert.equal(firstPasswordLogin.error, null, "the first Auth call did persist the new password before the admin metadata call failed");
  const partialSetupRpc = await partialSetupIdentity.client.rpc("accept_company_user_invitation", { p_invitation_id: partialSetupInvite });
  assert.equal(partialSetupRpc.error?.code, "42501", "direct RPC still denies acceptance after only the password call succeeded");
  assert.deepEqual(await snapshot(companyA), beforePartialSetup, "direct RPC denial after partial setup has no side effects");

  await stopNext();
  await startNext(serviceKey);
  await actionBrowser.navigate("/invitacion");
  await actionBrowser.runForm("form:has(input[name='password'])", { fullName: "Synthetic Partial User", password: "synthetic-retry-password-456", confirmation: "synthetic-retry-password-456" });
  await actionBrowser.waitForPath("setup=complete");
  const retriedSetupUser = await service.auth.admin.getUserById(partialSetupIdentity.userId);
  assert.ok(retriedSetupUser.data.user?.app_metadata?.access_setup_completed_at, "retry writes the server-controlled marker after the password call succeeds");
  await actionBrowser.navigate(`/qr004-action-harness?invitationId=${encodeURIComponent(partialSetupInvite)}`);
  await actionBrowser.runForm("#accept-invitation");
  await actionBrowser.waitForPath("/mi-qr");
  assert.equal((await dbPool.query("select count(*)::int n from public.company_memberships where company_id=$1 and user_id=$2 and active", [companyA, partialSetupIdentity.userId])).rows[0].n, 1, "retry completes the setup and accepts exactly one membership");
  assert.equal((await dbPool.query("select count(*)::int n from public.audit_log where company_id=$1 and entity_id=$2 and action='USER_INVITATION_ACCEPTED'", [companyA, partialSetupInvite])).rows[0].n, 1);
  process.stdout.write("PASS invitation Server Actions: anonymous/wrong identity, valid/multi-company selection, replay, mutable user_metadata denial, protected app_metadata password setup, and zero-side-effect rejects\n");
  await actionBrowser.clickButtonText("Cerrar sesión");
  await actionBrowser.waitForPath("/login");

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
  response = await request(`/api/admin/audit?companyId=${companyA}&from=2026-11-06&to=2026-11-05`, { user: adminA }); assert.equal(response.status, 400);
  response = await request(`/api/admin/audit?companyId=${companyA}&action=not%20a%20valid%20action`, { user: adminA }); assert.equal(response.status, 400);

  // Deterministic local fixtures exercise the action/date filters, tenant scope,
  // safe changed-field projection, and clamped pagination without touching a
  // hosted database. The whole stack is disposable and removed by this runner.
  const auditProbeAction = `QR004_FILTER_${randomUUID().replaceAll("-", "")}`;
  const auditProbeDate = new Date().toISOString().slice(0, 10);
  const auditProbeTimestamp = `${auditProbeDate}T12:00:00.000Z`;
  const auditAIds = Array.from({ length: 11 }, () => randomUUID());
  const auditRows = [
    ...auditAIds.map((entityId) => [companyA, adminA.userId, auditProbeAction, "qr004_test", entityId, auditProbeTimestamp,
      JSON.stringify({ name: "Old synthetic value", secret: "must-not-leak" }),
      JSON.stringify({ name: "New synthetic value", secret: "must-not-leak" })]),
    [companyB, adminB.userId, auditProbeAction, "qr004_test", randomUUID(), auditProbeTimestamp,
      JSON.stringify({ name: "Tenant B", secret: "must-not-leak" }),
      JSON.stringify({ name: "Tenant B changed", secret: "must-not-leak" })],
  ];
  const auditInsertSql = `insert into public.audit_log(company_id,actor_user_id,action,entity_table,entity_id,occurred_at,before_data,after_data) values ($1::uuid,$2::uuid,$3,$4,$5::uuid,$6::timestamptz,$7::jsonb,$8::jsonb)`;
  for (const row of auditRows) await dbPool.query(auditInsertSql, row);
  response = await request(`/api/admin/audit?companyId=${companyA}&from=${auditProbeDate}&to=${auditProbeDate}&action=${auditProbeAction}&page=0&pageSize=1`, { user: adminA });
  assert.equal(response.status, 200);
  let auditPage = await response.json();
  assert.equal(auditPage.pagination.page, 1, "audit page clamps to the first page");
  assert.equal(auditPage.pagination.pageSize, 10, "audit page size clamps to the minimum");
  assert.equal(auditPage.pagination.total, 11, "audit filters and RLS exclude the matching tenant B fixture");
  assert.equal(auditPage.pagination.pages, 2);
  assert.equal(auditPage.items.length, 10);
  assert.ok(auditPage.items.every((item) => auditAIds.includes(item.entity_id)));
  assert.ok(auditPage.items.every((item) => !("before_data" in item) && !("after_data" in item)));
  assert.ok(auditPage.items.every((item) => item.changedFields.length === 1 && item.changedFields[0] === "Nombre"));
  response = await request(`/api/admin/audit?companyId=${companyA}&from=${auditProbeDate}&to=${auditProbeDate}&action=${auditProbeAction}&page=2&pageSize=10`, { user: adminA });
  assert.equal(response.status, 200);
  auditPage = await response.json();
  assert.equal(auditPage.pagination.page, 2);
  assert.equal(auditPage.pagination.total, 11);
  assert.equal(auditPage.items.length, 1);
  assert.ok(auditAIds.includes(auditPage.items[0].entity_id));
  response = await request(`/api/admin/permissions?companyId=${companyA}`, { user: supervisorA }); assert.equal(response.status, 403);
  response = await request(`/api/admin/permissions?companyId=${companyA}`, { user: adminA }); assert.equal(response.status, 200);
  const catalog = await response.json(); assert.ok(Array.isArray(catalog.permissions) && Array.isArray(catalog.rolePermissions));
  response = await request(`/api/admin/permissions?companyId=${companyB}`, { user: adminA }); assert.equal(response.status, 403);
  process.stdout.write("PASS audit is company.manage-gated; permission catalog is available to active admins even when company.manage is overridden off\n");

  // Exercise invitation RPC lifecycle and existing-account compatibility with
  // genuine local Auth JWTs, including recipient, expiry, revocation and replay.
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
  }
  }
} catch (error) {
  primaryError = error;
} finally {
  try { await actionBrowser?.close(); } catch (error) { cleanupErrors.push(error); }
  try { await stopNext(); } catch (error) { cleanupErrors.push(error); }
  if (resendServer) {
    try { await new Promise((resolveClose, rejectClose) => resendServer.close((error) => error ? rejectClose(error) : resolveClose())); }
    catch (error) { cleanupErrors.push(error); }
  }
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
