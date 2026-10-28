#!/usr/bin/env node
/* Local-only disposable Supabase authorization matrix. Never links a remote project. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import net from "node:net";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "node_modules/.bin/supabase");
const projectId = `qr004_disposable_${randomBytes(6).toString("hex")}`;
const excluded = "realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
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
} catch (error) {
  primaryError = error;
} finally {
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
