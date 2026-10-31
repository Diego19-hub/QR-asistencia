"use client";

import type { ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReportAnalytics, ReportSummary } from "@/lib/reports/data";

const duration = (value: number | null) => value === null ? "—" : `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, "0")} min`;

export function ReportsCharts({ analytics, summary }: { analytics: ReportAnalytics; summary: ReportSummary | undefined }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard title="Horas efectivas por día" subtitle="Comparación con minutos programados" icon={<BarChart3 size={16} />}><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.byDay}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} fontSize={10} /><YAxis tickFormatter={(value) => `${Math.round(value / 60)}h`} fontSize={10} /><Tooltip formatter={(value) => duration(Number(value))} /><Legend /><Bar dataKey="scheduledMinutes" name="Programadas" fill="#cbd5e1" radius={[3, 3, 0, 0]} /><Bar dataKey="effectiveMinutes" name="Efectivas" fill="#2563eb" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Retardos por empleado" subtitle="Minutos acumulados en el periodo" icon={<BarChart3 size={16} />}><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.byEmployee} layout="vertical" margin={{ left: 8, right: 18 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" fontSize={10} /><YAxis type="category" dataKey="name" width={105} tick={{ fontSize: 9 }} /><Tooltip formatter={(value) => duration(Number(value))} /><Bar dataKey="latenessMinutes" name="Retardo" fill="#f59e0b" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Excedente y horas autorizadas" subtitle="Detección y autorización separadas" icon={<BarChart3 size={16} />}><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: "Horas", detected: summary?.detectedOvertimeMinutes ?? 0, approved: summary?.approvedOvertimeMinutes ?? 0 }]}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={10} /><YAxis tickFormatter={(value) => `${Math.round(value / 60)}h`} fontSize={10} /><Tooltip formatter={(value) => duration(Number(value))} /><Legend /><Bar dataKey="detected" name="Excedente detectado" fill="#f59e0b" radius={[4, 4, 0, 0]} /><Bar dataKey="approved" name="Extra autorizada" fill="#10b981" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Comparación de sucursales" subtitle={`${summary?.incomplete ?? 0} jornadas incompletas en el periodo`} icon={<BarChart3 size={16} />}><ResponsiveContainer width="100%" height="100%"><BarChart data={analytics.byBranch}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={10} /><YAxis tickFormatter={(value) => `${Math.round(value / 60)}h`} fontSize={10} /><Tooltip formatter={(value) => duration(Number(value))} /><Legend /><Bar dataKey="scheduledMinutes" name="Programadas" fill="#cbd5e1" radius={[3, 3, 0, 0]} /><Bar dataKey="effectiveMinutes" name="Efectivas" fill="#0f766e" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Jornadas incompletas" subtitle="Abiertas y con descansos sin cerrar" icon={<BarChart3 size={16} />}><ResponsiveContainer width="100%" height="100%"><BarChart data={[{ name: "Jornadas", incomplete: summary?.incomplete ?? 0, closed: Math.max(0, (summary?.sessions ?? 0) - (summary?.incomplete ?? 0)) }]}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={10} /><YAxis allowDecimals={false} fontSize={10} /><Tooltip /><Legend /><Bar dataKey="incomplete" name="Incompletas" fill="#f59e0b" radius={[4, 4, 0, 0]} /><Bar dataKey="closed" name="Completas" fill="#10b981" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard>
    </div>
  );
}

function ChartCard({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start gap-3"><span className="grid size-8 place-items-center rounded-lg bg-blue-50 text-blue-700">{icon}</span><div><h3 className="text-xs font-bold text-slate-800">{title}</h3><p className="mt-1 text-[10px] text-slate-400">{subtitle}</p></div></div><div className="mt-4 h-[235px]">{children}</div></article>;
}
