export const ISO_WEEKDAYS = [
  { id: "monday", isoWeekday: 1, label: "Lunes" },
  { id: "tuesday", isoWeekday: 2, label: "Martes" },
  { id: "wednesday", isoWeekday: 3, label: "Miércoles" },
  { id: "thursday", isoWeekday: 4, label: "Jueves" },
  { id: "friday", isoWeekday: 5, label: "Viernes" },
  { id: "saturday", isoWeekday: 6, label: "Sábado" },
  { id: "sunday", isoWeekday: 7, label: "Domingo" },
] as const;

export type WeekdayNumber = (typeof ISO_WEEKDAYS)[number]["isoWeekday"];

export type WeekDraftDay<TBreak> = {
  weekday: WeekdayNumber;
  enabled: boolean;
  start: string;
  end: string;
  breaks: TBreak[];
};

export type WeekDraft<TBreak> = Record<WeekdayNumber, WeekDraftDay<TBreak>>;

export function toggleWeekday<TBreak>(
  days: WeekDraft<TBreak>,
  weekday: WeekdayNumber,
): WeekDraft<TBreak> {
  const day = days[weekday];
  return { ...days, [weekday]: { ...day, enabled: !day.enabled } };
}

export function patchWeekday<TBreak>(
  days: WeekDraft<TBreak>,
  weekday: WeekdayNumber,
  update: Partial<WeekDraftDay<TBreak>>,
): WeekDraft<TBreak> {
  return { ...days, [weekday]: { ...days[weekday], ...update } };
}

export function getEnabledWeekdays<TBreak>(days: WeekDraft<TBreak>): WeekDraftDay<TBreak>[] {
  return ISO_WEEKDAYS.map(({ isoWeekday }) => days[isoWeekday]).filter((day) => day.enabled);
}

/** PostgreSQL extract(isodow) and this form both use ISO Monday=1 through Sunday=7. */
export function createWeekDraft<TBreak>(
  sourceDays: Array<{
    iso_weekday: number;
    start: string;
    end: string;
    breaks: TBreak[];
  }>,
): WeekDraft<TBreak> {
  const byWeekday = new Map<number, (typeof sourceDays)[number]>();
  for (const day of sourceDays) {
    if (day.iso_weekday >= 1 && day.iso_weekday <= 7 && !byWeekday.has(day.iso_weekday)) {
      byWeekday.set(day.iso_weekday, day);
    }
  }

  const week = {} as WeekDraft<TBreak>;
  for (const { isoWeekday } of ISO_WEEKDAYS) {
    const source = byWeekday.get(isoWeekday);
    week[isoWeekday] = {
      weekday: isoWeekday,
      enabled: source !== undefined,
      start: source?.start ?? "09:00",
      end: source?.end ?? "17:00",
      breaks: source?.breaks ?? [],
    };
  }
  return week;
}
