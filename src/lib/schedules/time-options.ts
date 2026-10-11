export const TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

export function isValidTime(value: string): boolean {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function formatTime12Hour(value: string): string {
  if (!isValidTime(value)) return value;
  const [hour, minute] = value.split(":").map(Number);
  const displayHour = hour % 12 || 12;
  const suffix = hour < 12 ? "a. m." : "p. m.";
  return `${String(displayHour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function normalizeTimeQuery(value: string): string {
  const query = value.trim().toLowerCase();
  if (/^\d$/.test(query)) return `0${query}`;
  if (/^\d:$/.test(query)) return `0${query}`;
  if (/^\d:\d{1,2}$/.test(query)) return `0${query}`;
  return query;
}

export function filterTimeOptions(options: string[], query: string): string[] {
  const normalized = normalizeTimeQuery(query);
  if (!normalized) return options;
  return options.filter((time) => time.startsWith(normalized));
}

export function nearestTimeOption(value: string, now = new Date()): string {
  if (isValidTime(value)) {
    const [hour, minute] = value.split(":").map(Number);
    const rounded = Math.round((hour * 60 + minute) / 15) * 15 % 1440;
    return TIME_OPTIONS[rounded / 15];
  }
  const minutes = now.getHours() * 60 + now.getMinutes();
  const rounded = Math.round(minutes / 15) * 15 % 1440;
  return TIME_OPTIONS[rounded / 15];
}
