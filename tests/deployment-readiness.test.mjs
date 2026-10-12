import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const healthModule = await import("../src/app/api/healthz/route.ts");

test("healthz returns only a cache-disabled liveness status", async () => {
  const response = healthModule.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("Testing container uses Node 22, low-privilege runtime, and PDFKit AFM validation", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /FROM node:22-bookworm-slim AS runtime/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /Helvetica\.afm/);
  assert.match(dockerfile, /\/api\/healthz/);
  assert.doesNotMatch(dockerfile, /SERVICE_ROLE|service_role/i);
});

test("Caddy preserves export streaming and grants camera only to this origin", async () => {
  const caddyfile = await readFile(new URL("../Caddyfile.testing", import.meta.url), "utf8");
  assert.match(caddyfile, /flush_interval -1/);
  assert.match(caddyfile, /stream_timeout 15m/);
  assert.match(caddyfile, /camera=\(self\)/);
  assert.match(caddyfile, /request>uri regexp/);
  assert.match(caddyfile, /request>headers>Referer delete/);
});

test("export telemetry records capacity signals without tenant or credential fields", async () => {
  const route = await readFile(new URL("../src/app/api/reports/export/route.ts", import.meta.url), "utf8");
  const logEntry = route.split("console.info(JSON.stringify({")[1]?.split("}));")[0];
  assert.ok(logEntry);
  for (const field of ["requestId", "format", "status", "handlerDurationMs", "rssBytes"]) {
    assert.match(logEntry, new RegExp(`\\b${field}\\b`));
  }
  assert.doesNotMatch(logEntry, /companyId|userId|cookie|authorization|pin|token|filters/i);
});
