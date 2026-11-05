# QR-004 — Fase 10.2: validación dirigida de brechas residuales

**Estado:** pruebas locales dirigidas aprobadas; QR-004 continúa **En curso**. QR-003 permanece **P0, pospuesta y NO-GO**.
**Base:** `baa99e44e3515f7aeb03df1add5e56a6e4fd7e57`.
**Rama:** `audit/qr-004-phase10-residual-gaps`.
**Entorno:** Supabase local desechable, proyecto aleatorio `qr004_disposable_*`, datos sintéticos `.invalid`, 27 migraciones versionadas. Ningún proyecto alojado fue enlazado o consultado.

## Alcance y brechas elegidas

Se atendieron las prioridades de Fase 10.1 que pueden comprobarse sin PIN, QR ni operaciones de asistencia:

1. `public.bootstrap_first_company` y `private.bootstrap_first_company`: ACL, invocación sólo con `service_role` en su contrato legítimo, creación inicial, asignación de owner sintético, idempotencia y rechazo de replay incompatible/segundo bootstrap.
2. Helpers `private.has_company_permission`, `private.is_company_owner`, `private.can_access_branch` y `private.can_manage_branch`: llamadas directas bajo `authenticated`, con owner/admin/supervisor/empleado, membresía inactiva, permiso revocado, sucursales A1/A2/B1, usuario con varias empresas y empresa ajena.
3. `private.guard_company_membership_owner`: rechazos de cambio de rol/deactivación por las RPC administrativas y verificación del invariante de último owner en los caminos de trigger.
4. `private.write_audit_log`: observación indirecta mediante actualización sintética permitida de sucursal; verificación de tenant, actor, acción, recurso, antes/después, cantidad de filas y campos registrados.

La selección evita duplicar suites previas de invitaciones/supervisores y no intenta incrementar cobertura por conteo. Las cinco funciones `BLOCKED` de Fase 10.1 permanecen excluidas.

## Matriz de resultados

| Función/control | Actor y alcance sintético | Caso permitido | Caso denegado / integridad | Evidencia nueva |
|---|---|---|---|---|
| `public.bootstrap_first_company` → `private.bootstrap_first_company` | `service_role` real del stack local, owner Auth sintético; DB inicialmente sin empresas | Primer bootstrap crea una empresa y su membresía owner; repetición idéntica conserva la misma solicitud | `anon`/`authenticated` carecen de `EXECUTE`; llamadas cliente denegadas; replay con valores distintos (`22023`) y request nuevo tras bootstrap (`23505`) no cambian el conteo de empresas ni el ledger | **DIRECT** al wrapper público; **INDIRECT** a la implementación privada llamada por el wrapper. SQLSTATE y snapshots verificados |
| `private.has_company_permission` | owner A, admin A con override, admin B, admin multiempresa, empleado e identidad con membresía inactiva | Permisos de lectura/gestión se resuelven sólo en memberships activas y empresas correspondientes | Override `false`, rol empleado, membresía inactiva y tenant ajeno devuelven `false`; rol admin no adquiere `overtime.manage` | **DIRECT** |
| `private.is_company_owner` | owner A/B, admin e identidad inactiva | Owner activo sólo en su empresa | Admin, owner de otra empresa e identidad inactiva no se consideran owner | **DIRECT** |
| `private.can_access_branch` | Supervisor activo de A asignado a A1; A2 y B1 no asignadas | Lee el alcance permitido en A1 | A2 sin asignación, sucursal de B y membership revocada no autorizan acceso | **DIRECT** |
| `private.can_manage_branch` | Admin con `company.read` + `schedules.manage`; supervisor de A con `attendance.adjust`; empleado | Admin administra el ámbito empresarial conforme a su permiso; supervisor opera en su sucursal asignada | Sucursal no asignada, permiso explícitamente revocado, rol empleado y membership inactiva rechazan el control | **DIRECT** |
| `private.guard_company_membership_owner` | Admin con permiso de gestión y owner sintético de A | Roles administrativos siguen las reglas de su RPC | `change_company_membership_role(..., owner)` rechaza (`22023`); admin no puede desactivar un owner (`42501`). Las guardas de deactivación/eliminación del último owner rechazan (`23514`) | **DIRECT** a las RPC; **INDIRECT** al trigger. Para el invariante interno de UPDATE/DELETE se usó el harness PostgreSQL `postgres` con claims sintéticos; esto no se presenta como una operación SQL disponible al cliente. Se verificó que authenticated no tiene DML directo sobre memberships |
| `private.write_audit_log` (trigger) | Owner A actualiza A1; admin A intenta modificar B1 | Exactamente un evento `UPDATE` con company A, actor owner A, tabla/ID de sucursal y valores antes/después correctos | La operación entre empresas deja B1 intacta y no agrega auditoría en B | **INDIRECT**, mediante el trigger activado por UPDATE; no se invocó artificialmente la función trigger |

Todos los fixtures se ejecutaron dentro de `BEGIN … ROLLBACK`. La suite no creó sesiones/eventos ni filas de asistencia. En el evento de auditoría de sucursal se comprobó que las claves registradas pertenecen al registro de sucursal; no se incluyeron campos ajenos a esa entidad.

## Aislamiento del runner

Se añadió `npm run test:security:phase10-residual:local`, usando `tests/qr004-auth-matrix.local.integration.mjs --phase10-residual-only`.

- El modo permite exclusivamente `qr004_phase10_residual_authorization_test.sql` y copia exactamente las 27 migraciones rastreadas (`git ls-files` comprueba el número).
- Usa `project_id` aleatorio, bloque de puertos no ocupado y endpoints loopback; sanea variables `SUPABASE_*`, `POSTGRES*` y `DATABASE_URL` del entorno de la CLI.
- No usa `--linked`, no obtiene estado/credenciales de proyectos alojados, y excluye GoTrue, PostgREST, Kong, Mailpit y servicios no necesarios.
- No inicia Next.js, Auth HTTP, navegador ni runners E2E. La suite tiene transacción y `ROLLBACK`; el `finally` detiene sólo el `project_id` aleatorio y elimina el temporal.
- La salida final verificó que no quedaran contenedores/volúmenes/redes del proyecto desechable y que se conservaran los recursos Docker preexistentes.
- El runner valida que la suite declare un plan positivo, que contenga `BEGIN`/`ROLLBACK`, que no llame a `scan_employee_attendance`, `confirm_employee_attendance` o `verify_employee_pin`, y que no inserte sesiones/eventos.

Las fixtures previas a las operaciones se insertan por el rol de prueba de la base, como preparación local, no como simulación de usuario. Las comprobaciones de negocio se ejecutan bajo `authenticated`; `service_role` se utiliza únicamente para probar el bootstrap que tiene explícitamente ese contrato. El harness `postgres` sólo prueba el invariante interno del trigger, no las capacidades del cliente.

## Validaciones y resultados

| Comando | Resultado |
|---|---|
| `npm run test:security:phase10-residual:local` | **59/59 PASS**; una suite; migraciones aplicadas sólo en la DB local desechable; rollback y cleanup PASS |
| `npm run test:security:rpc-ci:local` | **115/115 PASS** (27 + 26 + 62); modo restringido, sin HTTP/Next.js/PIN/scan/asistencia; cleanup PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `node --check tests/qr004-auth-matrix.local.integration.mjs` | PASS |
| `git diff --check` | PASS |

En el desarrollo de la fixture hubo ejecuciones incompletas que revelaron problemas del test (claims de actor/snapshots/override mal configurados); se corrigieron antes de la medición final. No se confirmó una vulnerabilidad de aplicación. El resultado 59/59 corresponde a la ejecución final del SQL de este commit de trabajo, no a CI.

No se ejecutaron `npm test`, matriz general, E2E ni GitHub Actions: la matriz general contiene `qr004_scanner_authorization_test.sql`, que realiza un scan sintético con verificación de PIN. El run histórico `41942830088` fue SUCCESS en el SHA base y no valida estos cambios locales. No se modificó el workflow.

## Hallazgos, limitaciones y cobertura restante

- **Vulnerabilidad nueva reproducida:** ninguna en los escenarios anteriores. No se modificó lógica funcional, migraciones, RLS ni grants.
- El bootstrap se validó mediante el wrapper servidor de `service_role`, en un estado de base realmente vacío dentro del stack local. No se ejecutó `service_role` para representar a un usuario ordinario.
- El disparador de auditoría se validó por efecto observable, no por invocación directa. La prueba demuestra los campos de una actualización de sucursal sintética, no la política de retención de auditoría ni todos los triggers del esquema.
- No se cubrieron todas las combinaciones de los 46 `SECURITY DEFINER`, los 50 métodos HTTP ni las siete Server Actions. Persisten brechas de rutas/filtros, carreras de membresía/Auth, revisión remota segregada y paridad de Testing/Producción.
- El trigger de último owner para DELETE sólo se ejercitó por harness interno porque el cliente no posee DML directo y no hay API pública de borrado. Se verifica el invariante de integridad, no un endpoint inexistente.
- No se consultó Testing ni Producción. La evidencia describe las migraciones canónicas locales exclusivamente.
- QR-003 no se modificó y sigue P0/NO-GO; QR-004 permanece En curso.

## Archivos de esta fase

- `supabase/tests/qr004_phase10_residual_authorization_test.sql`
- `tests/qr004-auth-matrix.local.integration.mjs`
- `package.json`
- `docs/QR-004-PHASE10-RESIDUAL-VALIDATION.md`
- `docs/QR-004-PHASE10-RESIDUAL-GAPS.md` (apéndice con actualización de cobertura)
- `TASKS.md`

No se hizo commit, push, PR, merge, workflow ni despliegue. La rama local y los cambios documentales preexistentes de Fase 10.1 se conservaron.

## Siguientes acciones

1. Revisar/publicar esta evidencia en una fase autorizada aparte; no integrar automáticamente la suite al CI general.
2. Aclarar el alcance permitido del workflow general si se planea ejecutarlo, porque contiene una llamada sintética a scan/PIN.
3. Priorizar pruebas locales de los restantes casos P1 no bloqueados y planificar auditorías read-only separadas de Testing y Producción con autorización específica.
4. Mantener QR-004 En curso hasta cubrir los dominios críticos restantes y la revisión remota segregada; mantener QR-003 P0/NO-GO.

## Consolidación de Fase 10.3 — revisión local

### Revisión de la suite y el runner

La suite versionable declara `plan(59)` y está envuelta en `BEGIN`/`ROLLBACK`. Sus fixtures son identidades `.invalid`, UUID sintéticos, dos empresas y tres sucursales. Las pruebas de negocio cambian explícitamente a `authenticated` y cargan claims sintéticos; `service_role` se usa únicamente para probar el wrapper de bootstrap cuyo contrato requiere ese rol. El rol `postgres` aparece solo en el harness para probar la guarda interna del último owner; la suite comprueba que `authenticated` no tiene DML directo en memberships. No se conceden permisos a actores de prueba para simular acceso normal. El UPDATE de sucursal autorizado verifica el trigger de auditoría; el UPDATE cruzado se rechaza sin cambio ni fila de auditoría. El runner además comprueba plan/resultado, `BEGIN`/`ROLLBACK` y ausencia de llamadas a RPC PIN/scan o inserciones de sesiones/eventos.

El modo `--phase10-residual-only` selecciona exactamente `qr004_phase10_residual_authorization_test.sql`; es mutuamente excluyente con los otros modos aislados, E2E y performance. Copia solo las 27 migraciones que Git rastrea, reescribe la configuración en un directorio temporal, genera un project ID aleatorio, asigna puertos libres y sanea del proceso CLI variables de conexión heredadas. Sus comandos son locales (`start`, `db reset --local`, `test db --local`, `stop --project-id`); no llama `link`, `--linked`, `db push` ni API remota. El teardown comprueba ausencia de recursos con ese ID, preservación de los recursos Docker preexistentes y elimina el temporal. Los modos anteriores mantienen sus suites asignadas; el runner rechazará más de un modo aislado o mezclar uno con E2E/performance.

### Revalidación local de este paquete

Fecha de repetición: **2026-11-04**. El primer intento de la suite Fase 10.2 se detuvo antes de iniciar Supabase porque el sandbox no tenía permiso para abrir el socket Docker. No dejó proyecto ni recursos parciales. La repetición autorizada con acceso al Docker local produjo:

| Comando | Resultado de esta repetición |
|---|---|
| `npm run test:security:phase10-residual:local` | **59/59 PASS**; suite única, stack/datos eliminados, recursos preexistentes preservados |
| `npm run test:security:rpc-ci:local` | **115/115 PASS** (27 + 26 + 62); stack/datos eliminados, recursos preexistentes preservados |

Estos son resultados locales reales; no equivalen a CI de GitHub. No se ejecutaron en esta repetición las otras validaciones de la tabla anterior.

### Inventario global y pendientes

Fase 10.1 inventarió **46 funciones `SECURITY DEFINER`**: 32 con evidencia DIRECT, 7 INDIRECT, 1 HTTP, 1 STATIC-only y 5 BLOCKED. La suite 10.2 mejora la evidencia dinámica de bootstrap, helpers de empresa/sucursal/rol, protección del último owner y auditoría. No completa los 46 objetos ni todas las combinaciones de métodos HTTP/RPC/Server Actions. Permanecen riesgos de cobertura multiempresa y revocación, carreras de Auth/membresía, paridad remota y revisión segregada read-only. Las cinco funciones bloqueadas por el alcance QR-003 son `private.guard_attendance_event`, `private.record_attendance_event`, `private.review_attendance_adjustment`, `private.sync_attendance_event` y `private.verify_employee_pin`; no se invocaron. QR-003 es P0/NO-GO.

Para cerrar QR-004 todavía se requieren pruebas dirigidas para los riesgos P0/P1 permitidos que siguen sin cobertura directa suficiente, cierre de brechas de Route Handlers/RPC/Server Actions, aclaración/validación CI compatible con la autorización vigente y revisión remota segregada de cada entorno. La tabla de condiciones de cierre y la matriz por función están en [QR-004-PHASE10-RESIDUAL-GAPS.md](QR-004-PHASE10-RESIDUAL-GAPS.md).

### CI y publicación autorizada

El CI general incluye `qr004_scanner_authorization_test.sql`, cuyo caso permitido llama `scan_employee_attendance` con el PIN sintético válido `123456` y alcanza la verificación de PIN. La suite local restringida de 115 aserciones no verifica PIN, no escanea ni registra asistencia. La autorización del propietario para esta publicación incluye expresamente que el CI general ejecute ese caso con datos sintéticos en infraestructura desechable; no extiende ese permiso a Testing/Producción ni a empleados reales.

Se añadió al workflow un paso aislado para `npm run test:security:phase10-residual:local`, manteniendo intactos los pasos generales, el timeout de 30 minutos y las 115 regresiones. El paso ejecuta exclusivamente la suite de 59 aserciones. En el SHA `31fcd219d263c14299abb42cd511ef77cc9f9d9a`, los runs push #41951434187 y PR #41951463431 terminaron `SUCCESS` (13:14 y 12:52). Ambos logs registran `ASSERTIONS qr004_phase10_residual_authorization_test.sql: 59/59 PASS`, limpieza de stack y datos, y SUCCESS para lint, typecheck, npm test, restauración, lease, matriz general, 115 regresiones RPC, E2E y build. Este CI valida el commit indicado; cualquier modificación posterior de código o workflow requiere validar el nuevo SHA.

No se alteró ni eliminó la prueba sintética existente de PIN/escaneo. La publicación y CI general están autorizados por el propietario en el prompt de publicación de Fase 10; esta autorización no cubre accesos alojados ni escrituras remotas.

**Resultado posterior:** la autorización de publicación fue concedida; el paquete se publicó como PR #31 y ambos workflows descritos arriba terminaron SUCCESS. Esto lo deja **READY para revisión**, no para el cierre de QR-004. No fusionar ni desplegar en esta fase. QR-004 continúa En curso, QR-003 sigue P0/NO-GO. No se accedió a Testing o Producción.

## Criterios verificables propuestos para Fase 10.4

Estos criterios son una propuesta para la siguiente fase local; no declaran QR-004 cerrada ni amplían las autorizaciones actuales:

1. **Inventario reproducible:** fijar el SHA y regenerar o validar el inventario de 46 funciones `SECURITY DEFINER`, 50 métodos de 33 Route Handlers y siete Server Actions. Cada fila debe enlazar función/ruta, firma/método, tenant/sucursal, actor, privilegio efectivo, efecto lateral y evidencia con clasificación DIRECT/INDIRECT/HTTP/STATIC/BLOCKED.
2. **Plan por brecha:** para cada riesgo P0/P1 que no esté bloqueado por QR-003, seleccionar una prueba local concreta con actor sintético, caso permitido, caso denegado y snapshot de datos/auditoría cuando la operación pueda escribir. Las funciones bloqueadas deben permanecer explícitas y no invocarse.
3. **Brechas de cobertura:** cerrar o justificar con evidencia las filas pendientes de rutas, filtros, revocación concurrente, RPC y Server Actions; una mención de llamada indirecta no cuenta como cobertura directa. No inventar HTTP para Server Actions.
4. **Aislamiento:** ejecutar únicamente suites específicas en Supabase local desechable, con migraciones canónicas rastreadas, puertos/proyecto aleatorios, sin link remoto ni variables de conexión heredadas, fixture transaccional/rollback y verificación de teardown/preservación de recursos.
5. **Comprobación de seguridad:** validar permisos efectivos bajo roles reales `anon`/`authenticated`/`service_role` solo donde correspondan al contrato; ningún permiso se amplía para simular un actor. Los rechazos de escritura no deben cambiar filas ni auditoría.
6. **Resultados reproducibles:** suite objetivo, scripts estáticos permitidos y `git diff --check` deben pasar en el SHA evaluado; guardar conteos reales, log sanitizado, limpieza y cualquier fallo inicial recuperado. No contar un check histórico ni cancelado como PASS del SHA nuevo.
7. **CI gobernado:** no ejecutar matriz general, E2E, `npm test` ni CI que incluya `qr004_scanner_authorization_test.sql` hasta recibir autorización explícita para su verificación de PIN sintético válido. Mantener workflow y pruebas intactos.
8. **Cierre local:** no declarar completa la auditoría local mientras existan casos P0/P1 permitidos sin prueba o justificación aprobada, hallazgos confirmados sin regresión o clasificaciones/evidencias sin trazabilidad.
9. **Cierre global separado:** aun si se satisface el cierre local, QR-004 seguirá en curso hasta la revisión remota segregada/read-only autorizada de Testing y Producción, más resolución de diferencias por entorno. No extrapolar un ambiente al otro.

La aceptación de Fase 10.4 deberá registrar explícitamente qué criterios pasaron, cuáles permanecen bloqueados por QR-003/CI y cuáles requieren revisión remota. QR-003 permanece P0/NO-GO durante esta propuesta.
