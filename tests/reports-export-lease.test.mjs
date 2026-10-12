import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { acquireDistributedExportLease } from "../src/lib/reports/export-lease.ts";

const routeSource = await readFile(new URL("../src/app/api/reports/export/route.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261012050537_global_report_export_lease.sql", import.meta.url), "utf8");

function createLeaseDb() {
  let now = 1_000;
  let active = null;
  const authorized = new Map([["admin-a", new Set(["company-a"])], ["admin-b", new Set(["company-b"])]]);
  const client = (userId) => ({
    async rpc(name, args) {
      if (!authorized.get(userId)?.has(args.p_company_id)) return { data: null, error: { code: "42501" } };
      if (name === "acquire_report_export_lease") {
        if (active && active.expiresAt > now) return { data: [{ acquired: false, retry_after_seconds: Math.ceil((active.expiresAt - now) / 1000) }], error: null };
        active = { token: args.p_owner_token, companyId: args.p_company_id, userId, expiresAt: now + args.p_lease_seconds * 1000 };
        return { data: [{ acquired: true, retry_after_seconds: 0 }], error: null };
      }
      if (name === "renew_report_export_lease") {
        const match = active?.token === args.p_owner_token && active.companyId === args.p_company_id && active.userId === userId && active.expiresAt > now;
        if (match) active.expiresAt = now + args.p_lease_seconds * 1000;
        return { data: match, error: null };
      }
      if (name === "release_report_export_lease") {
        const match = active?.token === args.p_owner_token && active.companyId === args.p_company_id && active.userId === userId;
        if (match) active = null;
        return { data: match, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  });
  return { client, state: () => active, advance: (ms) => { now += ms; } };
}

test("global slot rejects a simultaneous export across companies and reopens after release", async () => {
  const db = createLeaseDb();
  const first = await acquireDistributedExportLease(db.client("admin-a"), "company-a");
  const second = await acquireDistributedExportLease(db.client("admin-b"), "company-b");
  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  if (first.acquired) await first.lease.release();
  const third = await acquireDistributedExportLease(db.client("admin-b"), "company-b");
  assert.equal(third.acquired, true);
  if (third.acquired) await third.lease.release();
});

test("an abandoned lease expires, and a previous owner cannot renew or release its successor", async () => {
  const db = createLeaseDb();
  const old = await acquireDistributedExportLease(db.client("admin-a"), "company-a");
  assert.equal(old.acquired, true);
  db.advance(121_000);
  const successor = await acquireDistributedExportLease(db.client("admin-b"), "company-b");
  assert.equal(successor.acquired, true);
  if (!old.acquired || !successor.acquired) return;
  assert.equal(await old.lease.renew(), false);
  await old.lease.release();
  assert.equal(db.state()?.companyId, "company-b");
  assert.equal(await successor.lease.renew(), true);
  await successor.lease.release();
  assert.equal(db.state(), null);
});

test("authorization is checked before an export can acquire the global slot", async () => {
  const db = createLeaseDb();
  const unauthorized = await acquireDistributedExportLease(db.client("admin-a"), "company-b");
  assert.equal(unauthorized.acquired, false);
  assert.equal("error" in unauthorized && unauthorized.error?.code, "42501");
  assert.equal(db.state(), null);
});

test("an exception during file generation releases its active lease in finally", async () => {
  const db = createLeaseDb();
  const claim = await acquireDistributedExportLease(db.client("admin-a"), "company-a");
  assert.equal(claim.acquired, true);
  if (!claim.acquired) return;
  await assert.rejects(async () => {
    try { throw new Error("synthetic generator failure"); }
    finally { await claim.lease.release(); }
  }, /synthetic generator failure/);
  assert.equal(db.state(), null);
});

test("generated response retains the lease through body completion and releases it on cancellation", async () => {
  const db = createLeaseDb();
  const first = await acquireDistributedExportLease(db.client("admin-a"), "company-a");
  assert.equal(first.acquired, true);
  if (!first.acquired) return;
  const reader = first.lease.createResponseBody(Buffer.from("synthetic file")).getReader();
  assert.equal((await reader.read()).value?.toString(), "synthetic file");
  assert.ok(db.state(), "lease remains while response body is outstanding");
  assert.equal((await reader.read()).done, true);
  assert.equal(db.state(), null);

  const second = await acquireDistributedExportLease(db.client("admin-b"), "company-b");
  assert.equal(second.acquired, true);
  if (second.acquired) {
    await second.lease.createResponseBody(Buffer.from("cancelled")).cancel();
    assert.equal(db.state(), null);
  }
});

test("route takes lease before quota and data loading, and releases on every pre-stream return", () => {
  const lease = routeSource.indexOf("const claim = await acquireDistributedExportLease");
  const quota = routeSource.indexOf("consume_report_export_quota");
  const data = routeSource.indexOf("loadReport(");
  const generation = routeSource.indexOf("createReportWorkbook(");
  assert.ok(lease >= 0 && lease < quota && quota < data && data < generation);
  assert.match(routeSource, /finally\s*\{\s*if\s*\(!responseOwnsLease\)\s*await lease\.release\(\)/);
  assert.match(routeSource, /apiError\("export_concurrency_limited"[\s\S]*?, 429/);
  assert.match(routeSource, /"Retry-After"/);
  assert.match(routeSource, /result\.rows\.length > 500/);
});

test("migration keeps the lease private and exposes only authenticated, authorized, token-bound RPCs", () => {
  assert.match(migration, /create table private\.report_export_leases/);
  assert.match(migration, /alter table private\.report_export_leases enable row level security/);
  assert.match(migration, /set search_path = ''/);
  assert.equal((migration.match(/select auth\.uid\(\)/g) ?? []).length, 3);
  assert.equal((migration.match(/private\.has_company_permission\(p_company_id, 'reports\.read'\)/g) ?? []).length, 2);
  assert.match(migration, /leases\.owner_token = p_owner_token/);
  assert.match(migration, /leases\.expires_at <= clock_timestamp\(\)/);
  const releaseFunction = migration.split("create or replace function public.release_report_export_lease")[1];
  assert.match(releaseFunction, /leases\.user_id = current_user_id/);
  assert.doesNotMatch(releaseFunction, /has_company_permission/);
  assert.match(migration, /grant execute on function public\.acquire_report_export_lease\(uuid, uuid, integer\) to authenticated/);
  assert.match(migration, /revoke all on function public\.release_report_export_lease\(uuid, uuid\) from public, anon, authenticated, service_role/);
});
