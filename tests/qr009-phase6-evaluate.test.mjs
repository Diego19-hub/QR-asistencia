import test from "node:test";
import assert from "node:assert/strict";
import { parse, evaluate, report, median } from "../scripts/qr009-phase6-evaluate.mjs";
const samples = Array.from({ length: 5 }, (_, i) => ({ sample: i + 1,
  clickToVisibleMs: [12, 15, 14, 16, 13][i],
  beforeHoverJsBytes: 1000, afterHoverJsBytes: 1300, afterClickJsBytes: 1300 }));
const line = (items = samples, prohibitedRequests = 0) =>
  "QR009_PHASE6_RECHARTS_INTENT " + JSON.stringify({ samples: items, prohibitedRequests, hoverRequired: true });
test("computes exploratory p50 and speculative JS from one line", () => {
  assert.equal(median([8, 3, 7, 2]), 5);
  const result = evaluate(parse("23 tests\n" + line() + "\n23 passed"));
  assert.equal(result.clickToVisibleP50Ms, 14);
  assert.equal(result.speculativeJsP50Bytes, 300);
  assert.equal(result.postClickJsP50Bytes, 0);
  assert.match(report(result), /NO autoriza merge ni despliegue/);
});
test("rejects missing, duplicate, prohibited or malformed samples", () => {
  assert.throws(() => parse("23 passed"), /exactly one/);
  assert.throws(() => parse(line() + "\n" + line()), /exactly one/);
  assert.throws(() => parse(line(samples, 1)), /zero prohibited/);
  assert.throws(() => parse(line([...samples.slice(0, 4), { ...samples[4], sample: 4 }])), /bad sample IDs/);
  assert.throws(() => parse(line(samples.map((s) => ({ ...s, afterHoverJsBytes: 1000 })))), /preloading/);
  assert.throws(() => parse(line(samples.map((s) => ({ ...s, clickToVisibleMs: -1 })))), /bad timing/);
});
test("large p50 is never labeled as an approved optimization", () => {
  const result = evaluate(parse(line(samples.map((s) => ({ ...s, clickToVisibleMs: 501 })))));
  assert.equal(result.status, "NO_MEJORA_EXPLORATORIA");
  assert.match(report(result), /NO autoriza/);
});
