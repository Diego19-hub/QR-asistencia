# QR-009 — Benchmark reproducible de navegador y PostgreSQL

## Alcance y ejecución

El benchmark se ejecuta con `npm run benchmark:qr009:local`. Usa el runner desechable `tests/qr004-auth-matrix.local.integration.mjs --performance-only`: inicia un Supabase local con un identificador aleatorio, aplica solo sus migraciones locales, crea empresas, sucursales, usuarios y 500 empleados sintéticos, compila una copia temporal de Next.js en modo producción y lanza Playwright con Chrome. Auth y el aprovisionamiento suceden antes de medir. No lee `.env.local` ni usa credenciales alojadas.

Chrome ya instalado se puede seleccionar sin instalar navegadores:

```bash
QR004_CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run benchmark:qr009:local
```

El runner genera un JSON agregado con permisos `0600` bajo el directorio temporal del sistema. El archivo no contiene cookies, contraseñas, correos, IDs, URLs completas ni trazas. Se elimina el proyecto Supabase aleatorio, la app y sus recursos temporales aun cuando falle la prueba; el teardown comprueba que recursos Docker previos sigan presentes. No ejecutar en este modo el runner estándar de la matriz, que crea sesiones y eventos sintéticos de asistencia.

## Protocolo

- Código de aplicación: sin cambios desde `38652df09a8996e5baf3641e1d611e669760db3d`. La evidencia numérica procede de una corrida local sobre `e95ff37b72348082654b5b16840ee2b84e711c8c` con ajustes de seguimiento incorporados después en `9464f9f89b7023cc701951415e3b047d5f01f7bd`. El seguimiento de auditoría posterior corrige comprobaciones y metadatos, pero no constituye una nueva corrida de esas 100 muestras. No se modificó código de producto.
- App: build de producción aislado de Next.js, sin `.env*`, con URLs/keys de Supabase loopback efímeras.
- Navegador: Google Chrome 156.0.8078.79, Playwright 1.64.1, Node 24.18.0, npm 11.16.0.
- Rutas: `/login`, `/admin`, `/admin/reportes`, `/scanner`, `/mi-qr`.
- Muestras corregidas: **100/100**, 5 por ruta/perfil/estado, incluyendo `/login` desktop y móvil. El JSON utiliza `cache: "cold"` (caché limpiada explícitamente) y `cache: "repeated-no-cache"` (navegación repetida sin caché HTTP efectiva). La corrida anterior de 90 mediciones omitía login móvil y queda sustituida; se conserva en el historial del PR. “Fría” ejecuta `Network.clearBrowserCache` antes de cada muestra. “Repetida” navega sin limpiar. La investigación confirma que el guard de origen `browserContext.route("**/*")` de Playwright deshabilita HTTP cache, así que “repetida” no representa un cache hit.
- Next ejecuta `next build --webpack` y `next start` con `NODE_ENV=production` solo en `--performance-only`; el runner E2E ordinario conserva `next dev` y `NODE_ENV=development`.
- Desktop: 1440×900, CPU 1×, red local sin limitación. Móvil emulado: 390×844, CPU 4×, RTT 40 ms, 1.6 Mbps descarga y 750 Kbps subida.
- Métricas: navegación/load, TTFB, FCP, LCP, CLS, tareas largas, bytes de transferencia total y JavaScript desde `PerformanceResourceTiming`; APIs seleccionadas se cronometra aparte con timestamp request/response. INP no se simula ni se infiere de tareas largas.
- No se creó ninguna sesión ni evento de asistencia. No se llamó a `/api/attendance/scan`, no se activó la cámara, no se verificó PIN y no se probaron credenciales QR.

## Resultados del navegador

Las cifras son p50/p95 de cinco muestras; el conteo entre paréntesis es el número válido por métrica. En esta corrida hubo 5/5 observaciones de navegación, TTFB, FCP, LCP, CLS, tareas largas y bytes en todos los grupos. Los valores opcionales nulos se excluyen del percentil. Bytes proceden de Chrome local, no de una CDN real.

| Ruta | Perfil/caché | Navegación p50/p95 ms | TTFB p50 ms | FCP p50 ms | LCP p50 ms | CLS p50 | Transferencia p50 B | JS p50 B |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `/login` | Desktop fría | 26 / 102.3 (5) | 7.8 | 32 (5) | 32 (5) | 0 (5) | 148,088 | 134,814 |
| `/login` | Desktop repetida | 26.5 / 27.4 (5) | 8.7 | 28 (5) | 28 (5) | 0 (5) | 148,088 | 134,814 |
| `/login` | Móvil fría | 868.4 / 876 (5) | 5.1 | 284 (5) | 284 (5) | 0 (5) | 148,088 | 134,814 |
| `/login` | Móvil repetida | 870.8 / 873.1 (5) | 6.7 | 296 (5) | 296 (5) | 0 (5) | 148,088 | 134,814 |
| `/admin` | Desktop fría | 83.4 / 230.8 (5) | 38.5 | 72 (5) | 72 (5) | 0 (5) | 176,544 | 152,523 |
| `/admin` | Desktop repetida | 79.1 / 119.3 (5) | 34.5 | 68 (5) | 68 (5) | 0 (5) | 176,544 | 152,523 |
| `/admin/reportes` | Desktop fría | 75.1 / 97.2 (5) | 48.9 | 80 (5) | 80 (5) | 0 (5) | 361,670 | 256,672 |
| `/admin/reportes` | Desktop repetida | 84 / 147.6 (5) | 54.1 | 88 (5) | 88 (5) | 0 (5) | 361,670 | 256,672 |
| `/scanner` | Desktop fría | 90.8 / 156.2 (5) | 34.4 | 64 (5) | 64 (5) | 0 (5) | 286,295 | 271,907 |
| `/scanner` | Desktop repetida | 85.1 / 88.4 (5) | 51.9 | 64 (5) | 64 (5) | 0 (5) | 286,295 | 271,907 |
| `/mi-qr` | Desktop fría | 89.4 / 115.1 (5) | 37.2 | 96 (5) | 100 (5) | 0 (5) | 162,600 | 146,707 |
| `/mi-qr` | Desktop repetida | 81.6 / 130.5 (5) | 40.5 | 80 (5) | 116 (5) | 0 (5) | 162,600 | 146,707 |
| `/admin` | Móvil fría | 1,032.8 / 1,034.5 (5) | 45.7 | 364 (5) | 364 (5) | 0.1 (5) | 172,354 | 152,523 |
| `/admin` | Móvil repetida | 1,033.3 / 1,041.4 (5) | 37.8 | 356 (5) | 356 (5) | 0.1 (5) | 172,354 | 152,523 |
| `/admin/reportes` | Móvil fría | 1,542.6 / 1,617.3 (5) | 51.7 | 404 (5) | 404 (5) | 0 (5) | 275,613 | 256,672 |
| `/admin/reportes` | Móvil repetida | 1,544.2 / 1,589.8 (5) | 44.8 | 412 (5) | 412 (5) | 0 (5) | 275,613 | 256,672 |
| `/scanner` | Móvil fría | 1,664.4 / 1,694.5 (5) | 57.7 | 316 (5) | 316 (5) | 0 (5) | 286,292 | 271,907 |
| `/scanner` | Móvil repetida | 1,654.9 / 1,711.4 (5) | 202 | 328 (5) | 328 (5) | 0 (5) | 286,292 | 271,907 |
| `/mi-qr` | Móvil fría | 976.3 / 984.9 (5) | 67.2 | 384 (5) | 1,164 (5) | 0 (5) | 162,602 | 146,707 |
| `/mi-qr` | Móvil repetida | 977.5 / 996.9 (5) | 73.2 | 388 (5) | 1,132 (5) | 0 (5) | 162,602 | 146,707 |

La agregación conserva `null` y calcula percentiles solo sobre valores finitos; el JSON informa `validSamples` por métrica. No se afirma una mejora entre muestras ni un cache hit.

### Investigación de caché

Playwright documenta que habilitar `browserContext.route()` deshabilita la caché HTTP ([documentación oficial de BrowserContext](https://playwright.dev/docs/api/class-browsercontext#browser-context-route)). El guard `qr005.guardBrowserOrigins()` instala `context.route("**/*")` para bloquear todo origen distinto de Next/Supabase local; esa es la causa del comportamiento anterior.

La corrida confirmó que `Network.clearBrowserCache` se ejecuta antes de cada muestra fría; `Network.setCacheDisabled(false)` deja la caché habilitada explícitamente; el perfil Chrome no usa `--disable-cache`. Aun así, las respuestas JavaScript repetidas fueron HTTP 200 con `Cache-Control: public, max-age=31536000, immutable`, cero respuestas desde cache/memoria/disco/Service Worker/prefetch, cero peticiones condicionales, y `transferSize` no nulo. El guard se conserva por seguridad. Por tanto, este harness no puede medir una visita realmente caliente; las muestras “repetidas” no deben interpretarse como visitas cacheadas.

### Endpoints observados

| Ruta/API | Estado | Desktop fría p50/p95 ms | Móvil fría p50/p95 ms |
|---|---:|---:|---:|
| `/admin` — `/api/dashboard/summary` | 200 | 183 / 471 | 156 / 197 |
| `/admin/reportes` — `/api/reports` | 200 | 260 / 287 | 444 / 646 |
| `/mi-qr` — `/api/employee/portal` | 200 | 78 / 111 | 161 / 169 |
| `/scanner` — `/api/supervisor/scanner/context` | 403 | 10 / 13 | 60 / 64 |

El 403 del contexto del escáner es una limitación deliberada del entorno: el build de producción en loopback HTTP no satisface el control de origen `APP_BASE_URL` que exige HTTPS público. Es una respuesta rechazada, no una medida de latencia normal de un contexto autorizado. No se debilitó el control ni se simuló un origen aprobado. Por ello no se midieron tiempo de cámara lista ni transferencia de JavaScript al iniciar cámara. `/scanner` sí se midió como página protegida con sesión sintética, con el guard de origen activo.

## Recharts y ZXing

- En `/admin/reportes`, JavaScript mediano inicial: 256,672 B. Al abrir “Análisis y métricas avanzadas”, el SVG Recharts se renderizó y la transferencia JS acumulada permaneció en 256,672 B: **0 B adicionales**. Evidencia compatible con el import estático actual; no demuestra cuánto del total corresponde exclusivamente a Recharts. No se propone lazy loading sin un análisis de bundle que atribuya bytes y una segunda medición funcional.
- En `/scanner`, JavaScript mediano inicial: 271,907 B, 15,235 B más que `/admin/reportes` en esta corrida. El código mantiene el import estático `@zxing/browser`; la diferencia entre rutas no atribuye esos bytes a ZXing. Sin analyzer ni cámara habilitada no hay evidencia para separar el costo del decoder. Se conserva como investigación pendiente, no como hallazgo de optimización.

## PostgreSQL/RLS

Se ejecutó la misma consulta de lectura a `public.employees` con `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` bajo el rol `authenticated`, claims JWT sintéticos del administrador activo y RLS habilitada; el conteo exacto se verificó dentro del mismo rol. No se usó `service_role` para consultar. Dataset: 500 empleados activos sintéticos en una empresa y sucursal local; 5 repeticiones por rango.

| Filas sintéticas visibles bajo RLS | p50 ms | p95 ms | Shared hit blocks | Shared read blocks |
|---:|---:|---:|---:|---:|
| 10 | 0.913 | 1.040 | 100 | 0 |
| 100 | 7.812 | 8.509 | 910 | 0 |
| 500 | 34.144 | 35.631 | 4,510 | 0 |

La medición muestra crecimiento con cardinalidad para esta consulta y fixture; no es una prueba de carga ni una proyección de producción. No se midieron escrituras. Se excluyeron deliberadamente tablas y reportes de asistencia para cumplir la prohibición de registrar asistencia.

## Validaciones y decisión

**Nota de vigencia:** los PASS de esta sección describen la corrida local previa documentada (sobre `e95ff37` y ajustes incorporados en `9464f9f`), no revalidan automáticamente el follow-up `24ae7a6` ni commits posteriores. Para revalidar cada nuevo HEAD sin ejecutar PIN/scan ni registrar asistencia, utilizar [el protocolo seguro de revalidación](QR-009-VALIDACION-SEGURA.md).

- Benchmark producción local: **PASS**, 100/100 muestras, 3 escenarios SQL, 5 repeticiones por volumen, report JSON efímero; cero requests de scan/PIN y snapshots completos de sesiones/eventos iguales antes/después; teardown PASS.
- Build temporal de Next: **PASS**.
- `npm run lint`: **PASS**.
- `npm run typecheck`: **PASS**.
- `npm run test:e2e`: **PASS 22/22** con Auth y fixtures locales; el runner omitió seeds de asistencia y el suite afirma que no se registró asistencia; teardown PASS.
- Suites funcionales seleccionadas: **PASS 67/67** (`test:attendance` presentation, reports, scanner context, employee portal, user access, auth flow, deployment, credentials); se excluyó `test:pin-lockout`.
- `npm run lint` y `npm run typecheck`: **PASS** tras las correcciones.
- Build temporal aislado de Next `next build --webpack`: **PASS** dentro del runner; `next start` production también sirvió el benchmark. No se usó `.env.local`.
- GitHub Actions `CI #128`: cancelado intencionalmente durante `npm ci`, después de checkout/setup Node/Chrome y antes de los pasos de lint/typecheck/tests. No es un fallo de CI ni un PASS.
- Sin cambios funcionales ni optimizaciones propuestas. Los tiempos son locales/emulados, no métricas RUM ni resultados de Testing/Producción. Lighthouse, INP real, cámara activa, atribución exacta Recharts/ZXing, caché caliente real y carga de datos de asistencia quedan pendientes.

QR-009 permanece **En curso**. No se considera línea base de usuarios reales ni se justifican optimizaciones todavía.
