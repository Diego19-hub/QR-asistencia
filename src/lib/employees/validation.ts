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

export const employeeNssSchema = z.string().trim().regex(/^\d{11}$/, "El NSS debe contener exactamente 11 dígitos.");
export const employeeRfcSchema = z.string().trim()
  .min(1, "El RFC personal es obligatorio.")
  .max(13, "El RFC personal debe tener 13 caracteres.")
  .toUpperCase()
  .length(13, "El RFC personal debe tener 13 caracteres.")
  .regex(/^[A-Z&Ñ]{4}\d{6}[A-Z0-9]{3}$/, "Revisa el formato del RFC personal.");

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
  nss: employeeNssSchema,
  personal_rfc: employeeRfcSchema,
  email: optionalEmail,
  branch_id: optionalUuid,
  hired_on: optionalDate,
}).strict();

export const patchEmployeeSchema = z.object({
  employee_number: employeeFields.employee_number.optional(),
  first_name: employeeFields.first_name.optional(),
  last_name: employeeFields.last_name.optional(),
  nss: employeeNssSchema.optional(),
  personal_rfc: employeeRfcSchema.optional(),
  email: optionalEmail,
  branch_id: optionalUuid,
  hired_on: optionalDate,
  active: employeeFields.active.optional(),
}).strict()
  .refine((value) => Object.keys(value).length > 0, "Incluye al menos un campo para actualizar.")
  .superRefine((value, context) => {
    const updatesProfile = Object.keys(value).some((field) => field !== "active");
    if (updatesProfile && !value.personal_rfc) {
      context.addIssue({ code: "custom", path: ["personal_rfc"], message: "El RFC personal es obligatorio para guardar cambios." });
    }
  });

export const employeeIdSchema = z.string().uuid();

export function isValidCalendarDate(value: string | null | undefined) {
  if (!value) return true;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
