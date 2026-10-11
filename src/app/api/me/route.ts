import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json(
        { error: "unauthenticated" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: memberships, error: membershipError } = await supabase
      .from("company_memberships")
      .select("company_id, role")
      .eq("user_id", user.id)
      .eq("active", true);

    if (membershipError) {
      return Response.json(
        { error: "membership_lookup_failed" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    const companyIds = [...new Set((memberships ?? []).map(({ company_id }) => company_id))];
    const companiesResult = companyIds.length
      ? await supabase.from("companies").select("id, name").in("id", companyIds)
      : { data: [], error: null };

    if (companiesResult.error) {
      return Response.json(
        { error: "company_lookup_failed" },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    const companyNames = new Map(
      (companiesResult.data ?? []).map(({ id, name }) => [id, name]),
    );

    return Response.json(
      {
        user: { id: user.id, email: user.email ?? null },
        memberships: (memberships ?? []).map(({ company_id, role }) => ({
          companyId: company_id,
          companyName: companyNames.get(company_id) ?? null,
          role,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "authentication_service_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
