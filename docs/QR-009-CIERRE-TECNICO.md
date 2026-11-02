# QR-009 — Cierre técnico de investigación de rendimiento

**Fecha de decisión:** 31 de octubre de 2026  
**Alcance:** rendimiento web, bundle y consultas PostgreSQL/RLS medidos en un entorno sintético **local**.  
**Estado de tarea:** **EVALUACIÓN TÉCNICA TERMINADA**. **NO** implica optimización desplegada, CI aprobado ni autorización de lanzamiento.  
**PR del benchmark:** [#25 — perf: QR-009 runtime and database benchmark](https://github.com/Diego19-hub/QR-asistencia/pull/25) (abierto, sin fusionar al cerrar este informe).

## 1. Decisión ejecutiva y definición de «terminado»

**Cerramos QR-009 como investigación de rendimiento, no como despliegue de una optimización.** La decisión respaldada por las mediciones es **conservar las implementaciones originales** de Recharts y ZXing en el flujo que se integre finalmente. No se recomienda fusionar los prototipos de carga diferida ni de precarga por intención. No se ha demostrado un beneficio global de experiencia que compense las penalizaciones de primera apertura.

Esto satisface el objetivo acotado de **medir, comparar, investigar y tomar una decisión fundamentada** con evidencia revisable. No certifica Core Web Vitals de usuarios reales, escala operativa ni lector QR físico; esos objetivos pertenecen a validación de lanzamiento y siguen pendientes de autorización.

## 2. Línea base de navegador y base de datos

Fuente: `docs/QR-009-RUNTIME-BENCHMARK.md` del PR #25.

- **100 muestras** Chrome/Playwright: 5 rutas (`/login`, `/admin`, `/admin/reportes`, `/scanner`, `/mi-qr`) × escritorio/móvil emulado × dos condiciones solicitadas de caché × 5 muestras. Auth y Next.js (build/start de producción) usan Supabase **local desechable**, sin conexión a proyectos alojados. Se reportaron valores válidos por grupo y conteos para métricas faltantes.
- **Chrome 156** y stack temporal local, con throttling móvil emulado. Las cargas repetidas están etiquetadas `repeated-no-cache` porque `browserContext.route()` desactiva la caché HTTP; **no** son cache hits.
- **PostgreSQL bajo RLS y rol `authenticated`**, 500 empleados sintéticos y `EXPLAIN (ANALYZE, BUFFERS)` de lectura, cinco iteraciones por cardinalidad:

| Empleados visibles | SQL p50 | SQL p95 |
|---:|---:|---:|
| 10 | 0.913 ms | 1.040 ms |
| 100 | 7.812 ms | 8.509 ms |
| 500 | 34.144 ms | 35.631 ms |

No extrapolar este patrón a producción ni a operaciones de asistencia; son consultas sintéticas de lectura, no carga real.

## 3. Comparación de cambios: Fases 4 y 5

Fuentes de evidencia: archivos locales `baseline.json`, `recharts.json`, `zxing.json`, `manifest.json`, `comparison.md` recibidos del desarrollador; resultados E2E de Fase 5 entregados en salida de terminal. Análisis archivados en [Fase 4](https://github.com/Diego19-hub/QR-asistencia/blob/83c947f3526a66901dcf8e2a0a5dae8bd2de1dd7/docs/QR-009-PHASE4-RESULTS-REVIEW.md) y [Fase 5](https://github.com/Diego19-hub/QR-asistencia/blob/83c947f3526a66901dcf8e2a0a5dae8bd2de1dd7/docs/QR-009-PHASE5-RESULTS-REVIEW.md).

| Indicador | Baseline | Optimización lazy | Consecuencia |
|---|---:|---:|---|
| Recharts JS inicial en `/admin/reportes` | 256,671 B | 155,843 B | −100,828 B (−39.3%) |
| Recharts clic→primer SVG (p50; 5+5) | **13.5 ms** | **388.3 ms** | **+374.8 ms**: rechazo de esta variante |
| ZXing JS inicial en `/scanner` | 271,905 B | 146,845 B | −125,060 B (−46.0%) |
| ZXing clic→cámara falsa lista (p50; 3+3) | **81.1 ms** | **147.8 ms** | **+66.7 ms**: candidato condicional, no integrar |

**Recharts:** abrir las gráficas en la variante lazy descargó 103,529 B adicionales en el instrumento Fase 4, llevando el total a 259,372 B frente a 256,671 B de la baseline (**+2,701 B**, aunque difiere el momento de transferencia). El cierre no recomienda esa compensación.

**ZXing:** la prueba de revocación durante la descarga de JS pasó en Supabase local con cámara falsa. En los tres escenarios de la Fase 5 se registraron **24 + 23 + 23 = 70 ejecuciones de pruebas E2E** con `lint`/`typecheck` reportados satisfactorios, `prohibitedRequests=0` y limpieza del entorno satisfactoria. **No son 70 pruebas únicas** y no sustituyen pruebas de cámara física.

**Precarga por intención (Fase 6):** se creó un experimento separado de Recharts para descargar JS al hacer hover/enfocar/tocar. El desarrollador comunicó que el E2E terminó correctamente, **pero no aportó valores `QR009_PHASE6_RECHARTS_INTENT`**. Por tanto, no podemos afirmar que reduzca la latencia ni el tráfico; no se incluye en la integración. Se conserva como referencia experimental optativa, sin bloquear el cierre de la decisión actual.

Las mediciones Fase 4 (bytes de navegación) y Fase 5 (interacción y Resource Timing del E2E) usan protocolos distintos; **no sumar directamente valores absolutos entre fases**. Las muestras son pequeñas y exploratorias.

## 4. Decisión técnica por componente

| Elemento | Decisión | Motivo |
|---|---|---|
| Dashboard, portal, filtros, exportaciones y paginación | **Mantener** | Sin cuellos de botella suficientemente demostrados que justifiquen alterar código o caché compartida |
| Gráficas / Recharts estático | **Mantener** | Primera apertura prácticamente inmediata en las pruebas locales; lazy actual tiene regresión clara |
| Escáner / ZXing estático | **Mantener** | Lazy reduce JS al entrar, pero añade latencia de apertura y aún no tiene evidencia de hardware móvil real |
| Recharts precarga por intención | **No integrar** | E2E reportado PASS sin medición numérica; puede generar descarga innecesaria por hover sin clic |
| Consultas / RLS / índices | **No tocar** | Datos sintéticos insuficientes para justificar migraciones o cambios de permisos |
| Caché privada | **No cambiar** | Sin validación con usuarios/tenants y estados de autorización distintos |
| PIN, QR, endpoints de asistencia | **Excluidos del cambio** | QR-003 permanece P0 / NO-GO |

**Resultado funcional del PR #25:** introduce benchmark y documentación, no los prototipos de optimización. No hay que trasladar ramas experimentales a `main` para dar por cerrada la investigación.

## 5. Evidencia, faltantes y condiciones de integración

| Control | Evidencia / estado |
|---|---|
| Benchmark browser local y SQL/RLS sintético | **PASS histórico**, con logs y reproducción en docs del PR #25 |
| Antes/después de JS | **300 muestras Fase 4** en tres variantes (100 cada una); revisión independiente documentada |
| Antes/después de interacción | **Fase 5 documentada**, 5 muestras de gráficas y 3 de cámara por variante |
| Revocación asíncrona del dispositivo | **PASS de prueba sintética Fase 5**, sin scan/PIN |
| Tests Fase 6 | **PASS reportado**, sin tiempos adjuntos; sin adopción |
| Lighthouse / RUM / INP real | **No medidos**; no atribuir mejoras de Web Vitals a este trabajo |
| Caché caliente | **No medida** por limitación del guard de orígenes |
| Hardware físico y HTTPS autorizado | **No probados**; pasar a QA de lanzamiento |
| CI GitHub requerido del PR #25 | **NO-GO**: CI #128 cancelado durante `npm ci` en un SHA anterior; no existe aprobación integral para el head |
| QR-003 Testing / respaldo restaurable / migración | **P0 / NO-GO**; autorización independiente obligatoria |
| QR-004 / revisión de seguridad y branch protection | **Pendiente**; no presuponer aprobación |
| Merge o despliegue | **NO AUTORIZADO** |

### Cierre y seguimiento operativo

1. **No abrir más fases de QR-009** para perseguir una mejora marginal sin caso de uso y presupuesto aprobados: la investigación ha dado una decisión clara.
2. El propietario del PR #25 puede solicitar revisión de código y del benchmark; su **integración requiere CI obligatorio aprobado** y cumplir los controles del repositorio. No suprimir las suites para forzar verde; no ejecutar pruebas bloqueadas sin autorización.
3. Tras integración autorizada, validar desde una fase separada de **preparación de lanzamiento** con Chrome/móvil real, HTTPS, RUM y seguridad/recuperación. Si el benchmark identifica futuras regresiones, abrir una tarea nueva con límites cuantitativos explícitos.
4. **La marca `Hecha` de QR-009 se refiere exclusivamente a la investigación en la rama del PR.** Hasta fusionarla, `main` mantiene su estado anterior; el estado de lanzamiento sigue **NO-GO**.

**No se realizan cambios remotos en Supabase, migraciones, RLS, cache compartida, PIN, escaneo, CI ni despliegues como parte de este cierre.**
