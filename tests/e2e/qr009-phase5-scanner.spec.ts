import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/qr005-test";

type CameraState = { calls: number; tracks: MediaStreamTrack[]; start: number | null;
  ready: number | null; initialJs: number };
type CameraWindow = Window & { __qr009Camera?: CameraState };

const sensitive = (url: string) => {
  const path = new URL(url).pathname;
  return path === "/api/attendance/scan" || path.startsWith("/api/attendance/scan/") ||
    /^\/api\/(?:[^/]+\/)*pin(?:\/|$)/.test(path);
};

async function protect(page: Page, blocked: string[]) {
  await page.route(/\/api\/(?:attendance\/scan|(?:[^/]+\/)*pin)(?:[/?#]|$)/, (route) => {
    blocked.push(new URL(route.request().url()).pathname);
    return route.abort("blockedbyclient");
  });
  page.on("request", (request) => { if (sensitive(request.url())) blocked.push(new URL(request.url()).pathname); });
}
async function measureStart(page: Page) {
  await page.evaluate(() => {
    const state = (window as CameraWindow).__qr009Camera;
    if (!state) throw Error("Camera fixture missing");
    state.start = null; state.ready = null;
    state.initialJs = performance.getEntriesByType("resource")
      .filter((entry) => new URL(entry.name).pathname.endsWith(".js"))
      .reduce((sum, entry) => sum + (entry as PerformanceResourceTiming).transferSize, 0);
    const watcher = new MutationObserver(() => {
      if (state.start === null || state.ready !== null) return;
      requestAnimationFrame(() => {
        const close = [...document.querySelectorAll("button")]
          .find((button) => button.textContent?.includes("Cerrar cámara"));
        if (close && state.ready === null) { state.ready = performance.now(); watcher.disconnect(); }
      });
    });
    watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", (event) => {
      const clicked = (event.target as Element).closest("button");
      if (clicked?.textContent?.includes("Abrir cámara") && state.start === null) state.start = performance.now();
    }, { capture: true, once: true });
  });
}

// E2E uses a real disposable Supabase supervisor/device approval, but synthetic camera and no QR.
test("QR-009: tiempo de apertura de cámara falsa, cierre y pistas liberadas", async ({ page, browser, qr }) => {
  test.setTimeout(120_000);
  const blocked: string[] = [];
  await protect(page, blocked);
  await page.addInitScript(() => {
    const state: CameraState = { calls: 0, tracks: [], start: null, ready: null, initialJs: 0 };
    (window as CameraWindow).__qr009Camera = state;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      state.calls++;
      const stream = await original(...args);
      state.tracks.push(...stream.getTracks());
      return stream;
    };
  });
  await qr.signIn(page, qr.fixture("SUPERVISOR_EMAIL"), qr.fixture("SUPERVISOR_PASSWORD"));
  await expect(page.getByText("Dispositivo sin autorización")).toBeVisible();
  const label = "QR009 phase5 synthetic " + Date.now();
  const adminContext = await browser.newContext();
  await qr.guardBrowserOrigins(adminContext);
  const admin = await adminContext.newPage();
  let approved = false;
  try {
    await page.getByLabel("Nombre del dispositivo").fill(label);
    await page.getByRole("button", { name: "Solicitar autorización" }).click();
    await expect(page.getByRole("status")).toContainText("Solicitud enviada");
    await qr.signIn(admin, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"));
    await expect(admin).toHaveURL(/\/admin(?:\?|$)/);
    const approval = await admin.evaluate(async ({ companyId, label: name }) => {
      const response = await fetch("/api/supervisor-devices?companyId=" + companyId, { cache: "no-store" });
      const body = await response.json() as { requests?: { id: string; label: string; status: string }[] };
      const request = (body.requests ?? []).find((item) => item.label === name && item.status === "pending");
      if (!response.ok || !request) return { list: response.status, review: 0 };
      const review = await fetch("/api/supervisor-devices?companyId=" + companyId, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: request.id, approve: true }),
      });
      return { list: response.status, review: review.status };
    }, { companyId: qr.fixture("COMPANY_A_ID"), label });
    expect(approval).toEqual({ list: 200, review: 200 });
    approved = true;
    const samples: { sample: number; openToReadyMs: number; initialJsBytes: number; extraJsBytes: number }[] = [];
    for (let sample = 1; sample <= 3; sample++) {
      await page.reload();
      await expect(page.getByText("Dispositivo autorizado")).toBeVisible({ timeout: 20_000 });
      await measureStart(page);
      await page.getByRole("button", { name: "Abrir cámara" }).click();
      await expect(page.getByRole("button", { name: "Cerrar cámara" })).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => page.evaluate(() => (window as CameraWindow).__qr009Camera?.ready ?? null)).not.toBeNull();
      const metric = await page.evaluate(() => {
        const state = (window as CameraWindow).__qr009Camera;
        if (!state || state.start === null || state.ready === null) throw Error("Camera timing missing");
        const endJs = performance.getEntriesByType("resource")
          .filter((entry) => new URL(entry.name).pathname.endsWith(".js"))
          .reduce((sum, entry) => sum + (entry as PerformanceResourceTiming).transferSize, 0);
        return { openToReadyMs: state.ready - state.start, initialJsBytes: state.initialJs,
          extraJsBytes: Math.max(0, endJs - state.initialJs) };
      });
      expect(metric.openToReadyMs).toBeGreaterThanOrEqual(0);
      await page.getByRole("button", { name: "Cerrar cámara" }).click();
      await expect.poll(() => page.evaluate(() => {
        const state = (window as CameraWindow).__qr009Camera;
        return Boolean(state?.tracks.length && state.tracks.every((track) => track.readyState === "ended"));
      })).toBe(true);
      samples.push({ sample, ...metric });
    }
    // ZXing-only race: hold its newly requested JS chunk, revoke the actual
    // disposable device with an admin session, then release the chunk.
    // No QR image is shown and PIN/scan requests remain blocked.
    await page.reload();
    await expect(page.getByText("Dispositivo autorizado")).toBeVisible({ timeout: 20_000 });
    let unblock!: () => void;
    let markBlocked!: () => void;
    const releaseChunk = new Promise<void>((resolve) => { unblock = resolve; });
    const chunkStarted = new Promise<void>((resolve) => { markBlocked = resolve; });
    let intercepted = false;
    await page.route(/\/_next\/static\/chunks\/.*\.js(?:\?.*)?$/, async (route) => {
      if (intercepted) return route.fallback();
      intercepted = true;
      markBlocked();
      await releaseChunk;
      await route.fallback();
    });
    try {
      await page.getByRole("button", { name: "Abrir cámara" }).click();
      await Promise.race([chunkStarted, new Promise<never>((_, reject) =>
        setTimeout(() => reject(Error("No ZXing JS chunk requested after click")), 12_000))]);
      const revokeStatus = await admin.evaluate(async ({ companyId, label: name }) => {
        const response = await fetch("/api/supervisor-devices?companyId=" + companyId, { cache: "no-store" });
        const body = await response.json() as { devices?: { id: string; label: string; active: boolean }[] };
        const device = (body.devices ?? []).find((item) => item.label === name && item.active);
        if (!response.ok || !device) return 0;
        return (await fetch("/api/supervisor-devices/" + device.id + "?companyId=" + companyId,
          { method: "DELETE" })).status;
      }, { companyId: qr.fixture("COMPANY_A_ID"), label });
      expect(revokeStatus).toBe(200);
      approved = false;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByText("Dispositivo sin autorización")).toBeVisible({ timeout: 15_000 });
      expect(await page.evaluate(() => (window as CameraWindow).__qr009Camera?.calls)).toBe(0);
    } finally {
      unblock();
    }
    await expect(page.getByRole("button", { name: "Cerrar cámara" })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as CameraWindow).__qr009Camera?.calls)).toBe(0);
    console.log("QR009_PHASE5_ZXING_REVOKED_CHUNK PASS");
    expect(blocked).toEqual([]);
    console.log("QR009_PHASE5_SCANNER " + JSON.stringify({ samples, prohibitedRequests: blocked.length, fakeCamera: true }));
  } finally {
    if (approved) {
      try {
        const revoked = await admin.evaluate(async ({ companyId, label: name }) => {
          const response = await fetch("/api/supervisor-devices?companyId=" + companyId, { cache: "no-store" });
          const body = await response.json() as { devices?: { id: string; label: string; active: boolean }[] };
          const device = (body.devices ?? []).find((item) => item.label === name && item.active);
          if (!response.ok || !device) return 0;
          return (await fetch("/api/supervisor-devices/" + device.id + "?companyId=" + companyId, { method: "DELETE" })).status;
        }, { companyId: qr.fixture("COMPANY_A_ID"), label });
        expect(revoked).toBe(200);
      } finally { await adminContext.close(); }
    } else await adminContext.close();
  }
});
