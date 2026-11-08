# QR-011 — Matriz de aceptación operativa

**Fecha de actualización:** 2026-11-06
**Estado de QR-011:** Hecha por aceptación expresa de riesgos residuales solicitada por el responsable.
**Dictamen de Producción:** NO-GO; no se autorizaron cambios remotos ni despliegues.
**Alcance:** cierre administrativo local. No se consultaron ni modificaron Supabase Testing o Producción en esta actualización.

## Decisión de cierre y riesgos aceptados

El responsable solicitó cerrar esta parte y aceptó los riesgos pendientes que se detallan abajo. El cierre registra una decisión de gestión; **no convierte pruebas no ejecutadas en PASS ni demuestra que la recuperación, el monitoreo o los respaldos funcionen**.

## Evidencia y pendientes

| Criterio | Evidencia disponible | Estado y riesgo aceptado |
|---|---|---|
| Flujo integral de asistencia QR/PIN | QR-003 confirma lockout con fixtures sintéticos; las E2E QR-005/006 bloquean `/api/attendance/scan`. | **No ejecutado integralmente; riesgo aceptado.** No se validó una secuencia completa de entrada, salida y descanso en esta fase. |
| Bloqueo y recuperación de PIN | La validación sintética en Testing registró cinco fallos, lockout y rechazo del PIN correcto; cero sesiones/eventos y fixtures revertidos. | **Parcial; riesgo aceptado.** No se probó asistencia válida, expiración/reinicio remoto ni recuperación integral de cuenta. |
| Android físico, iPhone físico y permisos reales de cámara | Las pruebas de QR-006 usan Chromium, cámara fake y permisos simulados. | **No probado físicamente; riesgo aceptado.** |
| Pérdida y recuperación de conexión | Existe cobertura E2E sintética de red y cámara fake en Chromium. | **No probado en redes físicas; riesgo aceptado.** |
| Reglas de entrada, salida y descansos | Cobertura local y datos de horario no equivalen a aceptación operativa del ciclo completo. | **No aceptado funcionalmente mediante un ciclo completo; riesgo aceptado.** |
| Reportes y exportaciones | Hay suites unitarias y E2E locales de exportación. | **No aceptados en Testing para este cierre; riesgo aceptado.** |
| Seguridad de dependencias npm | Auditoría del lockfile de 2026-11-06: `npm audit` encontró **8 moderadas** asociadas a `minimatch` en la cadena de desarrollo ESLint/TypeScript-ESLint; la versión instalada reportada es `10.2.6`. `npm audit --omit=dev` encontró **0** vulnerabilidades de producción. | **Riesgo de desarrollo aceptado.** No se ejecutó `npm audit fix --force` porque propone degradar `eslint-config-next` a `15.5.29`, incompatible con la línea Next 16 fijada. Lockfile sin cambio. |
| Aceptación funcional en Testing | El usuario confirmó funcionamiento de invitaciones y alta de empleados; no es aceptación del resto de áreas. | **Aceptación integral no realizada; riesgo aceptado.** No se hicieron escrituras en Testing durante el cierre. |
| Monitoreo, respaldos y recuperación | QR-003 documenta que la recuperación de Testing no está garantizada; no hay RPO/RTO o restore remoto demostrado. | **Restore, RPO/RTO y monitoreo no demostrados; riesgo aceptado para el cierre de QR-011.** El riesgo aceptado para Testing no se extiende a Producción. |
| Decisión de lanzamiento | QR-003 y QR-004 cerradas con alcances/riesgos aceptados; los riesgos adicionales de QR-011 fueron aceptados expresamente. | **NO-GO para Producción.** Cerrar QR-011 no autoriza despliegue ni cambios remotos. |

## Protocolo para registrar pruebas físicas y funcionales

Antes de una prueba con escrituras en Testing, usar únicamente una identidad de empleado sintética y una sucursal/horario de QA. Registrar el commit y URL probados, dispositivo/navegador, caso, hora local, resultado observado, identificador sintético de asistencia y resultado del reporte. No incluir PIN, QR legible, cookies, enlaces de acceso ni datos personales en capturas o logs.

Para cada caso que escriba asistencia, comparar el estado previo y posterior y confirmar que no hubo filas duplicadas. Ejecutar la aceptación de una sola secuencia controlada por vez. No usar Producción para pruebas de aceptación.

Este documento registra la decisión de cierre. Las pruebas físicas y de aceptación que faltan siguen sin ejecutarse; el responsable aceptó ese riesgo para cerrar QR-011. No es una certificación de operación, seguridad integral, recuperación ni aptitud para Producción.
