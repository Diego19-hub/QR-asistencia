import { loadReport, reportResponseError } from "@/lib/reports/data";
import { createReportPdf, createReportWorkbook } from "@/lib/reports/export-files";

export const runtime = "nodejs";

function safeFilePart(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "empresa"; }

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (format !== "xlsx" && format !== "pdf") return Response.json({ error: { code: "invalid_format", message: "Elige Excel o PDF." } }, { status: 400 });
  url.searchParams.set("all", "true");
  const result = await loadReport(new Request(url, { headers: request.headers }));
  if (!result.ok) return reportResponseError(result);
  if (result.truncated) return Response.json({ error: { code: "report_too_large", message: "El reporte supera el límite de 5,000 jornadas. Reduce el periodo o filtra por empleado/sucursal." } }, { status: 413 });
  const generatedAt = new Date();
  const filters = [`Periodo: ${result.filters.from} a ${result.filters.to}`, result.filters.branchId ? `Sucursal: ${result.branches.find((item) => item.id === result.filters.branchId)?.name ?? "seleccionada"}` : "Todas las sucursales", result.filters.employeeId ? `Empleado: ${result.employees.find((item) => item.id === result.filters.employeeId)?.name ?? "seleccionado"}` : "Todos los empleados", `Estado: ${result.filters.status}`];
  const baseName = safeFilePart(result.scope.company.companyName);
  if (format === "xlsx") {
    const file = await createReportWorkbook(result.scope.company.companyName, generatedAt, filters, result.rows);
    return new Response(Uint8Array.from(file).buffer as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="reporte-${baseName}.xlsx"`, "Cache-Control": "no-store, private" } });
  }
  const file = await createReportPdf(result.scope.company.companyName, generatedAt, filters, result.rows);
  return new Response(Uint8Array.from(file).buffer as ArrayBuffer, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="reporte-${baseName}.pdf"`, "Cache-Control": "no-store, private" } });
}
