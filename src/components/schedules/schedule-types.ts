export type BreakRule = { id: string; code: string; name: string; counts_as_work: boolean; required: boolean; max_minutes: number | null; requires_qr: boolean };
export type BreakRow = { id: string; template_day_id: string; break_rule_id: string; planned_start_local: string; planned_end_local: string; planned_minutes: number; rule: BreakRule | null };
export type ScheduleDay = { id: string; iso_weekday: number; start_local: string | null; end_local: string | null; scheduled_minutes: number; breaks: BreakRow[] };
export type Schedule = { id: string; branch_id: string; name: string; kind: "fixed" | "variable"; active: boolean; workday_type: "day" | "night" | "mixed"; entry_tolerance_minutes: number; effective_from: string; effective_to: string | null; revision_of: string | null; days: ScheduleDay[] };
export type Employee = { id: string; employee_number: string; first_name: string; last_name: string; branch_id: string | null; active: boolean };
