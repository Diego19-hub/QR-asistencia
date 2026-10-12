export const dynamic = "force-dynamic";

/** Minimal process liveness endpoint; it intentionally reveals no configuration. */
export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
