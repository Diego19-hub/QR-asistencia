# QR-003 — Cierre con riesgo de recuperación aceptado

**Fecha:** 2026-11-06
**Proyecto:** QR-asistencia — Supabase Testing (`llxyziffgtqnzlguxhyt`)
**Decisión del propietario:** cerrar QR-003 para la corrección del PIN y la validación sintética; aceptar que Testing es descartable y que su recuperación no está garantizada.

## Alcance del cierre

La migración `20261018120000_persist_employee_pin_failures` figura en el historial de Testing. La evidencia de validación del 2026-11-06 documenta que cinco intentos incorrectos activan el bloqueo; el PIN correcto también se rechaza durante el lockout; no se crean sesiones ni eventos; y los registros sintéticos no permanecen tras `ROLLBACK`. La prueba verifica el comportamiento funcional de la corrección en el escenario descrito.

QR-003 queda **Hecha** para este alcance. El cierre no certifica la recuperación del proyecto, la aceptación operativa integral ni la preparación para Producción. No se repitió la prueba al registrar esta decisión; se conserva como evidencia el informe disponible en [QR-003-TESTING-RUNTIME-VALIDATION-2026-11-06.md](QR-003-TESTING-RUNTIME-VALIDATION-2026-11-06.md).

## Riesgo aceptado

El propietario acepta que la información o configuración exclusiva de Testing podría perderse. No hay backup/restore remoto demostrado ni RPO/RTO confirmado.

Esta aceptación **no autoriza** exportar datos, borrar o reconstruir el proyecto Testing, cambiar su plan, ni realizar operaciones en Producción. Para cualquiera de esas acciones se requiere autorización específica.

## Pendientes de lanzamiento

QR-011 sigue **P1 / Bloqueada**. Mantiene la aceptación funcional integral de asistencia, comprobación de bloqueo y recuperación de PIN, pruebas físicas Android/iPhone, cámara y conectividad reales, reportes, revisión de dependencias, monitoreo y un dictamen de lanzamiento. La decisión sobre la recuperación de Testing debe aparecer como riesgo aceptado en ese dictamen.
