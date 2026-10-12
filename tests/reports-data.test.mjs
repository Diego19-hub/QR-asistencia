import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { fetchAllCursorPages } from "../src/lib/reports/pagination.ts";
import { canExportReport, getExportFailureMessage, getReportView, reportFiltersMatch } from "../src/lib/reports/request-state.ts";

const dataSource = await readFile(new URL("../src/lib/reports/data.ts", import.meta.url), "utf8");
const pagination = await readFile(new URL("../src/lib/reports/pagination.ts", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/components/reports/reports-dashboard.tsx", import.meta.url), "utf8");
const exportRoute = await readFile(new URL("../src/app/api/reports/export/route.ts", import.meta.url), "utf8");

const reportFilters = { from: "2026-10-01", to: "2026-10-31", branchId: "", employeeId: "", status: "all" };

test("failed or stale report requests never expose rows from a previous query", () => {
  const oldData = { rows: [{ sessionId: "old" }], truncated: false };
  const staleState = { key: "old-filters", status: "success", data: oldData };
  assert.deepEqual(getReportView(staleState, "new-filters"), { data: null, error: "", loading: true });

  const failedState = { key: "new-filters", status: "error", message: "Query failed" };
  assert.deepEqual(getReportView(failedState, "new-filters"), { data: null, error: "Query failed", loading: false });
  assert.equal(canExportReport(failedState, "new-filters", true), false);
});

test("exports require a successful current result, matching visible filters, and a complete report", () => {
  const success = { key: "query-key", status: "success", data: { truncated: false } };
  assert.equal(reportFiltersMatch(reportFilters, { ...reportFilters }), true);
  assert.equal(reportFiltersMatch(reportFilters, { ...reportFilters, employeeId: "employee-2" }), false);
  assert.equal(canExportReport(success, "query-key", true), true);
  assert.equal(canExportReport(success, "different-query", true), false);
  assert.equal(canExportReport(success, "query-key", false), false);
  assert.equal(canExportReport({ ...success, data: { truncated: true } }, "query-key", true), false);
  assert.match(dashboard, /disabled=\{exporting \|\| !exportEnabled\}/);
});

test("cursor pagination returns every employee beyond 1,000 rows and verifies the final count", async () => {
  const rows = Array.from({ length: 1_207 }, (_, index) => ({ id: String(index + 1).padStart(4, "0"), employee_number: `emp-${index + 1}` }));
  const requests = [];
  const result = await fetchAllCursorPages(async (request) => {
    requests.push(request);
    if (request.countOnly) return { data: null, count: rows.length, error: null };
    const matches = request.afterId ? rows.filter((row) => row.id > request.afterId) : rows;
    return { data: matches.slice(0, request.pageSize), count: request.afterId ? null : rows.length, error: null };
  }, 500);

  assert.equal(result.error, null);
  assert.equal(result.data.length, 1_207);
  assert.equal(new Set(result.data.map((row) => row.id)).size, 1_207);
  assert.equal(requests.filter((request) => !request.countOnly).length, 3);
  assert.equal(requests.at(-1).countOnly, true);
  assert.doesNotMatch(dataSource, /\.limit\(1000\)/);
  assert.match(dataSource, /from\("employees"\)[\s\S]*?fetchAllCursorPages|fetchAllCursorPages\([\s\S]*?from\("employees"\)/);
});

test("detail pagination fails closed on truncated pages, duplicate IDs, or changed counts", async () => {
  const truncated = await fetchAllCursorPages(async ({ afterId, countOnly }) => {
    if (countOnly) return { data: null, count: 1_100, error: null };
    if (afterId) return { data: [], count: null, error: null };
    return { data: Array.from({ length: 500 }, (_, index) => ({ id: String(index + 1).padStart(4, "0") })), count: 1_100, error: null };
  }, 500);
  assert.ok(truncated.error instanceof Error);
  assert.equal(truncated.data.length, 0);

  const changedCount = await fetchAllCursorPages(async ({ countOnly }) => {
    if (countOnly) return { data: null, count: 3, error: null };
    return { data: [{ id: "0001" }, { id: "0002" }], count: 2, error: null };
  }, 500);
  assert.ok(changedCount.error instanceof Error);
  assert.equal(changedCount.data.length, 0);

  const duplicateIds = await fetchAllCursorPages(async ({ countOnly }) => countOnly
    ? { data: null, count: 2, error: null }
    : { data: [{ id: "0001" }, { id: "0001" }], count: 2, error: null }, 500);
  assert.ok(duplicateIds.error instanceof Error);
  assert.equal(duplicateIds.data.length, 0);

  assert.match(dataSource, /fetchBatched\(scope, "attendance_breaks"/);
  assert.match(dataSource, /fetchBatched\(scope, "attendance_events"/);
  assert.match(dataSource, /fetchBatched\(scope, "overtime_authorizations"/);
  assert.match(dataSource, /\.order\("id", \{ ascending: true \}\)\.range\(0, pageSize - 1\)/);
  assert.match(pagination, /La paginación terminó antes del conteo esperado/);
});

test("the table explains that sorting applies only to the current page", () => {
  assert.match(dashboard, /El ordenamiento se aplica únicamente a la página actual\./);
  assert.match(dashboard, /const rows = \[\.\.\.\(data\?\.rows \?\? \[\]\)\]/);
});

test("export errors handle JSON and empty or malformed server responses", () => {
  assert.equal(getExportFailureMessage('{"error":{"message":"PDF unavailable"}}', 500), "PDF unavailable");
  assert.equal(getExportFailureMessage("", 500), "No fue posible generar el archivo (HTTP 500).");
  assert.equal(getExportFailureMessage("not-json", 503), "No fue posible generar el archivo (HTTP 503).");
});

test("large export requests fail with 413 before allocating the files", () => {
  assert.match(exportRoute, /result.rows.length > 500/);
  assert.match(exportRoute, /apiError\("report_export_too_large"[\s\S]*?, 413/);
  assert.ok(exportRoute.indexOf("report_export_too_large") < exportRoute.indexOf("await createReportWorkbook"));
  assert.ok(exportRoute.indexOf("report_export_too_large") < exportRoute.indexOf("await createReportPdf"));
});
