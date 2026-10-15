import { resendCompanyInvitation } from "@/lib/access/resend-invitation";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return resendCompanyInvitation(request, id);
}
