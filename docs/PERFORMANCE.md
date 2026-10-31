# Medición de rendimiento

La revisión QR-009 primero capturó un inventario estático de chunks; la fase 2 añadió una línea base reproducible en build local de producción con 90 muestras Chrome/Playwright y tres cardinalidades SQL sintéticas. El protocolo y las cifras están en [QR-009 Runtime Benchmark](QR-009-RUNTIME-BENCHMARK.md). Lighthouse no está instalado; no se agregó dependencia. No se ha justificado ni realizado una optimización. No presentar resultados locales/emulados como métricas de Producción.

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
| 2026-10-31 / `38652df` | cinco rutas prioritarias | Next.js production build local, Chrome 156, Auth/Supabase local sintéticos; desktop y móvil emulado | `npm run benchmark:qr009:local`; 5 muestras por ruta/perfil/caché; Resource Timing y API separada | N/A | Ver [informe runtime QR-009](QR-009-RUNTIME-BENCHMARK.md) | 90 muestras; cache caliente no redujo bytes JS. `/scanner` context devolvió 403 por guard de origen HTTPS; cámara no medida. No es RUM/Producción |
| 2026-10-31 / `38652df` | Consulta de lectura `employees` | PostgreSQL local desechable, 500 filas sintéticas, rol authenticated + RLS | `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, 5 muestras por volumen | N/A | p50/p95: 10 filas 0.978/1.490 ms; 100: 8.474/8.976 ms; 500: 34.540/35.209 ms | Sin filas de asistencia ni escrituras; no extrapolar a producción |
