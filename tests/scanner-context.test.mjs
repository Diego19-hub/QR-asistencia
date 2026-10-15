import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const helperPath = fileURLToPath(new URL("../src/lib/http/request-origin.ts", import.meta.url));
const helperSource = readFileSync(helperPath, "utf8");
const helperJs = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const require = createRequire(import.meta.url);
const cjsModule = { exports: {} };
new Function("require", "module", "exports", helperJs)(require, cjsModule, cjsModule.exports);
const { isAllowedRequestOrigin, isCurrentContextRequest } = cjsModule.exports;

function preserveOriginEnv(callback) {
  const previous = {
    appBaseUrl: process.env.APP_BASE_URL,
    nodeEnv: process.env.NODE_ENV,
    devOrigin: process.env.NEXT_ALLOWED_DEV_ORIGIN,
  };
  try {
    callback();
  } finally {
    if (previous.appBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous.appBaseUrl;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    if (previous.devOrigin === undefined) delete process.env.NEXT_ALLOWED_DEV_ORIGIN;
    else process.env.NEXT_ALLOWED_DEV_ORIGIN = previous.devOrigin;
  }
}

test("allows same-origin requests in development", () => preserveOriginEnv(() => {
  delete process.env.APP_BASE_URL;
  process.env.NODE_ENV = "development";
  const request = new Request("https://scanner.example/api/supervisor/scanner/context", {
    method: "POST",
    headers: { origin: "https://scanner.example" },
  });

  assert.equal(isAllowedRequestOrigin(request), true);
}));

test("allows the exact APP_BASE_URL HTTPS origin when Dokploy request.url is internal HTTP", () => preserveOriginEnv(() => {
  process.env.APP_BASE_URL = "https://asistencia-test.duob.tech";
  process.env.NODE_ENV = "production";
  process.env.NEXT_ALLOWED_DEV_ORIGIN = "attacker.example";
  const request = new Request("http://0.0.0.0:3000/api/supervisor/scanner/context", {
    method: "POST",
    headers: { origin: "https://asistencia-test.duob.tech" },
  });

  assert.equal(isAllowedRequestOrigin(request), true);
}));

test("production rejects internal, external, lookalike, malformed, and insecure origins", () => preserveOriginEnv(() => {
  process.env.APP_BASE_URL = "https://asistencia-test.duob.tech";
  process.env.NODE_ENV = "production";
  process.env.NEXT_ALLOWED_DEV_ORIGIN = "grateful-upgrade-lakes-empty.trycloudflare.com";
  const origins = [
    "http://0.0.0.0:3000",
    "https://attacker.example",
    "https://asistencia-test.duob.tech.attacker.example",
    "http://asistencia-test.duob.tech",
    "null",
    "https://asistencia-test.duob.tech/",
  ];
  for (const origin of origins) {
    const request = new Request("http://0.0.0.0:3000/api/supervisor/device-requests", {
      method: "POST",
      headers: { origin },
    });
    assert.equal(isAllowedRequestOrigin(request), false, `must reject ${origin}`);
  }
  const forwardedHeaderSpoof = new Request("http://0.0.0.0:3000/api/supervisor/scanner/context", {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      "x-forwarded-host": "asistencia-test.duob.tech",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(isAllowedRequestOrigin(forwardedHeaderSpoof), false);
}));

test("NEXT_ALLOWED_DEV_ORIGIN is exact HTTPS-only and ignored in production", () => preserveOriginEnv(() => {
  process.env.NODE_ENV = "development";
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.NEXT_ALLOWED_DEV_ORIGIN = "grateful-upgrade-lakes-empty.trycloudflare.com";
  const tunnel = new Request("http://localhost:3000/api/supervisor/scanner/context", {
    method: "POST",
    headers: { origin: "https://grateful-upgrade-lakes-empty.trycloudflare.com" },
  });
  const insecureTunnel = new Request("http://localhost:3000/api/supervisor/scanner/context", {
    method: "POST",
    headers: { origin: "http://grateful-upgrade-lakes-empty.trycloudflare.com" },
  });
  const lookalike = new Request("http://localhost:3000/api/supervisor/scanner/context", {
    method: "POST",
    headers: { origin: "https://grateful-upgrade-lakes-empty.trycloudflare.com.attacker.example" },
  });
  assert.equal(isAllowedRequestOrigin(tunnel), true);
  assert.equal(isAllowedRequestOrigin(insecureTunnel), false);
  assert.equal(isAllowedRequestOrigin(lookalike), false);

  process.env.NODE_ENV = "production";
  assert.equal(isAllowedRequestOrigin(tunnel), false);
}));

test("both supervisor POST routes enforce the shared origin guard before processing", () => {
  const contextRoute = readFileSync(new URL("../src/app/api/supervisor/scanner/context/route.ts", import.meta.url), "utf8");
  const deviceRequestRoute = readFileSync(new URL("../src/app/api/supervisor/device-requests/route.ts", import.meta.url), "utf8");
  const guard = "if (!isAllowedRequestOrigin(request))";
  assert.ok(contextRoute.indexOf(guard) >= 0 && contextRoute.indexOf(guard) < contextRoute.indexOf("scannerContext(request, true)"));
  assert.ok(deviceRequestRoute.indexOf(guard) >= 0 && deviceRequestRoute.indexOf(guard) < deviceRequestRoute.indexOf("createClient()"));
});

test("does not commit an aborted or superseded context response", () => {
  const controller = new AbortController();

  assert.equal(isCurrentContextRequest(2, 2, controller.signal), true);
  assert.equal(isCurrentContextRequest(1, 2, controller.signal), false);
  controller.abort();
  assert.equal(isCurrentContextRequest(2, 2, controller.signal), false);
});
