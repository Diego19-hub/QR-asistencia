# QR-009 — Fase 6: evaluación offline y trazabilidad del lanzamiento

**Estado:** mecanismo de revisión, no integración. El desarrollador reportó PASS de `lint`, `typecheck` y E2E para `experiment/qr-009-phase6-recharts-intent` (`1350da6`), **sin adjuntar todavía las líneas numéricas** de `QR009_PHASE6_RECHARTS_INTENT`. La palabra «PASS» no prueba una mejora de latencia.

Este branch documental, `analysis/qr-009-phase6-evidence`, se deriva de la versión Fase 6 y añade **solo un comparador offline y pruebas sintéticas del comparador**. El código de la aplicación y las pruebas E2E de Fase 6 no cambian.

## Inspección y cálculo con resultados existentes

La prueba Fase 6 imprime una línea `QR009_PHASE6_RECHARTS_INTENT { ... }` con **cinco muestras**, campos `clickToVisibleMs`, `beforeHoverJsBytes`, `afterHoverJsBytes`, `afterClickJsBytes`, y `prohibitedRequests=0`.

El evaluador `scripts/qr009-phase6-evaluate.mjs` valida que esa línea sea única, que no haya requests PIN/scan, que los cinco IDs estén presentes y que las transferencias crezcan de manera coherente. Produce resumen **sin copiar el log bruto** a la salida.

Si guardaste el log de la ejecución anterior en un archivo local `/ruta/al/log.txt`:

```bash
node scripts/qr009-phase6-evaluate.mjs --log /ruta/al/log.txt
```

También acepta solo la línea mediante stdin. No publicar salidas completas con credenciales ni rutas de bases.

## Si no conservaste la salida anterior

En macOS, comprobar primero que el árbol de trabajo esté limpio y el repositorio siga siendo el esperado:

```bash
git status --short
git fetch origin
git switch --track origin/analysis/qr-009-phase6-evidence
# Si la rama ya existe localmente: git switch analysis/qr-009-phase6-evidence
node --test tests/qr009-phase6-evaluate.test.mjs
```

En el **stack Supabase local desechable que ya fue usado en Fase 6**, y sin permisos remotos, ejecutar exclusivamente `npm run test:e2e` si la autorización previa sigue vigente. Capturar en directorio temporal privado, validar la ejecución y **no almacenar** logs de pruebas en el repositorio:

```bash
(
  set -o pipefail
  umask 077
  EVIDENCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/qr009-phase6.XXXXXX")"
  trap 'rm -rf "$EVIDENCE_DIR"' EXIT
  QR004_CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    npm run test:e2e 2>&1 | tee "$EVIDENCE_DIR/local-e2e.log"
  node scripts/qr009-phase6-evaluate.mjs --log "$EVIDENCE_DIR/local-e2e.log"
)
```

**Este bloque vuelve a ejecutar E2E.** No es necesario si la línea original se conserva. No ejecutar `npm test`, `test:pin-lockout:db`, `test:security:matrix:local`, SQL, migraciones, backup/export remoto, Testing/Producción o despliegues.

## Cómo interpretar el informe

Referencias históricas de Fase 5 proporcionadas por el desarrollador: baseline `13.5 ms p50`; lazy sin precarga `388.3 ms p50`. Son corridas diferentes: los deltas solo orientan una **hipótesis exploratoria** y no un efecto causal estadístico.

La prueba Fase 6 **espera transferencia JS después de hover antes del clic**. Esto mide una apertura condicionada a la precarga: no prueba el primer toque directo de una persona con celular, ni el costo de varios movimientos sobre el control sin abrirlo.

Una latencia mejor que `388.3 ms` no justifica por sí sola activar la variante. Conservar las barreras de fase 4/5: JavaScript inicial, transferencia especulativa, permisos, revocación, UX móvil, CI integral, QR-003 P0/NO-GO y revisión profesional.

## Estado de lanzamiento

| Puerta | Estado |
|---|---|
| Versión de Fase 6 y pruebas E2E | PASS reportado; métricas numéricas sin adjuntar |
| Comparador de evidencia | Implementado; pruebas de unidad pendientes de Node local |
| Experiencia con primer toque/cámara móvil real | No comprobada |
| QR-003 Testing | P0/NO-GO |
| QR-004 cierre de auditoría | Pendiente |
| CI integral del PR #25 | No aprobado |
| PR #25 | Abierto, no fusionado |
| Lanzamiento | **NO-GO** |

**No realizar merge ni despliegue** a partir de este informe; el resultado cuantitativo y una revisión independiente siguen pendientes.
