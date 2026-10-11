import { z } from "zod";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const branchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  timezone: z.string().min(1).max(80),
}).strict();

const breakSchema = z.object({
  name: z.string().trim().min(1).max(80),
  start: time,
  end: time,
  countsAsWork: z.boolean(),
  requiresQr: z.boolean(),
  required: z.boolean(),
  maxMinutes: z.number().int().min(1).max(1440).nullable(),
}).strict();

const workdaySchema = z.object({
  weekday: z.number().int().min(1).max(7),
  start: time,
  end: time,
  breaks: z.array(breakSchema).max(8),
}).strict();

export const createScheduleSchema = z.object({
  branchId: uuid,
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["fixed", "variable"]),
  workdayType: z.enum(["day", "night", "mixed"]),
  entryToleranceMinutes: z.number().int().min(0).max(1440),
  effectiveFrom: date,
  effectiveTo: date.nullable(),
  days: z.array(workdaySchema).min(1).max(7),
  revisionOf: uuid.nullable(),
}).strict().superRefine((value, ctx) => {
  const dayIds = value.days.map((day) => day.weekday);
  if (new Set(dayIds).size !== dayIds.length) ctx.addIssue({ code: "custom", path: ["days"], message: "Los días laborales deben ser únicos." });
  const from = new Date(`${value.effectiveFrom}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || from.toISOString().slice(0, 10) !== value.effectiveFrom) ctx.addIssue({ code: "custom", path: ["effectiveFrom"], message: "La fecha inicial no es válida." });
  if (value.effectiveTo) {
    const to = new Date(`${value.effectiveTo}T00:00:00.000Z`);
    if (Number.isNaN(to.getTime()) || to.toISOString().slice(0, 10) !== value.effectiveTo || value.effectiveTo < value.effectiveFrom) ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "El periodo de vigencia no es válido." });
  }
  for (const [dayIndex, day] of value.days.entries()) {
    const start = minuteOfDay(day.start);
    const end = minuteOfDay(day.end) + (minuteOfDay(day.end) <= start ? 1440 : 0);
    if (end <= start || end - start > 1440) ctx.addIssue({ code: "custom", path: ["days", dayIndex, "end"], message: "La duración del turno debe ser de 1 a 24 horas." });
    const breakIntervals: Array<{ start: number; end: number; index: number }> = [];
    for (const [breakIndex, item] of day.breaks.entries()) {
      let breakStart = minuteOfDay(item.start);
      let breakEnd = minuteOfDay(item.end);
      if (breakStart < start) breakStart += 1440;
      if (breakEnd <= breakStart) breakEnd += 1440;
      if (breakStart < start || breakEnd > end || breakEnd - breakStart > 1440) {
        ctx.addIssue({ code: "custom", path: ["days", dayIndex, "breaks", breakIndex], message: "El descanso debe quedar dentro del horario del turno." });
      }
      breakIntervals.push({ start: breakStart, end: breakEnd, index: breakIndex });
    }
    breakIntervals.sort((a, b) => a.start - b.start);
    for (let index = 1; index < breakIntervals.length; index++) {
      if (breakIntervals[index].start < breakIntervals[index - 1].end) {
        ctx.addIssue({ code: "custom", path: ["days", dayIndex, "breaks", breakIntervals[index].index], message: "Los descansos de un mismo turno no pueden superponerse." });
      }
    }
  }
});

export const assignmentSchema = z.object({
  branchId: uuid,
  templateId: uuid,
  employeeIds: z.array(uuid).min(1).max(100),
  startsOn: date,
  endsOn: date.nullable(),
}).strict().refine((value) => new Set(value.employeeIds).size === value.employeeIds.length, "No repitas empleados.").refine((value) => !value.endsOn || value.endsOn >= value.startsOn, "La fecha final debe ser posterior a la inicial.");

export const laborRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  effectiveFrom: date,
  effectiveTo: date.nullable(),
  lateGraceMinutes: z.number().int().min(0).max(1440),
  earlyDepartureGraceMinutes: z.number().int().min(0).max(1440),
  restWeekdays: z.array(z.number().int().min(1).max(7)).max(7),
  dayStartsAt: time,
  nightStartsAt: time,
  overtimeDetection: z.boolean(),
  overtimeThresholdMinutes: z.number().int().min(0).max(1440),
  overtimeRecognition: z.enum(["authorization_only", "configured_rules"]),
}).strict().refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, "El periodo de vigencia no es válido.").refine((value) => new Set(value.restWeekdays).size === value.restWeekdays.length, "No repitas días de descanso.");

export function minuteOfDay(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function durationMinutes(start: string, end: string) {
  const startAt = minuteOfDay(start);
  const endAt = minuteOfDay(end);
  const duration = (endAt - startAt + 1440) % 1440;
  return duration === 0 ? 1440 : duration;
}
