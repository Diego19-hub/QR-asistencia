# Medición de rendimiento

No hay mediciones de referencia registradas en esta configuración. Captura datos antes de optimizar y repite el mismo procedimiento después. Anota commit, ambiente, dispositivo/navegador, ruta, volumen de datos, herramienta, número de repeticiones y resultados. No presentes resultados locales como métricas de Producción.

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
| Pendiente | — | — | — | — | — | Completar en QR-009 |
