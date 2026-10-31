import test from "node:test";
import assert from "node:assert/strict";
import { waitForCookieValue } from "./qr004-server-actions.browser.mjs";

const name = "qr_active_membership_id";
test("waits for the exact authorized membership cookie", async () => {
  let reads = 0;
  const cookie = await waitForCookieValue(async () =>
    [{ name, value: ++reads < 3 ? "previous" : "authorized" }],
    name, "authorized", { attempts: 5, intervalMs: 0 });
  assert.equal(cookie.value, "authorized");
  assert.equal(reads, 3);
});
test("rejects a stale membership cookie instead of relaxing authorization", async () => {
  await assert.rejects(() => waitForCookieValue(async () =>
    [{ name, value: "previous" }], name, "authorized",
    { attempts: 2, intervalMs: 0 }), /did not commit/);
});
test("rejects missing, unrelated or unsafe retry constraints", async () => {
  await assert.rejects(() => waitForCookieValue(async () => [], name, "authorized",
    { attempts: 1, intervalMs: 0 }), /did not commit/);
  await assert.rejects(() => waitForCookieValue(async () =>
    [{ name: "other", value: "authorized" }], name, "authorized",
    { attempts: 1, intervalMs: 0 }), /did not commit/);
  await assert.rejects(() => waitForCookieValue(async () => [], name, "authorized",
    { attempts: 201, intervalMs: 0 }), /Invalid bounded/);
});
