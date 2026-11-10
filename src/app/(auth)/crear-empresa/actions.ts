"use server";

import { redirect } from "next/navigation";

import { getAuthRedirectUrl } from "@/lib/access/auth-redirect";
import {
  companyDetailsSchema,
  ownerRegistrationSchema,
  type CompanyDetails,
  type CompanyRegistrationActionState,
} from "@/lib/access/company-registration";
import { setActiveMembershipCookie } from "@/lib/access/active-membership-cookie";
import { createClient } from "@/lib/supabase/server";

const invalidState: CompanyRegistrationActionState = {
  status: "error",
  message: "Revisa los datos obligatorios de la empresa, incluida la razón social, y el formato del RFC de persona moral.",
};

function readCompanyDetails(formData: FormData): CompanyDetails | null {
  const parsed = companyDetailsSchema.safeParse({
    companyName: formData.get("companyName"),
    legalName: formData.get("legalName"),
    address: formData.get("address"),
    employerRegistrationNumber: formData.get("employerRegistrationNumber"),
    rfc: formData.get("rfc"),
  });
  return parsed.success ? parsed.data : null;
}

async function createFirstCompany(details: CompanyDetails, user: { id: string; email_confirmed_at?: string | null }) {
  if (!user.email_confirmed_at) {
    return { state: { status: "verification-pending", message: "Confirma tu correo antes de crear la empresa. Después inicia sesión y termina el alta." } satisfies CompanyRegistrationActionState };
  }

  const supabase = await createClient();
  const { data: memberships, error: membershipError } = await supabase.from("company_memberships")
    .select("id,role,active").eq("user_id", user.id).limit(1);
  if (membershipError) return { state: { status: "error", message: "No fue posible comprobar si la cuenta ya tiene una empresa. Inténtalo de nuevo." } satisfies CompanyRegistrationActionState };
  if (memberships?.length) {
    if (memberships[0].active && memberships[0].role === "owner") return { redirectTo: "/admin" };
    return { state: { status: "account-has-company", message: "Esta cuenta ya está vinculada a una empresa. Inicia sesión con una cuenta Owner y usa “Crear otra empresa” desde el panel." } satisfies CompanyRegistrationActionState };
  }

  const { data, error } = await supabase.rpc("create_first_company_for_current_user", {
    p_name: details.companyName,
    p_legal_name: details.legalName,
    p_rfc: details.rfc,
    p_address: details.address,
    p_employer_registration_number: details.employerRegistrationNumber,
  });
  if (error) {
    if (error.code === "22023") return { state: invalidState };
    if (error.code === "23505") return { state: { status: "error", message: "No fue posible guardar el RFC porque ya existe un registro coincidente. Revisa el dato." } satisfies CompanyRegistrationActionState };
    if (error.code === "42501") return { state: { status: "account-has-company", message: "La cuenta no puede crear una primera empresa. Si ya pertenece a una, inicia sesión con su Owner para crear otra desde el panel." } satisfies CompanyRegistrationActionState };
    return { state: { status: "error", message: "No fue posible completar el alta. Puedes volver a intentarlo; no se guardó una empresa incompleta." } satisfies CompanyRegistrationActionState };
  }

  const created = Array.isArray(data) ? data[0] : null;
  if (!created?.company_id || !created?.membership_id) {
    return { state: { status: "error", message: "No fue posible confirmar el alta. Inicia sesión de nuevo para continuar." } satisfies CompanyRegistrationActionState };
  }
  await setActiveMembershipCookie(created.membership_id);
  return { redirectTo: "/admin" };
}

export async function registerOwner(
  _previous: CompanyRegistrationActionState,
  formData: FormData,
): Promise<CompanyRegistrationActionState> {
  const parsed = ownerRegistrationSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
    companyName: formData.get("companyName"),
    legalName: formData.get("legalName"),
    address: formData.get("address"),
    employerRegistrationNumber: formData.get("employerRegistrationNumber"),
    rfc: formData.get("rfc"),
  });
  if (!parsed.success) {
    const confirmationIssue = parsed.error.issues.some((issue) => issue.path[0] === "confirmation");
    return { status: "error", message: confirmationIssue ? "Las contraseñas no coinciden o no cumplen la longitud requerida." : invalidState.message };
  }

  let redirectTo: string | undefined;
  let resultState: CompanyRegistrationActionState | undefined;
  try {
    const supabase = await createClient();
    const { data: current } = await supabase.auth.getUser();
    if (current.user) {
      const result = await createFirstCompany(parsed.data, current.user);
      redirectTo = result.redirectTo;
      resultState = result.state;
    } else {
      const emailRedirectTo = getAuthRedirectUrl("confirm");
      if (!emailRedirectTo) return { status: "error", message: "La dirección segura de confirmación no está configurada. Contacta al administrador." };
      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          emailRedirectTo: emailRedirectTo.href,
          data: { full_name: parsed.data.fullName },
        },
      });
      if (error) {
        if (error.code === "weak_password") return { status: "error", message: "La contraseña no cumple la política configurada en Supabase Auth." };
        if (error.code === "email_exists" || error.code === "user_already_exists") return { status: "email-registered", message: "Ese correo ya tiene una cuenta. Inicia sesión para continuar; si ya tiene empresa, usa “Crear otra empresa” desde el panel Owner." };
        return { status: "error", message: "No fue posible iniciar el registro. Revisa el correo e inténtalo de nuevo." };
      }
      if (!data.user) return { status: "error", message: "No se pudo iniciar el registro. Inténtalo de nuevo." };
      if (data.user.identities?.length === 0) {
        return { status: "email-registered", message: "Ese correo ya tiene una cuenta. Inicia sesión para continuar; si ya tiene empresa, usa “Crear otra empresa” desde el panel Owner." };
      }
      if (!data.session) {
        return { status: "verification-pending", message: "Te enviamos un correo para confirmar tu identidad. Abre el enlace; después inicia sesión y termina la creación de tu empresa. Por seguridad, la empresa no se crea antes de confirmar el correo." };
      }
      const result = await createFirstCompany(parsed.data, data.user);
      redirectTo = result.redirectTo;
      resultState = result.state;
    }
  } catch {
    return { status: "error", message: "No fue posible completar el registro. Vuelve a intentarlo; no compartas tu contraseña por otros medios." };
  }

  if (redirectTo) redirect(redirectTo);
  return resultState ?? { status: "error", message: "No fue posible completar el alta. Inténtalo de nuevo." };
}

export async function completeFirstCompany(
  _previous: CompanyRegistrationActionState,
  formData: FormData,
): Promise<CompanyRegistrationActionState> {
  const details = readCompanyDetails(formData);
  if (!details) return invalidState;
  let redirectTo: string | undefined;
  let state: CompanyRegistrationActionState | undefined;
  try {
    const supabase = await createClient();
    const { data: auth, error } = await supabase.auth.getUser();
    if (error || !auth.user) return { status: "error", message: "Inicia sesión para terminar el alta." };
    const result = await createFirstCompany(details, auth.user);
    redirectTo = result.redirectTo;
    state = result.state;
  } catch {
    return { status: "error", message: "No fue posible terminar el alta. Inténtalo de nuevo; no se guardó una empresa incompleta." };
  }
  if (redirectTo) redirect(redirectTo);
  return state ?? { status: "error", message: "No fue posible terminar el alta. Inténtalo de nuevo." };
}
