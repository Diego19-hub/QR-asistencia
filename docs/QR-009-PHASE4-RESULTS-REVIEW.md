# QR-009 — Fase 4: evaluación de resultados recibidos

**Fecha de evaluación:** 2026-10-31. **Decisión:** dos candidatos con ahorro de JS inicial reproducido en una corrida sintética por variante; **NO-GO para merge/despliegue** hasta cerrar las validaciones de interacción y CI. QR-003 continúa P0/NO-GO.

## Procedencia, integridad y alcance

Fuente: los cinco archivos proporcionados por el desarrollador (`baseline.json`, `recharts.json`, `zxing.json`, `manifest.json`, `comparison.md`). Los números de este documento se recalcularon desde las muestras JSON; **no** son mediciones nuevas ejecutadas por el revisor. No publicar aquí los JSON locales.

| Versión | Commit fijado | Muestras | Estado |
|---|---|---:|---|
| Baseline PR #25 | `5f41479c399f94be38a981e3443c68581fb08829` | 100 | JSON completo |
| Recharts diferido | `0889ab9ba1a79c9854d062800f173b746dd5b716` | 100 | JSON completo |
| ZXing diferido | `92ef1507a6c9d798a7613e7d09c85f3c72aba5d8` | 100 | JSON completo |

Cada JSON tiene los 20 grupos esperados (5 rutas × 2 perfiles × 2 condiciones), 5 muestras por grupo y ninguna muestra omisa. Los tres reportan entorno sintético y 0 solicitudes PIN/scan en el campo instrumentado; `manifest.json` afirma snapshots vacíos y eliminación del stack en las tres corridas. **Los logs crudos de teardown y las pruebas funcionales no fueron adjuntados; estas afirmaciones se conocen por el manifiesto/instrumentación, no por verificación independiente de su ejecución.**

Entorno declarado: macOS arm64, Node 24.18.0, npm 11.16.0, Chrome 156.0.8078.79, Docker Desktop (`desktop-linux`). Solo Chrome/Playwright y stack Supabase local desechable. El guard de origen devolvió **403** en `/api/supervisor/scanner/context` para las tres variantes, por lo que no se demostró acceso autorizado a cámara. La caché HTTP se deshabilita al aplicar `browserContext.route()`; `repeated-no-cache` no es un cache hit. Ninguna cifra representa RUM ni dispositivo móvil físico.

## Resultados de transferencia y render inicial

Valores de JS corresponden a p50 de `jsTransferBytes` por ruta; reducción idéntica en ambos perfiles y condiciones de caché:

| Ruta | Base (B) | Candidato (B) | Delta (B) | Reducción |
|---|---:|---:|---:|---:|
| `/admin/reportes` — Recharts diferido | 256,671 | 155,843 | -100,828 | **-39.3%** |
| `/scanner` — ZXing diferido | 271,905 | 146,845 | -125,060 | **-46.0%** |

Medianas p50 con perfil móvil emulado y condición `cold`:

| Ruta | Navegación base → candidato (ms) | FCP base → candidato (ms) | LCP base → candidato (ms) |
|---|---:|---:|---:|
| `/admin/reportes` | 1,514.2 → 1,053.7 (-30.4%) | 380 → 356 (-6.3%) | 380 → 356 (-6.3%) |
| `/scanner` | 1,633.4 → 974.1 (-40.4%) | 296 → 296 (sin diferencia) | 296 → 296 (sin diferencia) |

La reducción de la duración de navegación **no equivale** a una mejora de la misma magnitud en percepción visual. En ZXing, FCP/LCP móvil no cambió, y FCP/LCP desktop bajo `repeated-no-cache` pasó de 48 a 64 ms: **+16 ms**, fluctuación o potencial regresión que debe observarse en una prueba mayor (n=5 por grupo).

## Coste diferido de Recharts

- Base: 256,671 B transferidos al cargar reportes, 0 B adicionales al expandir gráficos.
- Candidato: 155,843 B iniciales **+103,529 B** al abrir gráficos = **259,372 B** si se usan.
- Diferencia para un usuario que termina abriendo gráficos: **+2,701 B (+1.05%) de transferencia JS** respecto a la base. Esto no invalida el ahorro inicial; representa el intercambio entre descarga temprana y descarga por demanda.
- El SVG de Recharts se renderizó, pero **no se midió tiempo entre clic y gráfica visible**. Falta comprobar percepción, carga del chunk, reabrir/cerrar, cambios de filtros y errores de descarga.

**Decisión Recharts:** **candidato favorable para un flujo sin apertura de gráficos**; no integrar antes de medir primera apertura y regresión de funcionalidad en datos sintéticos.

## Coste diferido de ZXing

- Ahorro inicial confirmado: 125,060 B (46.0%) en `/scanner`.
- Los JSON no contienen `cameraReadyMs`, `jsTransferAfterCamera` ni un flujo autorizado: todos son `null` y la API de contexto devuelve 403 por el guard HTTPS local.
- **No** se puede afirmar mejora del tiempo hasta cámara lista, estabilidad de descarga en red móvil, ni seguridad del cambio de autorización tras la carga asíncrona.

**Decisión ZXing:** **candidato favorable para acceso sin abrir cámara**, pero **en espera obligatoria** de validación segura de apertura y cancelación con cámara falsa, sin QR/PIN/scan ni escrituras de asistencia. No debilitar el guard HTTPS para forzar resultados.

## Recomendación y condiciones de cierre

1. Preservar las dos ramas experimentales separadas y la base del PR #25 intacta. **No fusionar ninguna** por el momento.
2. Instrumentar de manera aislada, con datos y contextos sintéticos, el **tiempo de clic a gráfica visible** y el **tiempo hasta cámara lista**, únicamente si se puede hacerlo respetando las políticas de origen/autorización. Si el entorno no lo permite, registrar NOT MEASURED, nunca saltar los controles.
3. Mantener las suites funcionales E2E permitidas y verificar logs completos de snapshots vacíos/teardown. Aumentar repeticiones independientes antes de decidir por diferencias de milisegundos.
4. No ejecutar workflows bloqueados ni tests de PIN o scan. El CI integral obligatorio sigue sin aprobarse; QR-003 P0/NO-GO impide merge y despliegue.
5. Una revisión de seguridad/QA independiente y una decisión expresa del responsable serán necesarias antes de integrar cualquier candidato.

**Veredicto de la Fase 4:** éxito en el objetivo limitado de reducir **JS inicial** en ambas rutas; **no** evidencia suficiente de una mejora integral en la experiencia de uso. Mantener `NO-GO` para integración.
