# QR-004 — Auditoría de seguridad multiempresa

Fecha: 29 de octubre de 2026<br>
Base de trabajo: `2b076d27bb4815ac6a3eb96f3cbc78836c765899` (`main`, PR #13 integrado); esta actualización registra la rama `test/qr-004-attendance-schedules-matrix`.

## Resumen ejecutivo

La revisión confirmó dos brechas de autorización en políticas SQL de sucursal y permisos. Se corrigieron mediante una migración aditiva y se añadieron regresiones directas de RLS/RPC y HTTP/Auth. Los rechazos quedaron sin cambios de estado en snapshots de ambas empresas.

QR-004 **permanece en curso**. Esta fase cubrió asistencia, correcciones RLS/RPC y horarios en un stack Supabase desechable, con Auth local y Next.js en loopback: 185/185 aserciones pgTAP y todos los checks HTTP/Auth del runner pasaron. No se consultó ni modificó Testing o Producción. No se certifican todavía todas las rutas API, Server Actions, E2E de navegador ni configuraciones remotas.

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
- **Limitación de evidencia:** no se consiguió ejecutar el caso de escritura contra el SQL previo: el primer arranque local se detuvo por colisión de un puerto publicado por otro stack local, antes de crear fixtures. El bypass previo queda confirmado por la política estática; la prueba dinámica repetible cubre el estado corregido.

#### QR004-A2 — `company.read` sustituía permisos específicos en escrituras por sucursal

- **Severidad:** media; podía permitir a una membresía administrativa con override denegado seguir escribiendo horarios mediante `company.read`.
- **Evidencia:** la función previa `private.can_access_branch` devolvía verdadero por `has_company_permission(company.read) OR (permiso específico AND sucursal asignada)`. Las políticas de escritura de plantillas/asignaciones invocaban esa función con `schedules.manage`, por lo que la primera rama eludía un override `schedules.manage=false`.
- **Validación:** la matriz local denegó `POST /api/schedules` y un insert PostgREST directo con override sintético `schedules.manage=false`; ambos devolvieron rechazo (`403` / SQLSTATE `42501`) y los snapshots de horarios/auditoría no cambiaron.
- **Corrección:** la nueva guarda `private.can_manage_branch` requiere el permiso específico antes de permitir el alcance de empresa o sucursal. Se aplica a plantillas, días, asignaciones y descansos de horario, respetando el patrón de transacción RLS existente.
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
- **Evidencia:** ocho suites pgTAP (185 aserciones) y Route Handlers/páginas Next con Auth sintético. La matriz cubre asistencia, horarios, correcciones mediante RLS/RPC, administración de empleados/sucursales/supervisores/dispositivos, acceso e invitaciones. No se cubren todas las APIs, Server Actions ni recorridos de navegador. Se omitió `tests/security-jwt-matrix.integration.mjs` porque apunta a Testing. No se ejecutó la suite DB de bloqueo PIN porque QR-003 quedó pospuesta.
- **Impacto/condición:** comportamientos fuera de las rutas y escenarios nombrados siguen sin evidencia dinámica en esta matriz.
- **Recomendación:** mantener el runner local en CI; continuar por `/api/company`, `/api/dashboard/summary`, emisión/revocación HTTP de credenciales QR/PIN, solicitudes/revocación de dispositivos y operaciones restantes de reglas/horas extra. No existe Route Handler Next para solicitudes/revisión de correcciones; se probó insert vía PostgREST/RLS y la RPC real de revisión, sin inventar endpoint. Para Server Actions usar harness Next estable; no fabricar peticiones HTTP. La revisión remota, si se vuelve a priorizar, requiere autorización independiente y lectura segregada por entorno.
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
| `npm run test:security:matrix:local` | Aprobado: 8 suites pgTAP, 185/185 aserciones, proyecto local `qr004_disposable_441ec59d543f`. Incluye RLS de horarios, permisos efectivos, guarda `SECURITY DEFINER`/`search_path`/grants, usuarios sintéticos A/B, membresía activa/revocada y limpieza completa; el runner preservó los recursos Docker preexistentes. |
| `npm run test:security:matrix:local` (HTTP/Auth) | Aprobado. Además de rutas ya cubiertas de acceso, empleados, sucursales, supervisores, dispositivos, auditoría e invitaciones, se probaron `GET /api/attendance`, `GET /api/attendance/[id]`, rechazo `POST /api/attendance/scan`, `GET/POST /api/schedules`, `PATCH /api/schedules/[id]`, `GET/POST /api/schedules/assignments` y `GET /api/schedules/calendar`. Se verificaron anonimato, roles, membresía inactiva, empresa seleccionada, branch y IDs ajenos, `schedules.manage` revocado, permisos directos por RPC/RLS, corrección en rama asignada, rechazo de rama distinta, revisión no autorizada/autorizada y entradas inválidas. Snapshots confirmaron cero cambios ante rechazos; el scan se detuvo antes de validar QR/PIN. Invitaciones previas mantuvieron HTTP 201/200 y Mailpit local. |
| `npm run build` | Aprobado (código 0), Next.js 16.4.0, en una copia temporal sin `.env*` y con variables Supabase sintéticas de loopback. Next avisó que 27 archivos standalone quedaron fuera del trazado porque `node_modules` estaba enlazado desde el repo; compilación, TypeScript y generación de rutas terminaron correctamente. El temporal se eliminó. |
| `npm run test:pin-lockout:db` | No ejecutado: requiere un workdir y URL PostgreSQL locales configurados como proyecto QR PIN desechable. No se reutilizó una instancia compartida ni se imprimieron variables. La prueba Node de PIN sí pasó dentro de `npm test`. |
| Matriz `tests/security-jwt-matrix.integration.mjs` | Omitida intencionalmente: su configuración apunta a Testing; no se ejecutaron pruebas remotas. |

La fase HTTP ejercita Route Handlers y páginas protegidas con Auth local real. La aceptación/expiración/revocación de invitaciones se prueba por RPC autenticada; no se fabricaron peticiones a Server Actions. Las solicitudes de corrección no tienen Route Handler en `src/app/api`; se validó la inserción directa por PostgREST bajo RLS y la RPC de revisión con permisos. `tests/auth-email-flow.test.mjs` conserva comprobaciones unitarias/estáticas, pero `chooseMembership`, `setAdminMembership`, `signIn` y otras Server Actions todavía no tienen matriz dinámica con sesión. No se cubrieron todavía `/api/company`, `/api/dashboard/summary`, emisión/revocación de credenciales por HTTP ni todas las operaciones de solicitudes y dispositivos. Esto no constituye una matriz completa de cada RPC, tabla y ruta.

## Recomendaciones priorizadas

1. **P0 de seguridad pendiente:** QR-003 está pospuesta por decisión del propietario; no se considera corregida ni aplicada en Testing. No continuar respaldos, autorizaciones ni despliegues de esa tarea hasta que se retome expresamente.
2. **P1 evidencia:** extender casos locales a las APIs restantes y validar Server Actions mediante un harness estable; conservar la prohibición de peticiones inventadas a Server Actions.
3. **P1 entorno:** si se autoriza una auditoría remota de solo lectura, comparar por separado Testing y Producción; revisar refs, historial, cuerpos SQL, ACL, RLS y configuración Auth sin tratar snapshots anteriores como actuales.
4. **P2 mantenimiento:** mantener el runner SQL/HTTP en CI con fixtures efímeras; nunca inyectar secretos o datos personales en logs/artefactos.
5. **P2 revisiones futuras:** para cada RPC privilegiada, conservar una lista de funciones/ACL esperadas y comprobar cambios de `search_path`, owner, `EXECUTE`, identidad y alcance tenant.

## Estado de QR-002

La implementación y las regresiones de los canales correo/WhatsApp están integradas en `main` (PR #7); los flujos de destinatario, verificación Auth, expiración, revocación, reuso, carrera y envío local aparecen probados en la matriz. Para cerrar QR-002 falta completar la dependencia de QR-004 y aceptar su evidencia de autorización multiempresa. La pausa de QR-003 se mantiene separada; no autoriza el despliegue ni cambia el estado del PIN.

## Condiciones para cerrar QR-004

- Completar la matriz HTTP/Auth en las rutas API enumeradas como pendientes y documentar resultados negativos y positivos con datos sintéticos.
- Disponer de un mecanismo verificable para Server Actions o acotar formalmente qué controles se validan por pruebas unitarias y cuáles quedan pendientes.
- No declarar la auditoría completa mientras falte la revisión remota segregada requerida por el plan o haya hallazgos altos sin resolver. Esa revisión no se realizó en esta tarea.

## Estado

**QR-004: en curso.** Esta fase añadió y pasó 185/185 aserciones pgTAP, cobertura HTTP/Auth de asistencia/horarios y regresiones para dos brechas RLS corregidas en `20261030031019_scope_attendance_adjustment_branch.sql`. No se hicieron cambios funcionales en Route Handlers. GitHub Actions aún debe confirmar este commit. Faltan rutas API adicionales, Server Actions, E2E/otras operaciones y revisión remota segregada; por ello la auditoría no se cierra. Testing y Producción no se consultaron ni modificaron. QR-003 queda pospuesta, P0 y NO-GO; este cambio no la completa ni altera sus migraciones.
