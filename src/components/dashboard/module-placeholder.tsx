import { Clock3 } from "lucide-react";

export function ModulePlaceholder({ title }: { title: string }) {
  return (
    <section className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-5"><p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Módulo administrativo</p><h1 className="mt-1 text-2xl font-bold text-slate-950">{title}</h1></div>
      <div className="px-6 py-14 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-slate-50 text-slate-400"><Clock3 size={21} /></div><p className="mt-4 text-sm font-semibold text-slate-800">Próximamente</p><p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">Este módulo todavía no está habilitado. Aquí no se muestran datos ni acciones simuladas.</p></div>
    </section>
  );
}
