import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const helperPath = fileURLToPath(new URL("../src/lib/http/request-origin.ts", import.meta.url));
const helperSource = readFileSync(helperPath, "utf8");
const helperJs = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { isAllowedRequestOrigin, isCurrentContextRequest } = await import(
  `data:text/javascript;base64,${Buffer.from(helperJs).toString("base64")}`
);

test("allows same-origin requests", () => {
  const request = new Request("https://scanner.example/api/supervisor/scanner/context", {
    method: "POST",
    headers: { origin: "https://scanner.example" },
  });

  assert.equal(isAllowedRequestOrigin(request), true);
});

test("allows the exact configured HTTPS tunnel when the origin service URL is internal", () => {
  const previous = process.env.NEXT_ALLOWED_DEV_ORIGIN;
  process.env.NEXT_ALLOWED_DEV_ORIGIN = "grateful-upgrade-lakes-empty.trycloudflare.com";
  try {
    const request = new Request("http://localhost:3000/api/supervisor/scanner/context", {
      method: "POST",
      headers: { origin: "https://grateful-upgrade-lakes-empty.trycloudflare.com" },
    });

    assert.equal(isAllowedRequestOrigin(request), true);
  } finally {
    if (previous === undefined) delete process.env.NEXT_ALLOWED_DEV_ORIGIN;
    else process.env.NEXT_ALLOWED_DEV_ORIGIN = previous;
  }
});

test("rejects a different origin and an HTTP origin on the configured tunnel host", () => {
  const previous = process.env.NEXT_ALLOWED_DEV_ORIGIN;
  process.env.NEXT_ALLOWED_DEV_ORIGIN = "grateful-upgrade-lakes-empty.trycloudflare.com";
  try {
    const foreign = new Request("http://localhost:3000/api/supervisor/device-requests", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    const insecureTunnel = new Request("http://localhost:3000/api/supervisor/device-requests", {
      method: "POST",
      headers: { origin: "http://grateful-upgrade-lakes-empty.trycloudflare.com" },
    });

    assert.equal(isAllowedRequestOrigin(foreign), false);
    assert.equal(isAllowedRequestOrigin(insecureTunnel), false);
  } finally {
    if (previous === undefined) delete process.env.NEXT_ALLOWED_DEV_ORIGIN;
    else process.env.NEXT_ALLOWED_DEV_ORIGIN = previous;
  }
});

test("does not commit an aborted or superseded context response", () => {
  const controller = new AbortController();

  assert.equal(isCurrentContextRequest(2, 2, controller.signal), true);
  assert.equal(isCurrentContextRequest(1, 2, controller.signal), false);
  controller.abort();
  assert.equal(isCurrentContextRequest(2, 2, controller.signal), false);
});
