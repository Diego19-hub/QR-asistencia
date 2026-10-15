import type { User } from "@supabase/supabase-js";

import { classifyCompanyPermissionCheck, type CompanyPermissionCheck } from "@/lib/access/user-management";
import { createClient } from "@/lib/supabase/server";

const ADMIN_ROLES = new Set(["owner", "admin"]);

export type AdminCompany = {
  companyId: string;
  companyName: string;
  role: "owner" | "admin";
};

export type AdminScope = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
  company: AdminCompany;
  companies: AdminCompany[];
};

export type ScopeResult =
  | { ok: true; scope: AdminScope }
  | { ok: false; status: number; code: string; message: string };

export async function resolveAdminScope(request: Request): Promise<ScopeResult> {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return { ok: false, status: 401, code: "unauthenticated", message: "Inicia sesión para continuar." };
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("company_memberships")
    .select("company_id, role")
    .eq("user_id", authData.user.id)
    .eq("active", true);

  if (membershipsError) {
    return { ok: false, status: 503, code: "membership_lookup_failed", message: "No fue posible validar tus permisos." };
  }

  const adminMemberships = (memberships ?? []).filter((membership) => ADMIN_ROLES.has(membership.role));
  if (!adminMemberships.length) {
    return { ok: false, status: 403, code: "admin_required", message: "Tu cuenta no tiene permisos administrativos." };
  }

  const selectedCompanyId = new URL(request.url).searchParams.get("companyId");
  let selectedMembership = adminMemberships[0];
  if (selectedCompanyId) {
    const match = adminMemberships.find((membership) => membership.company_id === selectedCompanyId);
    if (!match) {
      return { ok: false, status: 403, code: "company_forbidden", message: "No tienes acceso administrativo a esa empresa." };
    }
    selectedMembership = match;
  } else if (adminMemberships.length > 1) {
    return { ok: false, status: 400, code: "company_required", message: "Selecciona una empresa para continuar." };
  }

  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("id, name")
    .in("id", adminMemberships.map((membership) => membership.company_id));

  if (companiesError) {
    return { ok: false, status: 503, code: "company_lookup_failed", message: "No fue posible cargar la empresa." };
  }

  const names = new Map((companies ?? []).map((company) => [company.id, company.name]));
  const availableCompanies = adminMemberships
    .filter((membership) => names.has(membership.company_id))
    .map((membership) => ({
      companyId: membership.company_id,
      companyName: names.get(membership.company_id)!,
      role: membership.role as AdminCompany["role"],
    }));
  const company = availableCompanies.find((item) => item.companyId === selectedMembership.company_id);

  if (!company) {
    return { ok: false, status: 404, code: "company_not_found", message: "No se encontró una empresa disponible." };
  }

  return {
    ok: true,
    scope: { supabase, user: authData.user, company, companies: availableCompanies },
  };
}

export function scopeError(result: Extract<ScopeResult, { ok: false }>) {
  return Response.json(
    { error: { code: result.code, message: result.message } },
    { status: result.status, headers: { "Cache-Control": "no-store" } },
  );
}

export function apiError(code: string, message: string, status: number) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Evaluates the effective permission using the active membership and its override. */
export async function checkAdminCompanyPermission(
  scope: AdminScope,
  permission: string,
): Promise<CompanyPermissionCheck> {
  const { data, error } = await scope.supabase.rpc("current_user_has_company_permission", {
    p_company_id: scope.company.companyId,
    p_permission: permission,
  });
  return classifyCompanyPermissionCheck(data, error);
}

export function permissionCheckError(check: CompanyPermissionCheck, message: string) {
  return check.allowed
    ? null
    : apiError(
        check.reason === "unavailable" ? "permission_check_unavailable" : "company_manage_required",
        check.reason === "unavailable" ? "No fue posible validar los permisos. Verifica que las migraciones locales requeridas estén aplicadas." : message,
        check.reason === "unavailable" ? 503 : 403,
      );
}
