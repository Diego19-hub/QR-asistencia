---
name: qr-attendance-performance
description: Mide y optimiza rendimiento de Next.js/React, bundle, páginas móviles, escáner QR y consultas Supabase/PostgreSQL en QR-asistencia.
---

# Rendimiento QR-asistencia

## Cuándo usarla
Para investigar carga lenta, Core Web Vitals, JavaScript cliente, panel, escáner, consultas o QR-009.

## Procedimiento
1. Lee `AGENTS.md` y `docs/PERFORMANCE.md`; fija ruta, actor, datos, ambiente y métrica objetivo.
2. Captura línea base antes del cambio: commit, herramienta, configuración, dispositivo, red, muestra y métricas.
3. Aísla cuello de botella entre servidor, cliente, red, cámara y base. Revisa componentes, solicitudes, bundle, caché, paginación y plan SQL.
4. Propón un cambio pequeño y medible; confirma herramientas instaladas antes de añadir dependencias.
5. Repite la medición con el mismo método y verifica función, permisos y privacidad.
6. Documenta método, antes/después, variabilidad y límites en `docs/PERFORMANCE.md` y la tarea.

## Verificación
- Exige mediciones antes y después de optimizar.
- Para SQL, usa datos sintéticos y `EXPLAIN (ANALYZE, BUFFERS)` local; anota volumen/parámetros.
- No compartas caché privada ni caches Auth, QR, PIN o asistencia sin analizar aislamiento e invalidación.
- Registra resultados medidos, no estimaciones; no sacrifiques seguridad ni claridad por mejoras marginales.
