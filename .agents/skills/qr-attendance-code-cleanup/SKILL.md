---
name: qr-attendance-code-cleanup
description: Audita código muerto, imports y dependencias sin uso, duplicación, scripts/tests y complejidad en QR-asistencia; guía retiros y refactorizaciones con evidencia.
---

# Limpieza segura QR-asistencia

## Cuándo usarla
Para QR-007/QR-008/QR-010 o solicitudes de simplificación, retiro de archivos, revisión de dependencias o refactorización.

## Procedimiento
1. Lee `AGENTS.md`, `TASKS.md` y `docs/CODE-CLEANUP.md`; confirma qué autorización cubre la tarea.
2. Reúne referencias estáticas y dinámicas: rutas Next, imports, scripts, configuración, SQL/RPC, templates, CI y documentación.
3. Por candidato registra evidencia, función protegida, consumidores, impacto de build/runtime, pruebas y riesgo.
4. Separa auditoría de implementación; no borres durante una tarea de inventario ni amplíes el alcance.
5. Si se aprueba el retiro, realiza un cambio acotado, conserva cobertura equivalente y ejecuta pruebas relevantes.
6. Actualiza inventario, decisión, evidencia y verificaciones.

## Verificación
- Una búsqueda sin resultados no demuestra que el código esté muerto.
- Comprueba uso por convención, carga dinámica, entrypoints, scripts, workflows, migraciones y operadores.
- No retires pruebas críticas ni dependencias sin rastrear usos de build/producción.
- Demuestra obsolescencia/duplicación, cobertura equivalente cuando aplique, riesgos y resultado de pruebas; mantén el cambio reversible.
