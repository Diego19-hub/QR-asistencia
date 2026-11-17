"use server";

import { redirect } from "next/navigation";

import {
  companyDetailsSchema,
  ownerRegistrationSchema,
  type CompanyDetails,
  type CompanyRegistrationActionState,
} from "@/lib/access/company-registration";
import { setActiveMembershipCookie } from "@/lib/access/active-membership-cookie";
import { clearRememberSessionPreference, setRememberSessionPreference } from "@/lib/supabase/session-cookie-preference";
import { createClient } from "@/lib/supabase/server";

const invalidState: CompanyRegistrationActionState = {
  status: "error",
  message: "Revisa los datos obligatorios, el tipo de contribuyente y el formato del RFC.",
};

function readCompanyDetails(formData: FormData): CompanyDetails | null {
  const parsed = companyDetailsSchema.safeParse({
    taxpayerType: formData.get("taxpayerType"),
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
    return { state: { status: "error", message: "La autenticación no inició una sesión lista para el registro. Contacta al administrador; este flujo no requiere confirmar el correo." } satisfies CompanyRegistrationActionState };
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
    p_taxpayer_type: details.taxpayerType,
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
    taxpayerType: formData.get("taxpayerType"),
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
      await setRememberSessionPreference(true);
      const result = await createFirstCompany(parsed.data, current.user);
      redirectTo = result.redirectTo;
      resultState = result.state;
    } else {
      await setRememberSessionPreference(true);
      const signupClient = await createClient();
      const { data, error } = await signupClient.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: { data: { full_name: parsed.data.fullName } },
      });
      if (error) {
        await clearRememberSessionPreference();
        if (error.code === "weak_password") return { status: "error", message: "La contraseña no cumple la política configurada en Supabase Auth." };
        return { status: "error", message: "No fue posible completar el registro. Revisa los datos o, si ya tienes cuenta, inicia sesión." };
      }
      if (!data.user) {
        await clearRememberSessionPreference();
        return { status: "error", message: "No fue posible completar el registro. Revisa los datos o, si ya tienes cuenta, inicia sesión." };
      }
      if (data.user.identities?.length === 0) {
        await clearRememberSessionPreference();
        return { status: "error", message: "No fue posible completar el registro. Revisa los datos o, si ya tienes cuenta, inicia sesión." };
      }
      if (!data.session) {
        await clearRememberSessionPreference();
        return { status: "error", message: "Supabase Auth no inició sesión. Desactiva la confirmación de correo para el registro y vuelve a intentarlo; no se creó la empresa." };
      }
      const result = await createFirstCompany(parsed.data, data.user);
      redirectTo = result.redirectTo;
      resultState = result.state;
    }
  } catch {
    return { status: "error", message: "No fue posible completar el registro. Inicia sesión para reintentar el alta o contacta al administrador." };
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
