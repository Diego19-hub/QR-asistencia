# QR-004 — Auditoría de seguridad multiempresa

Fecha: 28 de octubre de 2026<br>
Rama: `audit/qr-004-multitenant-security`<br>
Base revisada: `02263e1ae17d1151e6466838058b297b1cbd0181` (`main`, posterior al merge del PR #3)

## Resumen ejecutivo

La revisión del código y migraciones de esta base no confirmó una nueva ruta de explotación entre empresas. Los componentes centrales derivan identidad de `auth.getUser()`, comprueban membresías activas, acotan consultas por `company_id` y mantienen RLS y restricciones SQL como segunda frontera. La migración QR-003 contiene la corrección local de persistencia de fallos de PIN.

QR-004 **permanece en curso**. En esta fase se ejecutó una matriz SQL local con usuarios, empresas, sucursales, membresías, credenciales y dispositivos sintéticos en un stack Supabase desechable. Se cubrieron RLS, roles, acceso entre tenants, membresías inactivas, sucursales, RPC privilegiadas, QR/dispositivos y ausencia de efectos secundarios ante rechazos. No se consultó ni modificó Testing o Producción; la evidencia previa sobre QR-003 no se revalidó. La matriz no certifica todos los endpoints HTTP ni la configuración de los entornos remotos.

## Alcance y método

- Inspección estática de `src/app/api/**`, rutas protegidas, helpers Auth, alcance administrativo/de empleado, migraciones, RLS, grants, funciones privilegiadas y pruebas existentes.
- Ejecución local de lint, TypeScript, suite Node, integración Supabase/PostgreSQL aislada para report-export lease y build.
- La integración SQL creó un proyecto local con identificador aleatorio, puertos libres y servicios limitados a loopback. Sus propias guardas rechazaban los refs de Testing y Producción. El resultado informó el borrado de contenedores, red y volúmenes de prueba; el stack preexistente `codigo_QR` permaneció intacto.
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

#### QR004-R1 — Estado efectivo de QR-003 en Testing no revalidado

- **Severidad:** alta para la operación de asistencia mientras se mantenga el comportamiento legacy; estado remoto no confirmado en este turno.
- **Evidencia:** `TASKS.md` y `docs/PIN-LOCKOUT-FIX.md` indican que la migración `20261018120000_persist_employee_pin_failures.sql` está pendiente en Testing. El informe Etapa 9.4A documenta que las RPC antiguas lanzan excepción tras incrementar el contador, revirtiendo el intento junto con la transacción.
- **Impacto/condición:** usuarios que conozcan un QR válido pueden realizar intentos fallidos sin que el contador persista si Testing continúa con esas definiciones. No se hizo ninguna consulta o intento remoto en esta auditoría.
- **Recomendación:** mantener QR-003 abierta; antes de aplicarla, terminar la reconciliación del historial, confirmar el proyecto y realizar el procedimiento aislado/preflight ya solicitado en QR-003. Después comprobar con identidades y empleados sintéticos autorizados.
- **Regresión requerida:** el test local de PIN debe comprobar contador, quinto intento, expiración, concurrencia y ausencia de evento. No lanzar intentos contra empleados reales ni remotos.

#### QR004-R2 — Cobertura restante fuera de la matriz SQL local

- **Severidad:** baja como riesgo residual de cobertura; no es vulnerabilidad demostrada.
- **Evidencia:** la matriz local ejecutó seis suites pgTAP (142 aserciones), con owner/admin/supervisor/empleado, tenants A/B, sucursales, usuarios inactivos/revocados, privilegios de RPC, hashes de credenciales y RPC de escáner/dispositivo. Se omitió `tests/security-jwt-matrix.integration.mjs` porque apunta a Testing. No se ejecutó la suite de bloqueo PIN para mantener QR-003 fuera de alcance.
- **Impacto/condición:** rutas HTTP y comportamientos Auth reales fuera de los fixtures SQL podrían tener regresiones sin detectar en esta matriz.
- **Recomendación:** mantener la matriz local en CI y ampliar en tarea separada a los endpoints HTTP y escenarios Auth no cubiertos. Consultar Testing/Producción solo mediante autorización independiente y lectura segregada por entorno.
- **Regresión requerida:** pgTAP/RPC más HTTP para endpoints críticos; assert de cero cambios colaterales ante cada denegación.

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
| `npm test` | Aprobado (69/69 pruebas Node; suites de unidad y regresión listadas por el script `test`). Node emitió advertencias existentes de `MODULE_TYPELESS_PACKAGE_JSON`; sin fallos. |
| `npm run test:reports:lease:local` | Aprobado (14/14 controles): proyecto Supabase desechable, migraciones locales, 13 pgTAP, Auth/JWT sintéticos, rechazo cross-tenant/rol/anónimo, carrera concurrente y HTTP/exportación. El script confirmó limpieza del stack/volúmenes. |
| `npm run test:security:matrix:local` | Aprobado: seis suites pgTAP, 142 aserciones, en proyecto Supabase aleatorio desechable. Incluye tenant/RLS/roles, memberships, sucursales, ACL de RPC/credenciales y escáner con dispositivo desconocido, tenant/sucursal cruzados, QR revocado y cero eventos/sesiones/contadores PIN tras rechazos. El runner eliminó el stack y verificó que la instancia QR preexistente no cambiara. |
| `npm run build` | Aprobado (código 0), Next.js 16.4.0. `.env.local` fue detectado por Next; no se imprimieron valores de entorno. |
| `npm run test:pin-lockout:db` | No ejecutado: requiere un workdir y URL PostgreSQL locales configurados como proyecto QR PIN desechable. No se reutilizó una instancia compartida ni se imprimieron variables. La prueba Node de PIN sí pasó dentro de `npm test`. |
| Matriz `tests/security-jwt-matrix.integration.mjs` | Omitida intencionalmente: su configuración apunta a Testing; no se ejecutaron pruebas remotas. |

La integración lease sí valida PostgreSQL/Auth real local para ese recurso; no constituye la matriz completa de autorización de todas las RPC, tablas y rutas.

## Recomendaciones priorizadas

1. **P0 operacional:** mantener QR-003 en curso y verificar su despliegue únicamente mediante el procedimiento separado autorizado. No usar intentos PIN sobre empleados reales.
2. **P1 evidencia:** completar una matriz local aislada de permisos para funciones RPC, RLS y rutas críticas; incluir denegaciones de otra empresa/sucursal y estado sin efectos secundarios.
3. **P1 entorno:** si se autoriza una auditoría remota de solo lectura, comparar por separado Testing y Producción; revisar refs, historial, cuerpos SQL, ACL, RLS y configuración Auth sin tratar snapshots anteriores como actuales.
4. **P2 mantenimiento:** hacer que los tests de SQL y API críticos se ejecuten en CI en infraestructura aislada con fixtures efímeras; nunca inyectar secretos o datos personales en logs/artefactos.
5. **P2 revisiones futuras:** para cada RPC privilegiada, conservar una lista de funciones/ACL esperadas y comprobar cambios de `search_path`, owner, `EXECUTE`, identidad y alcance tenant.

## Condiciones antes de QR-002

- Cerrar/verificar los controles de membresía activa, revocación, destinatario y empresa en el flujo de invitación.
- Ejecutar pruebas locales positivas/negativas para expiración, revocación, aceptación por usuario incorrecto, consumo único, cambio de rol y vinculación opcional del expediente.
- Confirmar que errores no permitan enumerar otras empresas/correos y que el servicio administrativo permanezca solo en servidor.
- Aclarar el estado actual de QR-003 en Testing por su canal de despliegue separado. QR-002 no debe usar una invitación como bypass de PIN o de permisos.
- No considerar QR-004 concluida mientras falte la matriz de autorización acordada o existan hallazgos de severidad alta sin resolver.

## Estado

**QR-004: en curso; matriz SQL multiempresa local completada para los casos descritos.** Se añadió solo un test pgTAP y su runner; no se modificaron migraciones ni lógica funcional. Testing y Producción no se consultaron ni modificaron. Este documento no certifica el estado remoto ni autoriza una migración o despliegue.
