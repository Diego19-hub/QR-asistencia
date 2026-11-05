# QR-004 — Fase 9.1: autorización dinámica de RPC de lectura

**Estado:** Fase 9.1 validada localmente; QR-004 sigue **En curso**.
**Base:** `1198079647afaec33e54a1489ff2fd8eedb4c623` (merge de la Fase 8).
**Rama local:** `audit/qr-004-phase9-rpc-authorization`.

## Objetivo y alcance

Se añadió una suite pgTAP para examinar límites de autorización y filtración de datos en cinco RPC `SECURITY DEFINER` de solo lectura:

- `get_company_user_invitation_for_delivery(uuid,uuid)`
- `list_my_pending_company_invitations()`
- `get_employee_credential_status(uuid,uuid)`
- `get_own_employee_credential_status(uuid,uuid)`
- `list_authorized_supervisor_devices(uuid)`

La prueba usó exclusivamente una instancia Supabase/PostgreSQL local desechable, 27 migraciones SQL rastreadas y datos sintéticos de dos empresas. Las llamadas bajo prueba ejecutaron con `anon` o `authenticated`; `service_role` se empleó únicamente para sembrar el owner sintético conforme al trigger de membresías. No hubo enlace a un proyecto alojado ni se leyó `.env.local`.

La suite no invoca verificación o configuración de PIN, RPC de escaneo, procesamiento QR, ni escritura de sesiones, eventos o asistencia. No se modificó lógica funcional ni migraciones.

## Controles observados en las definiciones

| RPC | Control efectivo observado |
|---|---|
| `get_company_user_invitation_for_delivery` | Exige usuario autenticado, membresía activa owner/admin y `company.manage`; limita la fila por `company_id`, estado pendiente y expiración futura. Un admin no obtiene detalles de una invitación de admin; owner sí. |
| `list_my_pending_company_invitations` | Exige Auth; obtiene correo confirmado desde `auth.users` usando `auth.uid()` y lista solamente invitaciones pendientes/no vencidas dirigidas a ese correo. Varias invitaciones válidas de empresas distintas son visibles a su destinatario. |
| `get_employee_credential_status` | Exige `employees.manage` y membresía activa owner/admin en la empresa solicitada; el empleado debe pertenecer a esa empresa. Responde estado/indicadores, nunca hashes ni valores secretos. |
| `get_own_employee_credential_status` | Vincula empresa, empleado y `auth.uid()`; exige membresía activa `employee`, expediente vinculado y empleado activo. Responde estado y marcas de tiempo. |
| `list_authorized_supervisor_devices` | Exige autenticación y `devices.manage` para la empresa. La consulta es de ámbito empresarial y devuelve dispositivos de todas las sucursales de esa empresa; no filtra por sucursales asignadas al supervisor. No incluye token ni challenge. |

## Perfiles y cobertura dinámica

Los fixtures cubrieron owner A, admin A, admin B, supervisor A, empleado A, empleado B, identidad sin membresía, membresía inactiva, admin con `company.manage`/`employees.manage`/`devices.manage` revocados, admin con membresías en A y B, destinatario confirmado, destinatario no confirmado e identidad distinta. Se crearon empresas A/B, sucursales A1/A2/B1, un expediente vinculado por empresa, expedientes sintéticos auxiliares, invitaciones válidas, vencidas, revocadas y aceptadas, y dispositivos de A1/A2/B1.

La suite ejecutó **62 aserciones pgTAP PASS**, incluidos seis snapshots de ausencia de efectos secundarios, sin revelar el contenido de credenciales. Cubre:

- ACL: anon no tiene `EXECUTE` en las cinco funciones.
- Invitación de entrega: owner y admin autorizados, empresa no seleccionada/ajena, ID de invitación de otro tenant, invitación vencida, target admin y denegación por rol, membresía y permiso revocado.
- Invitaciones pendientes: rechazo anónimo; correo Auth consultado por identidad real, no por `email` falsificado en claims; exclusión de estados vencidos/revocados/aceptados y correo no confirmado; aislamiento por destinatario y visibilidad válida de invitaciones A/B para el destinatario correspondiente.
- Estado administrativo de credenciales: owner/admin y multiempresa autorizados; supervisor, empleado, membresía inactiva, `employees.manage` revocado y empresa/empleado ajeno rechazados. El resultado sintético no contiene claves de token, hash, PIN o secreto.
- Estado propio: lectura del expediente propio; rechazo de otro expediente, identidad/empresa ajena, membresía inactiva, usuario sin expediente y anon.
- Dispositivos: owner/admin/multiempresa autorizados dentro de sus empresas; admin B no cruza a A; supervisor sin `devices.manage`, membresía inactiva, permiso revocado y anon rechazados. El administrador ve A1 y A2, pero no B1; el JSON no expone token/challenge/hash.
- Sin efectos secundarios: seis checks post-call compararon huellas de estado de invitaciones, auditoría, membresías y dispositivos, más cantidades de credenciales QR/PIN. No se leen ni imprimen hashes secretos. La transacción termina con `ROLLBACK`.

## Matriz resumida

| Actor / caso | Entrega invitación | Pendientes propias | Estado admin credencial | Estado propio | Dispositivos autorizados |
|---|---|---|---|---|---|
| Anónimo | Denegado `42501` | Denegado `42501` | Sin EXECUTE; protegido | Denegado `42501` | Sin EXECUTE; denegado `42501` |
| Owner A | Permitido A; admin invite solo owner | Solo destinatario Auth | Permitido A | Sin rol de empleado | Permitido A, todas sus sucursales |
| Admin A activo | Permitido A, no admin invite | Solo destinatario Auth | Permitido A | Sin rol de empleado | Permitido A, todas sus sucursales |
| Admin B → A | Denegado por `company.manage` `42501` | Solo sus destinatarios | Denegado `42501` | No puede consultar empleado A | Denegado `42501` |
| Supervisor A | Denegado `42501` | Solo destinatario Auth | Denegado por rol `42501` | No es expediente empleado | Denegado sin `devices.manage` |
| Empleado A/B | Denegado `42501` | Solo invitaciones para su correo confirmado | Denegado por rol `42501` | Solo su expediente activo | Denegado sin `devices.manage` |
| Membresía inactiva | Denegado `42501` | Sin efecto si no es destinatario | Denegado `42501` | Denegado `42501` | Denegado `42501` |
| Admin con permiso revocado | Denegado `42501` | No afecta lista de destinatario | Denegado `42501` | No aplica | Denegado `42501` |
| Usuario sin membresía | No puede leer delivery | Puede leer solo si es el destinatario Auth confirmado | Denegado | Denegado | Denegado |
| Admin con membresía A+B | Permitido por empresa activa correspondiente | Invitaciones dirigidas a su Auth | Permitido A y B | Solo expediente propio si empleado | Permitido por empresa A y B |

Los `42501` y el `P0002` observado para un ID de empleado de B consultado dentro de A corresponden al contrato de autorización/indisponibilidad definido por las funciones. Los intentos con ID extranjero no devolvieron datos.

## Hallazgos y evaluación

**Vulnerabilidades confirmadas en estos cinco RPC y estos perfiles: ninguna.** La suite no es una auditoría exhaustiva de filas, campos o combinaciones posibles, y no demuestra la ausencia de modificaciones manuales en instalaciones alojadas.

La revisión de `list_authorized_supervisor_devices` confirmó que su autorización es por empresa, no por sucursal. El administrador sintético con `devices.manage` vio dispositivos de A1 y A2, incluida una sucursal no asignada al supervisor, y no vio B1. Esto concuerda con el permiso empresarial y la definición observada. Si el requisito de producto fuese limitar administradores a sucursales, requeriría una decisión de autorización separada; no se cambió el contrato ni se registra como vulnerabilidad.

## Validaciones ejecutadas

| Comando | Resultado |
|---|---|
| `npm run test:security:phase9-rpc:local` | **62/62 PASS**; 27 migraciones rastreadas; suite específica solamente; cleanup PASS; Docker preexistente preservado. |
| `npm run test:security:privileged-rpc:local` | **26/26** Fase 8 y **27/27** supervisores/dispositivos; limpieza PASS. |
| `npm run test:security:supervisor-devices:local` | **27/27 PASS**; limpieza PASS. |
| `node --check tests/qr004-auth-matrix.local.integration.mjs` | PASS. |
| `npm run lint` | PASS. |
| `npm run typecheck` | PASS. |
| `git diff --check` | PASS. |

Se omitieron `npm test`, matriz general, PIN, escaneo/asistencia, Auth/HTTP, E2E, build y GitHub Actions porque no eran compatibles con los límites de esta fase o no hubo cambios de aplicación. No se consultaron Supabase Testing ni Producción.

## Cobertura frente a fases anteriores

Las suites previas incluían verificaciones ACL/estáticas de credenciales y consultas de portal, así como otras operaciones de invitaciones en el runner HTTP/Auth. La ejecución nueva es evidencia dinámica directa de autorización sobre las cinco RPC en el mismo commit de esta rama. La matriz de [QR-004-PRIVILEGED-RPC-AUDIT.md](QR-004-PRIVILEGED-RPC-AUDIT.md) se actualizó solo para estas cinco funciones y no atribuye a esta fase resultados de otras funciones.

## Integración de pruebas de seguridad en CI — Fase 9.2

Se añadió el modo local `npm run test:security:rpc-ci:local`, que reutiliza el runner existente y ejecuta, en orden, las tres suites siguientes dentro de una sola instancia Supabase local desechable:

| Orden | Suite | Plan comprobado |
|---:|---|---:|
| 1 | `qr007_supervisor_device_rls_test.sql` (Fase 7) | 27 |
| 2 | `qr004_privileged_rpc_authorization_test.sql` (Fase 8) | 26 |
| 3 | `qr004_phase9_rpc_authorization_test.sql` (Fase 9.1) | 62 |
| | **Total** | **115** |

El modo exige los planes esperados, verifica que cada archivo tenga `BEGIN` y `ROLLBACK`, cuenta los resultados TAP observados de cada ejecución, falla si un conteo individual o el total difiere y exige exactamente la lista cerrada de tres archivos. Una suite fallida aborta el comando y el `finally` del runner ejecuta la limpieza del proyecto temporal.

**Aislamiento observado:** se copiaron las 27 migraciones SQL rastreadas con `git ls-files`, más plantillas de configuración, a un directorio temporal. Cada ejecución usó un `project_id` `qr004_disposable_*` y puertos loopback asignados al azar. El modo no lee `.env.local`, elimina del entorno las variables de Supabase/PostgreSQL, no enlaza proyectos remotos y excluye Auth/GoTrue, PostgREST, Kong, Mailpit, Studio, Storage, Realtime y servicios no necesarios. No arranca Next.js ni llamadas HTTP. El contenido de las tres suites fue revisado: los fixtures son sintéticos, sus prefijos UUID difieren (`f700`, `f810`, `f910`) y cada suite revierte sus cambios. No se invoca la verificación de PIN, RPC de escaneo ni escrituras de asistencia; Fase 8 solo inspecciona estáticamente sus ACL y Fase 9 compara conteos de credenciales antes/después.

**Comando y resultado medido:** `npm run test:security:rpc-ci:local` terminó con **27/27 + 26/26 + 62/62 = 115/115 PASS**. Las dos ejecuciones cronometradas completas con `/usr/bin/time -p` tardaron `real 33.53 s` (`user 3.74 s`, `sys 1.19 s`) y `real 38.82 s` (`user 4.03 s`, `sys 1.47 s`). El proyecto de la validación final fue `qr004_disposable_9f4c02d53278`. Una ejecución adicional sin cronómetro también pasó las 115 aserciones. En todas, el runner informó que eliminó el stack temporal y los datos, y preservó los recursos Docker anteriores.

**Workflow local preparado:** `.github/workflows/ci.yml` conserva el job `verify`, el límite de 30 minutos, lint, typecheck, `npm test`, matriz general, E2E y build; se agregó un único paso `npm run test:security:rpc-ci:local` después de la matriz general. No se agregaron secretos ni destinos remotos ni se cambiaron protecciones. La sintaxis YAML fue validada localmente. La contribución medida del nuevo paso fue 33.53 s; bajo estas restricciones no se ejecutaron ni se cronometraron localmente todos los pasos existentes, por lo que no se afirma un tiempo total del job ni se aumenta el límite de 30 minutos. El CI remoto está pendiente.

**Regresiones de modos:** se conservaron los scripts individuales de matriz, RPC privilegiadas, supervisores/dispositivos, Fase 9.1 y E2E, además de `npm test`. En la validación final se rechazaron antes de acceder a Docker cinco combinaciones incompatibles del modo unificado con supervisor, privilegiado, Fase 9.1, E2E y benchmark. La ruta nueva salió por su rama exclusiva, sin iniciar el servidor de aplicación. No se ejecutaron los modos general ni E2E para evitar los escenarios de PIN/asistencia excluidos.

**Validaciones de esta preparación:** modo unificado **115/115 PASS**; lint PASS; typecheck PASS; `node --check tests/qr004-auth-matrix.local.integration.mjs` PASS; guardas de argumentos y scripts existentes PASS; sintaxis de `.github/workflows/ci.yml` PASS; `git diff --check` PASS. No se ejecutaron `npm test`, matriz general, E2E, PIN, escaneo/asistencia ni GitHub Actions. Tampoco se publicaron cambios.

**Estado de publicación:** el cambio local del workflow no se ha ejecutado en GitHub; ninguna ejecución de Actions valida estos cambios aún. La revisión queda lista para revisión/publicación posterior, pero el CI remoto permanece **pendiente**, no aprobado. El tiempo de ejecución total del workflow no puede verificarse sin ejecutar el job completo; la medición de 33.53 s solo cuantifica el paso nuevo. No se modificó el timeout porque esa medición incremental no demuestra que el job exceda el límite.

## Riesgos residuales y estado

- Solo se cubrieron cinco de las funciones privilegiadas del catálogo; no declarar cobertura integral de las 46.
- Estas pruebas describen el esquema canónico local de `main`; no prueban el estado actual alojado ni deben ejecutarse contra Testing/Producción.
- Fase 9.2 integra tres suites, no reemplaza la matriz general ni las pruebas E2E. La integración sigue pendiente de una ejecución de GitHub Actions autorizada después de publicar.
- QR-004 conserva pendientes de otros dominios, Server Actions y revisión remota segregada. **No cerrar QR-004.**
- QR-003 sigue **P0, pospuesta y NO-GO**. No se alteraron sus archivos ni estado.
- No se creó commit, no se hizo push/PR/merge, no se inició GitHub Actions y no hubo despliegues ni migraciones remotas.

**Recomendación:** mantener la rama local para revisión de seguridad y considerar publicación solo después de lint/typecheck/diff-check y revisión del diff final. La propuesta de CI se debe tratar en Fase 9.2 separada.
