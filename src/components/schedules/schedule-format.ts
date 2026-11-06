export const formatTime = (value: string | null | undefined) => value?.slice(0, 5) ?? "—";

export const formatMinutes = (minutes: number | null | undefined) =>
  minutes == null ? "—" : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
