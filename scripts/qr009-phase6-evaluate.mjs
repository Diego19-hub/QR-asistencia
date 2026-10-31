#!/usr/bin/env node
// Offline QR-009 phase-6 evidence parser. No network, Docker, or DB operations.
import { readFileSync } from "node:fs";
const prefix = "QR009_PHASE6_RECHARTS_INTENT ";
export function median(xs) {
  if (!xs.length || xs.some((x) => !Number.isFinite(x))) throw Error("invalid finite samples");
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}
export function parse(text) {
  if (typeof text !== "string" || text.length > 2_000_000) throw Error("invalid log (max 2 MB)");
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith(prefix));
  if (lines.length !== 1) throw Error("expected exactly one QR009_PHASE6_RECHARTS_INTENT line");
  let value;
  try { value = JSON.parse(lines[0].slice(prefix.length)); }
  catch { throw Error("invalid phase-6 JSON"); }
  if (value?.prohibitedRequests !== 0 || value.hoverRequired !== true ||
      !Array.isArray(value.samples) || value.samples.length !== 5) {
    throw Error("requires 5 samples, zero prohibited requests, hoverRequired=true");
  }
  const ids = new Set();
  for (const s of value.samples) {
    if (!Number.isInteger(s?.sample) || s.sample < 1 || s.sample > 5 || ids.has(s.sample)) throw Error("bad sample IDs");
    ids.add(s.sample);
    if (!Number.isFinite(s.clickToVisibleMs) || s.clickToVisibleMs < 0) throw Error("bad timing");
    const { beforeHoverJsBytes: b, afterHoverJsBytes: h, afterClickJsBytes: c } = s;
    if (![b, h, c].every((n) => Number.isSafeInteger(n) && n >= 0)) throw Error("bad transferred bytes");
    if (h <= b || c < h) throw Error("preloading not proved or non-monotonic bytes");
  }
  return value.samples;
}
export function evaluate(samples) {
  const p50 = median(samples.map((s) => s.clickToVisibleMs));
  return { count: samples.length, clickToVisibleP50Ms: p50,
    clickToVisibleMinMs: Math.min(...samples.map((s) => s.clickToVisibleMs)),
    clickToVisibleMaxMs: Math.max(...samples.map((s) => s.clickToVisibleMs)),
    speculativeJsP50Bytes: median(samples.map((s) => s.afterHoverJsBytes - s.beforeHoverJsBytes)),
    postClickJsP50Bytes: median(samples.map((s) => s.afterClickJsBytes - s.afterHoverJsBytes)),
    baselinePhase5P50Ms: 13.5, lazyPhase5P50Ms: 388.3,
    status: p50 >= 388.3 ? "NO_MEJORA_EXPLORATORIA" : p50 > 150 ?
      "MEJORA_PARCIAL_EXPLORATORIA" : "CANDIDATO_PENDIENTE_VALIDACION",
  };
}
export function report(r) {
  const f = (x) => x.toFixed(1);
  return [
    "# QR-009 Fase 6 — evaluación local de precarga por intención",
    "",
    "Muestras E2E sintéticas válidas: " + r.count + "; solicitudes PIN/scan: 0.",
    "",
    "| Métrica | Valor |", "|---|---:|",
    "| Clic → SVG p50 (Fase 6, hover) | " + f(r.clickToVisibleP50Ms) + " ms |",
    "| Rango clic → SVG | " + f(r.clickToVisibleMinMs) + "–" + f(r.clickToVisibleMaxMs) + " ms |",
    "| JS por precarga especulativa p50 | " + r.speculativeJsP50Bytes + " B |",
    "| JS adicional tras clic p50 | " + r.postClickJsP50Bytes + " B |",
    "| Referencia Fase 5 lazy sin intención | 388.3 ms |",
    "| Referencia Fase 5 baseline original | 13.5 ms |", "",
    "**Evaluación:** " + r.status + ". **NO autoriza merge ni despliegue.**", "",
    "Advertencia: el test espera transferencia JS tras hover ANTES de hacer clic; NO mide primer toque inmediato en móvil ni usuarios que solo pasan el cursor. Las referencias Fase 5 vienen de otra ejecución y los bytes E2E no son equivalentes a JS inicial Fase 4.",
    "",
    "Pendientes: primer toque y teclado, móvil real, costo de hover sin clic, CI integral, QR-003 P0/NO-GO, revisión de seguridad y autorización separada.",
    "",
  ].join("\n");
}
if (process.argv[1]?.endsWith("/qr009-phase6-evaluate.mjs")) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--log")) throw Error("usage: --log path (or pipe stdin)");
    const input = args.length ? readFileSync(args[1], "utf8") : readFileSync(0, "utf8");
    process.stdout.write(report(evaluate(parse(input))));
  } catch (error) {
    process.stderr.write("QR009 EVIDENCE FAIL: " + (error instanceof Error ? error.message : "unknown") + "\n");
    process.exitCode = 1;
  }
}
