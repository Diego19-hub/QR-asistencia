"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";

import { ScheduleEmptyState } from "@/components/schedules/schedule-empty-state";
import { formatMinutes, formatTime } from "@/components/schedules/schedule-format";
import type { Employee, Schedule } from "@/components/schedules/schedule-types";
import { loadAssignmentHistory, type AssignmentHistoryItem } from "@/components/schedules/assignment-history-data";

export function AssignmentHistory({ schedules, query }: { schedules: Schedule[]; query: URLSearchParams }) {
  const [items, setItems] = useState<AssignmentHistoryItem[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadAssignmentHistory(query, controller.signal)
        .then(({ items: nextItems, employees: nextEmployees }) => {
          setItems(nextItems);
          setEmployees(nextEmployees);
          setError("");
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No fue posible cargar el historial.");
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const employeeById = new Map(employees.map((item) => [item.id, item]));
  const scheduleById = new Map(schedules.map((item) => [item.id, item]));

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5">
        <h2 className="text-sm font-bold text-slate-900">Historial de asignaciones</h2>
        <p className="mt-1 text-xs text-slate-500">Periodos pasados y vigentes ordenados por fecha.</p>
      </div>
      {error ? (
        <p role="alert" className="p-5 text-xs text-rose-700">{error}</p>
      ) : !items.length ? (
        <ScheduleEmptyState icon={<Users size={20} />} title="Sin asignaciones" description="Las asignaciones creadas aparecerán aquí." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-5 py-3">Empleado</th>
                <th className="px-5 py-3">Horario</th>
                <th className="px-5 py-3">Horario diario</th>
                <th className="px-5 py-3">Vigencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => {
                const employee = employeeById.get(item.employee_id);
                const schedule = scheduleById.get(item.template_id ?? "");
                return (
                  <tr key={item.id}>
                    <td className="px-5 py-3 text-xs font-semibold text-slate-800">{employee ? `${employee.first_name} ${employee.last_name}` : "Empleado"}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{schedule?.name ?? "Horario variable"}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{formatTime(item.planned_start_local)}–{formatTime(item.planned_end_local)} · {formatMinutes(item.planned_minutes)}</td>
                    <td className="px-5 py-3 text-xs text-slate-600">{item.starts_on} – {item.ends_on ?? "abierta"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
