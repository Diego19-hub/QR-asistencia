import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { credentialApiError } from "../src/lib/employees/credential-api-error.ts";

test("unknown and cross-company employee credential lookups are indistinguishable", async () => {
  // The scoped credential RPC returns P0002 for either lookup. Exercise the
  // same response mapper used by the actual Next.js route without real data.
  const missingEmployeeResponse = credentialApiError({ code: "P0002" });
  const otherCompanyResponse = credentialApiError({ code: "P0002" });

  assert.equal(missingEmployeeResponse.status, 404);
  assert.equal(otherCompanyResponse.status, 404);
  assert.deepEqual(
    {
      body: await missingEmployeeResponse.json(),
      cache: missingEmployeeResponse.headers.get("Cache-Control"),
    },
    {
      body: await otherCompanyResponse.json(),
      cache: otherCompanyResponse.headers.get("Cache-Control"),
    },
  );
});

test("the QR API route uses the common credential RPC error response", async () => {
  const route = await readFile(new URL("../src/app/api/employees/[id]/qr/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(error\) return credentialApiError\(error\)/);
});

test("credential RPC scopes employee lookup by company and uses the same not-found SQLSTATE", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261011182937_employee_qr_credentials.sql", import.meta.url), "utf8");
  assert.match(migration, /where e\.company_id=p_company_id and e\.id=p_employee_id/);
  assert.match(migration, /if not found then raise exception 'employee not found' using errcode='P0002'/);
});
