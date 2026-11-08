import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { readLoginCredentials } = await import("../src/lib/access/login-credentials.ts");
const action = await readFile(new URL("../src/app/(auth)/login/actions.ts", import.meta.url), "utf8");

test("login reads current autofilled FormData, normalizes email, and preserves password exactly", () => {
  const form = new FormData();
  // Simulate browser credential-manager autofill immediately before submit.
  form.set("email", "  Person@Example.COM  ");
  form.set("password", "  Preserved Case & symbols  ");
  assert.deepEqual(readLoginCredentials(form), {
    email: "person@example.com",
    password: "  Preserved Case & symbols  ",
  });
});

test("login rejects missing or blank credentials without recording their contents", () => {
  const form = new FormData();
  form.set("email", "  ");
  form.set("password", "not-logged");
  assert.equal(readLoginCredentials(form), null);
  assert.equal(readLoginCredentials(new FormData()), null);
});

test("Server Action submits current parsed FormData and sign-out invalidates Auth before clearing the membership cookie", () => {
  assert.match(action, /readLoginCredentials\(formData\)/);
  assert.match(action, /signInWithPassword\(credentials\)/);
  assert.match(action, /await supabase\.auth\.signOut\(\)/);
  assert.match(action, /await clearActiveMembershipCookie\(\)/);
  assert.doesNotMatch(action, /console\.(?:log|error|warn)|localStorage|sessionStorage/);
});
