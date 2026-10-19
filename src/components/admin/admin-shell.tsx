"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity, Building2, CalendarClock, ChartNoAxesCombined, ChevronDown,
  ClipboardList, LayoutDashboard, LogOut, Menu, Settings2, ShieldCheck, Users,
} from "lucide-react";
import type { ReactNode } from "react";

import { signOut } from "@/app/(auth)/login/actions";
import { setAdminMembership } from "@/app/(admin)/admin/actions";
import { AdminContextProvider, type CompanyOption } from "@/components/admin/admin-context";

const navigation = [
  { href: "/admin", label: "Inicio", icon: LayoutDashboard },
  { href: "/admin/empleados", label: "Empleados", icon: Users },
  { href: "/admin/horarios", label: "Horarios", icon: CalendarClock },
  { href: "/admin/asistencias", label: "Asistencias", icon: ClipboardList },
  { href: "/admin/configuracion", label: "Configuración", icon: Settings2 },
];

const attendanceNavigation = [
  { href: "/admin/asistencias", label: "Registros", icon: ClipboardList },
  { href: "/admin/reportes", label: "Reportes", icon: ChartNoAxesCombined },
  { href: "/admin/horas-extra", label: "Horas extra", icon: CalendarClock },
];

const settingsNavigation = [
  { href: "/admin/configuracion", label: "Empresa y sucursales", icon: Building2 },
  { href: "/admin/supervisores", label: "Supervisores y dispositivos", icon: ShieldCheck },
  { href: "/admin/configuracion#avanzada", label: "Configuración avanzada", icon: Settings2 },
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const [companyId, setCompanyId] = useState(initialCompany.companyId);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeHash, setActiveHash] = useState("");
  const [changingCompany, setChangingCompany] = useState(false);
  const [companyError, setCompanyError] = useState("");
  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);
  useEffect(() => {
    const updateHash = () => setActiveHash(window.location.hash);
    updateHash();
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, [pathname]);
  const company = companies.find((item) => item.companyId === companyId) ?? initialCompany;
  const attendanceSection = pathname.startsWith("/admin/asistencias") || pathname.startsWith("/admin/reportes") || pathname.startsWith("/admin/horas-extra");
  const settingsSection = pathname.startsWith("/admin/configuracion") || pathname.startsWith("/admin/supervisores");
  const currentLink = (href: string) => href === "/admin"
    ? pathname === href
    : href === "/admin/asistencias"
      ? attendanceSection
      : href === "/admin/configuracion"
        ? settingsSection
        : pathname.startsWith(href);
  const secondaryNavigation = attendanceSection ? attendanceNavigation : settingsSection ? settingsNavigation : [];
  const pageLabel = attendanceSection
    ? attendanceNavigation.find((item) => pathname.startsWith(item.href))?.label ?? "Asistencias"
    : settingsSection
      ? pathname.startsWith("/admin/supervisores") ? "Supervisores y dispositivos" : "Configuración"
      : navigation.find((item) => currentLink(item.href))?.label ?? "Inicio";
  const tabQuery = searchParams.toString();

  const sidebar = (
    <div className="flex h-full flex-col bg-[#101c35] text-white">
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="grid size-10 place-items-center rounded-xl bg-blue-500 text-white"><Activity size={21} /></div>
        <div><p className="text-sm font-bold tracking-wide">ASISTENCIA</p><p className="mt-0.5 text-[11px] text-slate-400">Control de jornada</p></div>
      </div>
      <div className="px-4 pb-3"><p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">Administración</p>
        <nav aria-label="Navegación administrativa" className="space-y-1">
          {navigation.map(({ href, label, icon: Icon }) => {
            const active = currentLink(href);
            return <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)} className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${active ? "bg-blue-500 text-white shadow-lg shadow-blue-950/30" : "text-slate-300 hover:bg-white/8 hover:text-white"}`}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
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
      {mobileOpen ? <div className="fixed inset-0 z-40 lg:hidden"><button aria-label="Cerrar navegación" className="absolute inset-0 bg-slate-950/50" onClick={() => setMobileOpen(false)} /><aside id="admin-navigation-drawer" aria-label="Menú administrativo" className="relative h-full w-[min(280px,85vw)] shadow-2xl">{sidebar}</aside></div> : null}
      <div className="lg:pl-[250px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur sm:px-7">
          <div className="flex items-center gap-3">
            <button aria-label="Abrir navegación" aria-expanded={mobileOpen} aria-controls="admin-navigation-drawer" onClick={() => setMobileOpen(true)} className="grid size-10 place-items-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:hidden"><Menu size={18} /></button>
            <div className="hidden text-xs text-slate-400 sm:block">Panel <span className="mx-2 text-slate-300">/</span><span className="font-medium text-slate-700">{pageLabel}</span></div>
            <div className="text-xs font-semibold text-slate-700 sm:hidden">{pageLabel}</div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-600">
              <Building2 size={15} className="text-blue-700" />
              <select aria-label="Empresa activa" value={companyId} disabled={changingCompany} onChange={async (event) => {
                const selected = companies.find((item) => item.companyId === event.target.value);
                if (!selected || selected.companyId === companyId) return;
                setChangingCompany(true);
                setCompanyError("");
                try {
                  if (await setAdminMembership(selected.membershipId)) {
                    setCompanyId(selected.companyId);
                    router.refresh();
                  }
                  else setCompanyError("No se pudo cambiar la empresa. Verifica tu acceso e inténtalo de nuevo.");
                } catch {
                  setCompanyError("Ocurrió un error al cambiar de empresa. Inténtalo de nuevo.");
                } finally {
                  setChangingCompany(false);
                }
              }} className="max-w-44 cursor-pointer appearance-none bg-transparent pr-1 text-xs font-semibold text-slate-800 outline-none disabled:cursor-wait disabled:opacity-60">
                {companies.map((item) => <option key={item.companyId} value={item.companyId}>{item.companyName}</option>)}
              </select><ChevronDown size={13} className="text-slate-400" />
            </label>
            <div className="hidden size-9 place-items-center rounded-full bg-[#e8efff] text-xs font-bold text-blue-800 sm:grid">{userName.slice(0, 2).toUpperCase()}</div>
          </div>
        </header>
        {secondaryNavigation.length ? <nav aria-label={attendanceSection ? "Secciones de Asistencias" : "Secciones de Configuración"} className="border-b border-slate-200/80 bg-white px-4 sm:px-7"><div className="mx-auto flex max-w-[1500px] gap-2 overflow-x-auto">{secondaryNavigation.map(({ href, label, icon: Icon }) => {
          const hasAnchor = href.includes("#");
          const active = hasAnchor
            ? pathname === href.split("#")[0] && activeHash === href.slice(href.indexOf("#"))
            : pathname === href && (!settingsSection || activeHash !== "#avanzada");
          const preserveQuery = attendanceSection && tabQuery;
          const target = preserveQuery ? `${href.split("#")[0]}?${tabQuery}${href.includes("#") ? href.slice(href.indexOf("#")) : ""}` : href;
          return <Link key={href} href={target} onClick={() => { if (hasAnchor) setActiveHash(href.slice(href.indexOf("#"))); else if (settingsSection) setActiveHash(""); }} aria-current={active ? "page" : undefined} className={`inline-flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${active ? "border-blue-600 text-blue-800" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"}`}><Icon size={15} />{label}</Link>;
        })}</div></nav> : null}
        {companyError ? <div role="alert" className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 sm:mx-7">{companyError}</div> : null}
        <main className="mx-auto min-h-[calc(100vh-72px)] max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8">{children}</main>
      </div>
    </div>
  </AdminContextProvider>;
}
