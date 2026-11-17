import { z } from "zod";
import { requiredCompanyLegalNameSchema } from "../company/legal-name.ts";

import {
  INVITATION_FULL_NAME_MAX_LENGTH,
  INVITATION_FULL_NAME_MIN_LENGTH,
  INVITATION_PASSWORD_MAX_LENGTH,
  INVITATION_PASSWORD_MIN_LENGTH,
  normalizeInvitationFullName,
} from "./invitation-password.ts";

export const companyDetailsSchema = z.object({
  taxpayerType: z.enum(["physical_person_business", "legal_entity"]),
  companyName: z.string().trim().min(1).max(180),
  legalName: requiredCompanyLegalNameSchema,
  address: z.string().trim().min(1, "El domicilio es obligatorio.").max(500),
  employerRegistrationNumber: z.string().trim().min(1, "El registro patronal es obligatorio.").max(64),
  rfc: z.preprocess((value) => typeof value === "string" ? value.trim().toUpperCase() : value, z.string()),
}).strict().superRefine((value, context) => {
  const expectedLength = value.taxpayerType === "physical_person_business" ? 13 : 12;
  const pattern = value.taxpayerType === "physical_person_business"
    ? /^[A-Z&Ñ]{4}\d{6}[A-Z0-9]{3}$/
    : /^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/;
  if (value.rfc.length !== expectedLength || !pattern.test(value.rfc)) {
    context.addIssue({ code: "custom", path: ["rfc"], message: `El RFC debe tener ${expectedLength} caracteres y un formato válido.` });
  }
});

const fullNameSchema = z.string()
  .transform((value) => normalizeInvitationFullName(value))
  .refine((value): value is string => value !== null, "Escribe tu nombre completo.");

export const ownerRegistrationSchema = z.object({
  fullName: fullNameSchema,
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(INVITATION_PASSWORD_MIN_LENGTH).max(INVITATION_PASSWORD_MAX_LENGTH),
  confirmation: z.string().min(INVITATION_PASSWORD_MIN_LENGTH).max(INVITATION_PASSWORD_MAX_LENGTH),
  ...companyDetailsSchema.shape,
}).strict().superRefine((value, context) => {
  if (value.password !== value.confirmation) {
    context.addIssue({ code: "custom", path: ["confirmation"], message: "Las contraseñas no coinciden." });
  }
});

export type CompanyDetails = z.infer<typeof companyDetailsSchema>;
export type OwnerRegistration = z.infer<typeof ownerRegistrationSchema>;
export type CompanyRegistrationActionState = {
  status: "idle" | "error" | "account-has-company";
  message?: string;
};

export const COMPANY_REGISTRATION_PASSWORD_MIN_LENGTH = INVITATION_PASSWORD_MIN_LENGTH;
export const COMPANY_REGISTRATION_PASSWORD_MAX_LENGTH = INVITATION_PASSWORD_MAX_LENGTH;
export const COMPANY_REGISTRATION_FULL_NAME_MIN_LENGTH = INVITATION_FULL_NAME_MIN_LENGTH;
export const COMPANY_REGISTRATION_FULL_NAME_MAX_LENGTH = INVITATION_FULL_NAME_MAX_LENGTH;
