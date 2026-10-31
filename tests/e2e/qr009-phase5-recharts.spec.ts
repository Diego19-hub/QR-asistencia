import { expect, test } from "./fixtures/qr005-test";

type ChartMeasurement = { openMs: number | null; visibleMs: number | null; initialJsBytes: number };
type ChartWindow = Window & { __qr009Chart?: ChartMeasurement };
const sensitive = (url: string) => {
  const path = new URL(url).pathname;
  return path === "/api/attendance/scan" || path.startsWith("/api/attendance/scan/") ||
    /^\/api\/(?:[^/]+\/)*pin(?:\/|$)/.test(path);
};

test("QR-009: medir del clic a la primera gráfica visible, sin asistencia", async ({ page, qr }) => {
  test.setTimeout(90_000);
  const blocked: string[] = [];
  await page.route(/\/api\/(?:attendance\/scan|(?:[^/]+\/)*pin)(?:[/?#]|$)/, (route) => {
    blocked.push(new URL(route.request().url()).pathname);
    return route.abort("blockedbyclient");
  });
  page.on("request", (request) => { if (sensitive(request.url())) blocked.push(new URL(request.url()).pathname); });
  await qr.signIn(page, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  const samples: { sample: number; openToVisibleMs: number; initialJsBytes: number; additionalJsBytes: number }[] = [];
  for (let sample = 1; sample <= 5; sample++) {
    await page.goto("/admin/reportes");
    const details = page.locator("details").filter({ hasText: "Análisis y métricas avanzadas" });
    await expect(details).toBeVisible({ timeout: 15_000 });
    await expect(details).not.toHaveAttribute("open", "");
    await page.evaluate(() => {
      const disclosure = [...document.querySelectorAll("details")]
        .find((candidate) => candidate.textContent?.includes("Análisis y métricas avanzadas"));
      if (!disclosure) throw Error("Panel de gráficas no disponible");
      const initialJsBytes = performance.getEntriesByType("resource")
        .filter((entry) => new URL(entry.name).pathname.endsWith(".js"))
        .reduce((total, entry) => total + (entry as PerformanceResourceTiming).transferSize, 0);
      const state: ChartMeasurement = { openMs: null, visibleMs: null, initialJsBytes };
      (window as ChartWindow).__qr009Chart = state;
      const watcher = new MutationObserver(() => {
        if (!disclosure.open || state.openMs === null || state.visibleMs !== null) return;
        requestAnimationFrame(() => {
          const rect = disclosure.querySelector("svg.recharts-surface")?.getBoundingClientRect();
          if (state.visibleMs === null && rect && rect.width > 0 && rect.height > 0) {
            state.visibleMs = performance.now();
            watcher.disconnect();
          }
        });
      });
      watcher.observe(disclosure, { childList: true, subtree: true, attributes: true,
        attributeFilter: ["open", "style"] });
      disclosure.querySelector("summary")?.addEventListener("click",
        () => { state.openMs = performance.now(); }, { capture: true, once: true });
    });
    await details.locator("summary").click();
    await expect(details.locator("svg.recharts-surface").first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => (window as ChartWindow).__qr009Chart?.visibleMs ?? null)).not.toBeNull();
    const result = await page.evaluate(() => {
      const state = (window as ChartWindow).__qr009Chart;
      if (!state || state.openMs === null || state.visibleMs === null) throw Error("No chart timing");
      const afterJsBytes = performance.getEntriesByType("resource")
        .filter((entry) => new URL(entry.name).pathname.endsWith(".js"))
        .reduce((total, entry) => total + (entry as PerformanceResourceTiming).transferSize, 0);
      return { openToVisibleMs: state.visibleMs - state.openMs, initialJsBytes: state.initialJsBytes,
        additionalJsBytes: Math.max(0, afterJsBytes - state.initialJsBytes) };
    });
    expect(result.openToVisibleMs).toBeGreaterThanOrEqual(0);
    samples.push({ sample, ...result });
    await details.locator("summary").click();
    await expect(details).not.toHaveAttribute("open", "");
  }
  expect(blocked).toEqual([]);
  console.log("QR009_PHASE5_RECHARTS " + JSON.stringify({ samples, prohibitedRequests: blocked.length }));
});
