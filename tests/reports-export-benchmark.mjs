import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createReportPdf, createReportWorkbook } from "../src/lib/reports/export-files.ts";

const template = {
  sessionId: "session-00000", employeeId: "employee-00000",
  employeeNumber: "BENCH-001", employeeName: "Empleado sintético 001",
  branchId: "branch-00001", branchName: "Sucursal de pruebas",
  workDate: "2026-10-06", timezone: "America/Mexico_City",
  scheduledStartAt: "2026-10-06T15:00:00.000Z", scheduledEndAt: "2026-10-06T23:00:00.000Z", scheduledMinutes: 480,
  clockIn: "2026-10-06T15:00:00.000Z", mealStart: "2026-10-06T19:00:00.000Z",
  mealEnd: "2026-10-06T20:00:00.000Z", clockOut: "2026-10-06T23:00:00.000Z",
  presenceMinutes: 480, paidBreakMinutes: 60, unpaidBreakMinutes: 0,
  allBreakMinutes: 60, effectiveMinutes: 480, latenessMinutes: 0,
  earlyDepartureMinutes: 0, detectedOvertimeMinutes: 0, approvedOvertimeMinutes: 0,
  status: "closed", incomplete: false, unscheduled: false, incidents: [],
};

function makeRows(count) {
  return Array.from({ length: count }, (_, index) => {
    const employee = String((index % 250) + 1).padStart(3, "0");
    const day = String((index % 28) + 1).padStart(2, "0");
    return { ...template, sessionId: "session-" + String(index + 1).padStart(5, "0"),
      employeeId: "employee-" + employee, employeeNumber: "BENCH-" + employee,
      employeeName: "Empleado sintético " + employee, workDate: "2026-10-" + day };
  });
}

async function measure(label, job) {
  global.gc?.();
  const startRss = process.memoryUsage().rss;
  let peakRss = startRss;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 10);
  const start = performance.now();
  try {
    const buffer = await job();
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    return { label, durationMs: Math.round(performance.now() - start), sizeBytes: buffer.length,
      startRssMb: +(startRss / 1_048_576).toFixed(1), peakRssMb: +(peakRss / 1_048_576).toFixed(1),
      peakGrowthMb: +((peakRss - startRss) / 1_048_576).toFixed(1) };
  } finally { clearInterval(sampler); }
}

async function runWorker(count, format) {
  const rows = makeRows(count);
  if (format === "concurrent") return measure("2 concurrent exports (" + count + " rows each)", async () => {
    const [xlsx, pdf] = await Promise.all([
      createReportWorkbook("QR-asistencia-testing", new Date(), [], rows),
      createReportPdf("QR-asistencia-testing", new Date(), [], rows),
    ]);
    return Buffer.concat([xlsx, pdf]);
  });
  const label = count + " rows " + format.toUpperCase();
  return measure(label, () => format === "xlsx"
    ? createReportWorkbook("QR-asistencia-testing", new Date(), [], rows)
    : createReportPdf("QR-asistencia-testing", new Date(), [], rows));
}

if (process.argv[2] === "--worker") {
  const result = await runWorker(Number(process.argv[3]), process.argv[4]);
  process.stdout.write(JSON.stringify(result) + "\n");
} else {
  const results = [];
  for (const count of [500, 1000, 5000]) for (const format of ["xlsx", "pdf"]) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--expose-gc", fileURLToPath(import.meta.url), "--worker", String(count), format], { encoding: "utf8" });
    if (child.status !== 0) throw new Error("Benchmark child failed: " + child.stderr);
    results.push(JSON.parse(child.stdout.trim().split("\n").at(-1)));
  }
  const concurrent = spawnSync(process.execPath, ["--experimental-strip-types", "--expose-gc", fileURLToPath(import.meta.url), "--worker", "1000", "concurrent"], { encoding: "utf8" });
  if (concurrent.status !== 0) throw new Error("Concurrent benchmark child failed: " + concurrent.stderr);
  results.push(JSON.parse(concurrent.stdout.trim().split("\n").at(-1)));
  process.stdout.write(JSON.stringify({ runtime: process.version, results }, null, 2) + "\n");
}
