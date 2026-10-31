# QR-009 — Auditoría de rendimiento web

Fecha: 2026-10-30

Commit base: `1a0b0a5a465fce453dc8a748e326c244da3a675e` (PR #23)

Rama: `perf/qr-009-runtime-benchmark`
Estado: **En curso; baseline local reproducible disponible, sin optimizaciones implementadas.** Resultados de fase 2: [QR-009-RUNTIME-BENCHMARK.md](QR-009-RUNTIME-BENCHMARK.md).

## 1. Resumen ejecutivo

Se revisaron dashboard, reportes, portal del empleado, escáner, consultas y configuración de build. La fase 1 inventarió chunks; fase 2 midió Chrome local y consultas SQL con RLS y datos sintéticos. JavaScript mediano transferido: 256,671 B en `/admin/reportes` y 271,906 B en `/scanner`. Al abrir el panel Recharts no se transfirieron bytes JavaScript adicionales (0 B observados), consistente con el import estático actual. No se atribuye el total de cada ruta exclusivamente a un paquete.

Se midieron localmente LCP, CLS, TTFB, FCP, bytes transferidos, endpoints seleccionados y p50/p95 de una consulta bajo RLS. TBT e INP no se midieron; las tareas largas se informan por separado. Lighthouse no está instalado y no se agregó dependencia. El contexto del escáner devolvió 403 porque el build local en loopback HTTP no satisface el guard HTTPS; no se activó la cámara. Las cifras no son RUM ni Producción. Sin comparación antes/después ni evidencia de usuarios reales, no se modificó código de aplicación ni se afirma una mejora. QR-009 permanece En curso.

## 2. Entorno y metodología

- Base inspeccionada: `1a0b0a5a465fce453dc8a748e326c244da3a675e`.
- Build: `npm run build` (`next build --webpack`), ejecutado desde una copia temporal sin `.env*`, con valores públicos ficticios y dependencias locales existentes. Build satisfactorio; Next informó advertencias de trazado por el symlink de `node_modules` fuera de `outputFileTracingRoot` en esa copia temporal.
- Aplicación: Next.js 16.4.3, React 19.2.8; instalación del repo indica Node v24.18.0 y npm 11.16.0.
- Navegador disponible: Google Chrome 156.0.8078.79.
- Lighthouse: no instalado.
- Rutas: `/login`, `/admin`, `/admin/reportes`, `/scanner`, `/mi-qr`.
- El runner usa un proyecto Supabase local con nombre desechable, endpoints de loopback y cuentas/datos sintéticos; no se contactó Testing ni Producción.
- Intento de probe: viewport 390×844, CPU emulada 4×, RTT 40 ms y red celular 4G emulada a 1.6 Mbps downstream / 750 Kbps upstream; muestras frías y calientes planeadas. El primer intento falló por timeout del runner al establecer sesión bajo el throttling. El segundo se interrumpió después de varios minutos sin completar la serie. Los contenedores desechables no estaban presentes en la comprobación posterior.
- Las medidas de emulación no representan dispositivos físicos. No se midió INP real ni Core Web Vitals de usuarios.

## 3. Línea base por ruta: artefacto estático

Se inspeccionaron los `page_client-reference-manifest.js` del build temporal, recolectando los chunks referenciados por los módulos cliente de cada ruta y deduplicando dentro de esa ruta. Tamaño gzip se calculó localmente con gzip nivel 9 a partir de los archivos emitidos.

| Ruta | Chunks referenciados | Bytes raw | Bytes gzip-9 | Lectura |
|---|---:|---:|---:|---|
| `/login` | 2 | 203 | 172 | Client-module roots mínimos del manifiesto |
| `/admin` | 12 | 45,169 | 16,368 | Dashboard administrativo |
| `/admin/reportes` | 16 | 450,872 | 127,549 | Incluye el conjunto de módulos cliente asociado al dashboard de reportes y gráficas |
| `/scanner` | 8 | 511,274 | 135,273 | Incluye código del escáner/ZXing; no implica que todo se descargue en la carga inicial en cada condición |
| `/mi-qr` | 8 | 31,125 | 11,139 | Portal del empleado |

**Limitaciones de esta tabla:** los manifiestos describen referencias de módulos/chunks para renderizado, no el waterfall que efectivamente descarga un navegador. No son equivalentes a tamaño inicial de transferencia ni sustituyen DevTools/Lighthouse. La relación con Recharts/ZXing identifica candidatos de análisis, no prueba que la carga diferida mejore LCP o la interacción.

## 4. Dashboard y administración

`src/app/(admin)/admin/page.tsx` compone el dashboard existente; no se midieron tiempos de API, renderizado, hidratación ni cantidad de revalidaciones. Las protecciones multiempresa y de permisos quedan fuera de cualquier cambio de caché. No se halló evidencia cuantitativa de solicitudes redundantes que justifique tocar la ruta.

## 5. Reportes y Recharts

`src/components/reports/reports-dashboard.tsx` importa Recharts estáticamente dentro de un componente cliente que también organiza filtros, tabla y exportaciones. El manifiesto identifica `/admin/reportes` como una ruta de cliente sustancialmente mayor que `/admin`, pero no permite asignar cada byte exclusivamente a Recharts ni demostrar que los gráficos se descarguen antes de mostrarse (están dentro de un `<details>` inicialmente cerrado).

**Decisión:** no introducir `dynamic()`/carga diferida en esta fase. Repetir análisis con waterfall y mediciones del navegador; validar SSR, apertura del panel de gráficas, accesibilidad, estados vacíos y exportaciones antes de considerar una modificación.

## 6. Portal del empleado

Se inspeccionó `src/app/api/employee/portal/route.ts`. La secuencia de consultas depende de IDs obtenidos en pasos anteriores; por ello no se paralizaron indiscriminadamente. No hay dataset sintético escalable ni trazas que permitan informar consultas por operación o latencias p50/p95. No se cambió paginación ni se alteró el aislamiento por empleado/empresa.

## 7. Escáner

La revisión estática confirma controles existentes de ciclo de cámara, cancelación/generación de peticiones y descarte de contexto obsoleto en QR-006. La suite E2E de 22 casos pasó con cámara fake; no se procesó QR, no se llamó a `/api/attendance/scan`, no se verificó PIN ni se registró asistencia. El benchmark midió la ruta y bytes iniciales de `/scanner`, pero su API de contexto respondió 403 porque el build local HTTP no satisface el guard HTTPS de producción. No se midió tiempo de cámara lista ni rendimiento de hardware móvil; el guard se conservó.

## 8. PostgreSQL y Supabase

Se ejecutó `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` con 500 empleados sintéticos locales, en tres rangos (10/100/500) y cinco repeticiones. La consulta fue bajo el rol `authenticated`, claims JWT sintéticos, política RLS activa y conteo verificado; no se usó `service_role` para las lecturas. Resultados p50/p95: 0.978/1.490 ms, 8.474/8.976 ms y 34.540/35.209 ms respectivamente. El dataset es pequeño y solo mide `employees`, no representa producción ni reportes de asistencia. No se accedió a Testing/Producción, ni hubo migraciones o cambios RLS.

## 9. Problemas confirmados y optimizaciones

- Problemas de rendimiento funcionales confirmados: **ninguno**. Medidas observadas: `/admin/reportes` transfiere 256,671 B de JS mediano y `/scanner` 271,906 B en esta instancia local; la consulta sintética escala de 0.978 ms p50 a 34.540 ms al elevar el rango de 10 a 500 filas.
- Vulnerabilidades o filtraciones: **ninguna detectada en el alcance revisado**.
- Optimización implementada: **ninguna**. La línea base local ya existe, pero falta evidencia de degradación en producción/usuarios y una comparación antes/después para justificar un cambio.
- Dashboard, reportes, portal y scanner conservan su lógica y controles.
- No se cambió política de caché ni dependencias.

## 10. Validaciones y resultados

| Validación | Resultado | Notas |
|---|---|---|
| Build de producción de base aislada | PASS | Build de referencia; advertencia de tracing causada por symlink temporal |
| Playwright funcional incluido en primera corrida | 22 PASS, probe 1 FAIL | Los 22 tests funcionales finalizaron; el probe exploratorio agotó timeout durante login bajo throttling. No reutilizar sus muestras incompletas |
| Segundo intento de medición aislada | Interrumpido sin serie | Duración no práctica con setup actual; no se convirtió en baseline |
| `npm run lint` | PASS | ESLint, sin advertencias |
| `npm run typecheck` | PASS | `tsc --noEmit` |
| `npm test` | PASS, 1 skip | Todas las suites del script pasaron; un caso de GnuPG omitido porque el sandbox deniega el socket del agente |
| `npm run test:security:matrix:local` | PASS | 201 aserciones pgTAP y comprobaciones dinámicas HTTP/Auth/Server Actions; teardown completado |
| `npm run test:e2e` | PASS, 22/22 | Playwright local con identidades sintéticas; teardown completado |
| `npm run benchmark:qr009:local` | PASS, 90 muestras + 3 escenarios SQL | Chrome local con build de producción, Auth local, 5 repeticiones por ruta/perfil/caché y SQL/RLS autenticado; no incluye sesiones/eventos de asistencia; teardown comprobado |
| Suites unitarias funcionales seleccionadas | PASS, 67 tests | `test:attendance` presentation, reports, scanner, employee-portal, user-access, auth-flow, deployment, credentials. Se excluyó deliberadamente `test:pin-lockout` por la restricción de no probar PIN |
| Matriz completa QR-004 en esta fase | No ejecutada | El runner integral crea sesiones/eventos sintéticos de asistencia y por eso quedó fuera del alcance. Se conserva el resultado previo documentado de 201 pgTAP assertions; no se presenta como revalidación de esta rama |
| Build de producción aislado final | PASS, 41/41 rutas | Sin archivos `.env`; URL/key Supabase sintéticas de loopback. Advertencia de 27 trazas omitidas por symlink de `node_modules` fuera del `outputFileTracingRoot` temporal |
| Limpieza del stack temporal | PASS | No quedaron contenedores con prefijo `qr004_disposable_` en la verificación posterior |

## 11. Riesgos y limitaciones residuales

- No hay Lighthouse ni RUM. La medición local brinda LCP/FCP/CLS/TTFB y bytes de cinco muestras, pero no es un Core Web Vitals de usuarios reales; el impacto de caché fue nulo en bytes JS observados.
- INP no está instrumentado; no se inferirá desde TBT.
- El conjunto de 500 empleados no demuestra comportamiento a escala; no se midió un reporte con asistencia sintética ni escrituras.
- La cifra de JavaScript por ruta no desglosa exactamente Recharts/ZXing. Abrir los charts añadió 0 B, pero no se atribuye el tamaño inicial solo a Recharts.
- No se midieron cámara real, latencia de autorización de scanner bajo un origen seguro local ni hardware físico.
- El benchmark toma alrededor de 1.7 minutos y usa navegador/dispositivo emulados.
- No se probó hardware físico, datos productivos, Testing ni Producción.

## 12. Recomendaciones y criterios para cerrar QR-009

1. Comparar esta línea base con RUM/Lighthouse aprobado, manteniendo perfil y versiones, antes de proponer optimizaciones.
2. Si se requiere atribuir Recharts/ZXing, utilizar un analyzer ya aprobado o inspección del browser waterfall sin agregar dependencias y comparar con la importación/ruta actual.
3. Para latencia de cámara/contexto, usar un entorno HTTPS local confiable que respete `APP_BASE_URL`; no relajar el guard de origen.
4. Medir consultas representativas de más escala con datos sintéticos y RLS; excluir sesiones/eventos mientras se mantenga la prohibición de registro de asistencia.
5. Solo implementar una optimización si la evidencia acredita una causa; repetir el mismo método y cubrir UX/seguridad/regresión antes y después.
6. Mantener QR-003 en P0/NO-GO y no validar flujos completos de asistencia.

QR-009 sigue **En curso**. QR-004, QR-005 y QR-006 siguen En curso. QR-003 permanece pospuesta, P0 y NO-GO.
