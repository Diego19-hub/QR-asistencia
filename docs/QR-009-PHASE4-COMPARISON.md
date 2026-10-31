# QR-009 — Fase 4: comparación local de experimentos

**Estado:** protocolo preparado; faltan los JSON reales. No se ha demostrado ninguna mejora. No fusionar ni desplegar: QR-003 P0/NO-GO y CI integral pendiente.

## Commits fijados

- Baseline (PR #25): 5f41479c399f94be38a981e3443c68581fb08829
- Recharts: 0889ab9ba1a79c9854d062800f173b746dd5b716
- ZXing: 92ef1507a6c9d798a7613e7d09c85f3c72aba5d8

El desarrollador reporta aprobadas las validaciones de ambos prototipos, pero las salidas no fueron suministradas. Se requieren tres corridas locales comparables, preferentemente en la misma máquina, versión de Chrome y configuración.

## Protocolo seguro

1. Aplicar docs/QR-009-VALIDACION-SEGURA.md. Usar únicamente Supabase y Auth sintéticos, en stack local desechable. No tocar Testing/Producción ni .env.local.
2. No ejecutar npm test, test:pin-lockout, test:security:matrix:local ni PIN, QR, endpoints de scan, escrituras de asistencia o el CI integral. No relajar RLS, guard de origen o protección de ramas.
3. Mantener el árbol limpio; fijar el commit exacto antes de cada corrida. El runner requiere Chrome y Docker locales.
4. En el Mac, configurar una sola vez: export QR009_PHASE4_DIR="$(mktemp -d "${TMPDIR:-/tmp}/qr009-phase4.XXXXXX")"
5. Para cada commit, git switch --detach <SHA>; verificar git rev-parse HEAD; ejecutar el benchmark con QR009_RESULTS_FILE="$QR009_PHASE4_DIR/<nombre>.json" QR004_CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run benchmark:qr009:local
6. Los nombres, en orden, son baseline.json, recharts.json y zxing.json. Crear un directorio nuevo para no sobrescribir archivos. Detener ante fallos o solicitudes sensibles.
7. Ejecutar desde esta rama analysis/qr-009-phase4-comparison: node scripts/qr009-compare-results.mjs "$QR009_PHASE4_DIR/baseline.json" "$QR009_PHASE4_DIR/recharts.json" "$QR009_PHASE4_DIR/zxing.json"

## Lectura de resultados

- El comparador exige 100 muestras y 20 grupos completos, commit SHA exacto, entorno marcado sintético y cero solicitudes PIN/scan declaradas. Recalcula los p50 desde muestras brutas.
- Compara JS inicial y diferencias de navegación/FCP/LCP en desktop y móvil emulado, con condiciones cold y repeated-no-cache. La segunda condición **no** implica caché caliente (Playwright routing la deshabilita).
- Recharts: verificar que los cinco SVG se vean al abrir el panel; el benchmark informa bytes añadidos al abrir, **no** tiempo de clic hasta gráfica visible.
- ZXing: la latencia de cámara lista **no** está medida en loopback HTTP, pues el contexto responde 403 bajo el guard HTTPS; no desactivar el guard para obtener una cifra.
- El JSON no demuestra por sí solo snapshots locales vacíos ni teardown correcto. Examinar también los logs reales. No extrapolar resultados sintéticos ni concluir significancia con cinco muestras.
- Un PASS funcional no constituye beneficio medido ni una aprobación del CI. Si las diferencias son inciertas, dejar el código original y mantener todas las ramas sin merge.

Este cambio agrega únicamente el comparador y este protocolo; no modifica el código funcional ni el workflow CI.
