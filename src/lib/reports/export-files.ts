import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { ReportRow } from "./data";

export async function createReportWorkbook(company: string, generatedAt: Date, filters: string[], rows: ReportRow[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QR-asistencia";
  workbook.created = generatedAt;
  workbook.subject = "Reporte de jornadas y asistencia";
  workbook.title = `Reporte de asistencia - ${company}`;
  const navy = "14264A";
  const blue = "2563EB";
  const meta = [company, "Reporte de asistencia", `Generado: ${generatedAt.toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}`, ...filters];
  const summary = workbook.addWorksheet("Resumen", { properties: { tabColor: { argb: blue } } });
  summary.columns = [{ width: 40 }, { width: 22 }, { width: 24 }];
  summary.addRow([safeText(meta[0]), safeText(meta[1])]);
  summary.mergeCells("A1:C1");
  summary.addRow([safeText(meta[2])]); summary.mergeCells("A2:C2");
  for (const item of filters) { summary.addRow([safeText(item)]); summary.mergeCells(`A${summary.rowCount}:C${summary.rowCount}`); }
  summary.addRow([]);
  summary.addRow(["Indicador", "Valor numérico", "Lectura en horas"]);
  const metrics: [string, number, string][] = [
    ["Empleados con asistencia", new Set(rows.map((row) => row.employeeId)).size, ""], ["Jornadas registradas", rows.length, ""],
    ["Presencia (minutos)", rows.reduce((sum, row) => sum + row.presenceMinutes, 0), "minutos"],
    ["Efectivo (minutos)", rows.reduce((sum, row) => sum + row.effectiveMinutes, 0), "minutos"],
    ["Descansos computables (minutos)", rows.reduce((sum, row) => sum + row.paidBreakMinutes, 0), "minutos"],
    ["Descansos no computables (minutos)", rows.reduce((sum, row) => sum + row.unpaidBreakMinutes, 0), "minutos"],
    ["Retardos (minutos)", rows.reduce((sum, row) => sum + (row.latenessMinutes ?? 0), 0), "minutos"],
    ["Salidas anticipadas (minutos)", rows.reduce((sum, row) => sum + (row.earlyDepartureMinutes ?? 0), 0), "minutos"],
    ["Tiempo excedente detectado (minutos)", rows.reduce((sum, row) => sum + (row.detectedOvertimeMinutes ?? 0), 0), "minutos"],
    ["Horas extra autorizadas (minutos)", rows.reduce((sum, row) => sum + row.approvedOvertimeMinutes, 0), "minutos"],
    ["Jornadas incompletas", rows.filter((row) => row.incomplete).length, ""],
  ];
  for (const [label, value, unit] of metrics) summary.addRow([label, value, unit === "minutos" ? human(value) : ""]);
  styleSheet(summary, navy, blue);
  summary.views = [{ state: "frozen", ySplit: 8 }];

  const detail = workbook.addWorksheet("Asistencias", { views: [{ state: "frozen", ySplit: 1 }] });
  detail.columns = [
    { header: "Empleado", key: "employee", width: 28 }, { header: "Número", key: "number", width: 16 }, { header: "Sucursal", key: "branch", width: 22 },
    { header: "Fecha laboral", key: "date", width: 15 }, { header: "Horario programado", key: "schedule", width: 27 },
    { header: "Entrada", key: "in", width: 24 }, { header: "Inicio comida", key: "mealStart", width: 24 }, { header: "Fin comida", key: "mealEnd", width: 24 }, { header: "Salida", key: "out", width: 24 },
    { header: "Presencia (min)", key: "presence", width: 17 }, { header: "Presencia (h:mm)", key: "presenceHours", width: 17 },
    { header: "Descanso computable (min)", key: "paid", width: 22 }, { header: "Computable (h:mm)", key: "paidHours", width: 18 },
    { header: "Descanso no computable (min)", key: "unpaid", width: 25 }, { header: "No computable (h:mm)", key: "unpaidHours", width: 19 },
    { header: "Efectivo (min)", key: "effective", width: 17 }, { header: "Efectivo (h:mm)", key: "effectiveHours", width: 17 }, { header: "Retardo (min)", key: "late", width: 16 }, { header: "Salida anticipada (min)", key: "early", width: 22 },
    { header: "Excedente detectado (min)", key: "detected", width: 23 }, { header: "Autorizado (min)", key: "approved", width: 18 }, { header: "Estado", key: "status", width: 16 }, { header: "Incidencias", key: "incidents", width: 36 },
  ];
  for (const row of rows) detail.addRow({ employee: safeText(row.employeeName), number: safeText(row.employeeNumber), branch: safeText(row.branchName), date: row.workDate,
    schedule: row.scheduledMinutes === null ? "Sin horario" : `${time(row.scheduledStartAt, row.timezone)}–${time(row.scheduledEndAt, row.timezone)} (${row.scheduledMinutes} min)`,
    in: time(row.clockIn, row.timezone), mealStart: time(row.mealStart, row.timezone), mealEnd: time(row.mealEnd, row.timezone), out: time(row.clockOut, row.timezone),
    presence: row.presenceMinutes, presenceHours: row.presenceMinutes / 1440, paid: row.paidBreakMinutes, paidHours: row.paidBreakMinutes / 1440,
    unpaid: row.unpaidBreakMinutes, unpaidHours: row.unpaidBreakMinutes / 1440, effective: row.effectiveMinutes, effectiveHours: row.effectiveMinutes / 1440,
    late: row.latenessMinutes, early: row.earlyDepartureMinutes, detected: row.detectedOvertimeMinutes, approved: row.approvedOvertimeMinutes,
    status: row.incomplete ? (row.status === "open" ? "Abierta" : "Incompleta") : row.unscheduled ? "Sin horario" : "Cerrada", incidents: safeText(row.incidents.join(", ")) });
  styleSheet(detail, navy, blue);
  for (const row of detail.getRows(2, Math.max(0, detail.rowCount - 1)) ?? []) for (const column of [11, 13, 15, 17]) row.getCell(column).numFmt = "[h]:mm";
  const overtime = workbook.addWorksheet("Horas extra", { views: [{ state: "frozen", ySplit: 1 }] });
  overtime.columns = [{ header: "Empleado", width: 28 }, { header: "Sucursal", width: 22 }, { header: "Fecha laboral", width: 16 }, { header: "Excedente detectado (min)", width: 28 }, { header: "Horas extra autorizadas (min)", width: 30 }, { header: "Jornada", width: 16 }];
  for (const row of rows.filter((item) => (item.detectedOvertimeMinutes ?? 0) > 0 || item.approvedOvertimeMinutes > 0)) overtime.addRow([safeText(row.employeeName), safeText(row.branchName), row.workDate, row.detectedOvertimeMinutes, row.approvedOvertimeMinutes, row.incomplete ? "Incompleta" : row.unscheduled ? "Sin horario" : "Cerrada"]);
  styleSheet(overtime, navy, blue);
  const incidents = workbook.addWorksheet("Incidencias", { views: [{ state: "frozen", ySplit: 1 }] });
  incidents.columns = [{ header: "Empleado", width: 28 }, { header: "Número", width: 16 }, { header: "Sucursal", width: 22 }, { header: "Fecha", width: 16 }, { header: "Estado", width: 18 }, { header: "Incidencias", width: 44 }];
  for (const row of rows.filter((item) => item.incidents.length)) incidents.addRow([safeText(row.employeeName), safeText(row.employeeNumber), safeText(row.branchName), row.workDate, row.status === "open" ? "Abierta" : row.incomplete ? "Incompleta" : "Cerrada", safeText(row.incidents.join(", "))]);
  styleSheet(incidents, navy, blue);
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

function styleSheet(sheet: ExcelJS.Worksheet, navy: string, blue: string) {
  const header = sheet.getRow(sheet.name === "Resumen" ? 8 : 1);
  header.height = 26;
  header.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } }; cell.font = { color: { argb: "FFFFFFFF" }, bold: true, size: 10 }; cell.alignment = { vertical: "middle", wrapText: true }; });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > (sheet.name === "Resumen" ? 8 : 1)) {
      if (rowNumber % 2 === 0) row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7FC" } }; });
      row.eachCell((cell) => { cell.alignment = { vertical: "middle", wrapText: true }; if (typeof cell.value === "number") cell.numFmt = "#,##0;[Red]-#,##0;–"; });
    }
  });
  if (sheet.name === "Resumen") { sheet.getRow(1).font = { bold: true, size: 18, color: { argb: `FF${blue}` } }; sheet.getRow(1).height = 30; }
}

export async function createReportPdf(company: string, generatedAt: Date, filters: string[], rows: ReportRow[]) {
  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margins: { top: 36, bottom: 38, left: 30, right: 30 }, bufferPages: true, info: { Title: `Reporte de asistencia - ${company}`, Author: "QR-asistencia", Subject: "Jornadas laborales" } });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => { doc.on("data", (chunk: Buffer) => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  doc.fillColor("#14264a").fontSize(19).font("Helvetica-Bold").text("Reporte de asistencia", { continued: false });
  doc.moveDown(0.25).fontSize(12).text(company, { continued: false });
  doc.moveDown(0.4).fillColor("#475569").font("Helvetica").fontSize(8).text(`Generado: ${generatedAt.toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}  ·  ${filters.join("  ·  ")}`, { width: 730 });
  doc.moveDown(0.7);
  const totals = [
    ["Jornadas", rows.length], ["Presencia", human(rows.reduce((sum, row) => sum + row.presenceMinutes, 0))], ["Efectivo", human(rows.reduce((sum, row) => sum + row.effectiveMinutes, 0))],
    ["Descansos", human(rows.reduce((sum, row) => sum + row.allBreakMinutes, 0))], ["Retardos", human(rows.reduce((sum, row) => sum + (row.latenessMinutes ?? 0), 0))],
    ["Salidas anticipadas", human(rows.reduce((sum, row) => sum + (row.earlyDepartureMinutes ?? 0), 0))],
    ["Excedente detectado", human(rows.reduce((sum, row) => sum + (row.detectedOvertimeMinutes ?? 0), 0))], ["Autorizadas", human(rows.reduce((sum, row) => sum + row.approvedOvertimeMinutes, 0))],
    ["Incompletas", rows.filter((row) => row.incomplete).length],
  ];
  const boxW = 76;
  const boxY = doc.y;
  totals.forEach(([label, value], index) => { const x = 30 + index * (boxW + 4); doc.roundedRect(x, boxY, boxW, 38, 5).fillAndStroke("#f1f5f9", "#dbe3ef"); doc.fillColor("#64748b").fontSize(6).text(String(label), x + 5, boxY + 6, { width: boxW - 10, height: 12, lineBreak: false, ellipsis: true }); doc.fillColor("#14264a").font("Helvetica-Bold").fontSize(8).text(String(value), x + 5, boxY + 22, { width: boxW - 10, height: 10, lineBreak: false, ellipsis: true }); });
  doc.y = boxY + 49;
  const columns: [string, number, (row: ReportRow) => string][] = [
    ["Fecha", 44, (r) => r.workDate], ["Empleado", 92, (r) => r.employeeName], ["Sucursal", 65, (r) => r.branchName], ["Programado", 62, (r) => r.scheduledMinutes === null ? "—" : `${time(r.scheduledStartAt, r.timezone)}-${time(r.scheduledEndAt, r.timezone)}`],
    ["Entrada/salida", 64, (r) => `${time(r.clockIn, r.timezone)}-${time(r.clockOut, r.timezone)}`], ["Presencia", 42, (r) => human(r.presenceMinutes)], ["Descanso P/NP", 48, (r) => `${human(r.paidBreakMinutes)}/${human(r.unpaidBreakMinutes)}`],
    ["Efectivo", 42, (r) => human(r.effectiveMinutes)], ["Retardo", 36, (r) => nullableHuman(r.latenessMinutes)], ["Anticipada", 40, (r) => nullableHuman(r.earlyDepartureMinutes)], ["Detectado", 42, (r) => nullableHuman(r.detectedOvertimeMinutes)], ["Autorizado", 42, (r) => human(r.approvedOvertimeMinutes)], ["Estado/incidencias", 65, (r) => `${r.status === "open" ? "Abierta" : r.incomplete ? "Incompleta" : r.unscheduled ? "Sin horario" : "Cerrada"}${r.incidents.length ? ` · ${r.incidents.join(", ")}` : ""}`],
  ];
  const left = 30; const tableWidth = columns.reduce((sum, [, width]) => sum + width, 0);
  function tableHeader() {
    doc.font("Helvetica-Bold").fontSize(6).fillColor("#fff").rect(left, doc.y, tableWidth, 22).fill("#14264a");
    let x = left;
    for (const [label, width] of columns) { doc.fillColor("#fff").text(label, x + 3, doc.y + 6, { width: width - 5, height: 14, ellipsis: true }); x += width; }
    doc.y += 22;
  }
  tableHeader();
  for (const row of rows) {
    if (doc.y > 530) { doc.addPage(); doc.y = 36; tableHeader(); }
    const top = doc.y; doc.font("Helvetica").fontSize(6.5).fillColor("#1e293b");
    let x = left;
    for (const [label, width, value] of columns) { void label; doc.text(pdfText(value(row)), x + 3, top + 4, { width: width - 6, height: 20, ellipsis: true }); x += width; }
    doc.moveTo(left, top + 24).lineTo(left + tableWidth, top + 24).strokeColor("#dbe3ef").lineWidth(0.35).stroke(); doc.y = top + 25;
  }
  if (!rows.length) doc.fillColor("#64748b").fontSize(10).text("No hay jornadas en el rango seleccionado.", left, doc.y + 12);
  const pages = doc.bufferedPageRange();
  // Keep the footer inside the printable area; PDFKit auto-paginates text that
  // starts at the bottom margin, which used to append a blank trailing page.
  for (let index = pages.start; index < pages.start + pages.count; index++) { doc.switchToPage(index); doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(`QR-asistencia  ·  Página ${index + 1} de ${pages.count}`, 30, 560, { width: 730, align: "right" }); }
  doc.end();
  return complete;
}

function safeText(value: string) { return /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value; }
function time(value: string | null, timezone: string) { return value ? new Intl.DateTimeFormat("es-MX", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—"; }
function human(minutes: number) { return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`; }
function nullableHuman(minutes: number | null) { return minutes === null ? "—" : human(minutes); }
function pdfText(value: string) { return value.replace(/[\r\n\t]+/g, " ").replace(/[^\x20-\xFF]/g, "?"); }
