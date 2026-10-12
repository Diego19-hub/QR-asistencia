import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import ExcelJS from "exceljs";

const env = process.env;
const required = [
  "QR_TEST_APP_URL", "QR_TEST_SUPABASE_URL", "QR_TEST_SUPABASE_PUBLISHABLE_KEY",
  "QR_TEST_COMPANY_A_ID", "QR_TEST_ADMIN_A_EMAIL", "QR_TEST_ADMIN_A_PASSWORD",
  "QR_TEST_COMPANY_B_ID", "QR_TEST_ADMIN_B_EMAIL", "QR_TEST_ADMIN_B_PASSWORD",
  "QR_TEST_SUPERVISOR_EMAIL", "QR_TEST_SUPERVISOR_PASSWORD", "QR_TEST_FROM", "QR_TEST_TO",
  "QR_TEST_SENTINEL_A", "QR_TEST_SENTINEL_B",
];
const strict = env.QR_SECURITY_STRICT === "1";
const missing = required.filter((key) => !env[key]);
if (strict && missing.length) throw new Error(`strict report integration configuration missing: ${missing.join(", ")}`);

function assertTestProjectTarget() {
  assert.equal(new URL(env.QR_TEST_SUPABASE_URL).hostname, "llxyziffgtqnzlguxhyt.supabase.co", "integration tests must use QR-asistencia-testing");
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(env.QR_TEST_APP_URL).hostname), "HTTP integration tests must use a local app server");
}

async function authenticatedCookie(email, password) {
  const jar = new Map();
  const supabase = createServerClient(env.QR_TEST_SUPABASE_URL, env.QR_TEST_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  assert.equal(error, null, "test account must authenticate in the isolated test project");
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function requestReport(path, cookie) {
  return fetch(new URL(path, env.QR_TEST_APP_URL), { headers: { cookie, accept: "application/json" }, redirect: "manual" });
}

test("authenticated report and export routes stay within each company's RLS scope", { skip: strict ? false : missing.length ? `configure isolated test environment (${missing.join(", ")})` : false }, async () => {
  assertTestProjectTarget();
  assert.notEqual(env.QR_TEST_COMPANY_A_ID, env.QR_TEST_COMPANY_B_ID);
  const [adminACookie, adminBCookie, supervisorCookie] = await Promise.all([
    authenticatedCookie(env.QR_TEST_ADMIN_A_EMAIL, env.QR_TEST_ADMIN_A_PASSWORD),
    authenticatedCookie(env.QR_TEST_ADMIN_B_EMAIL, env.QR_TEST_ADMIN_B_PASSWORD),
    authenticatedCookie(env.QR_TEST_SUPERVISOR_EMAIL, env.QR_TEST_SUPERVISOR_PASSWORD),
  ]);
  const from = encodeURIComponent(env.QR_TEST_FROM);
  const to = encodeURIComponent(env.QR_TEST_TO);
  const ownA = `/api/reports?companyId=${env.QR_TEST_COMPANY_A_ID}&from=${from}&to=${to}`;
  const ownB = `/api/reports?companyId=${env.QR_TEST_COMPANY_B_ID}&from=${from}&to=${to}`;
  const [reportA, reportB, foreignA, foreignB, deniedSupervisor] = await Promise.all([
    requestReport(ownA, adminACookie), requestReport(ownB, adminBCookie),
    requestReport(ownB, adminACookie), requestReport(ownA, adminBCookie), requestReport(ownA, supervisorCookie),
  ]);
  assert.equal(reportA.status, 200);
  assert.equal(reportB.status, 200);
  const jsonA = await reportA.json();
  const jsonB = await reportB.json();
  assert.equal(jsonA.company.id, env.QR_TEST_COMPANY_A_ID);
  assert.equal(jsonB.company.id, env.QR_TEST_COMPANY_B_ID);
  assert.ok(JSON.stringify(jsonA).includes(env.QR_TEST_SENTINEL_A), "company A report includes its synthetic sentinel");
  assert.ok(!JSON.stringify(jsonA).includes(env.QR_TEST_SENTINEL_B), "company A report excludes company B sentinel");
  assert.ok(JSON.stringify(jsonB).includes(env.QR_TEST_SENTINEL_B), "company B report includes its synthetic sentinel");
  assert.ok(!JSON.stringify(jsonB).includes(env.QR_TEST_SENTINEL_A), "company B report excludes company A sentinel");
  for (const response of [foreignA, foreignB, deniedSupervisor]) assert.equal(response.status, 403);

  for (const cookie of [adminACookie, adminBCookie]) {
    const ownCompanyId = cookie === adminACookie ? env.QR_TEST_COMPANY_A_ID : env.QR_TEST_COMPANY_B_ID;
    for (const format of ["xlsx", "pdf"]) {
      const ownExport = await fetch(new URL(`/api/reports/export?companyId=${ownCompanyId}&from=${from}&to=${to}&format=${format}`, env.QR_TEST_APP_URL), { headers: { cookie }, redirect: "manual" });
      assert.equal(ownExport.status, 200);
      const bytes = Buffer.from(await ownExport.arrayBuffer());
      assert.ok(bytes.length > 100);
      if (format === "xlsx") {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes);
        assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Resumen", "Asistencias", "Horas extra", "Incidencias"]);
        const workbookText = workbook.worksheets.flatMap((sheet) => sheet.getSheetValues().flat()).join(" ");
        const ownSentinel = ownCompanyId === env.QR_TEST_COMPANY_A_ID ? env.QR_TEST_SENTINEL_A : env.QR_TEST_SENTINEL_B;
        const otherSentinel = ownCompanyId === env.QR_TEST_COMPANY_A_ID ? env.QR_TEST_SENTINEL_B : env.QR_TEST_SENTINEL_A;
        assert.ok(workbookText.includes(ownSentinel), `${format} export contains its company's synthetic sentinel`);
        assert.ok(!workbookText.includes(otherSentinel), `${format} export excludes the other company's synthetic sentinel`);
      } else {
        assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
        const extracted = spawnSync("pdftotext", ["-", "-"], { input: bytes, encoding: "utf8" });
        assert.equal(extracted.error, undefined, "pdftotext must be installed to inspect PDF contents");
        assert.equal(extracted.status, 0, "PDF text extraction succeeds");
        const ownSentinel = ownCompanyId === env.QR_TEST_COMPANY_A_ID ? env.QR_TEST_SENTINEL_A : env.QR_TEST_SENTINEL_B;
        const otherSentinel = ownCompanyId === env.QR_TEST_COMPANY_A_ID ? env.QR_TEST_SENTINEL_B : env.QR_TEST_SENTINEL_A;
        // PDF text extraction may insert line breaks inside a wrapped employee name.
        const normalizedPdf = extracted.stdout.replace(/\s+/g, "");
        assert.ok(normalizedPdf.includes(ownSentinel.replace(/\s+/g, "")), `${format} export contains its company's synthetic sentinel`);
        assert.ok(!normalizedPdf.includes(otherSentinel.replace(/\s+/g, "")), `${format} export excludes the other company's synthetic sentinel`);
      }

      const foreignId = ownCompanyId === env.QR_TEST_COMPANY_A_ID ? env.QR_TEST_COMPANY_B_ID : env.QR_TEST_COMPANY_A_ID;
      const foreignExport = await fetch(new URL(`/api/reports/export?companyId=${foreignId}&from=${from}&to=${to}&format=${format}`, env.QR_TEST_APP_URL), { headers: { cookie }, redirect: "manual" });
      assert.equal(foreignExport.status, 403);
    }
  }

  const limitedPath = `/api/reports/export?companyId=${env.QR_TEST_COMPANY_A_ID}&from=${from}&to=${to}&format=xlsx`;
  const remainingRequests = await Promise.all(Array.from({ length: 9 }, async () => {
    const response = await fetch(new URL(limitedPath, env.QR_TEST_APP_URL), { headers: { cookie: adminACookie }, redirect: "manual" });
    return { status: response.status, retryAfter: response.headers.get("retry-after") };
  }));
  assert.equal(remainingRequests.filter((item) => item.status === 200).length, 8, "the shared fixed window permits up to ten exports per admin and company");
  const limited = remainingRequests.find((item) => item.status === 429);
  assert.ok(limited, "the shared fixed window returns HTTP 429 after the quota");
  assert.ok(Number(limited.retryAfter) > 0, "429 includes a positive Retry-After value");
});

test("report JSON and export routes reject unauthenticated requests", { skip: strict ? false : !env.QR_TEST_APP_URL ? "set QR_TEST_APP_URL to a local test server" : false }, async () => {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(env.QR_TEST_APP_URL).hostname), "unauthenticated tests must use a local app server");
  const query = "companyId=00000000-0000-4000-8000-000000000001&from=2026-10-01&to=2026-10-07";
  for (const path of [`/api/reports?${query}`, `/api/reports/export?${query}&format=xlsx`, `/api/reports/export?${query}&format=pdf`]) {
    const response = await fetch(new URL(path, env.QR_TEST_APP_URL), { redirect: "manual" });
    assert.equal(response.status, 401, `${path} rejects a request without a session`);
  }
});
