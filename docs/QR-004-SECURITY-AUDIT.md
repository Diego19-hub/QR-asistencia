# QR-004 — Auditoría de seguridad multiempresa

Fecha: 30 de octubre de 2026<br>
Base de trabajo: `f48a189a92cbff7d0a822a05a3fcc242469cf2f2` (`main`, PR #17 integrado); esta actualización registra pruebas dinámicas locales de Server Actions y sesiones en `test/qr-004-server-actions-session-matrix`.

## Resumen ejecutivo

Las fases anteriores confirmaron y corrigieron brechas de alcance en políticas SQL. La auditoría dinámica del PR #18 demostró una segunda brecha: aunque la UI y `acceptInvitation` comprobaban `app_metadata`, ambas RPC de aceptación permitían eludir esa barrera llamándolas directamente con un JWT Auth válido. La cuenta seguía requiriendo correo confirmado y ser el destinatario exacto; no se observó escalada de rol ni acceso entre empresas. La validación ahora reside también dentro de PostgreSQL antes de cualquier efecto.

QR-004 **permanece en curso**. La matriz local pasó 201/201 aserciones pgTAP, pruebas HTTP/Auth y acciones dinámicas Next.js con Auth y PostgreSQL desechables. Esta extensión añade intentos RPC autenticados sobre cuentas invitadas, denegaciones sin efectos, aceptación después del flujo real de contraseña y reintento tras fallo simulado del API administrativo Auth. No se consultó ni modificó Testing o Producción. Siguen pendientes combinaciones de otras rutas/RPC y la revisión remota segregada; esta evidencia no certifica catálogos ni configuración desplegados.

## Alcance y método

- Inspección estática de `src/app/api/**`, rutas protegidas, helpers Auth, alcance administrativo/de empleado, migraciones, RLS, grants, funciones privilegiadas y pruebas existentes.
- Ejecución local de lint, TypeScript, suite Node, integración Supabase/PostgreSQL aislada para report-export lease y build.
- La integración SQL creó un proyecto local con identificador aleatorio, puertos libres y servicios limitados a loopback. Sus propias guardas rechazaban los refs de Testing y Producción. El resultado informó el borrado de contenedores, red y volúmenes de prueba; el stack preexistente `codigo_QR` permaneció intacto.
- La fase HTTP reutilizó ese proyecto desechable, creó Auth users, empresas, membresías y expedientes sintéticos, e inició una copia temporal de Next.js con una lista permitida de variables. Los endpoints recibieron cookies SSR emitidas por Auth local. El runner conservó Mailpit local para correos de invitación; no configuró Resend ni credenciales SMTP externas. `.env.local` se excluyó del servidor local de pruebas y de la copia aislada del build. Un primer intento de build en el repo se canceló al detectar Next.js que cargaría `.env.local`; no llegó a compilar páginas y se repitió correctamente en la copia temporal limpia.
- Las solicitudes denegadas se contrastaron con snapshots PostgreSQL de invitaciones, auditoría, membresías y dispositivos. La pila temporal, los usuarios/datos sintéticos, el servidor Next.js y el directorio temporal se eliminan al finalizar incluso si falla la matriz.
- Para esta fase, los snapshots también incluyen sesiones, eventos, ajustes de asistencia, plantillas/días/descansos/asignaciones y reglas de descansos. El escáner se probó solo hasta el rechazo de dispositivo: el RPC valida primero el dispositivo, por lo que no se evaluó QR ni PIN y no se generaron intentos fallidos.
- No se ejecutó `tests/security-jwt-matrix.integration.mjs`: `docs/TESTING.md` especifica que apunta a Testing. No se ejecutaron operaciones, consultas, intentos PIN, migraciones ni pruebas de ataque en proyectos remotos.
- La revisión del SQL corresponde al repositorio en el SHA indicado. No equivale a comprobar los catálogos, ACL o configuración desplegada actualmente.

## Arquitectura de seguridad observada

1. Los clientes de servidor/navegador usan la publishable key; el cliente administrativo con `SUPABASE_SERVICE_ROLE_KEY` está marcado `server-only` y se limita al flujo servidor de invitaciones (`src/lib/supabase/auth-admin.ts`). No se identificó una importación desde código cliente.
2. `resolveAdminScope` valida usuario con `auth.getUser()`, consulta solo sus membresías activas `owner`/`admin` y rechaza un `companyId` que no pertenezca a ese conjunto (`src/lib/admin/scope.ts`). Las rutas administrativas consultadas reutilizan ese helper y filtran datos por la empresa derivada.
3. Las rutas de escáner/portal comprueban identidad, rol y membresía activa. Las funciones de escáner ligan usuario, empresa, sucursal y dispositivo; el portal busca el expediente asociado a `auth.uid()` y empresas con membresía activa de empleado.
4. Las migraciones habilitan RLS en las tablas expuestas, revocan escrituras generales de roles API y reabren operaciones concretas con políticas de permisos/tenant. Las vistas de asistencia declaran `security_invoker=true`. Las tablas de credenciales y dispositivos privados están en `private`, con grants restringidos.
5. Las RPC `SECURITY DEFINER` revisadas establecen `search_path` vacío y, para las RPC públicas relevantes, comprueban identidad, membresía activa, rol/permisos y empresa/sucursal. No se clasificó `SECURITY DEFINER` por sí solo como vulnerabilidad.
6. Los enlaces QR-001 solo apuntan a rutas fijas; no otorgan acceso. Los retornos Auth usan destinos permitidos y `APP_BASE_URL`, no un URL arbitrario de petición.

## Matriz actor × recurso

| Actor/estado | Datos de otra empresa | Escritura administrativa | Asistencia en escáner | Portal empleado | Resultado esperado y evidencia |
|---|---|---|---|---|---|
| Anónimo | Denegado | Denegada | Denegada | Denegado | `auth.getUser()` / RPC exigen sesión; la prueba local de lease confirmó rechazo anónimo. |
| Owner/admin activo de A | Denegado para B | Permitida en A según permiso efectivo | No concede escaneo por sí solo | No concede expediente | `resolveAdminScope`, filtros empresa y RPC/RLS. El RPC local de lease denegó company B. |
| Supervisor activo de A | Denegado para B | Denegada | Permitida solo con permiso, dispositivo y sucursal autorizados de A | Denegado | RPC de escáner valida membresía/dispositivo; suite scanner y report-lease local rechazó supervisor para operación administrativa. |
| Empleado activo de A con expediente ligado | Denegado salvo propio expediente | Denegada | Denegada | Solo su expediente/credencial/asistencia autorizada | `portal-scope.ts`, API de portal y políticas `auth_user_id = auth.uid()`. Pruebas unitarias de alcance aprobadas. |
| Rol insuficiente | Denegado | Denegada | Denegada | Denegado | Permisos efectivos se evalúan en API/RPC/RLS; la matriz JWT completa queda pendiente. |
| Membresía inactiva o revocada | Denegado en solicitudes posteriores | Denegada | Denegada; cambios de acceso revocan dispositivos asociados | Denegado | HTTP/Auth local rechazó membresía admin inactiva en asistencia/horarios; RLS rechazó la solicitud de corrección de supervisor revocado. |
| Usuario con varias membresías activas | Solo tenants autorizados | Solo empresa elegida y permiso concedido | Solo membresía/dispositivo elegido | Solo cuenta/empresa de empleado permitida | Cookies contienen ID de membresía, que se vuelve a resolver contra usuario y estado activo; la selección es explícita cuando hay múltiples opciones. |
| Supervisor de otra sucursal | Datos/operaciones fuera de alcance denegados | Denegada | Denegado para sucursal ajena | Denegado | pgTAP local: el supervisor solo lee empleados en su sucursal; RPC directa del escáner rechaza un QR de otra sucursal. |

Esta matriz describe controles observados y evidencia disponible; las filas que no tienen una prueba dinámica ejecutada en este turno no se consideran demostradas para todas las rutas.

## Hallazgos

### Hallazgos de explotación confirmada en esta revisión

#### QR004-A1 — Solicitudes de corrección sin alcance de sucursal

- **Severidad:** media; afecta la integridad del flujo de solicitudes, no permite modificar directamente los eventos originales.
- **Evidencia:** la política previa `attendance_adjustments_submit` solo exigía `requested_by = auth.uid()` y `has_company_permission(company_id, 'attendance.adjust')`. No relacionaba `session_id` con una sucursal autorizada. La política previa de lectura también permitía al solicitante leer su propia solicitud sin comprobar esa sucursal.
- **Validación:** se revisó la definición SQL previa y se añadió una regresión local con supervisor sintético asignado a A y una jornada de otra sucursal de la misma empresa. La política corregida rechaza el insert con SQLSTATE `42501`, oculta una solicitud sintética histórica de esa sucursal y permite crear una solicitud dentro de la sucursal asignada. La denegación deja iguales ajustes y auditoría.
- **Corrección:** `private.can_manage_branch` exige el permiso específico y, para administradores, el permiso `company.read`; para supervisores exige también membresía activa y asignación explícita a la sucursal. RLS aplica esta guarda a inserción y lectura de solicitudes propias/revisión.
- **Alcance de revisión:** `review_attendance_adjustment` conserva sus controles actuales: identidad autenticada, permiso `attendance.review_adjustments` en la empresa, prohibición de que quien solicitó revise su propia solicitud y estado pendiente, con bloqueo de fila. El permiso se evalúa a nivel de empresa; la RPC no limita al revisor por sucursal. La matriz confirmó que un owner sintético sin asignación de supervisor puede revisar una solicitud de otra sucursal de la misma empresa. No se cambió el contrato ni se encontró evidencia para hacerlo.
- **Limitación de evidencia:** no se consiguió ejecutar el caso de escritura contra el SQL previo: el primer arranque local se detuvo por colisión de un puerto publicado por otro stack local, antes de crear fixtures. El bypass previo queda confirmado por la política estática; la prueba dinámica repetible cubre el estado corregido.

#### QR004-A2 — `company.read` sustituía permisos específicos en escrituras por sucursal

- **Severidad:** media; podía permitir a una membresía administrativa con override denegado seguir escribiendo horarios mediante `company.read`.
- **Evidencia:** la función previa `private.can_access_branch` devolvía verdadero por `has_company_permission(company.read) OR (permiso específico AND sucursal asignada)`. Las políticas de escritura de plantillas/asignaciones invocaban esa función con `schedules.manage`, por lo que la primera rama eludía un override `schedules.manage=false`.
- **Validación:** la matriz local denegó `POST /api/schedules` y un insert PostgREST directo con override sintético `schedules.manage=false`; ambos devolvieron rechazo (`403` / SQLSTATE `42501`) y los snapshots de horarios/auditoría no cambiaron.
- **Corrección:** la nueva guarda `private.can_manage_branch` requiere el permiso específico antes de permitir el alcance de empresa o sucursal. Se aplica a plantillas, días, asignaciones y descansos de horario, respetando el patrón de transacción RLS existente.
- **Revisión de políticas:** el inventario local encontró solo las siete políticas permisivas esperadas para escrituras: una `FOR ALL` para cada tabla de plantillas, días y asignaciones; tres políticas (insert/update/delete) para descansos; y la política insert de ajustes. No hay otra política permisiva de escritura que eluda la guarda; las políticas adicionales encontradas en tablas de horario son de lectura (`SELECT`). Se añadió una aserción pgTAP para detectar políticas de escritura extra o que no invoquen `can_manage_branch`.
- **Regresión dinámica:** con Auth/PostgREST local se confirmó que los cuatro tipos de inserción y actualización directa funcionan con permisos válidos. Con `company.read` todavía permitido y override explícito `schedules.manage=false`, inserciones y actualizaciones en las cuatro tablas se rechazaron; la inserción de asignación también puede rechazarse antes en su trigger de validación porque el template no queda visible al miembro sin `schedules.manage`. Snapshots de datos y auditoría de ambas empresas quedaron idénticos.
- **Limitación de evidencia:** el caso pre-fix no se ejecutó dinámicamente; la evidencia del bypass se basa en las expresiones SQL previas y el catálogo de permisos versionado. La matriz prueba dinámicamente la denegación tras el cambio.

Los rechazos del resto de escenarios cubiertos pasaron en el stack local. Estos resultados no certifican los entornos remotos ni todas las APIs.

### Riesgos conocidos y limitaciones

#### QR004-R1 — Persistencia de fallos del PIN pendiente (fuera de alcance de esta fase)

- **Severidad:** alta para la operación de asistencia mientras se mantenga el comportamiento legacy; estado remoto no confirmado en este turno.
- **Evidencia:** `TASKS.md` y `docs/PIN-LOCKOUT-FIX.md` registran la migración `20261018120000_persist_employee_pin_failures.sql` y el comportamiento legacy conocido. El estado de Testing no se revalidó en esta fase.
- **Impacto/condición:** la corrección sigue pendiente de confirmación en Testing y el propietario ha pospuesto QR-003. No se hicieron consultas, pruebas, respaldos ni escrituras remotas.
- **Recomendación:** conservar el código y la migración; mantener el P0 abierto y no considerar corregido el entorno Testing. No iniciar el trabajo aplazado en el marco de QR-004.
- **Regresión requerida:** el test local de PIN debe comprobar contador, quinto intento, expiración, concurrencia y ausencia de evento. No lanzar intentos contra empleados reales ni remotos.

#### QR004-R2 — Cobertura restante fuera de la matriz SQL y HTTP local

- **Severidad:** baja como riesgo de cobertura; no es una vulnerabilidad demostrada.
- **Evidencia:** ocho suites pgTAP (192 aserciones en la extensión del 30-oct-2026) y Route Handlers/páginas Next con Auth sintético. La matriz cubre asistencia, horarios, correcciones mediante RLS/RPC, escrituras directas permitidas/denegadas en cuatro tablas, APIs de empleados/sucursales/supervisores/dispositivos, estado/emisión/regeneración/revocación QR, `/api/company`, `/api/dashboard/summary`, rechazos del endpoint PIN y accesos/invitaciones. No se cubren todas las APIs, Server Actions ni recorridos de navegador. Se omitió `tests/security-jwt-matrix.integration.mjs` porque apunta a Testing. No se ejecutó la suite DB de bloqueo PIN porque QR-003 quedó pospuesta.
- **Impacto/condición:** comportamientos fuera de las rutas y escenarios nombrados siguen sin evidencia dinámica en esta matriz.
- **Recomendación:** mantener el runner local en CI; continuar por operaciones restantes de reglas/horas extra. No existe Route Handler Next para solicitudes/revisión de correcciones; se probó insert vía PostgREST/RLS y la RPC real de revisión, sin inventar endpoint. Para Server Actions usar harness Next estable; no fabricar peticiones HTTP. La revisión remota, si se vuelve a priorizar, requiere autorización independiente y lectura segregada por entorno.
- **Regresión requerida:** conservar pruebas SQL/RPC, Route Handlers y snapshots de cero cambios colaterales ante denegaciones; los Server Actions continúan con sus pruebas unitarias y requieren un mecanismo de integración estable antes de ejercitarse dinámicamente.

#### QR004-R3 — Configuración de producción y Testing no inspeccionada

- **Severidad:** media como limitación de alcance.
- **Evidencia:** esta ejecución fue solo local y estática. `SECURITY-AUDIT.md` contiene snapshots previos de Testing, no evidencia del estado actual. Producción queda fuera de alcance.
- **Impacto/condición:** cambios manuales de ACL, configuración Auth o migraciones posteriores podrían crear divergencia no visible en Git.
- **Recomendación:** separar una revisión de solo lectura por entorno con autorización, confirmar project ref independientemente y consultar historial, funciones, grants, RLS, configuración de Auth/redirects y asesores. No asumir que Testing y Producción son iguales.

#### QR004-R4 — RPC con privilegio elevado requieren cobertura continua

- **Severidad:** baja como riesgo residual de regresión, no como bypass actual confirmado.
- **Evidencia:** las funciones `SECURITY DEFINER` públicas conceden `EXECUTE` a `authenticated`, por lo que el cliente autenticado puede invocarlas directamente. Las implementaciones inspeccionadas aplican controles internos y `search_path` vacío; el acceso no depende del ocultamiento de UI.
- **Impacto/condición:** si una futura edición elimina una guarda de empresa, permiso o identidad, la función puede saltarse RLS debido a su contexto privilegiado.
- **Recomendación:** mantener guardas internas; revisar función, owner, configuración, ACL y política de cada cambio SQL. Agregar pruebas negativas directas por RPC para empresas ajenas, rol insuficiente, membresía inactiva y rol anon.

## Evidencia estática por dominio

- **Sesión/cookies:** el cliente SSR usa `auth.getUser()`; las cookies se escriben `httpOnly`, `sameSite=lax`, `secure` en producción/HTTPS. La cookie de membresía es solo un selector: el servidor la compara con membresías leídas para el usuario. El `proxy` refresca sesión; cada ruta debe conservar su propia autorización.
- **Rutas API:** rutas administrativas inspeccionadas usan `resolveAdminScope`, esquema Zod en cuerpos sensibles y filtros `company_id`. Rutas de QR/PIN delegan a RPC y no devuelven hash/token. Rutas escáner comprueban origen, sesión, cookie de dispositivo y RPC. La revisión de endpoints fue estática, no un fuzz de todas las entradas.
- **SQL/RLS:** no se encontraron vistas nuevas sin `security_invoker`; las vistas principales de totales están marcadas. RLS de datos expuestos deriva permiso de membresía activa. Las escrituras de `attendance_events`/`sessions` se canalizan por funciones, no por grants DML genéricos a clientes.
- **QR/PIN/dispositivo:** QR se persiste como hash, la emisión rota el valor anterior y la revocación invalida; PIN se guarda como bcrypt y el bloqueo limita cinco fallos/15 minutos en la corrección versionada; token de dispositivo se persiste como hash y su RPC valida empresa, supervisor, membresía y sucursal. QR-003 sigue siendo riesgo de despliegue hasta verificar Testing.
- **Redirects/Auth:** destinos son rutas fijas; URLs de Auth salen de `APP_BASE_URL` validada. La confirmación de OTP es POST same-origin y añade `no-store`, `no-referrer` y CSP.
- **Auditoría/integridad:** triggers mantienen `audit_log`; claves foráneas compuestas y funciones de eventos imponen relación tenant/empresa, secuencia e idempotencia.

## Pruebas ejecutadas

| Comando | Resultado |
|---|---|
| `npm run lint` | Aprobado (código 0). |
| `npm run typecheck` | Aprobado (código 0). |
| `npm test` | Aprobado: 80 pasaron, 1 fue omitida (prueba GnuPG; el sandbox denegó el socket del agente). Total: 81. Persisten avisos Node `MODULE_TYPELESS_PACKAGE_JSON`; sin fallos. |
| `npm run test:reports:lease:local` | Aprobado (14/14 controles): proyecto Supabase desechable, migraciones locales, 13 pgTAP, Auth/JWT sintéticos, rechazo cross-tenant/rol/anónimo, carrera concurrente y HTTP/exportación. El script confirmó limpieza del stack/volúmenes. |
| `npm run test:security:matrix:local` | Aprobado en revisión del PR #14: 8 suites pgTAP, 187/187 aserciones, proyecto local `qr004_disposable_007cfe6664ea`. Incluye políticas de escritura de RLS, permisos efectivos, guarda `SECURITY DEFINER`/`search_path`/grants, usuarios sintéticos A/B y limpieza completa; el runner preservó los recursos Docker preexistentes. |
| `npm run test:security:matrix:local` (HTTP/Auth) | Aprobado. Además de rutas ya cubiertas de acceso, empleados, sucursales, supervisores, dispositivos, auditoría e invitaciones, se probaron `GET /api/attendance`, `GET /api/attendance/[id]`, rechazo `POST /api/attendance/scan`, `GET/POST /api/schedules`, `PATCH /api/schedules/[id]`, `GET/POST /api/schedules/assignments` y `GET /api/schedules/calendar`. Con `company.read` permitido y `schedules.manage` revocado, las inserciones/actualizaciones directas en `schedule_templates`, `schedule_template_days`, `schedule_assignments` y `schedule_template_breaks` fueron rechazadas; todas las rutas de escritura directa funcionaron en la prueba con permiso válido. Se verificaron anonimato, roles, membresía inactiva, empresa seleccionada, sucursales e IDs ajenos, permisos directos por RPC/RLS, corrección en sucursal asignada, rechazo de otra sucursal, revisión de correcciones a nivel de empresa, entradas inválidas y snapshots sin efectos ante rechazos. El escaneo se detuvo antes de validar QR/PIN; no se generaron fallos PIN. Invitaciones previas mantuvieron HTTP 201/200 y Mailpit local. |
| `npm run build` | Aprobado (código 0), Next.js 16.4.0, en una copia temporal sin `.env*` y con variables Supabase sintéticas de loopback. Next avisó que 27 archivos standalone quedaron fuera del trazado porque `node_modules` estaba enlazado desde el repo; compilación, TypeScript y generación de rutas terminaron correctamente. El temporal se eliminó. |
| `npm run test:pin-lockout:db` | No ejecutado: requiere un workdir y URL PostgreSQL locales configurados como proyecto QR PIN desechable. No se reutilizó una instancia compartida ni se imprimieron variables. La prueba Node de PIN sí pasó dentro de `npm test`. |
| Matriz `tests/security-jwt-matrix.integration.mjs` | Omitida intencionalmente: su configuración apunta a Testing; no se ejecutaron pruebas remotas. |

La fase HTTP ejercita Route Handlers y páginas protegidas con Auth local real. La extensión del 30-oct-2026 también ejecuta formularios renderizados y procesados por Next.js para `signIn`, `signOut`, `signOutEmployee`, `chooseMembership`, `setAdminMembership`, `acceptInvitation` y `setInvitationPassword`. No se inventaron IDs internos ni se fabricaron peticiones HTTP al protocolo de acciones: Chrome headless usa formularios nativos de las páginas; una ruta auxiliar generada exclusivamente dentro de la copia temporal renderiza las acciones que no tienen un formulario independiente. Las solicitudes de corrección no tienen Route Handler en `src/app/api`; se validó la inserción directa por PostgREST bajo RLS y la RPC de revisión con permisos. `tests/auth-email-flow.test.mjs` conserva sus pruebas unitarias. Las rutas `/api/company` y `/api/dashboard/summary` se añadieron a la matriz local en la extensión del 30-oct-2026; siguen fuera de cobertura exhaustiva otras combinaciones de cada API, operaciones restantes de solicitudes/dispositivos y flujos de navegador. Esto no constituye una matriz completa de cada RPC, tabla y ruta.

## Recomendaciones priorizadas

1. **P0 de seguridad pendiente:** QR-003 está pospuesta por decisión del propietario; no se considera corregida ni aplicada en Testing. No continuar respaldos, autorizaciones ni despliegues de esa tarea hasta que se retome expresamente.
2. **P1 evidencia:** ampliar de manera priorizada las combinaciones que faltan en APIs/RPC locales; conservar el harness de Next para Server Actions y no usar el protocolo de acciones como petición manual.
3. **P1 entorno:** si se autoriza una auditoría remota de solo lectura, comparar por separado Testing y Producción; revisar refs, historial, cuerpos SQL, ACL, RLS y configuración Auth sin tratar snapshots anteriores como actuales.
4. **P2 mantenimiento:** mantener el runner SQL/HTTP en CI con fixtures efímeras; nunca inyectar secretos o datos personales en logs/artefactos.
5. **P2 revisiones futuras:** para cada RPC privilegiada, conservar una lista de funciones/ACL esperadas y comprobar cambios de `search_path`, owner, `EXECUTE`, identidad y alcance tenant.

## Estado de QR-002

La implementación y las regresiones de los canales correo/WhatsApp están integradas en `main` (PR #7); los flujos de destinatario, verificación Auth, expiración, revocación, reuso, carrera y envío local aparecen probados en la matriz. Para cerrar QR-002 falta completar la dependencia de QR-004 y aceptar su evidencia de autorización multiempresa. La pausa de QR-003 se mantiene separada; no autoriza el despliegue ni cambia el estado del PIN.

## Condiciones para cerrar QR-004

- Completar la matriz Auth/HTTP/RLS para las rutas API/RPC y combinaciones de rol/sucursal que sigan pendientes, con datos sintéticos y evidencia reproducible.
- Mantener cobertura dinámica de las Server Actions con el runtime real de Next.js; las acciones listadas en la sección de esta fase ya se ejecutaron localmente.
- No declarar la auditoría completa mientras falte la revisión remota segregada requerida por el plan o haya hallazgos altos sin resolver. Esa revisión no se realizó en esta tarea.

## Estado

**QR-004: en curso.** La matriz histórica del PR #14 pasó 187/187 pgTAP; extensiones anteriores pasaron 192/192 y esta pasó 201/201 en ocho suites. Esta fase añadió acciones dinámicas de Next.js y corrigió el uso de `user_metadata` controlable por el usuario para omitir la preparación de contraseña. Quedan pendientes otras combinaciones Auth/HTTP/RPC y la revisión remota segregada; no se declara cerrada la auditoría. Testing y Producción no se consultaron ni modificaron. QR-003 sigue pospuesta, P0 y NO-GO; no se llamó a la verificación de PIN ni se enviaron intentos incorrectos.

## Empresa y dashboard — matriz Auth/HTTP y PostgreSQL (30-oct-2026)

- **Ambiente y aislamiento:** `npm run test:security:matrix:local` levantó el proyecto aleatorio `qr004_disposable_320a3cc8c96e` con Supabase local, Auth, Mailpit y Next.js ligados a loopback. El runner confirmó que no hay proyecto enlazado remoto; los usuarios, empresas, sucursales, empleados, sesiones y eventos fueron sintéticos. El cliente local `service_role` se usó solo para preparar fixtures; snapshots se tomaron por conexión directa al PostgreSQL desechable. Todas las comprobaciones de autorización y RLS se hicieron con sesiones Supabase Auth y clientes `authenticated` de los usuarios sintéticos. Al terminar se eliminaron stack/datos temporales y se preservaron recursos Docker preexistentes.
- **`GET /api/company`:** anónimo `401`; supervisor y empleado `403`; `adminA` lee su empresa y obtiene `canManage=true`; seleccionar una empresa ajena devuelve `403`; un usuario con dos membresías owner/admin recibe `400` sin selector y puede leer cualquiera de sus dos empresas al elegirla. Un usuario con una sola empresa puede omitir el selector. Con override `company.manage=false`, el administrador conserva lectura (`200`, `canManage=false`). Las respuestas llevan `Cache-Control: no-store`.
- **`PATCH /api/company`:** el administrador autorizado actualizó nombre, razón social y RFC sintéticos (`200`) y el cambio quedó persistido. Cuerpo inválido (nombre vacío/largo, razón social larga, RFC inválido y propiedad extra `companyId`) devuelve `422`, con snapshot de empresa/auditoría intacto. `company.manage=false`, membresía inactiva y selección de otra empresa rechazan la escritura (`403`) sin cambiar empresa ni datos. Un `UPDATE` directo mediante el cliente authenticated funciona con permiso válido; con override denegado o membresía inactiva PostgreSQL lo rechaza (error `42501` o cero filas), confirmando la segunda barrera RLS y la política `companies_update` de `20261011004350_explicit_tenant_write_policies.sql`.
- **`GET /api/dashboard/summary`:** anónimo `401`; empleado y supervisor `403`; empresa mal seleccionada `403`; multiempresa exige selector (`400`) y el usuario puede seleccionar su segundo tenant autorizado. UUID de sucursal inválido devuelve `400`; sucursal de otra empresa o inactiva devuelve `403`. El resumen exitoso incluye `Cache-Control: no-store`, solo sucursales activas de la empresa y estadísticas cotejadas con las filas sintéticas por empresa y sucursal. Se verificaron sucursales `America/Mexico_City` y `Pacific/Kiritimati`; `operatingDate` y `dateReference` correspondieron a la zona horaria de la sucursal seleccionada, y `completedToday` se cotejó contra `local_work_date` y zona horaria de cada sesión.
- **Aislamiento de contenido:** el tenant A tuvo movimientos propios en sucursales distintas y el tenant B tuvo empleado, sesión y eventos exclusivos. El dashboard A no devolvió nombres ni IDs de eventos/sesiones del tenant B; su lista filtrada por sucursal excluyó movimientos de las otras sucursales. El dashboard B mostró su movimiento sintético y excluyó los de A. Con el cliente Auth directo de A, consultas PostgreSQL a `employees`, `attendance_sessions` y `attendance_events` del tenant B devolvieron cero filas, mientras la consulta permitida a eventos de A devolvió sus propios IDs.
- **Hallazgos:** no se reprodujo bypass ni filtración adicional en estas rutas. `resolveAdminScope` restringe a membresías activas owner/admin y valida el `companyId` seleccionado; el Route Handler de empresa consulta `company.manage` y PostgreSQL aplica el mismo permiso en `USING` y `WITH CHECK`. El dashboard no recibe `companyId` en el cuerpo: deriva alcance de la membresía de servidor, filtra consultas por `scope.company.companyId`, valida la sucursal contra la lista de esa empresa y deja que RLS imponga su propio filtro. Las consultas de movimientos vuelven a resolver sesiones/empleados/sucursales dentro del mismo tenant antes de serializar nombres.
- **Alcance no demostrado:** son pruebas del código/migraciones locales. No certifican grants, políticas, datos ni configuración de Testing/Producción. No se hizo revisión remota. No se modificó lógica funcional ni migraciones y no se ejecutaron intentos incorrectos de PIN.

### Validaciones de esta extensión

| Comando | Resultado |
|---|---|
| `npm run test:security:matrix:local` | Aprobado: 192/192 pgTAP en 8 suites; las nuevas pruebas Auth/HTTP de empresa y dashboard pasaron; teardown limpio, recursos Docker anteriores preservados. |
| `npm test` | Código 0: 80 pasaron, 1 omitida (el sandbox bloqueó el socket local de GnuPG), total 81. Persisten advertencias Node `MODULE_TYPELESS_PACKAGE_JSON`. |
| `npm run lint` | Aprobado, código 0, sin errores ni advertencias. |
| `npm run typecheck` | Aprobado, código 0. |
| `npm run build` | Aprobado en copia temporal sin `.env*`, con Supabase loopback sintético. Next.js reportó la advertencia conocida de 27 archivos fuera del standalone trace por `node_modules` enlazado desde el repositorio; compilación, TypeScript, páginas y trazado finalizaron con código 0; temporal eliminado. |

## Reglas laborales y tiempo extra — matriz Auth/HTTP y RLS (29-oct-2026)

- **Ambiente:** `npm run test:security:matrix:local` usó el proyecto desechable `qr004_disposable_ea216ec568f6`, dos empresas, sucursales, membresías y sesiones/Auth sintéticas, Mailpit local y Next.js en loopback. El runner informó que eliminó el stack/datos temporales y preservó recursos Docker preexistentes. No se consultaron Testing ni Producción.
- **`GET/POST /api/schedules/rules`:** anónimo `401`, supervisor/empleado `403`, tenant ajeno `403`; multiempresa sin selector `400`. Administradores de A/B solo leyeron sus propias reglas, con `Cache-Control: no-store`. Alta válida `201`; entrada inválida `422`; un rango solapado `409` sin fila/auditoría adicional. La tabla es RLS-protegida y solo su política permisiva `labor_rules_manage` permite escrituras, exigiendo `company.manage` en `USING` y `WITH CHECK`.
- **`PATCH/DELETE /api/schedules/rules/[id]`:** cerrar una regla sin solapamiento devolvió `200`; extensión solapada `409`; fecha menor al inicio `422`. IDs ajenos responden `404` sin mutar el tenant objetivo. `DELETE` directo sobre `labor_rule_sets` no tiene grant para `authenticated`; la RPC `delete_labor_rule_set` exige membresía activa owner/admin y `company.manage`, bloquea la baja con referencias en `attendance_sessions` o `overtime_assessments` (`409`) y permite eliminar por la RPC una regla sin referencias (`200`). Los rechazos no alteraron los snapshots/auditoría. Con `company.manage=false` manteniendo `company.read`, el GET responde `200` con lista vacía por RLS, POST devuelve `403`, PATCH sobre ID oculto devuelve `404` y DELETE por la RPC `403`; no se filtra el contenido de las reglas.
- **`GET /api/schedules/overtime`:** anónimo `401`, supervisor/empleado y membresía inactiva `403`, empresa ajena `403`, selección multiempresa omitida `400`, rango inválido/invertido `400`; respuestas exitosas llevan `Cache-Control: no-store`. Los datos sintéticos se limitaron a la empresa seleccionada. Un admin activo con `company.read` pudo consultar métricas detectadas, pero sin `overtime.manage` RLS ocultó los detalles de autorización: la API devolvió lista `authorizations: []`. Owner con `overtime.manage` vio minutos pendientes/aprobados y el cálculo de minutos reconocidos.
- **`overtime_authorizations` directo:** owner autorizado pudo insertar, aprobar y borrar una autorización sintética. Admin sin `overtime.manage` no pudo INSERT/UPDATE/DELETE; un owner con override explícito `overtime.manage=false` también fue rechazado en las tres operaciones. El empleado pudo leer solo su autorización vinculada a su propia sesión mediante la política SELECT-only `employee_own_overtime_authorizations_read`. Un owner A no pudo insertar en B. Todos los rechazos preservaron los snapshots de autorización/auditoría.
- **Inspección de políticas/grants:** la inspección de migraciones y la nueva pgTAP confirman RLS en reglas y autorizaciones; existe exactamente una política permisiva de escritura en cada tabla (`labor_rules_manage` y `overtime_authorizations_manage`) y sus condiciones requieren respectivamente `company.manage` y `overtime.manage` tanto al modificar filas como al insertar. La política de lectura del empleado es exclusivamente SELECT. No se halló otra política permisiva de escritura que eluda esos permisos.
- **Diagnóstico:** no se reprodujo acceso entre empresas ni bypass de permiso. La diferencia observada para reglas con `company.manage` revocado es el resultado de RLS/cero filas y del mapeo HTTP existente; no se cambió comportamiento funcional. El acceso al catálogo de reglas requiere en la práctica `company.manage`, mientras las métricas de asistencia del endpoint de overtime se pueden consultar por un admin activo aunque no tenga `overtime.manage`; la autorización detallada sigue filtrada por PostgreSQL. No hay endpoint HTTP de mutación de horas extra en este alcance.

### Validaciones de reglas y horas extra

| Comando | Resultado |
|---|---|
| `npm run test:security:matrix:local` | PASS: ocho suites pgTAP, 201/201; pruebas HTTP/Auth de reglas/horas extra y matriz previa pasaron; teardown local limpio. |
| `npm test` | PASS: 80 pasaron, 1 omitida por bloqueo del socket local de GnuPG; Node mostró avisos `MODULE_TYPELESS_PACKAGE_JSON`. |
| `npm run lint` | PASS, código 0. |
| `npm run typecheck` | PASS, código 0. |
| `npm run build` | PASS con Supabase loopback sintético en una copia temporal sin `.env*`; se conserva la advertencia conocida de 27 archivos de trazado standalone por el symlink de `node_modules`. |

## Extensión de credenciales QR y dispositivos (30-oct-2026)

- **Método:** stack Supabase temporal (`qr004_disposable_9a915e4a24ad`), Auth y Next.js en loopback, usuarios/empresas/sucursales/empleados sintéticos, snapshots antes/después de rechazos. Se ejecutó exclusivamente `npm run test:security:matrix:local`; no se consultaron entornos alojados.
- **Credenciales QR:** la matriz `GET/POST/DELETE /api/employees/[id]/qr` confirmó 401 anónimo, 403 por rol o permiso, 404 para empleado de otro tenant, 409 para empleado inactivo y para emisión duplicada sin `replace`. Se verificó que la respuesta GET solo devuelve estado, que emisión/regeneración usa `Cache-Control: no-store, private`, devuelve el token únicamente en la operación de emisión y que PostgreSQL conserva solo SHA-256. Regenerar cambia el digest anterior; revocar invalida la credencial y una repetición no genera auditoría duplicada.
- **PIN administrativo:** `PUT /api/employees/[id]/pin` se probó en anónimo, rol insuficiente, empresa ajena, formato inválido y `employees.manage=false`; todos los rechazos conservaron snapshots de credenciales, lockout y auditoría. No se configuró PIN, no se invocó `private.verify_employee_pin` ni se enviaron intentos incorrectos, manteniendo QR-003 fuera de alcance.
- **Dispositivos:** se probaron solicitud del supervisor, desafío ligado al navegador, branch/tenant, duplicado del mismo desafío, listado, `devices.manage`, aprobación/rechazo, repetición, carreras de aprobación, canje único, revocación, membresía revocada y llamadas directas a RPC. La carrera de aprobación produjo exactamente un dispositivo y un evento de auditoría. La revocación impidió que el contexto de escáner siguiera autorizando el dispositivo; no se llamó a RPC de asistencia.
- **PostgreSQL:** pgTAP pasó 192/192 en ocho suites. Las aserciones añadidas comprueban RLS/grants de `private.device_authorization_requests` y que solo `authenticated` tenga `EXECUTE` en RPC de ciclo de vida; `anon` no puede invocarlas. Las pruebas dinámicas directas confirmaron que el cuerpo RPC también aplica tenant, rama, membresía y permiso, no solo ACL.
- **Resultado:** no se confirmó una vulnerabilidad adicional en estas rutas. La inspección y pruebas son del estado local versionado; no demuestran que un proyecto remoto tenga los mismos grants, funciones o historial. QR-004 sigue en curso por los pendientes enumerados arriba.

## Server Actions y sesiones Auth — matriz dinámica local (30-oct-2026)

- **Mecanismo:** `tests/qr004-auth-matrix.local.integration.mjs` crea una copia temporal de `src`, un stack Supabase aleatorio y un servidor Next.js ligado a loopback. Chrome headless usa un perfil efímero, navegación DNS bloqueada para destinos externos y formularios renderizados por Next. En GitHub Actions se instala Chrome for Testing y se desactiva el sandbox interno del navegador porque el runner puede bloquear user namespaces; la ejecución ocurre en una VM efímera, el DNS externo sigue bloqueado y los datos son sintéticos. Las páginas existentes `/login`, `/seleccionar-empresa`, `/invitacion` y `/mi-qr` ejercitan sus formularios reales; una ruta auxiliar se genera solo en la copia temporal para probar acciones sin un formulario independiente. Next crea las referencias de Server Actions; no se codifican IDs internos ni se fabrican peticiones de protocolo.
- **Autenticación y redirecciones:** `signIn` rechazó contraseña incorrecta sin emitir cookie de membresía; el acceso válido creó sesión SSR local. Una `next` externa fue descartada y el resultado permaneció en el origen de loopback. `signOut` y `signOutEmployee` invalidaron sesión y cookie de membresía; después, `/api/company` y `/api/me` respondieron 401. La cookie `qr_active_membership_id` se observó como `HttpOnly`, `SameSite=Lax` y `Path=/`.
- **Selección de membresía:** `chooseMembership` aceptó la membresía propia en una cuenta multiempresa y rechazó IDs de otro usuario, de empleado→administrador y de membresía revocada/inactiva; los intentos denegados no sustituyeron la cookie. `setAdminMembership` cambió entre membresías owner/admin propias y activas; devolvió sin cambio ante ID ajeno, rol empleado o falta de sesión. Después de revocar la membresía seleccionada, la API rechazó el acceso a esa empresa pese a la cookie obsoleta y permitió seleccionar la otra membresía activa.
- **Aceptación de invitaciones:** la acción rechazó anónimo, identidad destinataria incorrecta, invitación caducada/revocada y repetición. El destinatario correcto aceptó desde la página real; al tener dos empresas, la acción llevó a seleccionar explícitamente una membresía propia. Los snapshots y consultas sintéticas confirmaron una sola membresía y un evento `USER_INVITATION_ACCEPTED`, sin efectos ante rechazos.
- **Hallazgo confirmado — severidad media, bypass por Data API:** en la base local del commit `f9e5672`, una identidad sintética con `invited_at`, email confirmado, sesión válida y sin `raw_app_meta_data.access_setup_completed_at` falsificó una marca en `user_metadata`. `supabase.rpc("accept_company_user_invitation", ...)` aceptó la invitación. Repetir con una invitación compartida y llamar `accept_company_user_share_invitation(text)` también la aceptó, porque esta RPC invoca la función anterior. Se observó la aceptación y sus filas/auditoría en la instancia desechable antes de limpiar el stack.
- **Causa raíz:** los controles de `app_metadata` existían solo en la página y Server Action. Ambas RPC tenían `EXECUTE` para `authenticated` y la función SQL no comprobaba `invited_at` ni una marca administrada por servidor. El flujo compartido delegaba a la misma función y heredaba el bypass.
- **Corrección:** la migración aditiva `supabase/migrations/20261030220000_require_invitation_password_setup.sql` reemplaza la función de aceptación sin editar migraciones históricas ni alterar sus grants/contrato. Antes de leer/modificar la invitación consulta `auth.users`; para cuentas con `invited_at`, exige que `raw_app_meta_data.access_setup_completed_at` sea un timestamp válido, finito y no futuro. Faltante, vacío, malformado, infinito o futuro devuelve SQLSTATE `42501`. La función compartida no duplica la regla: su llamada a la función corregida aborta su transacción completa, incluido el borrado previo del hash. Las cuentas sin `invited_at` conservan el flujo anterior.
- **Regresiones dinámicas:** con JWT Auth sintéticos, las dos RPC rechazan `user_metadata` falsificado y la identidad sin marca. Se prueban también valor malformado, futuro y `-infinity`; snapshots verifican que invitación, hash compartido, membresía y auditoría no cambian. La ruta HTTP de WhatsApp mapea `42501` a `403 invitation_forbidden` sin revelar SQL/metadata; `acceptInvitation` mapea el rechazo SQL a `error=forbidden` con mensaje genérico. El flujo real `setInvitationPassword` guarda la marca en `raw_app_meta_data` y luego acepta; una cuenta no invitada sigue aceptando en la prueba de ciclo de vida.
- **Falla parcial Auth:** `setInvitationPassword` comprueba que el cliente administrativo esté configurado antes de cambiar la contraseña. Después, la contraseña se actualiza con sesión SSR y la marca se escribe con credencial administrativa. Una prueba local inicia Next con clave administrativa sintética no privilegiada: la contraseña se cambia, falla la marca, la invitación sigue pendiente y SQL deniega aceptación. Reiniciado Next con la clave local correcta, la persona reintenta, completa la marca y acepta una sola vez. Las dos llamadas no son transaccionales; una falla parcial no concede acceso.

### Validaciones de Server Actions

| Comando | Resultado |
|---|---|
| `npm run test:security:matrix:local` | PASS: ocho suites pgTAP, 201/201; matriz HTTP/Auth existente y acciones dinámicas; el runner eliminó el stack y el perfil Chrome temporal y preservó recursos Docker preexistentes. |
| `npm test` | PASS: 80 pasaron, 1 omitida porque el sandbox bloqueó el socket local del agente GnuPG; persisten avisos existentes `MODULE_TYPELESS_PACKAGE_JSON`. |
| `npm run lint` | PASS, código 0. |
| `npm run typecheck` | PASS, código 0. |
| `npm run build` | PASS en copia temporal con `.env*` excluidos y variables Supabase sintéticas de loopback; compilación y 41 páginas estáticas completadas. Se conserva la advertencia conocida de 27 archivos fuera del standalone trace por el symlink a `node_modules`. Un intento inicial en el repo se canceló al indicar Next que cargaría `.env.local`; el build final se ejecutó aislado y no se conectó a una base alojada. |

- **Entornos alojados:** no se consultó ni modificó Supabase Testing o Producción, no se aplicaron migraciones, no se hicieron respaldos y no se enviaron correos externos. QR-003 permanece pospuesta, P0 y NO-GO.

### Revalidación del PR #18 — ejecución final

La repetición de `npm run test:security:matrix` pasó con el proyecto aleatorio `qr004_disposable_bf1391ee40e8`: ocho suites pgTAP, 201/201; pruebas Auth/HTTP y Server Actions; denegaciones de RPC email/share sin efectos; aceptación legítima y compatibilidad de cuentas existentes; teardown eliminó el stack temporal y preservó recursos Docker anteriores. No se conectó a Testing ni Producción.

| Comando | Resultado |
|---|---|
| `npm run test:security:matrix` | PASS; matriz dinámica local y 201/201 pgTAP; limpieza verificada. |
| `npm run test` | PASS, código 0: 80 pruebas pasaron y 1 quedó omitida porque el sandbox bloqueó el socket local de GnuPG. |
| `npm test` | PASS, código 0: mismo script y resultado (80 pasaron, 1 omitida por el socket GnuPG). |
| `npm run lint` | PASS, código 0. |
| `npm run typecheck` | PASS, código 0. |
| `npm run build` | PASS, código 0, en copia temporal sin `.env*` y con URL/clave Supabase sintéticas de loopback; Next completó compilación y 41 páginas. Emitió la advertencia de 27 archivos fuera del standalone trace porque `node_modules` se enlazó desde el repositorio. |

Node mostró los avisos existentes `MODULE_TYPELESS_PACKAGE_JSON` durante tests. El build no leyó `.env.local`; la copia temporal se eliminó. El resultado de GitHub Actions debe comprobarse después de subir este cambio.

## Reportes, exportaciones y contexto de escáner (30-oct-2026)

### Hallazgo confirmado y corrección

- **Reproducción local:** en una instancia Supabase desechable, un `admin` sintético conservó `company.read` y `attendance.read`, pero recibió override `reports.read=false`. La consulta Auth directa a `attendance_session_totals` siguió mostrando su propia jornada, como corresponde a `attendance.read`; antes de la corrección, `GET /api/reports` respondió `200` e incluyó esa fila pese al permiso de reporte revocado. Se usaron exclusivamente datos sintéticos.
- **Causa raíz y severidad:** `resolveAdminScope` validaba rol owner/admin, membresía activa y empresa seleccionada, pero no equivalía a autorizar `reports.read`. `loadReport` omitía ese control. El bypass era de severidad media: un administrador podía leer reportes tras una revocación explícita del permiso; el alcance continuó confinado por empresa/RLS y no se reprodujo cruce de tenants.
- **Corrección mínima:** `loadReport` consulta `current_user_has_company_permission` para `reports.read`. Denegación: `403 reports_forbidden`, mensaje genérico y `no-store`; fallo de la RPC de permisos: `503 report_permission_unavailable`. No se cambiaron las migraciones, ACL, ni el modelo de permisos.
- **Regresión:** con `attendance.read` todavía efectivo, el endpoint ahora devuelve `403` y no serializa los datos. El snapshot de datos/auditoría no cambia. La consulta directa RLS a la jornada propia sigue permitida y las consultas de la empresa ajena siguen vacías.

### Cobertura HTTP/Auth y PostgreSQL

- **`GET /api/reports`:** Auth local cubre anónimo (`401`), supervisor/empleado (`403`), membresía inactiva (`403`), admin de empresa ajena (`403`), selección multiempresa omitida (`400`) y empresa propia seleccionada (`200`). Se probaron fechas imposibles, invertidas y mayores de 366 días, estado y UUID inválidos (`400`); sucursal/empleado ajenos (`403`); filtros válidos por sucursal, empleado y estado; `Cache-Control: no-store, private`; contenido JSON A/B y snapshots de rechazo. IDs de sesiones, empleados y eventos del otro tenant no aparecen en el resultado.
- **`GET /api/reports/export`:** la integración crea jornadas, empleados, sucursales y dispositivos sintéticos A/B y examina archivos reales. ExcelJS carga el XLSX; el texto de los streams Flate del PDF se extrae. Los archivos contienen el marcador de su empresa y excluyen el de la otra; exportar la empresa ajena es `403`. También se probaron `no-store`, autenticación, lease global, concurrencia, expiración, cuota, `Retry-After` y que `reports.read=false` no consuma cuota ni deje lease.
- **Contexto del escáner:** los errores GET/POST llevan ahora `Cache-Control: no-store, private`, incluidos anónimo, rol/empresa no autorizados, selección requerida y origen inválido.
- **`GET /api/supervisor/scanner/context`:** Auth local verifica anónimo (`401`), admin/empleado (`403`), empresa ajena (`403`), supervisor multiempresa sin selección (`409`) y selección activa propia. Una cookie ausente o manipulada no autoriza; cookie de dispositivo revocado resulta no autorizada; membresía revocada devuelve `403` incluso con cookies viejas.
- **`POST /api/supervisor/scanner/context`:** un supervisor sintético solicita un dispositivo, el admin lo aprueba y el POST real canjea el desafío. El resultado se autoriza una vez; la respuesta no incluye el secreto. Cookie emitida: `HttpOnly`, `Secure` con `x-forwarded-proto: https`, `SameSite=lax`, `Path=/api`. Replay no genera una segunda cookie ni modifica snapshots. `Origin` externo recibe `403` no cacheable y sin efectos. No se registró asistencia ni se probaron QR/PIN.
- **RLS/RPC:** las verificaciones de acceso usaron sesiones SSR/Auth y clientes `authenticated`; `service_role` preparó fixtures sintéticos exclusivamente. La integración de reportes ejecuta 13 aserciones pgTAP sobre tabla privada, RLS/grants y lease, y prueba las RPC `acquire_report_export_lease`, `renew_report_export_lease` y `release_report_export_lease` con JWT, carrera y lease expirado. La matriz ejercita `get_supervisor_scanner_context` y `redeem_supervisor_device` por HTTP; mantiene cobertura previa directa de `request_supervisor_device` y `review_supervisor_device_request`. No se invocaron `scan_employee_attendance` ni `confirm_employee_attendance`.

### Inventario de Route Handlers de esta revisión

El inventario incluye todos los archivos `src/app/api/**/route.ts` existentes en este checkout. “Dinámica” significa peticiones a Next.js local con Auth sintético; no implica cobertura exhaustiva de cada combinación.

| Ruta y métodos | Evidencia | Brecha o nota residual |
|---|---|---|
| `/api/admin/access` GET/POST/PATCH; `/api/admin/access/invitations/[id]/resend` POST; `/api/admin/access/invitations/[id]/share-link` POST | HTTP/Auth, permisos, tenant, Mailpit, snapshots y RPC de invitación | Mantener regresiones ante cambios de entrega/carreras |
| `/api/admin/audit` GET; `/api/admin/permissions` GET | HTTP/Auth: auditoría requiere `company.manage`; catálogo disponible a admin activo con ese permiso revocado | Sin inspección remota |
| `/api/company` GET/PATCH; `/api/dashboard/summary` GET | HTTP/Auth, RLS directo, empresas/sucursales sintéticas A/B; fase previa | No sustituye revisión remota |
| `/api/reports` GET; `/api/reports/export` GET | Esta fase: Auth, RLS, filtros, contenido JSON/PDF/XLSX, tenant isolation y lease | No se hizo stress de 5,000 filas en servidor local; límites conservados en unit tests |
| `/api/supervisor/scanner/context` GET/POST | Esta fase: Auth, selección, dispositivo, origen, cookies, desafío y revocación | Escaneo y registro de asistencia explícitamente fuera de alcance |
| `/api/supervisor/device-requests` POST; `/api/supervisor-devices` GET/PATCH; `/api/supervisor-devices/[id]` DELETE; `/api/supervisors` GET/PATCH | HTTP/Auth/RPC, sucursal, permisos, carreras y revocación en fases previas | Revisar otra vez al cambiar el modelo de dispositivos |
| `/api/me` GET; `/api/employee/portal` GET; `/api/invitations/share/accept` POST | HTTP/Auth, portal, invitaciones, sesión y RPC | Pruebas de navegador/Server Actions separadas, documentadas previamente |
| `/api/employees` GET/POST; `/api/employees/[id]` GET/PATCH; `/api/employees/[id]/qr` GET/POST/DELETE; `/api/employees/[id]/pin` PUT | Auth/RLS de tenant y credenciales; PIN solo configuración | Sin verificar PIN ni lockout; QR-003 pospuesta |
| `/api/branches` GET/POST/PATCH | HTTP/Auth y snapshots para tenant/sucursal | Faltan combinaciones en operaciones fuera de esta fase |
| `/api/attendance` GET; `/api/attendance/[id]` GET; `/api/attendance/scan` POST | Guardas/Auth/tenant documentadas en matriz previa | No se registró asistencia. La solicitud sintética de scan se rechazó por dispositivo inválido antes de lookup QR y `private.verify_employee_pin`; no se verificó ni se generó un intento de PIN |
| `/api/schedules` GET/POST; `/api/schedules/[id]` PATCH/DELETE; `/api/schedules/assignments` GET/POST; `/api/schedules/calendar` GET; `/api/schedules/rules` GET/POST; `/api/schedules/rules/[id]` PATCH/DELETE; `/api/schedules/overtime` GET | HTTP/Auth, permisos y RLS en fases anteriores | No se amplió el alcance funcional |
| `/api/healthz` | Health check | Sin autorización multiempresa; reevaluar si expone más datos |

El inventario corresponde a Route Handlers; las RPC privilegiadas se enumeran en cada sección histórica y en la cobertura RLS/RPC de arriba. No equivale a un inventario exhaustivo de todas las funciones SQL del esquema.

### Evidencia, riesgos y estado

- **Validaciones locales:** la última matriz local pasó ocho suites pgTAP (201/201), los escenarios HTTP/Auth añadidos y el teardown, preservando recursos Docker preexistentes. `npm run test:reports` pasó 16/16. `npm run test:reports:lease:local` pasó 17/17 checks, incluidos contenido PDF/XLSX y limpieza. `npm test` pasó con 80 pruebas y 1 omitida porque el sandbox bloqueó el socket del agente GnuPG. `npm run lint` y `npm run typecheck` pasaron. `npm run build` pasó en copia temporal con `.env*` excluidos y valores Supabase sintéticos de loopback; Next completó 41 páginas. Aviso conocido: 27 archivos no entraron al standalone trace porque `node_modules` se enlazó fuera de la copia. La copia se eliminó.
- **GitHub Actions:** pendiente de comprobar en el commit publicado de esta rama; actualizaré esta evidencia cuando exista un resultado remoto verificable.
- El canje de dispositivo persiste `redeemed_at` y hash del token. El esquema actual registra auditoría al solicitar, aprobar/rechazar y revocar, no al canjear; esta tarea comprobó ese comportamiento y no añadió un requisito funcional nuevo.
- No se consultaron ni modificaron Testing o Producción, no se aplicaron migraciones remotas, no hubo respaldos ni verificaciones de PIN. QR-003 continúa pospuesta, P0 y NO-GO.
- **QR-004 permanece En curso.** Faltan otras combinaciones/operaciones API-RPC-Server Actions y una revisión remota segregada; esta ampliación no cierra la auditoría.
