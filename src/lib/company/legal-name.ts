import { z } from "zod";

export const requiredCompanyLegalNameSchema = z.string()
  .trim()
  .min(1, "La razón social es obligatoria.")
  .max(240, "La razón social no puede exceder 240 caracteres.");
