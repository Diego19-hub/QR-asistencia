import assert from "node:assert/strict";
import test from "node:test";

import {
  REMEMBER_SESSION_MAX_AGE_SECONDS,
  isRememberSessionEnabled,
  withSessionCookieLifetime,
} from "../src/lib/supabase/session-cookie-policy.ts";

test("remember choice persists Supabase cookies for at most 30 days", () => {
  const result = withSessionCookieLifetime({ path: "/", maxAge: 400 * 24 * 60 * 60 }, true);
  assert.equal(result.maxAge, REMEMBER_SESSION_MAX_AGE_SECONDS);
});

test("unchecked choice makes refreshed Supabase cookies browser-session cookies", () => {
  const result = withSessionCookieLifetime({ path: "/", maxAge: 400 * 24 * 60 * 60 }, false);
  assert.equal("maxAge" in result, false);
  assert.equal(result.path, "/");
});

test("Auth cookie deletions stay deletions for either persistence choice", () => {
  for (const remember of [true, false]) {
    assert.equal(withSessionCookieLifetime({ maxAge: 0 }, remember).maxAge, 0);
  }
});

test("only the server-set marker enables persistent-cookie policy", () => {
  assert.equal(isRememberSessionEnabled("1"), true);
  for (const value of [undefined, "", "true", "0", "1; Secure"]) {
    assert.equal(isRememberSessionEnabled(value), false);
  }
});
