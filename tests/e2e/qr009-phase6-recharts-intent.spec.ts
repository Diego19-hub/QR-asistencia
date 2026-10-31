import { expect, test } from "./fixtures/qr005-test";

type IntentMetric = { startMs: number | null; visibleMs: number | null; beforeJs: number; prefetchedJs: number };
type IntentWindow = Window & { __qr009Intent?: IntentMetric };

function jsBytes() {
  return performance.getEntriesByType("resource")
    .filter((item) => new URL(item.name).pathname.endsWith(".js"))
    .reduce((total, item) => total + (item as PerformanceResourceTiming).transferSize, 0);
}

// The benchmark is intentionally browser-only; data and Auth are synthetic.
test("QR-009 Fase 6: precargar gráficos solo por intención y medir clic a SVG visible", async ({ page, qr }) => {
  test.setTimeout(150_000);
  const blocked: string[] = [];
  const denySensitive = (url: string) => {
    const path = new URL(url).pathname;
    return path === "/api/attendance/scan" || path.startsWith("/api/attendance/scan/") ||
      /^\/api\/(?:[^/]+\/)*pin(?:\/|$)/.test(path);
  };
  await page.route(/\/api\/(?:attendance\/scan|(?:[^/]+\/)*pin)(?:[/?#]|$)/, (route) => {
    blocked.push(new URL(route.request().url()).pathname);
    return route.abort("blockedbyclient");
  });
  page.on("request", (request) => {
    if (denySensitive(request.url())) blocked.push(new URL(request.url()).pathname);
  });
  await qr.signIn(page, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);

  const samples: { sample: number; clickToVisibleMs: number;
    beforeHoverJsBytes: number; afterHoverJsBytes: number; afterClickJsBytes: number }[] = [];
  for (let sample = 1; sample <= 5; sample++) {
    await page.goto("/admin/reportes");
    const disclosure = page.locator("details").filter({ hasText: "Análisis y métricas avanzadas" });
    const summary = disclosure.locator("summary");
    await expect(disclosure).toBeVisible({ timeout: 15_000 });
    await expect(disclosure).not.toHaveAttribute("open", "");
    await page.mouse.move(0, 0);
    const beforeHoverJsBytes = await page.evaluate(jsBytes);
    await summary.hover();

    // Hover/focus must actually initiate a JS download without opening the panel.
    await expect.poll(async () => page.evaluate(jsBytes),
      { timeout: 15_000, message: "La intención no inició la precarga JS" }
    ).toBeGreaterThan(beforeHoverJsBytes);
    await expect(disclosure).not.toHaveAttribute("open", "");
    const afterHoverJsBytes = await page.evaluate(jsBytes);
    await page.evaluate(() => {
      const disclosure = [...document.querySelectorAll("details")]
        .find((node) => node.textContent?.includes("Análisis y métricas avanzadas"));
      const summary = disclosure?.querySelector("summary");
      if (!disclosure || !summary) throw Error("Summary no disponible");
      const metric: IntentMetric = { startMs: null, visibleMs: null, beforeJs: 0, prefetchedJs: 0 };
      (window as IntentWindow).__qr009Intent = metric;
      const observer = new MutationObserver(() => {
        if (!disclosure.open || metric.startMs === null || metric.visibleMs !== null) return;
        requestAnimationFrame(() => {
          const rect = disclosure.querySelector("svg.recharts-surface")?.getBoundingClientRect();
          if (rect && rect.width > 0 && rect.height > 0 && metric.visibleMs === null) {
            metric.visibleMs = performance.now();
            observer.disconnect();
          }
        });
      });
      observer.observe(disclosure, { childList: true, subtree: true, attributes: true,
        attributeFilter: ["open", "style"] });
      summary.addEventListener("click", () => { metric.startMs = performance.now(); },
        { capture: true, once: true });
    });
    await summary.click();
    await expect(disclosure.locator("svg.recharts-surface").first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => (window as IntentWindow).__qr009Intent?.visibleMs ?? null)).not.toBeNull();
    const { clickToVisibleMs, afterClickJsBytes } = await page.evaluate(() => {
      const metric = (window as IntentWindow).__qr009Intent;
      if (!metric || metric.startMs === null || metric.visibleMs === null) throw Error("SVG timing incomplete");
      return { clickToVisibleMs: metric.visibleMs - metric.startMs,
        afterClickJsBytes: performance.getEntriesByType("resource")
          .filter((item) => new URL(item.name).pathname.endsWith(".js"))
          .reduce((sum, item) => sum + (item as PerformanceResourceTiming).transferSize, 0) };
    });
    expect(clickToVisibleMs).toBeGreaterThanOrEqual(0);
    samples.push({ sample, clickToVisibleMs, beforeHoverJsBytes,
      afterHoverJsBytes, afterClickJsBytes });
    await summary.click();
    await expect(disclosure).not.toHaveAttribute("open", "");
  }
  expect(blocked).toEqual([]);
  console.log("QR009_PHASE6_RECHARTS_INTENT " + JSON.stringify({
    samples, prohibitedRequests: blocked.length,
    comparison: "phase5-original-click-to-SVG", hoverRequired: true,
  }));
});
