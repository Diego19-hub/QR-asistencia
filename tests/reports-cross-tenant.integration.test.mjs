import assert from "node:assert/strict";
import test from "node:test";
import { createServerClient } from "@supabase/ssr";
import ExcelJS from "exceljs";

const env = process.env;
const required = [
  "QR_TEST_APP_URL", "QR_TEST_SUPABASE_URL", "QR_TEST_SUPABASE_PUBLISHABLE_KEY",
  "QR_TEST_COMPANY_A_ID", "QR_TEST_ADMIN_A_EMAIL", "QR_TEST_ADMIN_A_PASSWORD",
  "QR_TEST_COMPANY_B_ID", "QR_TEST_ADMIN_B_EMAIL", "QR_TEST_ADMIN_B_PASSWORD",
  "QR_TEST_SUPERVISOR_EMAIL", "QR_TEST_SUPERVISOR_PASSWORD", "QR_TEST_FROM", "QR_TEST_TO",
];
const missing = required.filter((key) => !env[key]);

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

test("authenticated report and export routes stay within each company's RLS scope", { skip: missing.length ? `configure isolated test environment (${missing.join(", ")})` : false }, async () => {
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
  assert.equal((await reportA.json()).company.id, env.QR_TEST_COMPANY_A_ID);
  assert.equal((await reportB.json()).company.id, env.QR_TEST_COMPANY_B_ID);
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
      } else assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");

      const foreignId = ownCompanyId === env.QR_TEST_COMPANY_A_ID ? env.QR_TEST_COMPANY_B_ID : env.QR_TEST_COMPANY_A_ID;
      const foreignExport = await fetch(new URL(`/api/reports/export?companyId=${foreignId}&from=${from}&to=${to}&format=${format}`, env.QR_TEST_APP_URL), { headers: { cookie }, redirect: "manual" });
      assert.equal(foreignExport.status, 403);
    }
  }
});
