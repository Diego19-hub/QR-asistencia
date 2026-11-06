import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadAssignmentHistory } from "../src/components/schedules/assignment-history-data.ts";

const componentSource = readFileSync(
  fileURLToPath(new URL("../src/components/schedules/assignment-history.tsx", import.meta.url)),
  "utf8",
);
const dataSource = readFileSync(
  fileURLToPath(new URL("../src/components/schedules/assignment-history-data.ts", import.meta.url)),
  "utf8",
);

const assignment = {
  id: "assignment-a",
  employee_id: "employee-a",
  template_id: "schedule-a",
  branch_id: "branch-a",
  starts_on: "2026-11-01",
  ends_on: null,
  planned_start_local: "09:00:00",
  planned_end_local: "17:00:00",
  planned_minutes: 480,
};

test("loads assignments and employees for the selected company without caching", async () => {
  const query = new URLSearchParams({ companyId: "company-a" });
  const controller = new AbortController();
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.startsWith("/api/schedules/assignments")
      ? { items: [assignment] }
      : { employees: [{ id: "employee-a", first_name: "Ana", last_name: "Prueba" }] }), { status: 200 });
  };

  const result = await loadAssignmentHistory(query, controller.signal, fetcher);

  assert.deepEqual(result.items, [assignment]);
  assert.deepEqual(result.employees, [{ id: "employee-a", first_name: "Ana", last_name: "Prueba" }]);
  assert.deepEqual(calls.map(({ url }) => url), [
    "/api/schedules/assignments?companyId=company-a",
    "/api/schedules?companyId=company-a",
  ]);
  assert.ok(calls.every(({ options }) => options.cache === "no-store" && options.signal === controller.signal));
  assert.equal(query.toString(), "companyId=company-a", "the helper must not mutate its caller's query");
});

test("returns empty collections when the endpoints return no items", async () => {
  const result = await loadAssignmentHistory(new URLSearchParams({ companyId: "company-a" }), new AbortController().signal,
    async () => new Response("{}", { status: 200 }));

  assert.deepEqual(result, { items: [], employees: [] });
});

test("surfaces the assignment endpoint's safe error message", async () => {
  await assert.rejects(
    loadAssignmentHistory(new URLSearchParams({ companyId: "company-a" }), new AbortController().signal,
      async (url) => url.startsWith("/api/schedules/assignments")
        ? new Response(JSON.stringify({ error: { message: "Acceso denegado." } }), { status: 403 })
        : new Response(JSON.stringify({ employees: [] }), { status: 200 })),
    /Acceso denegado\./,
  );
});

test("propagates cancellation to both in-flight requests", async () => {
  const controller = new AbortController();
  const seenSignals = [];
  const fetcher = (_url, options) => new Promise((_resolve, reject) => {
    seenSignals.push(options.signal);
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });

  const pending = loadAssignmentHistory(new URLSearchParams({ companyId: "company-a" }), controller.signal, fetcher);
  controller.abort();

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(seenSignals.length, 2);
  assert.ok(seenSignals.every((signal) => signal.aborted));
});

test("the component preserves accessible error, empty, table, and effect-cleanup states", () => {
  assert.match(componentSource, /role="alert"/);
  assert.match(componentSource, /<ScheduleEmptyState/);
  assert.match(componentSource, /title="Sin asignaciones"/);
  for (const heading of ["Empleado", "Horario", "Horario diario", "Vigencia"]) {
    assert.ok(componentSource.includes(`<th className="px-5 py-3">${heading}</th>`), `missing ${heading} column`);
  }
  assert.match(dataSource, /cache: "no-store"/);
  assert.match(componentSource, /return \(\) => \{\s*window\.clearTimeout\(timer\);\s*controller\.abort\(\);\s*\};/);
});
