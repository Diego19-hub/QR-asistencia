import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";
import { createReportPdf, createReportWorkbook } from "../src/lib/reports/export-files.ts";

const sample = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  employeeId: "22222222-2222-4222-8222-222222222222",
  employeeNumber: "=2+2",
  employeeName: "=HYPERLINK(\"https://example.invalid\")",
  branchId: "33333333-3333-4333-8333-333333333333",
  branchName: "Sucursal prueba",
  workDate: "2026-10-06",
  timezone: "America/Mexico_City",
  scheduledStartAt: "2026-10-06T15:00:00.000Z",
  scheduledEndAt: "2026-10-06T23:00:00.000Z",
  scheduledMinutes: 480,
  clockIn: "2026-10-06T15:00:00.000Z",
  mealStart: "2026-10-06T19:00:00.000Z",
  mealEnd: "2026-10-06T20:00:00.000Z",
  clockOut: "2026-10-06T23:00:00.000Z",
  presenceMinutes: 480,
  paidBreakMinutes: 60,
  unpaidBreakMinutes: 0,
  allBreakMinutes: 60,
  effectiveMinutes: 480,
  latenessMinutes: null,
  earlyDepartureMinutes: 0,
  detectedOvertimeMinutes: 60,
  approvedOvertimeMinutes: 30,
  status: "closed",
  incomplete: false,
  unscheduled: false,
  incidents: ["Tiempo excedente detectado"],
};

test("XLSX export has four usable worksheets, numeric minutes, readable durations, and safe text", async () => {
  const buffer = await createReportWorkbook("Empresa de prueba", new Date("2026-10-11T12:00:00Z"), ["Periodo: 2026-10-06 a 2026-10-06"], [sample]);
  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Resumen", "Asistencias", "Horas extra", "Incidencias"]);
  const detail = workbook.getWorksheet("Asistencias");
  assert.equal(detail.getRow(2).getCell(1).value, "'=HYPERLINK(\"https://example.invalid\")");
  assert.equal(detail.getRow(2).getCell(2).value, "'=2+2");
  assert.equal(detail.getRow(2).getCell(10).value, 480);
  assert.equal(detail.getRow(2).getCell(11).numFmt, "[h]:mm");
  const readablePresence = detail.getRow(2).getCell(11).value;
  assert.ok(readablePresence instanceof Date);
  assert.equal(readablePresence.getUTCHours(), 8);
  assert.equal(readablePresence.getUTCMinutes(), 0);
  assert.equal(workbook.getWorksheet("Horas extra").rowCount, 2);
  assert.equal(workbook.getWorksheet("Incidencias").rowCount, 2);
});

test("PDF export emits a complete valid PDF for populated and empty reports", async () => {
  for (const rows of [[sample], []]) {
    const buffer = await createReportPdf("Empresa de prueba", new Date("2026-10-11T12:00:00Z"), ["Periodo: octubre 2026"], rows);
    assert.ok(buffer.length > 1000);
    assert.equal(buffer.subarray(0, 8).toString("ascii"), "%PDF-1.3");
    assert.match(buffer.toString("latin1"), /%%EOF\s*$/);
    assert.equal((buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length, 1, "single-page reports should not append a blank page");
  }
});
