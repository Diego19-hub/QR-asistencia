# QR-009 — Benchmark reproducible de navegador y PostgreSQL

## Alcance y ejecución

El benchmark se ejecuta con `npm run benchmark:qr009:local`. Usa el runner desechable `tests/qr004-auth-matrix.local.integration.mjs --performance-only`: inicia un Supabase local con un identificador aleatorio, aplica solo sus migraciones locales, crea empresas, sucursales, usuarios y 500 empleados sintéticos, compila una copia temporal de Next.js en modo producción y lanza Playwright con Chrome. Auth y el aprovisionamiento suceden antes de medir. No lee `.env.local` ni usa credenciales alojadas.

Chrome ya instalado se puede seleccionar sin instalar navegadores:

```bash
QR004_CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run benchmark:qr009:local
```

El runner genera un JSON agregado con permisos `0600` bajo el directorio temporal del sistema. El archivo no contiene cookies, contraseñas, correos, IDs, URLs completas ni trazas. Se elimina el proyecto Supabase aleatorio, la app y sus recursos temporales aun cuando falle la prueba; el teardown comprueba que recursos Docker previos sigan presentes. No ejecutar en este modo el runner estándar de la matriz, que crea sesiones y eventos sintéticos de asistencia.

## Protocolo

- Base de aplicación: `main` integrado en `38652df09a8996e5baf3641e1d611e669760db3d`; no se modificó código de producto.
- App: build de producción aislado de Next.js, sin `.env*`, con URLs/keys de Supabase loopback efímeras.
- Navegador: Google Chrome 156.0.8078.79, Playwright 1.64.1, Node 24.18.0, npm 11.16.0.
- Rutas: `/login`, `/admin`, `/admin/reportes`, `/scanner`, `/mi-qr`.
- Muestras: 5 por ruta/perfil/estado de caché; 90 mediciones en total (login solo desktop; las demás rutas en desktop y móvil emulado). “Fría” limpia la caché HTTP antes de cada navegación. “Caliente” precarga una navegación y repite cinco navegaciones con caché habilitada.
- Desktop: 1440×900, CPU 1×, red local sin limitación. Móvil emulado: 390×844, CPU 4×, RTT 40 ms, 1.6 Mbps descarga y 750 Kbps subida.
- Métricas: navegación/load, TTFB, FCP, LCP, CLS, tareas largas, bytes de transferencia total y JavaScript desde `PerformanceResourceTiming`; APIs seleccionadas se cronometra aparte con timestamp request/response. INP no se simula ni se infiere de tareas largas.
- No se creó ninguna sesión ni evento de asistencia. No se llamó a `/api/attendance/scan`, no se activó la cámara, no se verificó PIN y no se probaron credenciales QR.

## Resultados del navegador

Las cifras son la mediana (p50) de cinco muestras; navegación incluye el p95 de la misma serie. Bytes proceden del Chrome local, no de una CDN real.

| Ruta | Perfil/caché | Navegación p50/p95 ms | TTFB p50 ms | FCP p50 ms | LCP p50 ms | CLS p50 | Transferencia p50 B | JS p50 B |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `/login` | Desktop fría | 28.3 / 105.8 | 6.7 | 32 | 32 | 0 | 148,088 | 134,814 |
| `/login` | Desktop caliente | 28.9 / 30.5 | 7.4 | 32 | 32 | 0 | 148,088 | 134,814 |
| `/admin` | Desktop fría | 69.9 / 87.4 | 40.7 | 72 | 72 | 0 | 176,533 | 152,521 |
| `/admin` | Desktop caliente | 68.8 / 117.5 | 42.0 | 84 | 84 | 0 | 176,532 | 152,521 |
| `/admin/reportes` | Desktop fría | 73.8 / 117.5 | 45.6 | 64 | 64 | 0 | 361,659 | 256,671 |
| `/admin/reportes` | Desktop caliente | 93.8 / 97.0 | 56.2 | 84 | 84 | 0 | 361,659 | 256,671 |
| `/scanner` | Desktop fría | 82.5 / 90.2 | 45.6 | 64 | 64 | 0 | 286,286 | 271,906 |
| `/scanner` | Desktop caliente | 77.2 / 137.8 | 38.9 | 68 | 68 | 0 | 286,285 | 271,906 |
| `/mi-qr` | Desktop fría | 71.3 / 97.6 | 40.0 | 68 | 68 | 0 | 162,598 | 146,706 |
| `/mi-qr` | Desktop caliente | 65.7 / 81.6 | 40.5 | 64 | 64 | 0 | 162,598 | 146,706 |
| `/admin` | Móvil fría | 1,023.6 / 1,038.3 | 46.2 | 360 | 360 | 0.0781 | 172,346 | 152,521 |
| `/admin` | Móvil caliente | 1,028.1 / 1,059.2 | 42.0 | 348 | 348 | 0.0781 | 172,345 | 152,521 |
| `/admin/reportes` | Móvil fría | 1,520.2 / 1,647.2 | 57.5 | 380 | 380 | 0 | 275,606 | 256,671 |
| `/admin/reportes` | Móvil caliente | 1,514.9 / 1,519.4 | 45.7 | 376 | 376 | 0 | 275,604 | 256,671 |
| `/scanner` | Móvil fría | 1,653.7 / 1,694.3 | 82.0 | 328 | 328 | 0 | 286,285 | 271,906 |
| `/scanner` | Móvil caliente | 1,647.4 / 1,700.6 | 66.1 | 304 | 304 | 0 | 286,286 | 271,906 |
| `/mi-qr` | Móvil fría | 958.0 / 975.9 | 58.9 | 368 | 1,124 | 0.0012 | 162,598 | 146,706 |
| `/mi-qr` | Móvil caliente | 988.4 / 1,129.0 | 57.5 | 376 | 1,104 | 0.0012 | 162,597 | 146,706 |

La caché caliente no redujo el JavaScript transferido en estas condiciones (`cachedJsResourcesP50=0` en todas las series). Por tanto, se reportan ambos estados, pero no se presenta una ventaja de caché que no se observó. CLS móvil fue 0.0781 en `/admin`, 0.0012 en `/mi-qr` y 0 en las demás rutas de la muestra local.

### Endpoints observados

| Ruta/API | Estado | Desktop fría p50/p95 ms | Móvil fría p50/p95 ms |
|---|---:|---:|---:|
| `/admin` — `/api/dashboard/summary` | 200 | 177 / 221 | 172 / 210 |
| `/admin/reportes` — `/api/reports` | 200 | 269 / 337 | 342 / 553 |
| `/mi-qr` — `/api/employee/portal` | 200 | 78 / 157 | 119 / 154 |
| `/scanner` — `/api/supervisor/scanner/context` | 403 | 7 / 9 | 57 / 65 |

El 403 del contexto del escáner es una limitación deliberada del entorno: el build de producción en loopback HTTP no satisface el control de origen `APP_BASE_URL` que exige HTTPS público. No se debilitó el control ni se simuló un origen aprobado. Por ello no se midieron tiempo de cámara lista ni transferencia de JavaScript al iniciar cámara. `/scanner` sí se midió como página protegida con sesión sintética, con el guard de origen activo.

## Recharts y ZXing

- En `/admin/reportes`, JavaScript mediano inicial: 256,671 B. Al abrir “Análisis y métricas avanzadas”, el SVG Recharts se renderizó y la transferencia JS acumulada permaneció en 256,671 B: **0 B adicionales**. Evidencia compatible con el import estático actual; no demuestra cuánto del total corresponde exclusivamente a Recharts. No se propone lazy loading sin un análisis de bundle que atribuya bytes y una segunda medición funcional.
- En `/scanner`, JavaScript mediano inicial: 271,906 B, 15,235 B más que `/admin/reportes` en esta corrida. El código mantiene el import estático `@zxing/browser`; la diferencia entre rutas no atribuye esos bytes a ZXing. Sin analyzer ni cámara habilitada no hay evidencia para separar el costo del decoder. Se conserva como investigación pendiente, no como hallazgo de optimización.

## PostgreSQL/RLS

Se ejecutó la misma consulta de lectura a `public.employees` con `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` bajo el rol `authenticated`, claims JWT sintéticos del administrador activo y RLS habilitada; el conteo exacto se verificó dentro del mismo rol. No se usó `service_role` para consultar. Dataset: 500 empleados activos sintéticos en una empresa y sucursal local; 5 repeticiones por rango.

| Filas sintéticas visibles bajo RLS | p50 ms | p95 ms | Shared hit blocks | Shared read blocks |
|---:|---:|---:|---:|---:|
| 10 | 0.978 | 1.490 | 100 | 0 |
| 100 | 8.474 | 8.976 | 910 | 0 |
| 500 | 34.540 | 35.209 | 4,510 | 0 |

La medición muestra crecimiento con cardinalidad para esta consulta y fixture; no es una prueba de carga ni una proyección de producción. No se midieron escrituras. Se excluyeron deliberadamente tablas y reportes de asistencia para cumplir la prohibición de registrar asistencia.

## Validaciones y decisión

- Benchmark producción local: **PASS**, 90 muestras, 3 escenarios SQL, 5 repeticiones por volumen, report JSON efímero, 0 solicitudes de scan y teardown PASS.
- Build temporal de Next: **PASS**.
- `npm run lint`: **PASS**.
- `npm run typecheck`: **PASS**.
- `npm run test:e2e`: **PASS, 22/22** con Auth local y fixtures sintéticos; teardown PASS. Suites funcionales seleccionadas: **PASS, 67/67**. `npm run lint`, `npm run typecheck` y build aislado de Next: **PASS**. La matriz completa QR-004 no se ejecutó en esta fase porque su runner normal crea sesiones/eventos de asistencia; la prueba QR-009 verificó únicamente lectura bajo RLS con actores locales.
- GitHub Actions: pendiente de la ejecución del PR que acompañará este commit.
- Sin cambios funcionales ni optimizaciones propuestas. Los tiempos son locales/emulados, no métricas RUM ni resultados de Testing/Producción. Lighthouse, INP real, cámara activa, atribución exacta Recharts/ZXing y carga de datos de asistencia quedan pendientes.

QR-009 permanece **En curso**. No se considera línea base de usuarios reales ni se justifican optimizaciones todavía.
