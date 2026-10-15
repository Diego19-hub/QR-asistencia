import { apiError, resolveAdminScope, scopeError } from "@/lib/admin/scope";

export async function GET(request: Request) {
  const result = await resolveAdminScope(request);
  if (!result.ok) return scopeError(result);
  const { data: permissions, error: permissionsError } = await result.scope.supabase
    .from("permissions").select("code,description").order("code");
  const { data: rolePermissions, error: rolesError } = await result.scope.supabase
    .from("role_permissions").select("role,permission_code").order("role");
  if (permissionsError || rolesError) return apiError("permissions_lookup_failed", "No fue posible cargar el catálogo de roles y permisos.", 503);
  return Response.json({ permissions: permissions ?? [], rolePermissions: rolePermissions ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
