# QR-asistencia — Cierre de seguridad Etapa 9.4A

Fecha: 12 de octubre de 2026

Base local y remota de `main`: `f2a7d1b63937a90615aa818060b65d85fb4c1ff2`

Pruebas: solo `QR-asistencia-testing` (`llxyziffgtqnzlguxhyt`). Producción (`jawdrhewabqajxnswhkn`) quedó fuera de alcance y no se consultó.

## Hallazgos corregidos

1. **El escáner no aplicaba el alcance de sucursal al empleado.** Un supervisor con un dispositivo autorizado en A1 podía intentar leer el QR de un empleado de A2. Los RPC de lectura y confirmación ahora comprueban que la sucursal del empleado coincida con la del dispositivo autorizado. Se conserva la comprobación de sesión, empresa, dispositivo, PIN y transiciones de asistencia.
2. **El RPC legado permitía evitar el flujo de PIN.** `public.record_attendance_event` ya no concede `EXECUTE` a `PUBLIC`, `anon` ni `authenticated`; los usuarios deben usar `confirm_employee_attendance`, que valida QR, PIN, dispositivo, sucursal, secuencia e idempotencia. También se revocó acceso API directo al helper privado.

La migración correspondiente es `20261012030630_scanner_branch_scope_and_legacy_rpc_lockdown.sql`. Se aplicó únicamente en Testing. Es transaccional, no altera filas históricas ni políticas RLS.

## Comparación con Testing

El historial remoto contiene `20261012030630 scanner_branch_scope_and_legacy_rpc_lockdown`. Las firmas observadas coinciden con las declaradas localmente:

- `public.scan_employee_attendance(uuid,text,text,text)` — `SECURITY DEFINER`, `search_path` vacío; `EXECUTE` para `authenticated` y `service_role`, no para `anon`.
- `public.confirm_employee_attendance(uuid,text,text,text,attendance_event_type,uuid,uuid)` — mismos permisos y configuración; conserva validación PIN y llama al helper privado.
- `private.record_attendance_event(uuid,text,text,attendance_event_type,uuid,uuid)` — `SECURITY DEFINER`, `search_path` vacío; sin `EXECUTE` para `anon`, `authenticated` ni `service_role`.
- `public.record_attendance_event(uuid,text,text,attendance_event_type,uuid,uuid)` — `SECURITY INVOKER`; sin `EXECUTE` para `anon` ni `authenticated`. `service_role` conserva un permiso explícito previo, pero el wrapper invoker no puede ejecutar el helper privado, cuyo permiso también se revocó. No se amplió ningún grant.

Se compararon los hashes MD5 del cuerpo almacenado en Postgres con el cuerpo SQL local. Coinciden exactamente para `scan_employee_attendance`, `confirm_employee_attendance` y `private.record_attendance_event`. La función pública heredada no fue reemplazada; su cambio es de ACL. Las funciones tienen `search_path` vacío. No se detectaron cambios de firma en esta migración.

El escaneo positivo con dispositivo autorizado y PIN, las transiciones de asistencia y el rechazo fuera de sucursal fueron comprobados en la matriz JWT antes de limpiar los fixtures. La llamada directa al RPC heredado fue rechazada.

## Evidencia de pruebas aisladas

Resultados previamente obtenidos con sesiones JWT reales, antes de limpiar los datos:

- **44/44 pruebas RPC aprobadas**, 0 fallidas, 0 omitidas.
- **2/2 pruebas HTTP de reportes y exportaciones aprobadas**, 0 fallidas, 0 omitidas. Se revisó el contenido de Excel/PDF y el aislamiento entre empresas.
- Se autenticaron cuatro cuentas sintéticas. Se validaron administradores de dos empresas, supervisor limitado a A1, usuario sin membresía y solicitudes anónimas.
- Se comparó el estado de credenciales antes/después de llamadas denegadas. No hubo modificaciones no autorizadas.
- Después de las pruebas se eliminaron por ID las cuatro cuentas creadas en esta ejecución y los objetos sintéticos. La comprobación administrativa confirmó cero cuentas/fixtures de esta ejecución. No se tocaron cuentas anteriores.

Las pruebas JWT requieren secretos y manifiesto externos a Git, fallan al faltar variables/fixtures y no tienen mecanismo de `skip`. El modo estricto HTTP se activa con `QR_SECURITY_STRICT=1` y falla si falta configuración. No se versionaron contraseñas, JWT ni fixtures.

## Pendiente: estado de credenciales

Algunas denegaciones del RPC de estado de credenciales devolvieron HTTP 500 con SQLSTATE `P0002`. La operación fue denegada y no cambió el estado, pero el mapeo HTTP es inconsistente. Propuesta posterior: responder 404 (o 403 uniforme, tras revisar el contrato de API) sin revelar si existe un objeto de otra empresa. No cambiar esta función sin repetir la matriz de regresión JWT y comprobar los estados antes/después.

## Verificación local de este cierre

- `npm run lint`: aprobado.
- `npm run typecheck`: aprobado.
- `npm run build`: aprobado.
- `npm run test:reports`: 9/9 aprobadas.
- `npm run test:scanner`: 4/4 aprobadas.
- `git diff --check`: aprobado.
- Escaneo de patrones de claves privadas, JWT y valores secretos en los archivos modificados: cero coincidencias. `.env.local` está ignorado por Git.

La matriz JWT/HTTP se ejecutó antes de limpiar los fixtures; no se reporta como una nueva ejecución en este cierre. No se aplicaron migraciones a producción ni se desplegó frontend.

## Publicación

La publicación requiere que `main` siga en el SHA base, revisión de los archivos, push normal (sin force) y un run exitoso de GitHub Actions. Si la conectividad de Git falla, conservar los cambios locales sin descartar ni reescribir historial.
