# QR-009 — Auditoría de rendimiento web

Fecha: 2026-10-30

Commit base: `1a0b0a5a465fce453dc8a748e326c244da3a675e` (PR #23)

Rama: `perf/qr-009-web-performance`
Estado: **En curso; baseline de navegador y SQL pendiente. No se aplicó optimización.**

## 1. Resumen ejecutivo

Se revisaron dashboard, reportes, portal del empleado, escáner, consultas y configuración de build. Un build de producción aislado permitió contar chunks referenciados por ruta, con Recharts concentrado en la ruta de reportes y ZXing en el área del escáner. Esos conteos son un indicador de bundle, no una medición de transferencia real.

No se obtuvo una serie confiable de LCP, CLS, TTFB, FCP, bytes realmente transferidos, TBT ni latencias SQL. Lighthouse no está instalado; no se agregó dependencia. Dos intentos de muestreo Playwright con una instancia local desechable no completaron las series bajo throttling y se detuvieron. Como no hay línea base comparable antes/después, no se modificó código de aplicación ni se afirma una mejora. QR-009 permanece En curso.

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

La revisión estática confirma controles existentes de ciclo de cámara, cancelación/generación de peticiones y descarte de contexto obsoleto en QR-006. En la corrida Playwright funcional de esta auditoría, los casos existentes del escáner estuvieron entre los 22 tests funcionales aprobados; no se procesó QR, no se llamó a la API de scan, no se verificó PIN ni se registró asistencia. No se midió tiempo físico de inicialización de cámara ni rendimiento de hardware móvil.

## 8. PostgreSQL y Supabase

No se ejecutó `EXPLAIN (ANALYZE, BUFFERS)` ni medición de p50/p95. Aunque el runner crea un stack desechable, esta tarea no preparó una cardinalidad sintética documentada y representativa para comparar planes. No se accedió a Supabase Testing ni Producción; no hubo migraciones ni cambios RLS.

## 9. Problemas confirmados y optimizaciones

- Problemas de rendimiento confirmados por medición: **ninguno**.
- Vulnerabilidades o filtraciones: **ninguna detectada en el alcance revisado**.
- Optimización implementada: **ninguna**; no existe baseline runtime comparable que la respalde.
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
| Build de producción aislado final | PASS, 41/41 rutas | Sin archivos `.env`; URL/key Supabase sintéticas de loopback. Advertencia de 27 trazas omitidas por symlink de `node_modules` fuera del `outputFileTracingRoot` temporal |
| Limpieza del stack temporal | PASS | No quedaron contenedores con prefijo `qr004_disposable_` en la verificación posterior |

## 11. Riesgos y limitaciones residuales

- Sin Lighthouse ni medición de navegador se desconoce LCP/FCP/CLS/TTFB, TBT e impacto por cache.
- INP no está instrumentado; no se inferirá desde TBT.
- El volumen sintético del runner existente no demuestra comportamiento a escala.
- No se midieron consultas SQL ni volumen de transferencia del portal.
- Los chunks de referencia no son transferencia de red observada.
- E2E local bajo CPU/network throttling puede tomar varios minutos y el timeout de navegación estándar dificulta un benchmark largo.
- No se probó hardware físico, datos productivos, Testing ni Producción.

## 12. Recomendaciones y criterios para cerrar QR-009

1. Ejecutar Lighthouse/Chrome DevTools instalado o aprobado, aislar startup de Next y el tiempo de fixture de Auth, y guardar JSON/trace local sin secretos.
2. Capturar al menos cinco muestras comparables por ruta y perfil; informar medianas/variabilidad y separar frío/caliente con suficiente tamaño de muestra.
3. Medir bytes transferidos desde el waterfall y atribuir chunks de reportes al componente/estado que los solicita.
4. Preparar un dataset exclusivamente sintético de volumen declarado y medir consultas representativas con `EXPLAIN (ANALYZE, BUFFERS)`, conteo de consultas y p50/p95.
5. Solo proponer una optimización si esos datos acreditan una causa; repetir el mismo método y cubrir UX, seguridad y regresiones antes/después.
6. Mantener QR-003 en P0/NO-GO; no validar flujos completos de asistencia hasta que exista autorización y condición segura independiente.

QR-009 sigue **En curso**. QR-004, QR-005 y QR-006 siguen En curso. QR-003 permanece pospuesta, P0 y NO-GO.
