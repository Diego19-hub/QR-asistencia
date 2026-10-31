# QR-009 — Fase 6: precarga por intención y preparación de lanzamiento

**Estado: EXPERIMENTO; no aprobado para integración ni producción.**
**Fecha:** 2026-10-31. **Rama:** `experiment/qr-009-phase6-recharts-intent`, derivada de `experiment/qr-009-phase5-recharts` (`b66a7c1`).

## Por qué se experimenta

La fase 4 evidenció JS inicial **256,671 → 155,843 B (−39.3%)** con Recharts diferido, pero la fase 5 encontró **13.5 → 388.3 ms p50** desde clic al primer SVG visible, `+374.8 ms`: **no integrar** esa variante tal cual.

En ZXing se midió **271,905 → 146,845 B (−46.0%)** al cargar `/scanner`, pero la apertura de cámara falsa aumentó **81.1 → 147.8 ms p50**. Su prueba de revocación durante la descarga pasó, pero ZXing sigue en **candidato condicional**, sin pruebas en cámara física autorizada. Se conserva sin cambiar.

## Hipótesis de Recharts

Mientras el panel `<details>` está cerrado, el JS de las gráficas permanece diferido. Si el usuario muestra intención de abrirlo (puntero encima, enfoque de teclado o `touchstart`), el navegador inicia el `import()` del mismo módulo que usa `next/dynamic`. El panel no se abre ni el contenido se renderiza por la precarga: solo al expandirlo con datos ya autorizados.

**Intercambio importante:** pasar el cursor sin hacer clic **también descarga el chunk** y puede perderse el ahorro para ese usuario. En touch, `touchstart` y clic pueden estar demasiado cerca para ganar tiempo. No asumir mejora hasta medir y revisar el tráfico.

## Cambios técnicos exactos

- `src/components/reports/reports-dashboard.tsx`: centraliza `loadReportsCharts`; `next/dynamic` y handlers `onPointerEnter`, `onFocus` y `onTouchStart` comparten import. No altera la consulta de reportes, permisos ni funciones de negocio.
- `tests/e2e/qr009-phase6-recharts-intent.spec.ts`: cinco rondas con admin/Auth sintéticos y Supabase local desechable. Antes de abrir panel, activa hover y exige transferencia JS adicional; después mide `clickToVisibleMs` hasta SVG y los bytes antes de hover, antes de clic y después de clic; bloquea cualquier request a PIN/scan/asistencia.
- Se mantienen las pruebas de Fase 5, que pueden cambiar su comportamiento por la precarga introducida. La nueva prueba mide explícitamente el escenario **con intención anticipada**, no la primera pulsación táctil inmediata.

## Validación local permitida en Mac

Los cambios de esta rama son experimento; **no se ha ejecutado `lint`, `typecheck` ni E2E en este entorno de autoría**. En tu Mac, con árbol Git limpio, Chrome y Docker local desechable:

```bash
git status --short
git fetch origin
git switch --track origin/experiment/qr-009-phase6-recharts-intent
# Si la rama ya existe: git switch experiment/qr-009-phase6-recharts-intent
npm run lint
npm run typecheck
QR004_CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:e2e
```

Conservar las líneas `QR009_PHASE5_RECHARTS` y `QR009_PHASE6_RECHARTS_INTENT`, además del conteo PASS y prueba de cleanup. No compartir cookies, logs secretos, credenciales ni datos reales. No ejecutar `npm test`, `test:pin-lockout:db` ni `test:security:matrix:local`.

### Criterio de evaluación, aún no demostrado

- La prueba de intención descarga JS **antes** del clic sin abrir el panel; la primera gráfica aparece efectivamente.
- `clickToVisibleMs` con hover es **materialmente inferior a 388.3 ms p50** y preferiblemente ≤150 ms sin fallas funcionales ni extra requests prohibidos.
- Comparar también contra la baseline original p50=13.5 ms, no solo contra lazy antiguo.
- Comprobar cuánto JS se gasta por hover no convertido en clic; el ahorro inicial de fase 4 se puede perder para usuarios que solo navegan el encabezado.
- Resultados con n=5 son exploratorios; repetir bajo móvil real/teclado y condiciones de red adversas antes de proponer integración.

## Preparación de lanzamiento — matriz de puertas

| Puerta | Evidencia necesaria | Estado al crear esta rama |
|---|---|---|
| QR-009 — funcional | Ejecutar lint, typecheck, E2E permitido + review de los cambios de ambos candidatos | **PENDIENTE** |
| QR-009 — rendimiento | JS inicial, clic→gráfica, clic→cámara, transferencia diferida, móvil físico y seguridad de revocación | **PENDIENTE** |
| Recharts | Demostrar que el nuevo enfoque corrige penalización de primera apertura sin deterioro indebido del tráfico | **NO-GO** actual |
| ZXing | Aprobación específica después de probar cámara real y autorizaciones sin QR/PIN/scan | **CONDICIONAL** |
| QR-003 Testing | Historial reconciliado, recuperación alojada demostrada o descarte aprobado, autorización remota expresa | **P0 / NO-GO** |
| QR-004 | Auditoría y pendientes de permisos/Server Actions revisados y aprobados | **EN CURSO** |
| CI | Workflow obligatorio `verify` aprobado para el SHA final, sin saltar suites requeridas | **NO-GO** |
| Branch protection | Verificación del administrador; el conector no pudo consultar la protección de `main` | **NO VERIFICADO** |
| Despliegue | Plan de rollback/forward-fix, monitoreo, copia recuperable, cambio autorizado, responsables | **NO-GO** |

### Condiciones de puesta en marcha

1. No fusionar automáticamente experimentos ni el PR #25. Revisar resultado cuantitativo y código; preferir la versión baseline cuando la experiencia empeore.
2. Si una optimización supera todas las puertas, preparar **PR independiente** contra `main` (rebasado y revisado, sin arrastrar artefactos de benchmark), solicitar code review y obtener CI obligatorio real. No usar `[skip ci]` para un PR de integración.
3. Testing requiere autorización separada y plan de recuperación; no ejecutar `db push`, `migration repair`, export/backup remoto ni SQL de Testing por una instrucción genérica de avanzar.
4. Configurar un plan operativo de lanzamiento por fases: revisión de secretos/configuración, consentimiento/capacidad, canary autorizado, monitoreo de errores de scanner/cámara y tiempos de carga (sin registrar PIN/QR/datos sensibles), detenerse ante fallas y reparar hacia delante.
5. Un build o imagen GHCR no es un despliegue; `publish-ghcr-testing.yml` puede publicar imagen tras CI exitoso en push a `main`, pero no sustituye QA/GO.
6. No emitir fecha de lanzamiento ni declarar listo mientras subsista cualquier puerta roja.

**Decisión al preparar el experimento:** trabajo de optimización en rama aislada, sin merge, sin CI integral, sin acceso a Supabase alojado y sin despliegue.
