import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyBenchmarkResult, expected } from "./qr009-phase4-run.mjs";
const proof = [
  "PASS isolated Next.js production build completed with loopback-only Supabase configuration",
  "PASS QR-009 performance-only preserved full local attendance snapshots; both tables remain empty",
  "PASS temporary stack and data removed; pre-existing Docker resources preserved",
].join("\n");
function data() {
  return {
    schemaVersion: 1, baseCommit: expected[0].sha,
    environment: { syntheticOnly: true, browserSamplesExpected: 100 },
    browser: { samples: Array.from({ length: 100 }, () => ({})),
      interactions: { scanner: { prohibitedAttendanceOrPinRequests: 0 } } },
    postgres: { scenarios: [{}, {}, {}] },
  };
}
test("acepta 100 muestras sintéticas y evidencia de aislamiento/limpieza", () =>
  assert.doesNotThrow(() => verifyBenchmarkResult(data(), expected[0].sha, proof)));
test("rechaza un SHA diferente", () =>
  assert.throws(() => verifyBenchmarkResult({ ...data(), baseCommit: expected[1].sha }, expected[0].sha, proof), /commit/));
test("rechaza PIN o scan, incluso si las muestras son completas", () => {
  const d = data();
  d.browser.interactions.scanner.prohibitedAttendanceOrPinRequests = 1;
  assert.throws(() => verifyBenchmarkResult(d, expected[0].sha, proof), /PIN\/scan/);
});
test("rechaza ausencia de snapshot o teardown", () =>
  assert.throws(() => verifyBenchmarkResult(data(), expected[0].sha, proof.split("\n")[0]), /Falta prueba/));
test("rechaza series incompletas", () => {
  const d = data(); d.browser.samples.pop();
  assert.throws(() => verifyBenchmarkResult(d, expected[0].sha, proof), /100 muestras/);
});
