import type { ReactNode } from "react";

export function ScheduleEmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <div className="px-6 py-14 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-50 text-slate-400">{icon}</div><p className="mt-4 text-sm font-semibold text-slate-800">{title}</p><p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">{description}</p></div>;
}
