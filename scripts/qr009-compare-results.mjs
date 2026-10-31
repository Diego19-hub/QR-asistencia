#!/usr/bin/env node
// QR-009 phase 4: only reads sanitized local browser-benchmark JSON. No external calls.
import { readFile, stat } from "node:fs/promises";

const expected = [
  ["Baseline PR #25", "5f41479c399f94be38a981e3443c68581fb08829"],
  ["Recharts lazy", "0889ab9ba1a79c9854d062800f173b746dd5b716"],
  ["ZXing lazy", "92ef1507a6c9d798a7613e7d09c85f3c72aba5d8"],
];
const routes = ["/login", "/admin", "/admin/reportes", "/scanner", "/mi-qr"];
const profiles = ["desktop", "mobile-emulated"];
const caches = ["cold", "repeated-no-cache"];
const metrics = ["jsTransferBytes", "navigationMs", "fcpMs", "lcpMs"];
function insist(value, msg) { if (!value) throw Error(msg); }
function p50(values) {
  const finite = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!finite.length) return null;
  finite.sort((a, b) => a - b);
  return finite[Math.ceil(finite.length / 2) - 1];
}
async function load(path, [label, sha]) {
  const size = await stat(path);
  insist(size.isFile() && size.size > 0 && size.size < 20_000_000, label + ": invalid input file");
  const report = JSON.parse(await readFile(path, "utf8"));
  insist(report.schemaVersion === 1 && report.baseCommit === sha, label + ": unexpected schema/commit SHA");
  insist(report.environment?.syntheticOnly === true, label + ": non-synthetic report");
  insist(report.environment?.browserSamplesExpected === 100 &&
    report.environment?.samplesPerRouteCacheProfile === 5, label + ": wrong sampling protocol");
  insist(Array.isArray(report.browser?.samples) && report.browser.samples.length === 100,
    label + ": must have 100 samples");
  insist(report.browser?.interactions?.scanner?.prohibitedAttendanceOrPinRequests === 0,
    label + ": scan/PIN request detected or unmeasured");
  insist(report.browser?.interactions?.recharts?.renderedSvg === true,
    label + ": Recharts rendering not confirmed");
  insist(Array.isArray(report.postgres?.scenarios) && report.postgres.scenarios.length === 3,
    label + ": expected three local SQL scenarios");
  insist(!Number.isNaN(Date.parse(report.generatedAt)), label + ": invalid timestamp");
  const groups = new Map();
  for (const s of report.browser.samples) {
    insist(routes.includes(s.route) && profiles.includes(s.profile) && caches.includes(s.cache),
      label + ": invalid sample grouping");
    insist(Number.isInteger(s.sample) && s.sample >= 1 && s.sample <= 5, label + ": invalid sample number");
    for (const metric of metrics) {
      const value = s[metric];
      insist(value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0),
        label + ": invalid " + metric);
    }
    const key = [s.route, s.profile, s.cache].join("|");
    const found = groups.get(key) || [];
    found.push(s);
    groups.set(key, found);
  }
  insist(groups.size === 20, label + ": expected 20 groups");
  for (const route of routes) for (const profile of profiles) for (const cache of caches) {
    const key = [route, profile, cache].join("|");
    const samples = groups.get(key) || [];
    insist(samples.length === 5 && new Set(samples.map((s) => s.sample)).size === 5,
      label + ": missing or duplicated group " + key);
    insist(samples.every((s) => typeof s.jsTransferBytes === "number"), label + ": JS transfer missing");
  }
  return { label, sha, date: report.generatedAt, environment: report.environment,
    groups, interactions: report.browser.interactions };
}
function value(run, route, profile, cache, metric) {
  return p50(run.groups.get([route, profile, cache].join("|")).map((row) => row[metric]));
}
function n(v) { return v === null ? "N/D" : Number(v.toFixed(1)).toLocaleString("en-US"); }
function diff(b, a) {
  if (a === null || b === null) return "N/D";
  const d = a - b;
  const signed = (d >= 0 ? "+" : "") + n(d);
  return b === 0 ? signed + " (base 0)" :
    signed + " (" + (d >= 0 ? "+" : "") + (100 * d / b).toFixed(1) + "%)";
}
function section(baseline, candidate, route) {
  const table = [
    "### " + candidate.label + ": " + route,
    "",
    "| Perfil | Condición | JS base (B) | JS candidato (B) | Δ JS | Δ navegación p50 (ms) | Δ FCP p50 (ms) | Δ LCP p50 (ms) |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const profile of profiles) for (const cache of caches) {
    const base = (metric) => value(baseline, route, profile, cache, metric);
    const test = (metric) => value(candidate, route, profile, cache, metric);
    table.push("| " + [profile, cache, n(base("jsTransferBytes")), n(test("jsTransferBytes")),
      diff(base("jsTransferBytes"), test("jsTransferBytes")),
      diff(base("navigationMs"), test("navigationMs")),
      diff(base("fcpMs"), test("fcpMs")), diff(base("lcpMs"), test("lcpMs"))].join(" | ") + " |");
  }
  return table.join("\n");
}
async function main() {
  insist(process.argv.length === 5,
    "Uso: node qr009-compare-results.mjs BASELINE.json RECHARTS.json ZXING.json");
  const reports = await Promise.all(process.argv.slice(2).map((path, i) => load(path, expected[i])));
  const [baseline, recharts, zxing] = reports;
  for (const r of reports) {
    insist(JSON.stringify(r.environment.profiles) === JSON.stringify(baseline.environment.profiles) &&
      r.environment.app === baseline.environment.app && r.environment.browser === baseline.environment.browser,
      "The reported browser profiles or environments do not match");
  }
  console.log("# QR-009 Fase 4 — Comparación descriptiva\n");
  console.log("Estos números salen de los tres JSON locales; no implican una mejora demostrada ni CI aprobado.\n");
  for (const r of reports) console.log("- " + r.label + " " + r.sha + ", generado " + r.date + ", 100 muestras; 0 requests PIN/scan.");
  console.log("\n" + section(baseline, recharts, "/admin/reportes"));
  console.log("\n" + section(baseline, zxing, "/scanner"));
  console.log("\nJS adicional al abrir Recharts: baseline " + n(baseline.interactions.recharts.additionalBytes) +
    " B; candidato " + n(recharts.interactions.recharts.additionalBytes) + " B.");
  console.log("Tiempo de clic a gráfica visible: NO MEDIDO. Tiempo hasta cámara lista ZXing: NO MEDIDO (guard HTTPS/403).");
  console.log("Verificar además logs de snapshots vacíos, teardown y tests permitidos. Cinco muestras por grupo no bastan para significancia estadística; repetidas no equivale a cache hits. NO-GO para merge/producción.");
}
main().catch((e) => { console.error("QR009 comparison FAILED: " + e.message); process.exitCode = 1; });
