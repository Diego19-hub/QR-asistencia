"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity, ArrowUpRight, Building2, CalendarClock, ChartNoAxesCombined, ChevronDown, CircleDollarSign,
  ClipboardList, LayoutDashboard, LogOut, Menu, Settings2, ShieldCheck, Users,
} from "lucide-react";
import type { ReactNode } from "react";

import { signOut } from "@/app/(auth)/login/actions";
import { AdminContextProvider, type CompanyOption } from "@/components/admin/admin-context";

const navigation = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/empleados", label: "Empleados", icon: Users },
  { href: "/admin/horarios", label: "Horarios", icon: CalendarClock },
  { href: "/admin/asistencias", label: "Asistencias", icon: ClipboardList },
  { href: "/admin/horas-extra", label: "Horas extra", icon: CircleDollarSign },
  { href: "/admin/supervisores", label: "Supervisores", icon: ShieldCheck },
  { href: "/admin/reportes", label: "Reportes", icon: ChartNoAxesCombined },
  { href: "/admin/configuracion", label: "Configuración", icon: Settings2 },
];

export function AdminShell({
  userName,
  companies,
  initialCompany,
  children,
}: {
  userName: string;
  companies: CompanyOption[];
  initialCompany: CompanyOption;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [companyId, setCompanyId] = useState(initialCompany.companyId);
  const [mobileOpen, setMobileOpen] = useState(false);
  const company = companies.find((item) => item.companyId === companyId) ?? initialCompany;
  const currentLink = (href: string) => href === "/admin" ? pathname === href : pathname.startsWith(href);

  const sidebar = (
    <div className="flex h-full flex-col bg-[#101c35] text-white">
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="grid size-10 place-items-center rounded-xl bg-blue-500 text-white"><Activity size={21} /></div>
        <div><p className="text-sm font-bold tracking-wide">ASISTENCIA</p><p className="mt-0.5 text-[11px] text-slate-400">Control de jornada</p></div>
      </div>
      <div className="px-4 pb-3"><p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">Workspace</p>
        <nav className="space-y-1">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = currentLink(href);
            return <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition ${active ? "bg-blue-500 text-white shadow-lg shadow-blue-950/30" : "text-slate-300 hover:bg-white/8 hover:text-white"}`}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{label === "Empleados" ? <ArrowUpRight className="ml-auto opacity-50" size={14} /> : null}
            </Link>;
          })}
        </nav>
      </div>
      <div className="mt-auto border-t border-white/10 p-4">
        <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-400/20 text-xs font-bold text-blue-200">{userName.slice(0, 2).toUpperCase()}</div>
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{userName}</p><p className="mt-1 text-[10px] text-slate-400">{company.role === "owner" ? "Propietario" : "Administrador"}</p></div>
        </div>
        <form action={signOut} className="mt-2"><button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs text-slate-400 transition hover:bg-white/8 hover:text-white" type="submit"><LogOut size={16} />Cerrar sesión</button></form>
      </div>
    </div>
  );

  return <AdminContextProvider value={{ company, companies, setCompanyId }}>
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[250px] lg:block">{sidebar}</aside>
      {mobileOpen ? <div className="fixed inset-0 z-40 lg:hidden"><button aria-label="Cerrar navegación" className="absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} /><aside className="relative h-full w-[280px] shadow-2xl">{sidebar}</aside></div> : null}
      <div className="lg:pl-[250px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur sm:px-7">
          <div className="flex items-center gap-3">
            <button aria-label="Abrir navegación" onClick={() => setMobileOpen(true)} className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-600 lg:hidden"><Menu size={18} /></button>
            <div className="hidden text-xs text-slate-400 sm:block">Panel administrativo <span className="mx-2 text-slate-300">/</span><span className="font-medium text-slate-700">{navigation.find((item) => currentLink(item.href))?.label ?? "Dashboard"}</span></div>
            <div className="flex items-center gap-2 sm:hidden"><Building2 className="text-blue-700" size={16} /><span className="max-w-36 truncate text-xs font-semibold">{company.companyName}</span></div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-600">
              <Building2 size={15} className="text-blue-700" />
              <select aria-label="Empresa activa" value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="max-w-44 cursor-pointer appearance-none bg-transparent pr-1 text-xs font-semibold text-slate-800 outline-none">
                {companies.map((item) => <option key={item.companyId} value={item.companyId}>{item.companyName}</option>)}
              </select><ChevronDown size={13} className="text-slate-400" />
            </label>
            <div className="hidden size-9 place-items-center rounded-full bg-[#e8efff] text-xs font-bold text-blue-800 sm:grid">{userName.slice(0, 2).toUpperCase()}</div>
          </div>
        </header>
        <main className="mx-auto min-h-[calc(100vh-72px)] max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8">{children}</main>
      </div>
    </div>
  </AdminContextProvider>;
}
