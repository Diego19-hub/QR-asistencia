import { z } from "zod";

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().email("Escribe un correo válido.").max(254).nullable().optional(),
);

const optionalUuid = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().uuid("Selecciona una sucursal válida.").nullable().optional(),
);

const optionalDate = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa una fecha válida.").nullable().optional(),
);

export const employeeFields = {
  employee_number: z.string().trim().min(1, "El identificador es obligatorio.").max(64),
  first_name: z.string().trim().min(1, "El nombre es obligatorio.").max(100),
  last_name: z.string().trim().min(1, "Los apellidos son obligatorios.").max(120),
  email: optionalEmail,
  branch_id: optionalUuid,
  hired_on: optionalDate,
  active: z.boolean(),
};

export const createEmployeeSchema = z.object({
  employee_number: employeeFields.employee_number,
  first_name: employeeFields.first_name,
  last_name: employeeFields.last_name,
  email: optionalEmail,
  branch_id: optionalUuid,
  hired_on: optionalDate,
}).strict();

export const patchEmployeeSchema = z.object({
  employee_number: employeeFields.employee_number.optional(),
  first_name: employeeFields.first_name.optional(),
  last_name: employeeFields.last_name.optional(),
  email: optionalEmail,
  branch_id: optionalUuid,
  hired_on: optionalDate,
  active: employeeFields.active.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Incluye al menos un campo para actualizar.");

export const employeeIdSchema = z.string().uuid();

export function isValidCalendarDate(value: string | null | undefined) {
  if (!value) return true;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
