export type AttendanceStatus = "open" | "closed" | "incomplete" | "unscheduled";

export function getAttendanceStatus(input: { status: string; incompleteBreaks: boolean; scheduledMinutes: number | null }): AttendanceStatus {
  if (input.status === "open") return "open";
  if (input.incompleteBreaks) return "incomplete";
  if (input.scheduledMinutes === null) return "unscheduled";
  return "closed";
}

export function hasAttendanceIncident(input: { incompleteBreaks: boolean; scheduledMinutes: number | null; latenessMinutes: number | null; earlyDepartureMinutes: number | null }) {
  return input.incompleteBreaks || input.scheduledMinutes === null || Number(input.latenessMinutes ?? 0) > 0 || Number(input.earlyDepartureMinutes ?? 0) > 0;
}
