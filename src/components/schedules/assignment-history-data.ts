import type { Employee } from "@/components/schedules/schedule-types";

export type AssignmentHistoryItem = {
  id: string;
  employee_id: string;
  template_id: string | null;
  branch_id: string;
  starts_on: string;
  ends_on: string | null;
  planned_start_local: string | null;
  planned_end_local: string | null;
  planned_minutes: number;
};

type AssignmentResponse = { items?: AssignmentHistoryItem[]; error?: { message?: string } };
type ScheduleResponse = { employees?: Employee[] };

export async function loadAssignmentHistory(
  query: URLSearchParams,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const params = new URLSearchParams(query);
  const [assignmentResponse, dataResponse] = await Promise.all([
    fetcher(`/api/schedules/assignments?${params}`, { cache: "no-store", signal }),
    fetcher(`/api/schedules?${params}`, { cache: "no-store", signal }),
  ]);
  const [assignmentPayload, dataPayload] = await Promise.all([
    assignmentResponse.json() as Promise<AssignmentResponse>,
    dataResponse.json() as Promise<ScheduleResponse>,
  ]);

  if (!assignmentResponse.ok) {
    throw new Error(assignmentPayload.error?.message ?? "No fue posible cargar las asignaciones.");
  }

  return {
    items: assignmentPayload.items ?? [],
    employees: dataPayload.employees ?? [],
  };
}
