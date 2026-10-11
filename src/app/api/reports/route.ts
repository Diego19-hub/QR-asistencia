import { loadReport, reportResponseError } from "@/lib/reports/data";

export async function GET(request: Request) {
  const result = await loadReport(request);
  if (!result.ok) return reportResponseError(result);
  return Response.json({
    company: { id: result.scope.company.companyId, name: result.scope.company.companyName },
    filters: result.filters,
    rows: result.rows,
    totalRows: result.totalRows,
    truncated: result.truncated,
    branches: result.branches,
    employees: result.employees,
    summary: result.summary,
    analytics: result.analytics,
    payPeriodRule: result.payPeriodRule,
  }, { headers: { "Cache-Control": "no-store, private" } });
}
