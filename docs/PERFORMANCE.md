# Medición de rendimiento

La fase 2 de QR-009 registró 100 muestras Chrome/Playwright en build/servidor de producción local y tres cardinalidades SQL sintéticas. Incluye login móvil y conteos de validez por métrica. La cache HTTP quedó deshabilitada por el guard de origen basado en `browserContext.route`; las muestras repetidas no son cache hits. El protocolo y las cifras están en [QR-009 Runtime Benchmark](QR-009-RUNTIME-BENCHMARK.md). Lighthouse no está instalado; no se agregó dependencia. No se justificó ni realizó optimización. No presentar mediciones locales/emuladas como métricas de Producción.

## Carga y experiencia de página

- Usa Lighthouse (modo y versión registrados) sobre rutas representativas: login, panel, listado/reportes, `/scanner` y `/mi-qr`.
- Registra LCP, INP, CLS, TTFB y tamaño de transferencia. Para Core Web Vitals reales, usa la fuente de RUM disponible; no se identificó una instrumentación en el repositorio.
- Repite en un perfil móvil representativo y en el mismo perfil de red/CPU. Separa primera visita de cargas con caché.

## Bundle y cliente

- Genera build de producción y usa el analizador de bundle aprobado por el proyecto si está instalado; confirma dependencias/herramientas antes de agregar otra.
- Registra chunks iniciales, JavaScript transferido y componentes cliente por ruta. Evalúa Server Components y carga diferida preservando interactividad, auth y estados privados.
- Revisa imágenes, fuentes, solicitudes y duplicación de datos en DevTools; conserva capturas o reporte reproducible.

## Escáner QR

- Mide tiempo desde apertura hasta cámara lista, latencia desde lectura hasta respuesta, tasa de error/reintento y comportamiento al perder conexión.
- Registra dispositivo, cámara, navegador, red y tamaño de muestra. No uses credenciales QR reales; evita grabar tokens, imágenes identificables o datos personales.
- Separa trabajo de cámara en cliente de latencia API/SQL para identificar el cuello de botella.

## Consultas PostgreSQL/Supabase

- Usa `EXPLAIN (ANALYZE, BUFFERS)` y datos sintéticos en una base local de tamaño documentado. Compara plan, filas estimadas/reales, buffers y tiempo.
- Revisa paginación, índices, filtros por empresa/sucursal y políticas RLS. Evita ejecutar `ANALYZE` de consultas con efectos secundarios o contra Producción.
- Registra conteo de consultas por acción y latencias p50/p95 cuando el entorno permita medirlas.

## Caché y privacidad

Antes de cambiar caché, documenta clave, usuario/empresa, invalidación y datos incluidos. No caches respuestas privadas de autenticación, permisos, QR, PIN o asistencia de forma compartida. Prueba cambios con dos empresas y estados de membresía diferentes.

## Registro de resultados

| Fecha/commit | Ruta/escenario | Entorno y dispositivo | Método | Línea base | Después | Observaciones |
|---|---|---|---|---|---|---|
| 2026-10-30 / `1a0b0a5` | `/login`, `/admin`, `/admin/reportes`, `/scanner`, `/mi-qr` | Build de producción aislado; inventario estático, no dispositivo | Chunks referenciados por el client-reference manifest, deduplicados por ruta | Ver tabla en [informe QR-009](QR-009-PERFORMANCE-REPORT.md) | N/A | No representa bytes transferidos por navegador ni permite concluir LCP/TBT |
| 2026-10-30 / `1a0b0a5` | cinco rutas prioritarias | Playwright/Chrome local, viewport móvil 390×844, CPU 4×, perfil 4G, Supabase desechable | Probe exploratorio; se intentaron repeticiones frías y calientes | Sin serie válida | N/A | Dos intentos incompletos por tiempo; no usar como baseline cuantitativo. 22 E2E funcionales existentes sí pasaron en la primera ejecución |
| 2026-10-31 / `e95ff37` (corrida corregida en PR #25) | cinco rutas prioritarias | Next 16 production build/start, Chrome 156, Auth/Supabase local sintéticos; desktop/móvil | `benchmark:qr009:local`; 5 muestras por ruta/perfil/cache solicitada; Resource Timing + CDP | N/A | 100 muestras; tabla en [informe runtime](QR-009-RUNTIME-BENCHMARK.md) | Login incluye móvil. Playwright `context.route` desactiva cache HTTP; “repetida” no representa cache caliente. `/scanner` context 403 guard HTTPS, no latencia autorizada. No es RUM |
| 2026-10-31 / `e95ff37` (corrida corregida en PR #25) | lectura sintética `employees` | PostgreSQL local desechable, 500 filas, rol authenticated + RLS | `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, 5 muestras/rango | N/A | p50/p95: 10 filas 0.913/1.040 ms; 100: 7.812/8.509 ms; 500: 34.144/35.631 ms | Sin filas de asistencia ni escrituras; no extrapolar a producción |
