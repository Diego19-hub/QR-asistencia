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
  navigationMs: number | null;
  ttfbMs: number | null;
  fcpMs: number | null;
  lcpMs: number | null;
  cls: number | null;
  longTaskMs: number | null;
  transferBytes: number | null;
  jsTransferBytes: number | null;
  jsResources: number;
  cachedJsResources: number;
  cacheDiagnostics: {
    jsResponseCount: number; cacheServedCount: number; diskCacheCount: number; serviceWorkerCount: number;
    prefetchCacheCount: number;
    responseStatusCodes: number[]; requestCacheDirectives: string[]; conditionalRequestCount: number;
    etagResponses: number; lastModifiedResponses: number; cacheControl: string[];
  };
  api: { path: string; status: number; durationMs: number }[];
};

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function configureProfile(page: Page, profile: "desktop" | "mobile-emulated") {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: false });
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
  const scriptResponseIds = new Set<string>();
  const scriptRequestCacheDirectives = new Map<string, string[]>();
  const servedFromCacheRequestIds = new Set<string>();
  const cacheServedIds = new Set<string>();
  const diskCacheIds = new Set<string>();
  const serviceWorkerIds = new Set<string>();
  const prefetchCacheIds = new Set<string>();
  const cacheControls = new Set<string>();
  const responseStatusCodes = new Set<number>();
  const conditionalRequestIds = new Set<string>();
  let etagResponses = 0;
  let lastModifiedResponses = 0;
  const onCacheServed = (event: { requestId: string }) => {
    servedFromCacheRequestIds.add(event.requestId);
    if (scriptResponseIds.has(event.requestId)) cacheServedIds.add(event.requestId);
  };
  const onCdpRequest = (event: { requestId: string; type?: string; request: { url: string; headers: Record<string, string> } }) => {
    if (event.type !== "Script" || !new URL(event.request.url).pathname.endsWith(".js")) return;
    const headers = Object.fromEntries(Object.entries(event.request.headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
    scriptRequestCacheDirectives.set(event.requestId, [headers["cache-control"], headers.pragma].filter((value): value is string => Boolean(value)));
    if (headers["if-none-match"] || headers["if-modified-since"]) conditionalRequestIds.add(event.requestId);
  };
  const onCdpResponse = (event: { requestId: string; type?: string; response: { url: string; headers: Record<string, string>; status?: number; fromDiskCache?: boolean; fromServiceWorker?: boolean; fromPrefetchCache?: boolean } }) => {
    if (event.type !== "Script" || !new URL(event.response.url).pathname.endsWith(".js")) return;
    scriptResponseIds.add(event.requestId);
    if (servedFromCacheRequestIds.has(event.requestId)) cacheServedIds.add(event.requestId);
    if (event.response.fromDiskCache) diskCacheIds.add(event.requestId);
    if (event.response.fromServiceWorker) serviceWorkerIds.add(event.requestId);
    if (event.response.fromPrefetchCache) prefetchCacheIds.add(event.requestId);
    if (event.response.headers.etag) etagResponses += 1;
    if (event.response.headers["last-modified"] || event.response.headers["Last-Modified"]) lastModifiedResponses += 1;
    if (typeof event.response.status === "number") responseStatusCodes.add(event.response.status);
    const cacheControl = Object.entries(event.response.headers).find(([name]) => name.toLowerCase() === "cache-control")?.[1];
    if (cacheControl) cacheControls.add(cacheControl);
  };
  session.on("Network.requestServedFromCache", onCacheServed);
  session.on("Network.requestWillBeSent", onCdpRequest);
  session.on("Network.responseReceived", onCdpResponse);
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
    const finiteOrNull = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value >= 0 ? Math.round(value * 10) / 10 : null;
    return {
      navigationMs: finiteOrNull(nav?.loadEventEnd),
      ttfbMs: finiteOrNull(nav?.responseStart),
      fcpMs: finiteOrNull(performance.getEntriesByName("first-contentful-paint")[0]?.startTime),
      lcpMs: finiteOrNull((window as Window & { __qr009Lcp?: number | null }).__qr009Lcp ?? undefined),
      cls: finiteOrNull((window as Window & { __qr009Cls?: number | null }).__qr009Cls ?? undefined),
      longTaskMs: finiteOrNull((window as Window & { __qr009LongTaskMs?: number | null }).__qr009LongTaskMs ?? undefined),
      transferBytes: nav ? resources.reduce((sum, entry) => sum + entry.transferSize, nav.transferSize) : null,
      jsTransferBytes: js.length > 0 ? js.reduce((sum, entry) => sum + entry.transferSize, 0) : null,
      jsResources: js.length,
      cachedJsResources: js.filter((entry) => entry.transferSize === 0 && entry.encodedBodySize > 0).length,
    };
  });
  page.off("response", onResponse);
  page.off("request", onRequest);
  session.off("Network.requestServedFromCache", onCacheServed);
  session.off("Network.requestWillBeSent", onCdpRequest);
  session.off("Network.responseReceived", onCdpResponse);
  return {
    route, profile, cache, sample, ...values,
    cacheDiagnostics: {
      jsResponseCount: scriptResponseIds.size, cacheServedCount: cacheServedIds.size, diskCacheCount: diskCacheIds.size,
      serviceWorkerCount: serviceWorkerIds.size, prefetchCacheCount: prefetchCacheIds.size,
      responseStatusCodes: [...responseStatusCodes].sort((a, b) => a - b),
      requestCacheDirectives: [...new Set([...scriptRequestCacheDirectives.values()].flat())].sort(),
      conditionalRequestCount: conditionalRequestIds.size, etagResponses, lastModifiedResponses,
      cacheControl: [...cacheControls].sort(),
    },
    api,
  };
}

async function newGuardedContext(browser: Browser, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport, permissions: ["camera"] });
  await context.addInitScript(() => {
    const state = window as Window & { __qr009Lcp?: number | null; __qr009Cls?: number | null; __qr009LongTaskMs?: number | null };
    state.__qr009Lcp = null;
    state.__qr009Cls = null;
    state.__qr009LongTaskMs = null;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.__qr009Lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // Unsupported LCP observation is represented as null.
    }
    try {
      state.__qr009Cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
          if (!entry.hadRecentInput) state.__qr009Cls = (state.__qr009Cls ?? 0) + (entry.value ?? 0);
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      state.__qr009Cls = null;
    }
    try {
      state.__qr009LongTaskMs = 0;
      new PerformanceObserver((list) => {
        state.__qr009LongTaskMs = (state.__qr009LongTaskMs ?? 0) + list.getEntries().reduce((sum, entry) => sum + entry.duration, 0);
      }).observe({ type: "longtask", buffered: true });
    } catch {
      state.__qr009LongTaskMs = null;
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
    const mobileLoginSession = await configureProfile(anonymousPage, "mobile-emulated");
    await measure(anonymousPage, "/login", "mobile-emulated", "cold", 0, mobileLoginSession);
    for (let sample = 1; sample <= sampleCount; sample++) records.push(await measure(anonymousPage, "/login", "mobile-emulated", "cold", sample, mobileLoginSession));
    await measure(anonymousPage, "/login", "mobile-emulated", "warm", 0, mobileLoginSession);
    for (let sample = 1; sample <= sampleCount; sample++) records.push(await measure(anonymousPage, "/login", "mobile-emulated", "warm", sample, mobileLoginSession));

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

    for (const context of [adminContext, supervisorContext, employeeContext]) {
      context.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path === "/api/attendance/scan") scanRequests.push("attendance scan endpoint");
        if (/^\/api\/employees\/[^/]+\/pin$/.test(path)) scanRequests.push("employee PIN endpoint");
      });
    }

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

    expect(records).toHaveLength(100);
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      baseCommit: process.env.QR009_BASE_COMMIT ?? process.env.GITHUB_SHA ?? "local-working-tree",
      environment: { app: "Next.js production build and server, local loopback", browser: "Chromium via Playwright", syntheticOnly: true, profiles: ["desktop 1440x900", "mobile emulated 390x844, CPU 4x, RTT 40ms, 1.6Mbps down / 750Kbps up"], samplesPerRouteCacheProfile: sampleCount, browserSamplesExpected: 100 },
      browser: { samples: records, summaries: summarize(records), interactions: { recharts, scanner: { cameraReadyMs: null, jsTransferBeforeCamera: null, jsTransferAfterCamera: null, cameraStatus: "not measured: production APP_BASE_URL origin guard rejects scanner-context POST from loopback HTTP", prohibitedAttendanceOrPinRequests: scanRequests.length } } },
      postgres: sql,
      limitations: ["No real-device INP; long-task duration is reported separately and is not TBT.", "Synthetic dataset is 500 employee rows only; no attendance sessions/events were created.", "Browser transferSize is local Chromium resource timing, not production CDN/RUM traffic.", "The production build safely rejects the scanner-context POST from loopback HTTP, so camera readiness and authorized-device API latency are not measured."],
    };
    const destination = targetFile;
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    process.stdout.write(`QR-009 results written to ${destination}; samples=${records.length}; PostgreSQL scenarios=${sql.scenarios.length}; no credentials or identities stored\n`);
    expect(scanRequests).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
  }
});

function summarize(records: Metric[]) {
  const metricStats = (values: (number | null)[]) => {
    const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return { validSamples: valid.length, p50: valid.length ? percentile(valid, 0.5) : null, p95: valid.length ? percentile(valid, 0.95) : null };
  };
  const keys = [...new Set(records.map((record) => `${record.route}|${record.profile}|${record.cache}`))];
  return keys.map((key) => {
    const [route, profile, cache] = key.split("|");
    const samples = records.filter((record) => `${record.route}|${record.profile}|${record.cache}` === key);
    const values = (field: "navigationMs" | "ttfbMs" | "fcpMs" | "lcpMs" | "cls" | "longTaskMs" | "transferBytes" | "jsTransferBytes" | "cachedJsResources") => samples.map((record) => record[field]);
    const apiPathsForRoute = [...new Set(samples.flatMap((record) => record.api.map((entry) => entry.path)))];
    return {
      route, profile, cache, n: samples.length,
      metrics: {
        navigationMs: metricStats(values("navigationMs")), ttfbMs: metricStats(values("ttfbMs")),
        fcpMs: metricStats(values("fcpMs")), lcpMs: metricStats(values("lcpMs")), cls: metricStats(values("cls")),
        longTaskMs: metricStats(values("longTaskMs")), transferBytes: metricStats(values("transferBytes")),
        jsTransferBytes: metricStats(values("jsTransferBytes")), cachedJsResources: metricStats(values("cachedJsResources")),
      },
      cacheDiagnostics: {
        jsResponseCountP50: percentile(samples.map((record) => record.cacheDiagnostics.jsResponseCount), 0.5),
        cacheServedCountP50: percentile(samples.map((record) => record.cacheDiagnostics.cacheServedCount), 0.5),
        diskCacheCountP50: percentile(samples.map((record) => record.cacheDiagnostics.diskCacheCount), 0.5),
        serviceWorkerCountP50: percentile(samples.map((record) => record.cacheDiagnostics.serviceWorkerCount), 0.5),
        prefetchCacheCountP50: percentile(samples.map((record) => record.cacheDiagnostics.prefetchCacheCount), 0.5),
        responseStatusCodes: [...new Set(samples.flatMap((record) => record.cacheDiagnostics.responseStatusCodes))].sort((a, b) => a - b),
        requestCacheDirectives: [...new Set(samples.flatMap((record) => record.cacheDiagnostics.requestCacheDirectives))].sort(),
        conditionalRequestCountP50: percentile(samples.map((record) => record.cacheDiagnostics.conditionalRequestCount), 0.5),
        etagResponsesP50: percentile(samples.map((record) => record.cacheDiagnostics.etagResponses), 0.5),
        lastModifiedResponsesP50: percentile(samples.map((record) => record.cacheDiagnostics.lastModifiedResponses), 0.5),
        cacheControl: [...new Set(samples.flatMap((record) => record.cacheDiagnostics.cacheControl))].sort(),
      },
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
