# QR-004 — Auditoría de seguridad multiempresa

Fecha: 29 de octubre de 2026<br>
Base de trabajo: `6bb6573d03267e58fbea7307ed5f5dbe95ea692f` (`main`, PR #12 integrado); esta actualización registra la cobertura incremental de la rama actual.

## Resumen ejecutivo

La revisión del código y migraciones de esta base no confirmó una nueva ruta de explotación entre empresas. Los componentes centrales derivan identidad de `auth.getUser()`, comprueban membresías activas, acotan consultas por `company_id` y mantienen RLS y restricciones SQL como segunda frontera. La migración QR-003 contiene la corrección local de persistencia de fallos de PIN.

QR-004 **permanece en curso**. La fase 2 ejecutó una matriz SQL local; la fase 3 añadió Auth local y Next.js en loopback. Esta ampliación extiende la matriz HTTP/Auth a expedientes, sucursales, asignaciones de supervisores y lectura de dispositivos, con usuarios/empresas/sucursales sintéticos y comprobaciones de efectos laterales. La ejecución actual pasó 156/156 aserciones pgTAP y las pruebas HTTP/Auth incluidas. No se consultó ni modificó Testing o Producción. No se certifican todavía todas las rutas API, Server Actions, E2E de navegador ni configuraciones remotas.

## Alcance y método

- Inspección estática de `src/app/api/**`, rutas protegidas, helpers Auth, alcance administrativo/de empleado, migraciones, RLS, grants, funciones privilegiadas y pruebas existentes.
- Ejecución local de lint, TypeScript, suite Node, integración Supabase/PostgreSQL aislada para report-export lease y build.
- La integración SQL creó un proyecto local con identificador aleatorio, puertos libres y servicios limitados a loopback. Sus propias guardas rechazaban los refs de Testing y Producción. El resultado informó el borrado de contenedores, red y volúmenes de prueba; el stack preexistente `codigo_QR` permaneció intacto.
- La fase HTTP reutilizó ese proyecto desechable, creó Auth users, empresas, membresías y expedientes sintéticos, e inició una copia temporal de Next.js con una lista permitida de variables. Los endpoints recibieron cookies SSR emitidas por Auth local. El runner conservó Mailpit local para correos de invitación; no configuró Resend ni credenciales SMTP externas. `.env.local` no se copió al servidor de prueba ni al build aislado.
- Las solicitudes denegadas se contrastaron con snapshots PostgreSQL de invitaciones, auditoría, membresías y dispositivos. La pila temporal, los usuarios/datos sintéticos, el servidor Next.js y el directorio temporal se eliminan al finalizar incluso si falla la matriz.
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
| Membresía inactiva o revocada | Denegado en solicitudes posteriores | Denegada | Denegada; cambios de acceso revocan dispositivos asociados | Denegado | Consultas usan `active=true`; RPC vuelve a comprobar estado. Pendiente prueba dinámica integral local. |
| Usuario con varias membresías activas | Solo tenants autorizados | Solo empresa elegida y permiso concedido | Solo membresía/dispositivo elegido | Solo cuenta/empresa de empleado permitida | Cookies contienen ID de membresía, que se vuelve a resolver contra usuario y estado activo; la selección es explícita cuando hay múltiples opciones. |
| Supervisor de otra sucursal | Datos/operaciones fuera de alcance denegados | Denegada | Denegado para sucursal ajena | Denegado | pgTAP local: el supervisor solo lee empleados en su sucursal; RPC directa del escáner rechaza un QR de otra sucursal. |

Esta matriz describe controles observados y evidencia disponible; las filas que no tienen una prueba dinámica ejecutada en este turno no se consideran demostradas para todas las rutas.

## Hallazgos

### Hallazgos de explotación confirmada en esta revisión

No se confirmó una nueva vulnerabilidad explotable entre empresas en el SHA revisado. Los controles ejercitados pasaron en el stack local. Esto no certifica los entornos remotos ni todos los endpoints HTTP.

### Riesgos conocidos y limitaciones

#### QR004-R1 — Persistencia de fallos del PIN pendiente (fuera de alcance de esta fase)

- **Severidad:** alta para la operación de asistencia mientras se mantenga el comportamiento legacy; estado remoto no confirmado en este turno.
- **Evidencia:** `TASKS.md` y `docs/PIN-LOCKOUT-FIX.md` registran la migración `20261018120000_persist_employee_pin_failures.sql` y el comportamiento legacy conocido. El estado de Testing no se revalidó en esta fase.
- **Impacto/condición:** la corrección sigue pendiente de confirmación en Testing y el propietario ha pospuesto QR-003. No se hicieron consultas, pruebas, respaldos ni escrituras remotas.
- **Recomendación:** conservar el código y la migración; mantener el P0 abierto y no considerar corregido el entorno Testing. No iniciar el trabajo aplazado en el marco de QR-004.
- **Regresión requerida:** el test local de PIN debe comprobar contador, quinto intento, expiración, concurrencia y ausencia de evento. No lanzar intentos contra empleados reales ni remotos.

#### QR004-R2 — Cobertura restante fuera de la matriz SQL y HTTP local

- **Severidad:** baja como riesgo de cobertura; no es una vulnerabilidad demostrada.
- **Evidencia:** siete suites pgTAP (156 aserciones) y Route Handlers/páginas Next probados con sesiones Auth sintéticas. Se añadieron APIs de empleados, sucursales, asignaciones de supervisores y lectura/permiso de dispositivos. La matriz HTTP aún no cubre todas las APIs, Server Actions ni todos los recorridos de navegador. Se omitió `tests/security-jwt-matrix.integration.mjs` porque apunta a Testing. No se ejecutó la suite DB de bloqueo PIN porque QR-003 quedó pospuesta.
- **Impacto/condición:** comportamientos fuera de las rutas y escenarios nombrados siguen sin evidencia dinámica en esta matriz.
- **Recomendación:** mantener el runner local en CI; continuar por API de asistencia, empresa/tablero, horarios, credenciales QR/PIN y solicitudes/revocación de dispositivos. Para Server Actions usar un harness Next estable (por ejemplo, E2E de QR-005 cuando se apruebe); no fabricar peticiones HTTP. La revisión remota, si se vuelve a priorizar, requiere autorización independiente y lectura segregada por entorno.
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
| `npm test` | Aprobado: 80 pruebas pasaron y una prueba GnuPG fue omitida porque el sandbox denegó el socket local del agente. Se conservaron avisos existentes `MODULE_TYPELESS_PACKAGE_JSON`; sin fallos. |
| `npm run test:reports:lease:local` | Aprobado (14/14 controles): proyecto Supabase desechable, migraciones locales, 13 pgTAP, Auth/JWT sintéticos, rechazo cross-tenant/rol/anónimo, carrera concurrente y HTTP/exportación. El script confirmó limpieza del stack/volúmenes. |
| `npm run test:security:matrix:local` | Aprobado en la ejecución final: siete suites pgTAP, 156 aserciones, en el proyecto aleatorio `qr004_disposable_0fe44b75d15b`. Incluye tenant/RLS/roles, membresías, sucursales, ACL de RPC/credenciales y escáner con negativos de empresa/sucursal/dispositivo/QR. El runner eliminó el stack desechable y preservó los recursos Docker preexistentes. Un intento previo se detuvo por un `ReferenceError` del runner antes de los HTTP; se corrigió la declaración y la ejecución completa pasó. |
| `npm run test:security:matrix:local` (HTTP/Auth) | Aprobado junto con pgTAP. Además de `/api/admin/access` y su reenvío, `/api/me`, `/api/employee/portal`, `/admin`, `/mi-qr`, auditoría, permisos e invitaciones, la ejecución cubrió `GET/POST /api/employees`, `GET/PATCH /api/employees/[id]`, `GET/POST/PATCH /api/branches`, `GET/PATCH /api/supervisors` y `GET /api/supervisor-devices`. Se ejercitaron anónimo, rol insuficiente, IDs/branches de empresa ajena, permisos `company.manage` y `devices.manage`, operaciones permitidas dentro del tenant y snapshots sin cambios en rechazos. La invitación válida devolvió 201 y Mailpit recibió el correo sintético; el reenvío devolvió 200 y Mailpit recibió el segundo correo. Las aceptaciones conservaron cobertura de destinatario, expiración, revocación, consumo único y concurrencia entre canales. |
| `npm run build` | Aprobado (código 0), Next.js 16.4.0, en una copia temporal sin `.env*` y con variables Supabase sintéticas de loopback. Next avisó que 27 archivos standalone quedaron fuera del trazado porque `node_modules` estaba enlazado desde el repo; compilación, TypeScript y generación de rutas terminaron correctamente. El temporal se eliminó. |
| `npm run test:pin-lockout:db` | No ejecutado: requiere un workdir y URL PostgreSQL locales configurados como proyecto QR PIN desechable. No se reutilizó una instancia compartida ni se imprimieron variables. La prueba Node de PIN sí pasó dentro de `npm test`. |
| Matriz `tests/security-jwt-matrix.integration.mjs` | Omitida intencionalmente: su configuración apunta a Testing; no se ejecutaron pruebas remotas. |

La fase HTTP ejercita Route Handlers y páginas protegidas con Auth local real. La aceptación/expiración/revocación de invitaciones se prueba por RPC autenticada; no se fabricaron peticiones a Server Actions. `tests/auth-email-flow.test.mjs` conserva comprobaciones unitarias/estáticas del flujo de invitaciones, pero `chooseMembership`, `setAdminMembership`, `signIn` y otras acciones todavía no tienen una matriz dinámica con sesión. No se cubrieron todavía `/api/company`, `/api/dashboard/summary`, APIs de asistencia y horarios, emisión/revocación de credenciales por HTTP, ni todas las operaciones de solicitudes y dispositivos. Esto no constituye una matriz completa de cada RPC, tabla y ruta.

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

**QR-004: en curso; matrices SQL y HTTP/Auth locales completadas para los casos enumerados, con rutas de empleados, sucursales, supervisores y dispositivos añadidas en esta fase.** Se amplió `tests/qr004-auth-matrix.local.integration.mjs`; el script existente de CI ya ejecuta el runner, pero GitHub Actions aún debe confirmar el commit de este PR. No se modificaron migraciones ni lógica funcional. No se confirmó una vulnerabilidad nueva en los escenarios cubiertos. Los escenarios API/Server Actions remanentes y la revisión remota segregada impiden cerrar QR-004. Testing y Producción no se consultaron ni modificaron. QR-003 queda pospuesta y su riesgo P0 no se considera resuelto en Testing.
