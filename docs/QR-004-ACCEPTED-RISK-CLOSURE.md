# QR-004 — Cierre por aceptación de riesgos residuales

**Fecha:** 2026-11-06
**Decisión:** cerrar QR-004 administrativamente por decisión explícita del responsable.
**Naturaleza del cierre:** los riesgos enumerados abajo se aceptan para continuar con las demás tareas; no se certifica cobertura completa ni se afirma ausencia de vulnerabilidades.

## Evidencia considerada

- CI del código funcional: [run #42265204297](https://github.com/Diego19-hub/QR-asistencia/actions/runs/42265204297), SUCCESS en `cacff53ee73c518238503c829a343ab8b7968ddd`.
- CI documental: [run #42269716116](https://github.com/Diego19-hub/QR-asistencia/actions/runs/42269716116), SUCCESS en `3b8390cfb6ba8041919b323798168e80b4fc70b4`.
- R10-05 mantiene inventario de 33 Route Handlers y 50 métodos. La matriz registra pruebas dinámicas para parte de las operaciones, roles, tenants, filtros y carreras; no prueba exhaustivamente todas las combinaciones. La cobertura QR/PIN/asistencia de Testing y Producción permanece fuera del alcance y bloqueada por QR-003.
- Se corrigió la validación de fechas calendario de `/api/admin/audit`, se cubrieron límites mínimo/máximo de `pageSize` y se incorporó a CI el runner local de carreras de autorización. Ese runner usa infraestructura desechable y no genera sesiones/eventos de asistencia ni ejecuta PIN o escaneo.
- La revisión remota documentada con fecha 2026-11-05 encontró diferencias materiales entre Testing y Producción. La comparación completa de cuerpos de funciones, políticas RLS, grants y configuración Auth no está terminada. No se infiere paridad de entornos.

## Riesgos aceptados

1. **Cobertura dinámica incompleta:** permanecen métodos y combinaciones de permisos, empresa, sucursal, filtros y concurrencia sin prueba dinámica específica. Podría existir una exposición o mutación cross-tenant o una condición de carrera que la evidencia reunida no detectó; no se confirmó un bypass nuevo en esta revisión.
2. **Deriva entre entornos:** los catálogos remotos comparados no son idénticos. Un comportamiento probado localmente puede no coincidir con Testing o Producción hasta reconciliar esquema y configuración.
3. **Auth/RLS/grants incompletos:** la revisión remota no comparó exhaustivamente políticas, permisos efectivos y ajustes Auth, por lo que el estado completo de autorización de cada entorno permanece desconocido.
4. **QR-003 y aceptación de lanzamiento:** la aceptación de este riesgo no valida PIN, lockout ni asistencia real, no remueve el NO-GO de QR-003 y no autoriza despliegue.

## Seguimiento

- **Estado posterior documentado (2026-11-06):** QR-003 quedó Hecha para la corrección del PIN y la validación sintética en Testing, con riesgo de recuperación aceptado; no es GO para Producción. QR-008 y QR-009 quedaron cerradas en sus alcances documentados; QR-010 cerró el paquete acotado de extracción de `AssignmentHistory`. QR-011 se cerró administrativamente por aceptación expresa de riesgos; sus pruebas operativas pendientes no se consideran ejecutadas.
- QR-004 se cerró por aceptación de riesgos residuales, no por cobertura exhaustiva. La integración o despliegue posterior debe seguir el flujo de PR/CI de la aplicación y no implica cambios en Supabase. El estado vigente de cada tarea está en [TASKS.md](../TASKS.md).
- No hubo cambios de datos, migraciones, políticas, grants, configuración Auth ni despliegues en Supabase Testing o Producción como parte de esta decisión.
