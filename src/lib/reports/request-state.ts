export type ReportRequestState<T extends { truncated: boolean }> =
  | { key: string; status: "loading" }
  | { key: string; status: "success"; data: T }
  | { key: string; status: "error"; message: string };

export type ReportFilterIdentity = {
  from: string;
  to: string;
  branchId: string;
  employeeId: string;
  status: string;
};

export function getReportView<T extends { truncated: boolean }>(
  state: ReportRequestState<T> | null,
  requestKey: string,
) {
  if (!state || state.key !== requestKey) return { data: null, error: "", loading: true };
  if (state.status === "success") return { data: state.data, error: "", loading: false };
  if (state.status === "error") return { data: null, error: state.message, loading: false };
  return { data: null, error: "", loading: true };
}

export function reportFiltersMatch(draft: ReportFilterIdentity, applied: ReportFilterIdentity) {
  return draft.from === applied.from
    && draft.to === applied.to
    && draft.branchId === applied.branchId
    && draft.employeeId === applied.employeeId
    && draft.status === applied.status;
}

export function canExportReport<T extends { truncated: boolean }>(
  state: ReportRequestState<T> | null,
  requestKey: string,
  filtersMatch: boolean,
) {
  return filtersMatch
    && state?.key === requestKey
    && state.status === "success"
    && !state.data.truncated;
}

export function getExportFailureMessage(bodyText: string, status: number) {
  try {
    const body = JSON.parse(bodyText) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string" && body.error.message.trim()) return body.error.message;
  } catch {
    // A proxy or server failure may return an empty or non-JSON response.
  }
  return `No fue posible generar el archivo (HTTP ${status}).`;
}
