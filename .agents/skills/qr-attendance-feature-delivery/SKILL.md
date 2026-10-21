---
name: qr-attendance-feature-delivery
description: Implementa funcionalidades pequeñas de QR-asistencia con autorización, aislamiento multiempresa, pruebas y documentación. Úsala al trabajar en una tarea funcional del backlog.
---

# Entrega de funcionalidades QR-asistencia

## Cuándo usarla
Para entregar o corregir una funcionalidad dentro del alcance de `TASKS.md`. Para auditorías profundas, optimización o limpieza, usa también la skill específica.

## Procedimiento
1. Lee `AGENTS.md`, `TASKS.md`, la arquitectura y documentación del módulo; confirma criterios y dependencias.
2. Rastrea el flujo desde página/componente hacia Route Handler, helpers, Auth, SQL/RLS y pruebas. Registra comportamiento y archivos afectados.
3. Implementa el cambio mínimo que cumpla los criterios. Valida entradas en servidor y deriva identidad, empresa y permiso de fuentes confiables.
4. Añade o ajusta pruebas para éxito, denegación y fallos relevantes. Preserva contratos, auditoría e integridad.
5. Ejecuta verificaciones según `docs/TESTING.md`; las pruebas DB solo usan entorno local desechable.
6. Actualiza documentación y evidencia de la tarea. Prepara el PR con `.github/pull_request_template.md`.

## Verificación
- Explica qué cambió y qué archivos toca.
- Registra comandos ejecutados y resultados observados; identifica omisiones.
- Comprueba acceso permitido/denegado por rol y empresa sin exponer secretos ni datos ajenos.
- No hagas merge, despliegue ni migración remota sin autorización explícita.
