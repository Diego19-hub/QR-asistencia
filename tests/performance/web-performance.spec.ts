import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "pg";
import { expect, test } from "@playwright/test";
import { qr005Environment } from "../e2e/helpers/qr005-env.mjs";
import type { Browser, BrowserContext, Page } from "@playwright/test";

const qr = qr005Environment();
const sampleCount = 5;
const targetFile = process.env.QR009_RESULTS_FILE ?? join(tmpdir(), `qr009-runtime-${Date.now()}.json`);
const apiPaths = new Set(["/api/dashboard/summary", "/api/reports", "/api/employee/portal", "/api/supervisor/scanner/context"]);
const routeApiPath: Record<string, string> = { "/admin": "/api/dashboard/summary", "/admin/reportes": "/api/reports", "/scanner": "/api/supervisor/scanner/context", "/mi-qr": "/api/employee/portal" };
type Metric = {
  route: string;
  profile: string;
  cache: "cold" | "warm";
  sample: number;
  navigationMs: number;
  ttfbMs: number;
  fcpMs: number | null;
  lcpMs: number | null;
  cls: number;
  longTaskMs: number;
  transferBytes: number;
  jsTransferBytes: number;
  jsResources: number;
  cachedJsResources: number;
  api: { path: string; status: number; durationMs: number }[];
};

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function configureProfile(page: Page, profile: "desktop" | "mobile-emulated") {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  if (profile === "mobile-emulated") {
    await session.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await session.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8, connectionType: "cellular4g" });
  } else {
    await session.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await session.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
  return session;
}

async function waitForPageReady(page: Page, route: string) {
  await page.waitForLoadState("load");
  if (route === "/login") await expect(page.locator("body")).toContainText("Contraseña");
  if (route === "/admin") await expect(page.locator("body")).not.toContainText("Cargando");
  if (route === "/admin/reportes") await expect(page.locator("body")).toContainText(/Reporte|reportes|Asistencia/i);
  if (route === "/scanner") await expect(page.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible({ timeout: 30_000 });
  if (route === "/mi-qr") await expect(page.locator("body")).toContainText(/QR|asistencia/i);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function measure(page: Page, route: string, profile: "desktop" | "mobile-emulated", cache: "cold" | "warm", sample: number, session: Awaited<ReturnType<typeof configureProfile>>): Promise<Metric> {
  if (cache === "cold") await session.send("Network.clearBrowserCache");
  const api: Metric["api"] = [];
  const requestStartedAt = new WeakMap<import("@playwright/test").Request, number>();
  const onRequest = (request: import("@playwright/test").Request) => {
    if (apiPaths.has(new URL(request.url()).pathname)) requestStartedAt.set(request, Date.now());
  };
  const onResponse = (response: import("@playwright/test").Response) => {
    const url = new URL(response.url());
    if (!apiPaths.has(url.pathname)) return;
    const startedAt = requestStartedAt.get(response.request());
    if (startedAt === undefined) return;
    api.push({ path: url.pathname, status: response.status(), durationMs: Math.max(0.1, Date.now() - startedAt) });
  };
  const expectedApi = routeApiPath[route]
    ? page.waitForResponse((response) => new URL(response.url()).pathname === routeApiPath[route], { timeout: 5_000 }).catch(() => null)
    : null;
  page.on("request", onRequest);
  page.on("response", onResponse);
  await page.goto(route, { waitUntil: "load" });
  await waitForPageReady(page, route);
  await page.waitForTimeout(profile === "mobile-emulated" ? 150 : 50);
  const apiResponse = expectedApi ? await expectedApi : null;
  if (routeApiPath[route]) expect(apiResponse, `${route} should request ${routeApiPath[route]}`).not.toBeNull();
  const values = await page.evaluate(() => {
    const entries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    const nav = entries[0];
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const js = resources.filter((entry) => new URL(entry.name).pathname.endsWith(".js"));
    return {
      navigationMs: Math.round((nav?.loadEventEnd ?? 0) * 10) / 10,
      ttfbMs: Math.round((nav?.responseStart ?? 0) * 10) / 10,
      fcpMs: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      lcpMs: (window as Window & { __qr009Lcp?: number }).__qr009Lcp ?? null,
      cls: (window as Window & { __qr009Cls?: number }).__qr009Cls ?? 0,
      longTaskMs: (window as Window & { __qr009LongTaskMs?: number }).__qr009LongTaskMs ?? 0,
      transferBytes: resources.reduce((sum, entry) => sum + entry.transferSize, nav?.transferSize ?? 0),
      jsTransferBytes: js.reduce((sum, entry) => sum + entry.transferSize, 0),
      jsResources: js.length,
      cachedJsResources: js.filter((entry) => entry.transferSize === 0 && entry.encodedBodySize > 0).length,
    };
  });
  page.off("response", onResponse);
  page.off("request", onRequest);
  return { route, profile, cache, sample, ...values, api };
}

async function newGuardedContext(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport, permissions: ["camera"] });
  await context.addInitScript(() => {
    const state = window as Window & { __qr009Lcp?: number; __qr009Cls?: number; __qr009LongTaskMs?: number };
    state.__qr009Lcp = 0;
    state.__qr009Cls = 0;
    state.__qr009LongTaskMs = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.__qr009Lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
          if (!entry.hadRecentInput) state.__qr009Cls = (state.__qr009Cls ?? 0) + (entry.value ?? 0);
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        state.__qr009LongTaskMs = (state.__qr009LongTaskMs ?? 0) + list.getEntries().reduce((sum, entry) => sum + entry.duration, 0);
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Unsupported browser performance entry types remain null/zero in report.
    }
  });
  await qr.guardBrowserOrigins(context);
  return context;
}

async function signIn(page: Page, email: string, password: string, target: RegExp) {
  await qr.signIn(page, email, password);
  await expect(page).toHaveURL(target, { timeout: 30_000 });
}

test("captura baseline web y PostgreSQL local con identidades y datos sintéticos", async ({ browser }) => {
  const databaseUrl = process.env.QR009_DATABASE_URL;
  const adminId = process.env.QR009_ADMIN_USER_ID;
  const branchId = process.env.QR009_BRANCH_ID;
  expect(databaseUrl).toBeTruthy();
  expect(adminId).toBeTruthy();
  expect(branchId).toBeTruthy();
  const parsedDb = new URL(databaseUrl!);
  expect(["127.0.0.1", "localhost", "::1"].includes(parsedDb.hostname)).toBe(true);
  expect(databaseUrl).not.toMatch(/llxyziffgtqnzlguxhyt|jawdrhewabqajxnswhkn/);

  const sql = await benchmarkPostgres(databaseUrl!, adminId!, branchId!);
  const records: Metric[] = [];
  const contexts: BrowserContext[] = [];
  const scanRequests: string[] = [];
  try {
    const anonymousContext = await newGuardedContext(browser, { width: 1440, height: 900 });
    contexts.push(anonymousContext);
    const anonymousPage = await anonymousContext.newPage();
    const desktopSession = await configureProfile(anonymousPage, "desktop");
    records.push(await measure(anonymousPage, "/login", "desktop", "cold", 1, desktopSession));
    for (let sample = 2; sample <= sampleCount; sample++) records.push(await measure(anonymousPage, "/login", "desktop", "cold", sample, desktopSession));
    await measure(anonymousPage, "/login", "desktop", "warm", 0, desktopSession);
    for (let sample = 1; sample <= sampleCount; sample++) records.push(await measure(anonymousPage, "/login", "desktop", "warm", sample, desktopSession));

    const adminContext = await newGuardedContext(browser, { width: 1440, height: 900 });
    const supervisorContext = await newGuardedContext(browser, { width: 1440, height: 900 });
    const employeeContext = await newGuardedContext(browser, { width: 1440, height: 900 });
    contexts.push(adminContext, supervisorContext, employeeContext);
    const adminPage = await adminContext.newPage();
    const supervisorPage = await supervisorContext.newPage();
    const employeePage = await employeeContext.newPage();
    await signIn(adminPage, qr.fixture("ADMIN_EMAIL"), qr.fixture("ADMIN_PASSWORD"), /\/admin(?:\?.*)?$/);
    await signIn(supervisorPage, qr.fixture("SUPERVISOR_EMAIL"), qr.fixture("SUPERVISOR_PASSWORD"), /\/scanner(?:\?.*)?$/);
    await expect(supervisorPage.getByRole("heading", { name: "Escáner del supervisor" })).toBeVisible({ timeout: 30_000 });
    await signIn(employeePage, qr.fixture("EMPLOYEE_EMAIL"), qr.fixture("EMPLOYEE_PASSWORD"), /\/mi-qr(?:\?.*)?$/);

    supervisorPage.on("request", (request) => { if (new URL(request.url()).pathname === "/api/attendance/scan") scanRequests.push("attendance scan endpoint"); });

    const routeActors = [
      { page: adminPage, routes: ["/admin", "/admin/reportes"] },
      { page: supervisorPage, routes: ["/scanner"] },
      { page: employeePage, routes: ["/mi-qr"] },
    ];
    for (const profile of ["desktop", "mobile-emulated"] as const) {
      for (const { page, routes } of routeActors) {
        const session = await configureProfile(page, profile);
        for (const route of routes) {
          await measure(page, route, profile, "cold", 0, session);
          for (let sample = 1; sample <= sampleCount; sample++) records.push(await measure(page, route, profile, "cold", sample, session));
          await measure(page, route, profile, "warm", 0, session);
          for (let sample = 1; sample <= sampleCount; sample++) records.push(await measure(page, route, profile, "warm", sample, session));
        }
      }
    }

    const reportPage = adminPage;
    await reportPage.goto("/admin/reportes", { waitUntil: "load" });
    await waitForPageReady(reportPage, "/admin/reportes");
    const beforeCharts = await reportPage.evaluate(() => (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((entry) => new URL(entry.name).pathname.endsWith(".js")).reduce((sum, entry) => sum + entry.transferSize, 0));
    await reportPage.getByText("Análisis y métricas avanzadas").click();
    await expect(reportPage.locator("svg.recharts-surface").first()).toBeVisible({ timeout: 20_000 });
    const afterCharts = await reportPage.evaluate(() => (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((entry) => new URL(entry.name).pathname.endsWith(".js")).reduce((sum, entry) => sum + entry.transferSize, 0));
    const recharts = { initialJsTransferBytes: beforeCharts, afterOpenJsTransferBytes: afterCharts, additionalBytes: Math.max(0, afterCharts - beforeCharts), renderedSvg: true };

    await supervisorPage.goto("/scanner", { waitUntil: "load" });
    await waitForPageReady(supervisorPage, "/scanner");
    expect(scanRequests).toEqual([]);

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      baseCommit: process.env.QR009_BASE_COMMIT ?? process.env.GITHUB_SHA ?? "local-working-tree",
      environment: { app: "Next.js production build, local loopback", browser: "Chromium via Playwright", syntheticOnly: true, profiles: ["desktop 1440x900", "mobile emulated 390x844, CPU 4x, RTT 40ms, 1.6Mbps down / 750Kbps up"], samplesPerRouteCacheProfile: sampleCount },
      browser: { samples: records, summaries: summarize(records), interactions: { recharts, scanner: { cameraReadyMs: null, jsTransferBeforeCamera: null, jsTransferAfterCamera: null, cameraStatus: "not measured: production APP_BASE_URL origin guard rejects scanner-context POST from loopback HTTP", attendanceScanRequests: scanRequests.length } } },
      postgres: sql,
      limitations: ["No real-device INP; long-task duration is reported separately and is not TBT.", "Synthetic dataset is 500 employee rows only; no attendance sessions/events were created.", "Browser transferSize is local Chromium resource timing, not production CDN/RUM traffic.", "The production build safely rejects the scanner-context POST from loopback HTTP, so camera readiness and authorized-device API latency are not measured."],
    };
    const destination = targetFile;
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    process.stdout.write(`QR-009 results written to ${destination}; samples=${records.length}; PostgreSQL scenarios=${sql.scenarios.length}; no credentials or identities stored\n`);
    expect(scanRequests).toHaveLength(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  }
});

function summarize(records: Metric[]) {
  const keys = [...new Set(records.map((record) => `${record.route}|${record.profile}|${record.cache}`))];
  return keys.map((key) => {
    const [route, profile, cache] = key.split("|");
    const samples = records.filter((record) => `${record.route}|${record.profile}|${record.cache}` === key);
    const values = (field: "navigationMs" | "ttfbMs" | "transferBytes" | "jsTransferBytes") => samples.map((record) => record[field]);
    const apiPathsForRoute = [...new Set(samples.flatMap((record) => record.api.map((entry) => entry.path)))];
    return {
      route, profile, cache, n: samples.length,
      navigationP50: percentile(values("navigationMs"), 0.5), navigationP95: percentile(values("navigationMs"), 0.95),
      ttfbP50: percentile(values("ttfbMs"), 0.5), transferBytesP50: percentile(values("transferBytes"), 0.5),
      jsTransferBytesP50: percentile(values("jsTransferBytes"), 0.5), lcpP50: percentile(samples.map((record) => record.lcpMs ?? 0), 0.5),
      fcpP50: percentile(samples.map((record) => record.fcpMs ?? 0), 0.5),
      clsP50: percentile(samples.map((record) => record.cls), 0.5),
      longTaskMsP50: percentile(samples.map((record) => record.longTaskMs), 0.5),
      cachedJsResourcesP50: percentile(samples.map((record) => record.cachedJsResources), 0.5),
      api: apiPathsForRoute.map((path) => {
        const responses = samples.flatMap((record) => record.api.filter((entry) => entry.path === path));
        return { path, responses: responses.length, statuses: [...new Set(responses.map((entry) => entry.status))].sort(), durationP50: percentile(responses.map((entry) => entry.durationMs), 0.5), durationP95: percentile(responses.map((entry) => entry.durationMs), 0.95) };
      }),
    };
  });
}

async function benchmarkPostgres(connectionString: string, userId: string, branchId: string) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000, statement_timeout: 15_000 });
  await client.connect();
  const scenarios = [];
  try {
    for (const volume of [10, 100, 500]) {
      const executions: number[] = [];
      let actualRows = -1;
      let sharedHitBlocks = 0;
      let sharedReadBlocks = 0;
      for (let sample = 0; sample < sampleCount; sample++) {
        await client.query("begin");
        try {
          await client.query("set local role authenticated");
          await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated" })]);
          const count = await client.query("select count(*)::int as count from public.employees where employee_number >= $1 and employee_number < $2 and branch_id = $3 and active = true", [`QR009-${"0001"}`, `QR009-${String(volume + 1).padStart(4, "0")}`, branchId]);
          expect(Number(count.rows[0]?.count)).toBe(volume);
          const result = await client.query("explain (analyze, buffers, format json) select id from public.employees where employee_number >= $1 and employee_number < $2 and branch_id = $3 and active = true", [`QR009-${"0001"}`, `QR009-${String(volume + 1).padStart(4, "0")}`, branchId]);
          const plan = result.rows[0]["QUERY PLAN"][0];
          executions.push(Number(plan["Execution Time"]));
          actualRows = Number(plan.Plan["Actual Rows"] ?? 0);
          sharedHitBlocks = Number(plan.Plan["Shared Hit Blocks"] ?? 0);
          sharedReadBlocks = Number(plan.Plan["Shared Read Blocks"] ?? 0);
        } finally {
          await client.query("rollback");
        }
      }
      scenarios.push({ volume, authorizedRole: "authenticated admin with active company membership", rowCountVerifiedUnderRls: actualRows, explainExecutionMs: executions, p50Ms: percentile(executions, 0.5), p95Ms: percentile(executions, 0.95), sharedHitBlocks, sharedReadBlocks, queryFingerprint: createHash("sha256").update("employees:branch:active:employee-number-range:v1").digest("hex").slice(0, 16) });
    }
  } finally {
    await client.end();
  }
  return { engine: "local Supabase PostgreSQL; authenticated role + user JWT claims; no service_role query", method: "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)", data: "500 synthetic active employees, one local synthetic company and branch", samplesPerVolume: sampleCount, scenarios };
}
