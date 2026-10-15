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

test("GHCR workflow publishes only an AMD64 image after enforcing the Testing project ref", async () => {
  const workflow = await readFile(new URL("../.github/workflows/publish-ghcr-testing.yml", import.meta.url), "utf8");
  assert.match(workflow, /packages:\s*write/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /vars\.NEXT_PUBLIC_SUPABASE_URL != ''/);
  assert.match(workflow, /vars\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY != ''/);
  assert.match(workflow, /https:\/\/llxyziffgtqnzlguxhyt\.supabase\.co/);
  assert.match(workflow, /platforms:\s*linux\/amd64/);
  assert.match(workflow, /tags:\s*\$\{\{ env\.REGISTRY \}\}\/\$\{\{ env\.IMAGE_NAME \}\}:\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /steps\.image\.outputs\.digest/);
  assert.match(workflow, /NEXT_PUBLIC_SUPABASE_URL=\$\{\{ env\.NEXT_PUBLIC_SUPABASE_URL \}\}/);
  assert.match(workflow, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\$\{\{ env\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \}\}/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|RESEND_API_KEY|DATABASE_URL/i);
  const buildArgs = workflow.split("build-args:")[1]?.split("\n\n      - name:")[0];
  assert.ok(buildArgs);
  assert.doesNotMatch(buildArgs, /PASSWORD|SERVICE_ROLE|RESEND|DATABASE_URL/i);
});

test("Dokploy guide documents private GHCR, immutable references, and single-instance port 3000", async () => {
  const guide = await readFile(new URL("../DOKPLOY-GHCR-TESTING.md", import.meta.url), "utf8");
  assert.match(guide, /GHCR.*privad/i);
  assert.match(guide, /read:packages/);
  assert.match(guide, /sha256:/);
  assert.match(guide, /una sola instancia/);
  assert.match(guide, /3000/);
  assert.match(guide, /llxyziffgtqnzlguxhyt/);
});

test("local Auth disables public sign-up while keeping email login available for invited users", async () => {
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /\[auth\][\s\S]*?enable_signup = false/);
  assert.match(config, /\[auth\.email\][\s\S]*?enable_signup = true/);
});

test("Testing first-company bootstrap is hard-pinned and keeps the Production guard intact", async () => {
  const testingBootstrap = await readFile(new URL("../scripts/bootstrap-first-company-testing.mjs", import.meta.url), "utf8");
  const productionBootstrap = await readFile(new URL("../scripts/bootstrap-first-company.mjs", import.meta.url), "utf8");
  assert.match(testingBootstrap, /PROJECT_REF = 'llxyziffgtqnzlguxhyt'/);
  assert.match(testingBootstrap, /const COMPANY_NAME = 'DiegosCompany'/);
  assert.match(testingBootstrap, /https:\/\/\$\{PROJECT_REF\}\.supabase\.co/);
  assert.match(testingBootstrap, /auth\.admin\.getUserById/);
  assert.match(testingBootstrap, /bootstrap_first_company/);
  assert.match(testingBootstrap, /\.supabase-bootstrap\/testing-first-company\.json/);
  assert.doesNotMatch(testingBootstrap, /jawdrhewabqajxnswhkn|NEXT_PUBLIC_|process\.env\.SUPABASE_URL/);
  assert.match(productionBootstrap, /EXPECTED_PROJECT_REF = 'jawdrhewabqajxnswhkn'/);
  assert.match(productionBootstrap, /bootstrap_first_company/);
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
