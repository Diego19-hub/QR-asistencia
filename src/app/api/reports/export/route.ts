import { resolveAdminScope, scopeError } from "@/lib/admin/scope";
import { createReportPdf, createReportWorkbook } from "@/lib/reports/export-files";
import { acquireDistributedExportLease } from "@/lib/reports/export-lease";
import { loadReport, reportResponseError } from "@/lib/reports/data";

export const runtime = "nodejs";

function safeFilePart(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "empresa"; }
function apiError(code: string, message: string, status: number, headers: HeadersInit = {}) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  if (format !== "xlsx" && format !== "pdf") return apiError("invalid_format", "Elige Excel o PDF.", 400);

  const admin = await resolveAdminScope(request);
  if (!admin.ok) return scopeError(admin);

  // Claim the cross-instance, cross-company slot before quota accounting or any
  // report query. A concurrency rejection therefore does not consume quota.
  const claim = await acquireDistributedExportLease(admin.scope.supabase, admin.scope.company.companyId).catch(() => null);
  if (!claim) return apiError("export_concurrency_unavailable", "No fue posible validar la disponibilidad de exportación.", 503);
  if (!claim.acquired) {
    if ("error" in claim) {
      if (claim.error?.code === "42501") return apiError("export_forbidden", "No tienes permiso para exportar reportes de esta empresa.", 403);
      return apiError("export_concurrency_unavailable", "No fue posible validar la disponibilidad de exportación.", 503);
    }
    return apiError("export_concurrency_limited", "Ya se está generando otro reporte. Intenta nuevamente cuando termine.", 429, { "Retry-After": String(claim.retryAfterSeconds) });
  }

  const lease = claim.lease;
  let responseOwnsLease = false;
  try {
    const { data: quota, error: quotaError } = await admin.scope.supabase.rpc("consume_report_export_quota", {
      p_company_id: admin.scope.company.companyId,
    });
    if (quotaError) {
      if (quotaError.code === "42501") return apiError("export_forbidden", "No tienes permiso para exportar reportes de esta empresa.", 403);
      return apiError("export_quota_unavailable", "No fue posible validar el límite de exportaciones.", 503);
    }
    const quotaRow = Array.isArray(quota) ? quota[0] : quota;
    if (!quotaRow) return apiError("export_quota_unavailable", "No fue posible validar el límite de exportaciones.", 503);
    if (!quotaRow.allowed) return apiError("export_rate_limited", "Se alcanzó el límite de 10 exportaciones en 5 minutos. Intenta nuevamente más tarde.", 429, { "Retry-After": String(quotaRow.retry_after_seconds) });

    url.searchParams.set("all", "true");
    const result = await loadReport(new Request(url, { headers: request.headers }));
    if (!result.ok) return reportResponseError(result);
    if (result.truncated) return apiError("report_too_large", "El reporte supera el límite de consulta. Reduce el periodo o filtra por empleado/sucursal.", 413);
    if (result.rows.length > 500) return apiError("report_export_too_large", "Las exportaciones actuales admiten hasta 500 jornadas por archivo. Reduce el periodo o aplica filtros; la generación progresiva se habilitará en una etapa posterior.", 413);

    const generatedAt = new Date();
    const filters = [`Periodo: ${result.filters.from} a ${result.filters.to}`, result.filters.branchId ? `Sucursal: ${result.branches.find((item) => item.id === result.filters.branchId)?.name ?? "seleccionada"}` : "Todas las sucursales", result.filters.employeeId ? `Empleado: ${result.employees.find((item) => item.id === result.filters.employeeId)?.name ?? "seleccionado"}` : "Todos los empleados", `Estado: ${result.filters.status}`];
    const baseName = safeFilePart(result.scope.company.companyName);
    const file = format === "xlsx"
      ? await createReportWorkbook(result.scope.company.companyName, generatedAt, filters, result.rows)
      : await createReportPdf(result.scope.company.companyName, generatedAt, filters, result.rows);

    // If the lease expired or renewal failed while generating, do not serve a
    // file whose generation no longer owns the global slot.
    if (!await lease.renew()) return apiError("export_lease_lost", "La generación perdió su permiso. Intenta nuevamente.", 503);

    const contentType = format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf";
    const response = new Response(lease.createResponseBody(file), { headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="reporte-${baseName}.${format}"`,
      "Cache-Control": "no-store, private",
    } });
    responseOwnsLease = true;
    return response;
  } catch {
    return apiError("export_generation_failed", "No fue posible generar el reporte. Intenta nuevamente.", 500);
  } finally {
    if (!responseOwnsLease) await lease.release();
  }
}
