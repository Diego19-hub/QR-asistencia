# QR-003 — Validación dinámica en Supabase Testing

**Fecha:** 2026-11-06
**Proyecto:** `QR-asistencia-testing` — `llxyziffgtqnzlguxhyt`
**Alcance:** prueba sintética temporal de persistencia del contador PIN y lockout. Producción no se consultó ni modificó.

## Preflight de solo lectura

- El historial remoto registra `20261018120000_persist_employee_pin_failures`.
- `private.verify_employee_pin(uuid,uuid,text)` existe con propietario `postgres`, `SECURITY DEFINER`, `search_path=""` y ejecución concedida solo a `postgres`.
- Las RPC `public.scan_employee_attendance` y `public.confirm_employee_attendance` existen con propietario `postgres`, `SECURITY DEFINER`, `search_path=""` y `EXECUTE` para `authenticated` y `service_role` (además de `postgres`).
- Las dos RPC contienen las respuestas estructuradas `pin_invalid`, `pin_locked` y `pin_not_configured`. En confirmación, el retorno por PIN inválido precede a `private.record_attendance_event`.
- Se comprobó que los UUID reservados para los fixtures de esta prueba no existieran antes de ejecutarla.

## Prueba dinámica

La suite local `supabase/tests/attendance_pin_lockout_test.sql` no pudo ejecutarse tal cual en Testing: allí no está disponible la función pgTAP `plan(integer)`. No se instaló ninguna extensión ni se alteró el esquema. Se ejecutó una prueba SQL equivalente, limitada a identidades sintéticas y contenida en una transacción que terminó con `ROLLBACK`.

| Comprobación | Resultado observado |
|---|---|
| Primeras cuatro llamadas inválidas alternando preview y confirmación | `pin_invalid` |
| Quinto intento inválido | `pin_locked` |
| PIN correcto durante la ventana de bloqueo | `pin_locked` |
| Contador persistido | 5 |
| Ventana de bloqueo | `locked_until` posterior a la hora actual y dentro de 15 minutos |
| Eventos/sesiones de asistencia | 0 / 0 |
| Contador de credencial sintética de empresa B | 0 |
| Fixtures después del `ROLLBACK` | todos ausentes, comprobado con consulta posterior |

No se seleccionaron PIN, hashes, tokens ni filas de empleados existentes. Ninguna solicitud externa de correo se generó. La prueba no usó credenciales ni empleados reales.

## Dictamen y límites

La persistencia del contador a través de las RPC y el bloqueo están **PASS en Testing** para la secuencia sintética descrita. Las operaciones de prueba no dejaron datos persistentes. El propietario cerró QR-003 para este alcance y aceptó que la recuperación de Testing no está garantizada; véase [QR-003-ACCEPTED-RISK-CLOSURE.md](QR-003-ACCEPTED-RISK-CLOSURE.md).

Esto no constituye un ensayo de backup o restauración de Testing, ni acredita que el proyecto sea descartable. No se volvió a ejecutar la prueba concurrente de doce llamadas ni se validó por escritura el reinicio tras expiración en el entorno remoto; esos casos conservan la evidencia local documentada en `docs/PIN-LOCKOUT-FIX.md`. No se probó una asistencia válida.

El cierre de QR-003 no autoriza un lanzamiento. QR-011 permanece **P1 / Bloqueada** y debe incluir el riesgo aceptado de recuperación de Testing en su decisión GO/NO-GO. No se aplicaron migraciones en esta validación.
