# QR-004 — Auditoría de seguridad multiempresa

Fecha: 29 de octubre de 2026<br>
Base de trabajo: `b3b1263e137742d2c210779e3f648451782a1e9b` (`main`, PR #16 integrado); esta actualización registra pruebas locales para reglas laborales y horas extra en `test/qr-004-rules-overtime-matrix`.

## Resumen ejecutivo

Las fases anteriores confirmaron y corrigieron dos brechas en políticas SQL de sucursal y permisos. Esta extensión cubre las rutas de reglas laborales/horas extra y el acceso directo a sus tablas con sesiones Auth locales. No confirmó una vulnerabilidad adicional; los rechazos conservaron snapshots de las dos empresas sintéticas.

QR-004 **permanece en curso**. La matriz local actual pasó 201/201 aserciones pgTAP y sus pruebas HTTP/Auth con Supabase desechable, Auth local y Next.js en loopback. Incluye solapamientos y baja segura de reglas, lectura de horas extra y escrituras directas autorizadas/denegadas en autorizaciones. No se consultó ni modificó Testing o Producción. Siguen pendientes el harness dinámico de Server Actions y la revisión remota segregada; esta evidencia no certifica todas las rutas ni los catálogos remotos.

## Alcance y método

- Inspección estática de `src/app/api/**`, rutas protegidas, helpers Auth, alcance administrativo/de empleado, migraciones, RLS, grants, funciones privilegiadas y pruebas existentes.
- Ejecución local de lint, TypeScript, suite Node, integración Supabase/PostgreSQL aislada para report-export lease y build.
- La integración SQL creó un proyecto local con identificador aleatorio, puertos libres y servicios limitados a loopback. Sus propias guardas rechazaban los refs de Testing y Producción. El resultado informó el borrado de contenedores, red y volúmenes de prueba; el stack preexistente `codigo_QR` permaneció intacto.
- La fase HTTP reutilizó ese proyecto desechable, creó Auth users, empresas, membresías y expedientes sintéticos, e inició una copia temporal de Next.js con una lista permitida de variables. Los endpoints recibieron cookies SSR emitidas por Auth local. El runner conservó Mailpit local para correos de invitación; no configuró Resend ni credenciales SMTP externas. `.env.local` no se copió al servidor de prueba ni al build aislado.
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

La fase HTTP ejercita Route Handlers y páginas protegidas con Auth local real. La aceptación/expiración/revocación de invitaciones se prueba por RPC autenticada; no se fabricaron peticiones a Server Actions. Las solicitudes de corrección no tienen Route Handler en `src/app/api`; se validó la inserción directa por PostgREST bajo RLS y la RPC de revisión con permisos. `tests/auth-email-flow.test.mjs` conserva comprobaciones unitarias/estáticas, pero `chooseMembership`, `setAdminMembership`, `signIn` y otras Server Actions todavía no tienen matriz dinámica con sesión. Las rutas `/api/company` y `/api/dashboard/summary` se añadieron a la matriz local en la extensión del 30-oct-2026; siguen fuera de cobertura exhaustiva todas las combinaciones de cada API, operaciones restantes de solicitudes/dispositivos y flujos de navegador. Esto no constituye una matriz completa de cada RPC, tabla y ruta.

## Recomendaciones priorizadas

1. **P0 de seguridad pendiente:** QR-003 está pospuesta por decisión del propietario; no se considera corregida ni aplicada en Testing. No continuar respaldos, autorizaciones ni despliegues de esa tarea hasta que se retome expresamente.
2. **P1 evidencia:** extender casos locales a las APIs restantes y validar Server Actions mediante un harness estable; conservar la prohibición de peticiones inventadas a Server Actions.
3. **P1 entorno:** si se autoriza una auditoría remota de solo lectura, comparar por separado Testing y Producción; revisar refs, historial, cuerpos SQL, ACL, RLS y configuración Auth sin tratar snapshots anteriores como actuales.
4. **P2 mantenimiento:** mantener el runner SQL/HTTP en CI con fixtures efímeras; nunca inyectar secretos o datos personales en logs/artefactos.
5. **P2 revisiones futuras:** para cada RPC privilegiada, conservar una lista de funciones/ACL esperadas y comprobar cambios de `search_path`, owner, `EXECUTE`, identidad y alcance tenant.

## Estado de QR-002

La implementación y las regresiones de los canales correo/WhatsApp están integradas en `main` (PR #7); los flujos de destinatario, verificación Auth, expiración, revocación, reuso, carrera y envío local aparecen probados en la matriz. Para cerrar QR-002 falta completar la dependencia de QR-004 y aceptar su evidencia de autorización multiempresa. La pausa de QR-003 se mantiene separada; no autoriza el despliegue ni cambia el estado del PIN.

## Condiciones para cerrar QR-004

- Completar la matriz HTTP/Auth en las rutas API que sigan pendientes y documentar resultados negativos y positivos con datos sintéticos. Reglas laborales y horas extra quedan cubiertas por esta extensión local.
- Disponer de un mecanismo verificable para Server Actions o acotar formalmente qué controles se validan por pruebas unitarias y cuáles quedan pendientes.
- No declarar la auditoría completa mientras falte la revisión remota segregada requerida por el plan o haya hallazgos altos sin resolver. Esa revisión no se realizó en esta tarea.

## Estado

**QR-004: en curso.** La matriz histórica del PR #14 pasó 187/187 pgTAP; las extensiones integradas de credenciales/dispositivos y empresa/dashboard pasaron 192/192 cada una. Esta extensión pasó 201/201, con ocho suites en el runner desechable. Quedan pendientes el harness dinámico de Server Actions y la revisión remota segregada; no se declara cerrada la auditoría. Testing y Producción no se consultaron ni modificaron. QR-003 sigue pospuesta, P0 y NO-GO; no se llamó a la verificación de PIN ni se enviaron intentos incorrectos.

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
