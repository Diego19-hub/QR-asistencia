# QR-009 — Fase 5: evaluación de apertura de gráficas y cámara

**Fecha:** 2026-10-31. **Fuente primaria:** salida íntegra de terminal compartida por el desarrollador (tres ramas de Fase 5). Esta revisión no ha ejecutado las pruebas; los resultados se recalcularon a partir de los JSON `QR009_PHASE5_*` incluidos en esa salida. **NO-GO para integración/despliegue.** QR-003 continúa P0/NO-GO.

## Verificación de pruebas locales

| Rama | Base de producto | Lint | Typecheck | E2E | Limpieza local |
|---|---|---|---|---:|---|
| `experiment/qr-009-phase5-baseline` (`9f7ea66`) | `5f41479` | PASS | PASS | 24/24 | PASS |
| `experiment/qr-009-phase5-recharts` (`b66a7c1`) | `0889ab9` | PASS | PASS | 23/23 | PASS |
| `experiment/qr-009-phase5-zxing` (`7b03f0f`) | `92ef150` | PASS | PASS | 23/23 | PASS |

Son **70 ejecuciones de casos E2E**, no 70 casos únicos. El runner informó migraciones locales aplicadas, Auth/Next.js en loopback con Supabase desechable, y limpieza de contenedores/datos temporales. Los tres registros instrumentados reportan `prohibitedRequests=0`. En ZXing se obtuvo específicamente `QR009_PHASE5_ZXING_REVOKED_CHUNK PASS`; esto prueba la carrera sintética de revocación **en el alcance de esa prueba**, no todos los posibles casos de producción.

## Recharts: interacción mucho peor pese a ahorrar JS inicial

Tiempos del clic en «Análisis y métricas avanzadas» al primer SVG con dimensiones visibles (`openToVisibleMs`, ms):

| Muestra | Baseline | Lazy Recharts |
|---:|---:|---:|
| 1 | 13.2 | 389.0 |
| 2 | 13.5 | 370.0 |
| 3 | 13.5 | 388.3 |
| 4 | 13.5 | 392.1 |
| 5 | 13.9 | 378.5 |
| **p50** | **13.5** | **388.3** |

**Delta p50: +374.8 ms (28.76× el tiempo original; +2776%).** En estos cinco ensayos el incremento es consistente; prioridad de UX negativa.

La Fase 4 confirmó menor JS en la navegación inicial de `/admin/reportes`: 256,671 → 155,843 bytes (−39.3%). Sin embargo, el módulo lazy se descarga cuando se abre el panel. La fase 5 declaró `additionalJsBytes=0` en baseline y `1,090,624` para lazy (instrumentación distinta de la Fase 4). En la Fase 5, p50 de JS acumulado antes del clic 4,489,501 B → 3,418,650 B y **después** del clic lazy 4,509,274 B (+19,773 B contra baseline), sujeto al alcance del navegador y resource timing de esa ejecución. **No mezclar los valores absolutos de Fase 4 con los de Fase 5**: se midieron durante fases y rutas de instrumento diferentes; investigar la discrepancia del tamaño observado antes de usarlo como presupuesto de producción.

**Decisión Recharts: RECHAZAR la variante actual como candidata inmediata a integración.** Preservar rama para investigación; si se retoma, experimentar con precarga por intención, distintos puntos de inicio, o mejoras del chunk en una rama nueva y comparar **clic→SVG** otra vez. No aceptar ahorro de navegación a costa de casi 0.4 s adicionales para usar una función visible sin evaluación de producto.

## ZXing: intercambio favorable en bytes iniciales, pero apertura más lenta

Tiempo del clic «Abrir cámara» al cambio a estado «Cerrar cámara» con dispositivo autorizado local y Chrome fake camera (`openToReadyMs`, ms):

| Muestra | Baseline | Lazy ZXing |
|---:|---:|---:|
| 1 | 281.0 | 347.8 |
| 2 | 80.9 | 147.8 |
| 3 | 81.1 | 147.0 |
| **p50** | **81.1** | **147.8** |

**Delta p50: +66.7 ms (+82.2%; 1.82× el tiempo de la baseline).** Los tres emparejamientos aumentan ~66 ms, pero sigue siendo n=3 por variante y con cámara falsa, no un móvil físico.

La Fase 4 midió JS de `/scanner` al cargar: 271,905 → 146,845 B (−46.0%). En los tests de Fase 5 los recursos observados antes de clic fueron 4,417,486 B → 3,343,345 B y la variante lazy transfirió 1,075,552 B adicionales al abrir cámara (total 4,418,897 B, +1,411 B respecto a baseline), con la misma salvedad de que las mediciones absolutas de fases distintas **no son comparables directamente**.

En la rama ZXing, la prueba bloqueó un chunk JS al iniciar cámara, revocó realmente un dispositivo sintético con Auth admin local, comprobó que no llamó a `getUserMedia` tras la revocación, liberó el chunk y comprobó que no apareció «Cerrar cámara». `QR009_PHASE5_ZXING_REVOKED_CHUNK PASS` y `prohibitedRequests=0`.

**Decisión ZXing: CANDIDATO CONDICIONAL.** Mantener diferido en rama experimental; realizar más rondas, perfiles móviles reales y probar tiempo hasta cámara lista/flujo de permiso sin QR/PIN/scan, además de los casos de revocación. El delta de 66.7 ms debe evaluarse contra el ahorro inicial en los flujos reales de uso; no fusionar por el momento.

## Decisión y próximos pasos

1. **Recharts actual: NO-GO de optimización** por empeoramiento del tiempo para abrir la primera gráfica; conservar sin merge.
2. **ZXing actual: pendiente de validación de experiencia** (ahorro inicial probado, pero apertura +66.7 ms con cámara falsa).
3. La Fase 4 midió una reducción clara de JS inicial (−39.3% y −46.0%) en Chrome/Playwright sintético. **No** equivalen a una reducción probada de tiempo a primera interacción ni validan móviles reales.
4. Integración **NO-GO** en ambos casos: el PR #25 sigue sin fusionar; el CI integral obligatorio no está aprobado y QR-003 sigue P0/NO-GO.
5. Guardar evidencia cuantitativa separada de la decisión: suites E2E PASS no implican rendimiento UX PASS. No ejecutar suites PIN/scan, no modificar RLS, no quitar HTTPS ni operar sobre Testing/Producción.

**Resultado:** instrumentación de Fase 5 válida para identificar penalización medible. No desarrollar Fase 6 de integración hasta resolver la regresión de Recharts y evaluar ZXing en un dispositivo representativo.
