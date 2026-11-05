# QR-004 — Revisión final local de seguridad multiempresa

- **Fecha de las pruebas locales:** 2026-11-04
- **Rama:** `audit/qr-004-final-local-closure`
- **Base:** `main` integrado en `49025160f2d9765d00c73aeb2e2bdfda4fc9744c` (PR #31)
- **HEAD validado:** `49025160f2d9765d00c73aeb2e2bdfda4fc9744c` más el diff local descrito abajo; no se creó commit.
- **Dictamen local:** **NOT READY para cerrar QR-004**
- **Dictamen global:** **BLOCKED** por QR-003, brechas locales P1 y revisión remota incompleta para Producción.

## Alcance y aislamiento

Se revisaron `AGENTS.md`, `TASKS.md`, la auditoría QR-004, los informes de brechas/validación/cierre de Fase 10 y las skills locales de seguridad y testing. El trabajo se limitó a los casos P1 residuales seleccionados de R10-05, carreras de invitación y Server Actions prioritarias.

Las pruebas locales usaron instancias Supabase aleatorias y desechables, datos y usuarios sintéticos bajo `@qr-asistencia.invalid`, Next.js enlazado únicamente a URLs loopback y dos conexiones PostgreSQL independientes para ordenar la carrera. La revisión remota posterior consultó por separado metadatos de catálogo de Testing. No se leyeron filas personales ni hubo escrituras remotas.

El modo `--authorization-races-only` no siembra ni modifica `attendance_sessions`/`attendance_events`, no consulta estado PIN, no llama a funciones de PIN/escaneo/asistencia y no ejecuta la matriz general. No modifica los modos previos del runner.

## Resultados dirigidos

### R10-05 — API de acceso administrativo

Se probó `GET/PATCH /api/admin/access` contra PostgreSQL local con dos empresas sintéticas:

| Escenario | HTTP/resultado | Verificación en PostgreSQL |
|---|---:|---|
| Anónimo consulta accesos | 401 | Sin escritura |
| Supervisor consulta accesos administrativos | 403 | Sin escritura |
| Admin de A consulta empresa B | 403 | Sin exposición de la empresa B |
| Admin de A presenta ID de membresía de B al modificar A | 404 | Membresía B y auditoría idénticas al snapshot previo |
| `company.manage` explícitamente revocado intenta desactivar membresía | 403 | Membresía y auditoría idénticas al snapshot previo |
| Owner autorizado desactiva usuario sintético de A | 200 | Membresía queda inactiva y se registra exactamente una auditoría |

La prueba cubre un patrón API de denegación por tenant/permisos y su efecto en la base. La E2E 23/23 cubrió también APIs de supervisores/dispositivos, selección de empresa, roles y revocación; la asignación a sucursal ajena se comprobó sin cambio persistente. Esto no completa los 33 handlers/50 métodos: quedan casos por método y filtros de empleados, sucursales, horarios, credenciales QR y dispositivos que no se repitieron en esta ejecución. Resultados históricos no se atribuyen al trabajo local actual.

### Server Actions y sesión

Se invocaron acciones mediante forms renderizados por Next.js; Next generó los identificadores de acciones y el browser helper usó el protocolo real del framework.

- `chooseMembership` seleccionó la membresía activa propia de la empresa B.
- `setAdminMembership` seleccionó la membresía admin propia de A.
- Tras degradar esa membresía de admin a supervisor mediante una petición HTTP autenticada del owner, el cookie de membresía existente no mantuvo permiso de administración: `GET /api/company` devolvió 403.
- Volver a invocar `setAdminMembership` con la membresía degradada no cambió el cookie ni recuperó privilegios. `chooseMembership` permitió seleccionar la membresía activa de supervisor y dirigió a `/scanner`; la API administrativa siguió denegada.
- `setInvitationPassword` no aceptó por sí misma la invitación. La marca se observó en `auth.users.raw_app_meta_data`; después `acceptInvitation` completó el flujo con una membresía y una auditoría de aceptación.
- Una aceptación antes de terminar el setup de contraseña fue rechazada, dejando la invitación pendiente y sin membresía ni auditoría de aceptación.

Estos casos prueban reautorización tras cambio de rol y el camino real de setup/aceptación. No se afirma que cubran todas las ventanas de rotación de cookies o todos los intercalados de las siete Server Actions.

### Carrera revocación/aceptación

Una conexión transaccional retuvo `FOR UPDATE` sobre una invitación sintética. Una segunda conexión, con `SET ROLE authenticated` y los claims de la identidad admin sintética, puso primero en cola la RPC de revocación. La acción `acceptInvitation`, enviada desde la sesión Auth real del destinatario mediante Next, se puso después en cola. Al liberar el lock, revocación se confirmó primero y aceptación recibió la denegación.

Snapshot final: estado `revoked`, cero membresías activas para el destinatario, cero eventos `USER_INVITATION_ACCEPTED` y exactamente un `USER_INVITATION_REVOKED`. La consulta de espera de locks verificó el orden antes de liberar la fila; no se dependió de una carrera probabilística.

## Hallazgo reproducido y corrección mínima

La acción ya traducía la RPC fallida a `error=expired`, pero si la invitación revocada era la única pendiente, `InvitationPage` redirigía a `/login?error=no-company` antes de renderizar el mensaje de invitación vencida/revocada. La autorización rechazó correctamente y no hubo acceso indebido; la falla era de presentación del resultado.

Se movió el mapa de errores antes de la condición de redirección. La página ahora conserva el mensaje seguro si no hay invitaciones pendientes y existe un código conocido. No cambió la autorización, el contrato SQL ni el texto de errores internos. La carrera dirigida verifica que se muestre `error=expired` tras la revocación.

No se confirmó una vulnerabilidad nueva de bypass multiempresa. La corrección es una regresión funcional menor.

## Regresiones y validaciones

| Comando | Resultado |
|---|---|
| `npm run test:security:authorization-races:local` | **27/27 aserciones PASS**; teardown y preservación de Docker PASS |
| `npm run test:security:rpc-ci:local` | **115/115 pgTAP PASS** (27 + 26 + 62); teardown PASS |
| `npm run test:security:phase10-residual:local` | **59/59 pgTAP PASS**; transacción/teardown PASS |
| `npm run lint` | **PASS** |
| `npm run typecheck` | **PASS** |
| `node --check tests/qr004-auth-matrix.local.integration.mjs` | **PASS** |
| `git diff --check` | **PASS** |

El primer intento de la prueba nueva fue bloqueado localmente por permisos de Docker. En la repetición autorizada, la variante inicial de revocación vía cliente RPC no permitió observar de forma determinista la cola del lock y se detuvo por timeout; el runner limpió ese stack. Se cambió a una conexión PostgreSQL local bajo el rol `authenticated` para controlar el orden, manteniendo la aceptación en la Server Action real. La ejecución final pasó y eliminó sus recursos.

En la evaluación inicial documentada arriba no se ejecutaron `npm test`, matriz general, Playwright/E2E ni build. La revalidación posterior se registra a continuación.

## Estado de riesgos P0/P1

| Riesgo | Estado | Motivo |
|---|---|---|
| R10-01 PIN/asistencia y paridad alojada | **BLOCKED por QR-003** | Cinco funciones de PIN/asistencia siguen fuera del alcance; no fueron llamadas. QR-003 permanece P0/NO-GO. |
| R10-02 alcance de CI general con PIN sintético | **Documentado; sin ejecución nueva** | El CI general de GitHub se ejecutó automáticamente por el merge previo; esta tarea no lo inició ni repitió el scan/PIN. No se usó como evidencia del código local no publicado. |
| R10-03 bootstrap/último owner/auditoría | **PASS, cobertura seleccionada** | 59/59 pgTAP de Fase 10 y 115/115 regresiones RPC restringidas. |
| R10-04 paridad Testing/Producción | **BLOCKED** | Testing tuvo revisión read-only parcial el 2026-11-04. Production está INACTIVE; sus listados de migraciones/esquema fallaron por timeout/no disponibilidad. |
| R10-05 cobertura API tenant/sucursal | **PARCIAL; bloquea cierre** | `/api/admin/access` por HTTP/Auth y E2E de roles, empresa, portal, supervisores/dispositivos y sucursal ajena con snapshot. | No está demostrada la matriz por método para empleados, sucursales, horarios, credenciales y toda API. La matriz general no se repitió porque ejecuta PIN/escaneo/asistencia. |
| Carreras de membresía y autorización en todas las rutas/acciones | **PARCIAL** | La carrera de invitación y las sesiones obsoletas tras cambio de rol pasaron. No se han serializado y probado todos los handlers de escritura o las siete acciones. |

## Brechas locales restantes y siguiente cierre

Para solicitar cierre local todavía hace falta enlazar cada brecha P1 restante a una prueba ejecutada existente o nueva, sin duplicar matrices ya cubiertas. Priorizar las operaciones de escritura que validan autorización en un paso y mutan en otro: branches/schedules/assignments, cambios de supervisor/dispositivo y cambios de acceso; demostrar snapshots sin efectos ante denegación y alcance por sucursal. Mantener excluidos `/api/attendance/scan`, intentos/validación de PIN y escrituras de asistencia.

Las carreras no deben aprobarse solo mediante sleeps: usar locks/barreras observables o demostrar que el segundo control de autorización del lado SQL serializa el cambio. Para `chooseMembership`/`setAdminMembership`, extender la comprobación de cambio de rol únicamente si un hook estable permite observar la operación intercalada; el permiso efectivo debe probarse en la petición siguiente, no por el contenido del cookie.

## Revisión remota segregada (solo lectura), 2026-11-04

| Entorno | Ref y estado confirmado | Evidencia obtenida | Límite |
|---|---|---|---|
| Testing | `llxyziffgtqnzlguxhyt`, `QR-asistencia-testing`, `ACTIVE_HEALTHY`, PostgreSQL 17.11.0.003 | 27 migraciones listadas; versiones/nombres coinciden con los 27 archivos locales. Consulta `SELECT` de catálogo: 46 funciones `SECURITY DEFINER`, 45 políticas públicas, 25 tablas públicas con RLS; se observaron owners, `search_path` y EXECUTE por `anon`/`authenticated`/`service_role`; esquemas `auth`, `private`, `public`, `storage`. | No se compararon hashes de todos los cuerpos, expresiones `USING`/`WITH CHECK`, configuración Auth ni todos los grants de tablas/secuencias. La presencia de QR-003 en el ledger no valida su conducta; PIN/scan no se ejecutaron. |
| Production | `jawdrhewabqajxnswhkn`, `QR-asistencia`, `INACTIVE` | `get_project` confirmó ref/estado. `list_migrations` falló con timeout de conexión y `list_tables` indicó que la base posiblemente no está accesible. No se envió SQL ni se intentó reactivar. | Sin lectura de catálogo. No se infiere paridad con Testing ni con `main`; revisión pendiente cuando esté disponible. |

La consulta SQL a Testing fue exclusivamente `SELECT` sobre catálogos de PostgreSQL; no se leyeron tablas de negocio ni se ejecutó DDL/DML. La herramienta de tablas devolvió metadatos y conteos agregados, no filas. Los refs se verificaron antes de consultar cada proyecto.

### Actualización de catálogo remoto y validación local — 2026-11-04

Esta adenda registra la revisión posterior del mismo día y sustituye cualquier cifra de catálogo menos reciente de arriba; no convierte la inspección en una auditoría completa.

**Testing (`llxyziffgtqnzlguxhyt`):** se volvió a verificar el ref y estado `ACTIVE_HEALTHY`, PostgreSQL 17.11.0.003. `list_migrations` devolvió 27 migraciones; sus versiones y nombres corresponden al manifiesto canónico local. El `SELECT` de catálogo encontró 46 funciones `SECURITY DEFINER`, propietarias de `postgres` y con `search_path` vacío; no se observó EXECUTE para `anon` en ese conjunto. Se capturaron hashes MD5 de las definiciones remotas, pero no se compararon con definiciones canónicas locales, por lo que la equivalencia de cuerpos no queda demostrada. El inventario devolvió 45 políticas permisivas y 32 tablas en `public`/`private`: 30 con RLS habilitada y ninguna con `FORCE ROW LEVEL SECURITY`; `private.bootstrap_requests` y `private.device_token_hashes` aparecen sin RLS. Una consulta directa confirmó que `anon`, `authenticated` y `service_role` no tienen SELECT directo sobre las tablas privadas de credenciales/tokens verificadas, pero el resumen de grants de tablas/secuencias fue parcial. Se recuperaron las expresiones `USING`/`WITH CHECK`, sin una validación dinámica exhaustiva de las 45 políticas. No se leyó configuración Auth ni filas personales. No se realizó ninguna escritura.

**Producción (`jawdrhewabqajxnswhkn`):** la consulta de metadatos confirmó `INACTIVE`. `list_migrations` terminó en timeout y `list_tables` indicó que la base posiblemente no está accesible. No se pudo obtener historial, cuerpos, grants, RLS ni configuración Auth. No se reintentó ni se infirió paridad con Testing.

**Validación local final:** el runner `--authorization-races-only` pasó 148 aserciones con datos sintéticos en dos empresas; se verificaron rutas administrativas, supervisores/dispositivos y emisión/rotación/revocación de credenciales QR, con snapshots y limpieza. No se consultó GET de estado QR porque también revela `pinConfigured`; no se llamó PIN, escaneo o asistencia. Las suites locales dirigidas adicionales pasaron 59/59 y 115/115; E2E 23/23, unitarias compatibles 67/67, lint, typecheck, build aislado, `node --check` y `git diff --check` pasaron. `npm test` y matriz general se omitieron por incluir PIN/scan/asistencia fuera del alcance. E2E tuvo un timeout transitorio en una repetición previa; la repetición final pasó.

## GitHub y decisión

PR #31 fue integrado en `main` como `49025160f2d9765d00c73aeb2e2bdfda4fc9744c`. El run automático posterior al merge #41955351473 terminó `SUCCESS` en ese SHA. No valida los cambios locales de esta rama. GitHub se consultó solo en modo read-only para verificar merge/CI; no hubo acceso a Testing o Producción. En esta tarea no hubo commit, push, PR, merge ni despliegue.

## Revalidación local de cierre en HEAD base + diff local

| Comando | Resultado real |
|---|---|
| `npm run test:security:authorization-races:local` | 27 aserciones PASS; cleanup y preservación de recursos Docker PASS. |
| `npm run test:security:rpc-ci:local` | 115/115 pgTAP PASS; cleanup PASS. |
| `npm run test:security:phase10-residual:local` | 59/59 pgTAP PASS; `ROLLBACK`, cleanup y preservación Docker PASS. |
| `QR004_CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e` | 23/23 PASS; cero solicitudes a `/api/attendance/scan`; cleanup y preservación Docker PASS. |
| Suites unitarias permitidas (reports, scanner context, credentials, employee portal, user access, auth flow, deployment, Server Action cookies) | 67/67 PASS. |
| `npm run lint`; `npm run typecheck`; build en copia temporal sin `.env*`; `node --check tests/qr004-auth-matrix.local.integration.mjs`; `git diff --check` | PASS. |

La primera ejecución E2E no halló el Chromium empaquetado por Playwright y falló antes de abrir tests. Se repitió con Google Chrome ya instalado; no se instaló software. `npm test` no se ejecutó porque incluye las suites de asistencia y PIN. La matriz general tampoco se ejecutó: crea fixtures de sesiones/eventos y llama a `/api/attendance/scan` y `scan_employee_attendance` con un PIN válido. Ambas quedan **BLOCKED por la exclusión QR-003**, no como PASS. El build informó la advertencia conocida de 27 archivos de `node_modules` fuera de `outputFileTracingRoot`; compilación y rutas terminaron correctamente.

El workflow `.github/workflows/ci.yml` no se modificó ni inició. Su matriz general conserva el scan sintético con PIN válido. Publicar el diff iniciaría Actions y requiere autorización explícita para ese run; no se hizo push.

**Decisión:** **NOT READY** para cierre local o global. R10-05 y carreras de autorización siguen parciales; la revisión Testing es parcial y Production no es accesible. QR-004 permanece **En curso**, QR-003 permanece **P0/NO-GO**, y QR-011 permanece **P1/Bloqueada**, dependiente de QR-003 y QR-004.

## Revalidación ampliada posterior — 2026-11-04

Los conteos previos de 27 aserciones en el modo HTTP/Auth fueron reemplazados por la ejecución ampliada siguiente. La base siguió siendo el commit `49025160f2d9765d00c73aeb2e2bdfda4fc9744c` con cambios locales sin commit; no hay un SHA nuevo que represente el diff.

### Cobertura HTTP/Auth prioritaria

`npm run test:security:authorization-races:local` terminó con **148 aserciones PASS** en un stack Supabase local desechable, con Auth de Next y datos sintéticos de dos empresas. La selección cubre:

- `/api/admin/access`: lecturas anónimas/de rol/tenant denegadas, ID extranjero, `company.manage` revocado, snapshots de membresía/auditoría y escritura autorizada con una sola auditoría.
- `/api/branches`: GET/POST/PATCH, usuario anónimo, supervisor, empresa ajena, sucursal inactiva, zona horaria inválida, `company.manage` revocado, snapshot ante rechazos y cambios permitidos.
- `/api/employees` y `/api/employees/[id]`: GET/POST/PATCH, rol/tenant, filtro de sucursal ajena, ID ajeno, destino de sucursal inactivo/ajeno, snapshot y lecturas/escrituras permitidas.
- `/api/schedules`, `/api/schedules/[id]` y `/api/schedules/assignments`: filtros de rol/tenant, sucursales ajenas/inactivas, `schedules.manage` revocado, employee IDs ajenos, lectura filtrada, snapshots y operaciones autorizadas.
- `/api/supervisors`: lectura y asignación de sucursal, empresa/sucursal ajena, `devices.manage` revocado y snapshots antes/después.
- `/api/supervisor-devices` y `/api/supervisor-devices/[id]`: lectura, revisión de solicitud, autorización, denegaciones por rol/permiso/empresa, revocación y repetición sin auditoría duplicada.
- `/api/employees/[id]/qr`: emisión, rotación y revocación del token QR; el almacenamiento solo conserva hash, y rechazos no alteran credenciales ni auditoría. No se usó GET QR porque la respuesta agrega estado de configuración del PIN. Ninguna ruta/RPC PIN fue llamada.
- Membresía administrativa inactiva; la ejecución verifica denegaciones y que snapshots de datos administrativos/auditoría permanezcan sin cambios.

El runner confirma teardown del stack temporal y preservación de recursos Docker preexistentes. Su modo enfocado no enlaza proyectos remotos, no lee `.env.local`, no crea sesiones/eventos de asistencia y no ejecuta PIN, scan ni RPC de asistencia. La carrera observada sigue siendo la secuencia controlada invitación-revocación/aceptación; esta evidencia no cubre todas las intercalaciones de membresía, rol, sucursal, dispositivos o cambios de permiso.

### Validaciones actuales

| Comando | Resultado observado |
|---|---|
| `npm run test:security:authorization-races:local` | 148 aserciones PASS; teardown y preservación Docker PASS. |
| `npm run test:security:rpc-ci:local` | 115/115 pgTAP PASS; cleanup PASS. |
| `npm run test:security:phase10-residual:local` | 59/59 pgTAP PASS; rollback, teardown y preservación Docker PASS. |
| `QR004_CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e` | Última repetición 23/23 PASS; sin solicitudes a `/api/attendance/scan`; teardown y preservación Docker PASS. Una repetición previa falló 1 de 23 por timeout esperando el control de cámara; el reintento pasó. |
| Suites unitarias compatibles | 67/67 PASS (reportes, scanner context, credenciales, portal empleado, user access, auth flow, deployment, sincronización de cookies Server Action). |
| `npm run lint`, `npm run typecheck`, build aislado, `node --check tests/qr004-auth-matrix.local.integration.mjs`, `git diff --check` | PASS; build aislado mantuvo advertencia conocida de 27 trazas fuera de `outputFileTracingRoot`, sin fallo de compilación. |

`npm test` no se ejecutó porque incluye suites de PIN/asistencia. `npm run test:security:matrix:local` tampoco: incluye sesiones/eventos y `/api/attendance/scan` con un PIN sintético válido. Ambos quedan **BLOCKED por el límite de QR-003**, no aprobados. No se ejecutaron Actions nuevos.

### Revisión remota y dictamen vigente

La revisión segregada de solo lectura del 2026-11-04 sigue parcial: Testing fue identificado como `llxyziffgtqnzlguxhyt` y `ACTIVE_HEALTHY`; se leyeron metadatos de migración y catálogo (27 migraciones, 46 funciones `SECURITY DEFINER`, 45 políticas y 25 tablas públicas con RLS), pero no se compararon todas las definiciones, expresiones RLS, grants o configuración Auth. Production (`jawdrhewabqajxnswhkn`) fue identificado como `INACTIVE`; las lecturas de catálogo fallaron por timeout/no disponibilidad. No se infiere paridad entre entornos.

**Dictamen vigente: NOT READY para cerrar QR-004.** La ampliación reduce brechas R10-05, pero no completa los 33 Route Handlers/50 métodos, filtros y carreras relevantes. No se han probado exhaustivamente las siete Server Actions. La revisión remota por entorno no está completa: faltan comparación canónica de cuerpos, revisión completa de políticas/grants y configuración Auth en Testing, y Producción está inaccesible. Mantener QR-004 **En curso**, QR-003 **P0/NO-GO** y QR-011 **P1/Bloqueada**, dependiente de QR-003 y QR-004. No hubo commit, push, PR, merge, Actions ni despliegue.

### Revisión actualizada — 2026-11-05

Sobre HEAD inicial `4c8d2d57413df1c8840365951620781d7d8e899b` se reprodujo localmente una carrera de autorización en alta de dispositivo: la solicitud podía completarse durante una revocación de membresía sin esperar a que acabara la limpieza. El fix mínimo añade `FOR SHARE` a membresía, asignación y sucursal en la selección autorizadora de `request_supervisor_device`. Las regresiones HTTP/Auth locales cubren desactivación, cambio de rol y retiro de sucursal concurrentes; después del commit de revocación, el POST devuelve 403 y no deja solicitud ni auditoría de solicitud. La empresa sintética B conserva su snapshot. El estado previo de aprobación ya revalida el acceso y no se creó dispositivo autorizado.

La migración es aditiva y local; Testing la tiene pendiente y su definición remota actual sigue siendo la versión sin lock. Testing no se modificó. La revisión de Producción sigue bloqueada por `INACTIVE`/timeout. Por tanto, el fix local no resuelve por sí solo el estado remoto ni habilita cierre o lanzamiento.

Validaciones actuales: modo de carreras **180 PASS**; matriz general **201/201 pgTAP + HTTP/Auth PASS**; RPC restringidas **115/115**; Fase 10 **59/59**; E2E **23/23**; `npm test` PASS (una omisión local GnuPG por socket); lint, typecheck, build aislado, `node --check`, `git diff --check` PASS. La matriz general usó PIN sintético válido solo en stack local desechable por autorización expresa. Hubo colisión de puerto en primer intento RPC y cleanup correcto; reintento SUCCESS. El build muestra solo la advertencia conocida de 27 trazas de `node_modules` fuera del root aislado.

La revisión remota read-only halló Testing activo con 27 migraciones, dos migraciones locales de dispositivos pendientes, 46 funciones SECURITY DEFINER, 45 políticas, RLS en 25/25 relaciones públicas y 5/7 privadas, cero funciones definer ejecutables por anon y un `SELECT` sobrante de anon en `company_pay_period_rules` sin política visible para ese rol. No pudo verificarse configuración Auth administrada ni cada grant/cuerpo de función contra una instancia local de referencia. Production `jawdrhewabqajxnswhkn` sigue `INACTIVE`; migraciones y catálogo no accesibles. No se infiere paridad.

La matriz por método (33 rutas/50 métodos) está en [QR-004-R10-05-METHOD-MATRIX.md](QR-004-R10-05-METHOD-MATRIX.md). La evidencia por método es parcial; siguen faltando escenarios/filtros/carreras para operaciones y Server Actions, y casos QR/PIN/asistencia están fuera de alcance. **Dictamen NOT READY**: QR-004 En curso, QR-003 P0/NO-GO, QR-011 P1/Bloqueada.

### Continuación del cierre — revisión del SHA cfce669 (2026-11-05)

CI #42088289847 para `cfce6698897a3931a6de5d14c73b2daa29f1ba08` terminó SUCCESS; `verify` pasó instalación, lint, typecheck, npm test, reportes, matriz general, RPC, Fase 10, E2E y build. La matriz general incluye el scan con PIN válido sintético autorizado exclusivamente en stack efímero CI.

El runner local `--authorization-races-only` pasó **194 aserciones**. Además de la cobertura de carreras HTTP/Auth documentada antes, se probó `DELETE /api/schedules/[id]` con rechazo anónimo, administrador de otra empresa y permiso `schedules.manage` revocado, snapshots A/B sin cambios, eliminación autorizada de una plantilla sintética sin referencias y audit confirmado. Cleanup retiró el proyecto desechable y preservó recursos Docker existentes. El modo no creó asistencia ni invocó PIN/scan. La suite local de catálogo ejecutó 26+27 pgTAP aserciones y pasó.

Testing, en lectura de catálogos, tiene 27 migraciones mientras la rama contiene 29. De 46 funciones `SECURITY DEFINER`, cuatro hashes de cuerpo difieren: `private.scanner_device`, `public.request_supervisor_device`, `public.review_supervisor_device_request` y `public.set_supervisor_branch`; owner, `search_path` y privilegios EXECUTE efectivos coinciden. Las diferencias corresponden a cambios locales de dispositivo que no están registrados en el historial remoto. La consulta devolvió 45 políticas RLS, pero no se produjo una comparación de todos los predicados/grants con un catálogo local actual. Auth administrado no estuvo disponible. `company_pay_period_rules` tiene un grant SELECT para anon, RLS activa, una política únicamente para authenticated y cero política permisiva para anon; no se consultaron filas. El grant es innecesario según ese catálogo y necesita decisión/cambio separado.

Producción se confirmó `INACTIVE`; migraciones, funciones, grants, políticas y Auth no pudieron comprobarse. No se infiere paridad. No hubo escritura o cambio de configuración remoto.

Nota de validación: una invocación accidental de `npm test -- --help` ejecutó el chain local con salida suprimida; no es un resultado utilizable ni cuenta como PASS.

**Dictamen:** **NOT READY**. R10-05 mantiene huecos por operación/filtro/carrera; falta comparar completamente RLS/grants/Auth de Testing y la revisión de Producción está bloqueada. QR-004 permanece En curso, QR-003 P0/NO-GO y QR-011 P1/Bloqueada.


### Revisión remota de solo lectura — 2026-11-05, posterior al CI del SHA 719a319

El CI general terminó SUCCESS para el commit funcional `83a643847961aca31294390a231b2608353600cd` ([run 42097068385](https://github.com/Diego19-hub/QR-asistencia/actions/runs/42097068385)) y para este commit documental ([run 42099012378](https://github.com/Diego19-hub/QR-asistencia/actions/runs/42099012378)). Incluyeron la matriz general en stack desechable; no se consultó Testing ni Producción desde esos jobs.

**Testing** `llxyziffgtqnzlguxhyt` continúa `ACTIVE_HEALTHY`. El ledger registra 27 migraciones frente a las 29 de esta rama. Las dos ausentes son `20261105044818_supervisor_device_request_revocation_guard` y `20261105172831_supervisor_device_request_authorization_lock`. En la revisión de catálogo: 25/25 tablas públicas tienen RLS; hay 45 políticas públicas; `anon` tiene grant SELECT en `company_pay_period_rules`, pero no hay política aplicable a `anon` para esa tabla; ninguna función SECURITY DEFINER pública resulta ejecutable por `anon`, y el rol `anon` no tiene USAGE del esquema `private`.

Cuatro cuerpos SECURITY DEFINER que ya se habían identificado por hash como distintos son `private.scanner_device`, `public.request_supervisor_device`, `public.review_supervisor_device_request` y `public.set_supervisor_branch`. La inspección focal actual confirma que Testing todavía no incluye la comprobación de sucursal activa de `scanner_device`, ni el `FOR SHARE` de `request_supervisor_device` y `review_supervisor_device_request`. La función remota `set_supervisor_branch` sí muestra limpieza de solicitudes y revocación de dispositivos, pero su cuerpo difiere del canónico local; no se declara equivalencia completa. La revisión de expresiones RLS, todos los grants y la configuración Auth administrada sigue incompleta. El resultado sobre `anon` es de catálogo, no una consulta de filas.

**Producción** `jawdrhewabqajxnswhkn` se confirmó `INACTIVE`; por esa razón no fue posible leer su catálogo en esta sesión. No se infiere paridad con Testing ni con la rama local. No se aplicaron migraciones, no hubo DDL/DML ni cambios de configuración en ninguno de los dos proyectos.

**Dictamen:** QR-004 permanece **En curso / NOT READY**. Aún faltan cobertura dinámica de otros métodos y carreras, comparación canónica completa de Testing (incluida Auth), y recuperación/revisión de Producción. QR-003 sigue **P0/NO-GO** y QR-011 **P1/Bloqueada**.

### Corrección del rango de fechas de horas extra — 2026-11-05

La revisión de `GET /api/schedules/overtime` encontró que el esquema solo comprobaba el formato `AAAA-MM-DD`; una fecha sintácticamente correcta pero imposible podía llegar a PostgREST y producir un error de consulta en vez de 400. El handler ahora comprueba también que la fecha sobreviva una conversión ISO UTC sin normalizarse a otro día. El runner HTTP/Auth incorpora `from=2026-02-30` y espera 400 antes de consultar datos.

CI general del SHA funcional `71dce32b21023c357772e8b1021ef08808c82e4a` terminó SUCCESS ([run 42106689611](https://github.com/Diego19-hub/QR-asistencia/actions/runs/42106689611)): lint, typecheck, npm test, restauración local, reportes, matriz general, RPC, Fase 10, E2E y build. La prueba usa solo infraestructura y datos desechables; no toca Testing ni Producción. La matriz se actualiza con ese resultado en el commit documental siguiente.

El hallazgo corrige un caso de entrada del endpoint, pero no cierra R10-05 ni cambia el estado de las diferencias remotas de Testing o la inaccesibilidad de Producción. QR-004 sigue **En curso / NOT READY**.
