#!/usr/bin/env node
/**
 * QR-009 Phase 4: sequential local-only, disposable benchmarks for three fixed commits.
 * No remote Git operations, no PIN/scan tests, no attendance writes, no CI dispatch.
 * It only runs the repository's existing benchmark:qr009:local runner.
 */
import { spawn, execFileSync } from "node:child_process";
import { access, chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const expected = Object.freeze([
  { label: "baseline", sha: "5f41479c399f94be38a981e3443c68581fb08829" },
  { label: "recharts", sha: "0889ab9ba1a79c9854d062800f173b746dd5b716" },
  { label: "zxing", sha: "92ef1507a6c9d798a7613e7d09c85f3c72aba5d8" },
]);
const ANALYSIS_BRANCH = "analysis/qr-009-phase4-comparison";
const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROOF = [
  "PASS isolated Next.js production build completed with loopback-only Supabase configuration",
  "PASS QR-009 performance-only preserved full local attendance snapshots; both tables remain empty",
  "PASS temporary stack and data removed; pre-existing Docker resources preserved",
];

export function verifyBenchmarkResult(report, sha, log) {
  if (report?.schemaVersion !== 1 || report.baseCommit !== sha) throw Error(`El JSON no pertenece al commit ${sha}`);
  if (report?.environment?.syntheticOnly !== true) throw Error("El JSON no confirma entorno sintético");
  if (report?.browser?.samples?.length !== 100 || report?.environment?.browserSamplesExpected !== 100)
    throw Error("El benchmark no registró las 100 muestras esperadas");
  if (report?.browser?.interactions?.scanner?.prohibitedAttendanceOrPinRequests !== 0)
    throw Error("El benchmark no confirma cero solicitudes PIN/scan");
  if (!Array.isArray(report?.postgres?.scenarios) || report.postgres.scenarios.length !== 3)
    throw Error("Faltan los escenarios SQL sintéticos");
  for (const message of PROOF) if (!log.includes(message)) throw Error(`Falta prueba de seguridad/limpieza en la salida: ${message}`);
}

function cli(program, args, cwd, env = process.env) {
  return execFileSync(program, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim();
}
function filteredEnv() {
  const safe = [
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "TERM",
    "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR",
    "CI", "USER", "LOGNAME", "SSH_AUTH_SOCK",
  ];
  return Object.fromEntries(safe.filter((key) => typeof process.env[key] === "string")
    .map((key) => [key, process.env[key]]));
}
function assertClean(root) {
  const changes = cli("git", ["status", "--porcelain", "--untracked-files=all"], root);
  if (changes) throw Error("Working tree con cambios: se cancela para no sobrescribir trabajo local.");
}
function assertLocalDocker(root, env) {
  if (env.DOCKER_HOST && !env.DOCKER_HOST.startsWith("unix://")) throw Error("DOCKER_HOST apunta a un daemon no local.");
  const host = cli("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], root, env);
  if (!host.startsWith("unix://")) throw Error(`Contexto Docker no local, se rechaza: ${host}`);
  cli("docker", ["info", "--format", "{{.ServerVersion}}"], root, env);
}
function status(root, name, args) {
  const value = cli(name, args, root);
  if (!value) throw Error(`Preflight vacío: ${name} ${args.join(" ")}`);
  return value;
}
let activeChild;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted = true;
    if (activeChild?.pid) {
      try { process.kill(-activeChild.pid, signal); } catch { activeChild.kill(signal); }
    }
  });
}
async function npmBenchmark(root, output, chrome, env) {
  const args = ["run", "benchmark:qr009:local"];
  const childEnv = { ...env, QR004_CHROME_BIN: chrome, QR009_RESULTS_FILE: output };
  return new Promise((resolve, reject) => {
    let log = "";
    activeChild = spawn("npm", args, {
      cwd: root, env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (bytes) => { log = (log + String(bytes)).slice(-300_000); };
    activeChild.stdout.on("data", collect);
    activeChild.stderr.on("data", collect);
    activeChild.once("error", (err) => { activeChild = undefined; reject(err); });
    activeChild.once("close", (code) => {
      activeChild = undefined;
      if (code !== 0 || interrupted) reject(Error(`Benchmark no completado (exit ${code}). Inspecciona la salida terminal local.`));
      else resolve(log);
    });
  });
}
async function main() {
  const checkOnly = process.argv.slice(2).join(" ") === "--check";
  if (!(process.argv.length === 2 || checkOnly)) throw Error("Uso: node scripts/qr009-phase4-run.mjs [--check]");
  const root = cli("git", ["rev-parse", "--show-toplevel"], process.cwd());
  const branch = cli("git", ["branch", "--show-current"], root);
  if (branch !== ANALYSIS_BRANCH) throw Error(`Debes estar en ${ANALYSIS_BRANCH}, rama actual: ${branch || "(detached)"}`);
  const startSha = cli("git", ["rev-parse", "HEAD"], root);
  assertClean(root);
  for (const e of expected) {
    const actual = cli("git", ["rev-parse", "--verify", `${e.sha}^{commit}`], root);
    if (actual !== e.sha) throw Error(`Commit local inesperado: ${e.label}`);
  }
  const env = filteredEnv();
  assertLocalDocker(root, env);
  const chrome = process.env.QR004_CHROME_BIN || DEFAULT_CHROME;
  await access(chrome, constants.X_OK);
  await access(join(root, "node_modules", "next", "package.json"), constants.R_OK);
  await access(join(root, "node_modules", "@playwright", "test", "package.json"), constants.R_OK);
  const versions = {
    node: process.version, npm: status(root, "npm", ["--version"]),
    chrome: cli(chrome, ["--version"], root), docker: cli("docker", ["context", "show"], root, env),
  };
  console.log(`PRECHECK PASS — ${branch} ${startSha}; Chrome: ${versions.chrome}; Docker: ${versions.docker}`);
  if (checkOnly) return;

  const dir = await mkdtemp(join(tmpdir(), "qr009-phase4-"));
  await chmod(dir, 0o700);
  const manifest = { baselineCommit: expected[0].sha, sourceBranch: branch, analysisHead: startSha,
    machine: { platform: process.platform, arch: process.arch }, versions, runs: [] };
  console.log(`Directorio privado de resultados: ${dir}`);
  let failure;
  try {
    for (const e of expected) {
      if (interrupted) throw Error("Ejecución interrumpida");
      assertClean(root);
      cli("git", ["switch", "--detach", e.sha], root);
      const currentSha = cli("git", ["rev-parse", "HEAD"], root);
      if (currentSha !== e.sha) throw Error("Git HEAD no coincide con el experimento");
      console.log(`>>> Ejecutando ${e.label} (${e.sha.slice(0, 8)}) con Supabase desechable...`);
      const path = join(dir, `${e.label}.json`);
      const start = Date.now();
      const log = await npmBenchmark(root, path, chrome, env);
      const report = JSON.parse(await readFile(path, "utf8"));
      verifyBenchmarkResult(report, e.sha, log);
      manifest.runs.push({ label: e.label, sha: e.sha, resultFile: `${e.label}.json`,
        elapsedMs: Date.now() - start, generatedAt: report.generatedAt,
        samples: report.browser.samples.length, attendanceEmptyAndTeardown: true });
      console.log(`PASS ${e.label}: 100/100, snapshots vacíos, 0 PIN/scan, teardown limpio.`);
    }
  } catch (e) {
    failure = e;
    console.error(`STOP: ${e.message}`);
  } finally {
    try {
      assertClean(root);
      cli("git", ["switch", branch], root);
      const restored = cli("git", ["rev-parse", "HEAD"], root);
      if (restored !== startSha) throw Error("La rama original cambió durante la ejecución.");
      console.log(`Git restaurado: ${branch} (${restored.slice(0, 8)})`);
    } catch (err) {
      failure ??= err;
      console.error(`ATENCIÓN: no se pudo restaurar Git automáticamente: ${err.message}`);
      console.error(`Revisa git status y recupera manualmente con: git switch ${branch}`);
    }
  }
  if (failure) {
    console.error(`Resultados parciales, si los hay, están en ${dir}. No interpretar como comparación completa.`);
    throw failure;
  }
  const comparator = join(root, "scripts", "qr009-compare-results.mjs");
  const outputs = expected.map((e) => join(dir, `${e.label}.json`));
  const report = cli(process.execPath, [comparator, ...outputs], root);
  await writeFile(join(dir, "comparison.md"), report + "\n", { mode: 0o600, flag: "wx" });
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(`\nCOMPARACIÓN GENERADA: ${join(dir, "comparison.md")}`);
  console.log(`MANIFIESTO: ${join(dir, "manifest.json")}`);
  console.log("Revisa y comparte comparison.md + manifest.json; no publiques cookies, credenciales ni trazas. NO-GO para merge/producción.");
}
const runningAsCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (runningAsCli) main().catch((e) => { console.error("QR-009 Fase 4 no completada:", e.message); process.exitCode = 1; });
