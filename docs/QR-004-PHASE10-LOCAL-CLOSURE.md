# QR-004 — Evaluación de cierre técnico local, Fase 10

**Estado de auditoría:** En curso; no se declara cerrada.
**Rama de evaluación:** `audit/qr-004-final-local-closure`.
**Base de `main`:** `49025160f2d9765d00c73aeb2e2bdfda4fc9744c` (merge de PR #31).
**Alcance:** consolidación de evidencia 10.1–10.3 y pruebas locales dirigidas finales de API/Auth, carreras y Server Actions.
**Límite:** actualización del 2026-11-04 consultó exclusivamente metadatos read-only de Testing. Production no estuvo disponible. No hubo escrituras remotas, migraciones, despliegues ni lectura de filas personales.

## Dictamen

**Cierre técnico local: NOT READY.** La evaluación final añadió evidencia dinámica para una selección del riesgo R10-05, una carrera revocación/aceptación y las Server Actions prioritarias. No satisface aún los criterios de cierre de QR-004: la cobertura R10-05 sigue parcial en los 50 métodos, otras carreras y acciones conservan límites, cinco funciones P0 dependen del alcance QR-003 y la revisión remota segregada permanece pendiente. Los resultados 27/27, 59/59 y 115/115 son suites específicas, no una certificación integral de seguridad.

**Cierre de seguridad alojada: BLOCKED.** No se obtuvo evidencia nueva de configuración efectiva en los entornos alojados, por las restricciones de esta tarea.

**Aceptación de lanzamiento: separada.** QR-011 permanece P1 / Bloqueada y depende de QR-003 y QR-004. Su lista operativa no se satisface con este paquete.

## Criterios verificables y estado

| Criterio | Estado | Evidencia | Brecha / acción pendiente |
|---|---|---|---|
| Inventario reproducible de funciones, rutas y acciones | **PASS, alcance documental** | Fase 10.1 enumera 46 funciones `SECURITY DEFINER` (32 DIRECT, 7 INDIRECT, 1 HTTP, 1 STATIC-only, 5 BLOCKED), 33 Route Handlers / 50 métodos y siete Server Actions. | Revalidar el inventario frente a cambios futuros y completar pruebas donde la clasificación no sea directa. Los conteos no implican que cada camino esté probado. |
| Prueba dirigida de bootstrap, permisos, tenant/sucursal, membresía, último owner y auditoría | **PASS, cobertura seleccionada** | `qr004_phase10_residual_authorization_test.sql`: plan 59; ejecución local documentada 59/59 con fixtures sintéticas, `BEGIN`/`ROLLBACK` y teardown. | No prueba todos los flujos ni todas las combinaciones de los 46 objetos. |
| Regresiones RPC previas | **PASS, cobertura seleccionada** | Modo restringido: 115/115 (27 + 26 + 62), sin PIN/scan/asistencia. | No sustituye la matriz general ni cubre cada RPC/Route Handler/Server Action. |
| Aislamiento de suites de Fase 10.2 | **PASS, local** | Modo exclusivo `--phase10-residual-only`; proyecto Supabase y puertos temporales; sólo migraciones canónicas; variables heredadas saneadas; sin `--linked`; asserts impiden scan/PIN e inserts de asistencia; `ROLLBACK` y cleanup verificados. | El resultado de GitHub Actions para el SHA de publicación todavía debe comprobarse en el run asociado. |
| Permisos efectivos, denegaciones y ausencia de efectos inesperados en la suite dirigida | **PASS, escenarios incluidos** | Casos autorizados/denegados con roles y claims sintéticos, snapshots y comprobación del evento de auditoría. | La cobertura de operaciones excluidas o no accesibles en la fase no cuenta como validada. |
| Brechas P0/P1 restantes de RPC, API y Server Actions | **BLOCKED / pendiente** | La matriz fase 10.1 conserva brechas con clasificación y referencias. | Cubrir o justificar cada caso permitido restante con pruebas aisladas, sin simulaciones HTTP inventadas para Server Actions. Resolver por separado dominios prohibidos por QR-003. |
| Funciones relacionadas con asistencia/PIN bloqueadas | **BLOCKED por QR-003** | `private.guard_attendance_event`, `private.record_attendance_event`, `private.review_attendance_adjustment`, `private.sync_attendance_event` y `private.verify_employee_pin` no se invocaron en Fase 10.2. | No cuentan como aprobadas. QR-003 permanece P0 / NO-GO; se requiere autorización y criterio separado para validar su dominio. |
| Revisión de carreras de autorización/revocación y consistencia de auditoría | **PARCIAL / pendiente** | Se verificaron casos dirigidos y efectos auditables descritos en la suite. | Faltan escenarios sistemáticos de concurrencia, revocación entre validación y escritura, y cobertura de cada operación relevante. |
| CI del SHA de implementación | **PASS** | Push run #41951434187 (13:14) y PR run #41951463431 (12:52), ambos `SUCCESS` para `31fcd219d263c14299abb42cd511ef77cc9f9d9a`. Los logs incluyen `ASSERTIONS qr004_phase10_residual_authorization_test.sql: 59/59 PASS` y teardown PASS. Los dos runs pasaron instalación, lint, typecheck, `npm test`, restore, lease, matriz general, 115 RPC, nueva suite 59, E2E y build. | Si cambia el código/workflow, exigir nuevos checks del SHA actualizado. Los runs históricos de `main` no validan este PR. |
| Revisión de seguridad alojada por entorno | **BLOCKED por alcance** | No hubo consultas remotas en esta fase. | Requiere autorización read-only específica, evidencia separada para cada entorno y reconciliación de diferencias. No extrapolar el estado de Testing a Producción ni viceversa. |
| Aceptación operativa del lanzamiento | **BLOCKED en QR-011** | QR-011 sigue P1 / Bloqueada, dependiente de QR-003 y QR-004. | Mantener sus criterios: asistencia QR/PIN, dispositivos físicos y cámara, conexión, reglas, reportes, advisories npm, aceptación en Testing, backup/recuperación y decisión de lanzamiento. |

## Evidencia de fases consolidadas

- **Fase 10.1:** inventario estático y clasificación de las 46 funciones privilegiadas, endpoints y Server Actions en [brechas residuales](QR-004-PHASE10-RESIDUAL-GAPS.md). No confirmó vulnerabilidad nueva; documenta cobertura y riesgo residual.
- **Fase 10.2:** suite SQL versionable de 59 aserciones, aislada mediante modo propio del runner. Resultado local reportado: 59/59. La suite no invoca RPC de PIN/escaneo ni crea sesiones/eventos de asistencia.
- **Fase 10.3:** revisión de aislamiento, modos previos y cierres administrativos en [validación residual](QR-004-PHASE10-RESIDUAL-VALIDATION.md). Regresiones restringidas 115/115 documentadas.
- **CI:** se agregó un solo paso de Fase 10.2. Se mantienen `npm ci`, lint, typecheck, `npm test`, restore sintético, lease de reportes, matriz general, 115 regresiones, E2E, build y timeout de 30 minutos. El CI general conserva su prueba ya existente de PIN sintético válido en stack local desechable. La autorización del propietario cubre esa ejecución de CI, pero no Testing/Producción.
- **Cierres administrativos:** QR-002, QR-005, QR-006 y QR-007 permanecen **Hecha** en el alcance documentado; QR-009 conserva su estado previo. Esto no equivale a aceptación de lanzamiento.

## Riesgos y condiciones para cerrar QR-004

1. No hay cobertura directa completa para todas las funciones privilegiadas, métodos HTTP y Server Actions.
2. Permanecen casos de revocación/cambio de autorización concurrente y trazabilidad de auditoría que requieren pruebas explícitas por operación.
3. Cinco funciones de asistencia/PIN no se validaron en esta fase; las dependencias y cualquier ejecución autorizada se gobiernan por QR-003.
4. No existe evidencia remota nueva que pruebe paridad de configuración, grants, RLS o migraciones efectivas por entorno.
5. CI debe pasar en el SHA nuevo; el historial de CI de la base no cuenta como validación de este paquete.
6. El cierre local requiere resolver o justificar formalmente todos los casos P0/P1 permitidos y conservar evidencia reproducible. El cierre global de QR-004 además exige revisión remota segregada autorizada.

No se rebajó severidad ni se amplió privilegio para hacer pasar pruebas. No se modificaron código funcional ni migraciones.

## Relación con tareas de lanzamiento

- **QR-003:** P0, pospuesta y **NO-GO**. La corrección local no significa aplicada o validada en Testing.
- **QR-004:** **En curso**; cierre técnico local y revisión alojada todavía incompletos.
- **QR-011:** P1, **Bloqueada**, dependiente de QR-003 y QR-004. Mantener todos los criterios de aceptación operativa documentados en `TASKS.md`.
- **QR-002/005/006/007:** **Hecha** dentro del alcance de desarrollo, auditoría o automatización correspondiente; no autoriza despliegue ni sustituye QR-011.

## Publicación y decisión

La publicación autorizada permitió crear el commit `31fcd219d263c14299abb42cd511ef77cc9f9d9a`, publicar la rama y abrir el PR #31. El CI general push y PR terminó SUCCESS; los logs de ambos muestran las 59 aserciones y cleanup. El PR está **READY para revisión**, pero QR-004 está **NOT READY para cierre técnico local ni aceptación de lanzamiento** hasta completar las brechas descritas. Un cambio posterior de código o workflow requiere validar su nuevo SHA. No hubo merge ni despliegue.

## Validación local final posterior a PR #31

Fecha local: **2026-11-04**. Base integrada: `49025160f2d9765d00c73aeb2e2bdfda4fc9744c`.

| Riesgo / control | Estado | Evidencia de esta ejecución | Límite restante |
|---|---|---|---|
| R10-03: bootstrap y privilegios iniciales | **PASS, suite seleccionada** | Fase 10: `qr004_phase10_residual_authorization_test.sql` **59/59** con fixtures sintéticas, transacción `ROLLBACK` y cleanup. | No cubre toda función privilegiada ni todas las combinaciones de rol/operación. |
| R10-05: autorización HTTP multiempresa | **PASS parcial** | Nuevo modo aislado: `/api/admin/access` rechazó anónimo (401), supervisor (403), administrador A sobre empresa B (403), ID de membresía de B bajo empresa A (404), y `company.manage` revocado (403); snapshots probaron cero cambios ante denegaciones. El owner autorizado sí desactivó un usuario sintético de A y escribió exactamente una auditoría. | No equivale a la matriz directa de los 50 métodos. Los handlers de ramas, empleados, horarios, credenciales QR y dispositivos conservan brechas por método/filtro/concurrencia ya enumeradas en `QR-004-PHASE10-RESIDUAL-GAPS.md`. Los endpoints de asistencia no se ejercitaron. |
| Carreras de autorización: revocación de invitación y aceptación | **PASS, secuencia controlada** | Dos conexiones locales independientes bloquearon la fila de invitación. La revocación autenticada se puso primero en cola; la Server Action `acceptInvitation` se puso después. Tras liberar la fila, quedó `revoked`, 0 membresías activas, 0 eventos de aceptación y 1 evento de revocación; la acción mostró el error de invitación revocada. | Valida este orden serializado de una invitación; no demuestra exhaustividad para cada RPC ni para revocación de membresía durante cada Route Handler. |
| Server Actions `chooseMembership` y `setAdminMembership` | **PASS, casos dirigidos** | Se usó el runtime real de Next y forms con IDs emitidos por Next. Selección de tenant propio; cambio de rol admin→supervisor; el cookie obsoleto no restauró `/api/company`; `setAdminMembership` no sustituyó cookie con rol ya degradado. | No se probaron todas las rotaciones de cookies/proveedores ni cada intercalación entre lectura de membresía y escritura de cookie. |
| Server Actions `setInvitationPassword` y `acceptInvitation` | **PASS, flujo positivo/negativo** | Invitación sin marca protegida rechazada antes de mutación; setup de contraseña escribió `raw_app_meta_data`; aceptación posterior produjo una membresía y un registro de auditoría. | Los fallos parciales/timeout de Auth conservan la evidencia histórica de la matriz previa; no se inyectaron de nuevo en esta ejecución restringida. |
| Error de invitación vencida/revocada | **Corregido y probado** | La acción emitía `error=expired`, pero la página redirigía a `no-company` antes de renderizarlo cuando no quedaban invitaciones. Se movió el mapa de errores antes de esa redirección y se conserva el mensaje de error conocido aunque la lista quede vacía. La prueba de concurrencia confirma el mensaje. | Corrección de presentación; no modifica la autorización ni el contrato de la RPC. |
| Regresiones RPC restringidas | **PASS** | `npm run test:security:rpc-ci:local`: **115/115** (27+26+62), sin aplicación Next ni funciones PIN/scan/asistencia. | No sustituye la matriz general. |
| Funciones PIN/asistencia (QR-003) | **BLOCKED** | No se invocaron. | QR-003 permanece P0/NO-GO; no se cuentan como aprobadas. |
| Paridad de entornos alojados | **BLOCKED / parcial** | Testing tuvo inspección read-only parcial; Production fue identificado como `INACTIVE` y sus listados de migraciones/esquema fallaron por timeout/no disponibilidad. | Completar comparación de funciones, expresiones RLS, grants y Auth en Testing y realizar revisión separada de Production cuando esté accesible. |
| CI posterior al merge de PR #31 | **PASS para el merge SHA** | Run push #41955351473, `SUCCESS`, SHA `49025160f2d9765d00c73aeb2e2bdfda4fc9744c`. Fue una ejecución automática del evento de merge; esta sesión no la inició. | No valida los cambios locales aún no publicados de esta rama. No se inició workflow nuevo. |

### Validación del nuevo modo y limpieza

`npm run test:security:authorization-races:local` completó **27 aserciones**. El modo usa un ID Supabase aleatorio, las migraciones canónicas, credenciales/identidades sintéticas y URLs loopback. La suite no sembró ni consultó sesiones/eventos de asistencia, no leyó estado PIN, no invocó escaneo/validación de PIN, no enlazó proyecto remoto y no usó `.env.local`. El teardown eliminó el stack y los temporales, y comprobó que se conservaran los recursos Docker preexistentes.

También pasaron `npm run lint`, `npm run typecheck`, `node --check tests/qr004-auth-matrix.local.integration.mjs` y `git diff --check`. No se ejecutaron `npm test`, matriz general, E2E, build ni GitHub Actions en esta tarea.

### Dictamen final local

**NOT READY para cierre local de QR-004.** No se confirmó una vulnerabilidad de autorización nueva. La prueba sí reprodujo un problema menor de presentación de errores de invitación, corregido con un cambio mínimo y regresión dinámica. El riesgo R10-05 tiene evidencia adicional pero permanece parcial: las filas no cubiertas directamente en las matrices API, los demás intercalados de revocación y varias combinaciones por sucursal continúan pendientes o deben justificarse con suites previas identificables.

**Cierre global BLOCKED:** las cinco funciones de asistencia/PIN siguen excluidas por QR-003 P0/NO-GO y falta la revisión remota segregada de migraciones, definiciones/propietarios, EXECUTE, RLS, grants, Auth y esquemas expuestos. QR-004 permanece **En curso**. QR-011 conserva estado P1/Bloqueada. No se hicieron commits, push, PR, merge ni despliegues en esta ejecución.

## Actualización de revisión final — 2026-11-04

SHA de base probado: `49025160f2d9765d00c73aeb2e2bdfda4fc9744c`; cambios locales no commiteados, detallados en [la revisión final](QR-004-FINAL-LOCAL-SECURITY-REVIEW.md).

- Suites locales sin PIN/scan/asistencia: carrera Auth/API **148 assertions PASS** (reemplaza el conteo inicial de 27); regresiones RPC **115/115 PASS**; Fase 10 **59/59 PASS**; E2E **23/23 PASS** sin requests a `/api/attendance/scan`; suites unitarias compatibles **67/67 PASS**. Cada stack desechable informó cleanup y preservación de Docker preexistente.
- `npm run lint`, `npm run typecheck`, build en copia temporal sin `.env*`, sintaxis Node y `git diff --check`: **PASS**. Build dejó advertencia de 27 trazas externas por el enlace a `node_modules`; compiló y generó las rutas correctamente.
- `npm test` y la matriz general **no ejecutados**: incluyen asistencia/PIN y scan válido con PIN, incompatibles con la exclusión QR-003 de esta tarea. Workflow intacto y no iniciado.
- Testing (`llxyziffgtqnzlguxhyt`): activo y saludable; 27 migraciones con versiones/nombres coincidentes. La actualización posterior del catálogo encontró 46 `SECURITY DEFINER`, 45 políticas permisivas y 32 tablas `public`/`private` (30 con RLS habilitada, ninguna con FORCE, dos privadas sin RLS). No se compararon cuerpos contra canónicos, ni se validaron todas las políticas/grants; configuración Auth no leída.
- Production (`jawdrhewabqajxnswhkn`): `INACTIVE`; catálogo de migraciones expiró por timeout y listado de tablas indicó que la base posiblemente no está accesible. No se reintentó conexión ni se infirió paridad.

**Dictamen actualizado:** QR-004 continúa **En curso / NOT READY**. R10-05 permanece parcial; no se completó la cobertura de rutas y métodos prioritarios ni todas las carreras. La revisión remota segregada está incompleta por Production y el alcance parcial de Testing. QR-003 permanece **P0 / NO-GO**. QR-011 conserva **P1 / Bloqueada**, dependiente de QR-003 y QR-004. No hubo commit, push, Actions, PR, merge o despliegue.

### Revalidación ampliada de rutas HTTP/Auth — 2026-11-04

Esta sección sustituye los conteos anteriores de **27 aserciones** del modo `--authorization-races-only`; aquellos números describen una ejecución anterior, no la matriz ampliada.

| Verificación | Resultado | Cobertura / límite |
|---|---|---|
| `npm run test:security:authorization-races:local` | **148 aserciones PASS** | Local desechable, usuarios y empresas sintéticos. Cubre las rutas documentadas de access, branches, employees, schedules/assignments, supervisors, supervisor-devices y emisión/rotación/revocación QR. Snapshots de filas/auditoría verifican denegaciones; el modo no invoca GET QR, porque su respuesta también expone si PIN está configurado, ni ningún endpoint o RPC PIN. Retiene la carrera controlada revocación/aceptación de invitación y Server Actions mediante Next real. Teardown y preservación de Docker preexistente PASS. |
| R10-05 restante | **PARCIAL; bloquea cierre** | No demuestra todos los 50 métodos/33 handlers, filtros/permissions en cada ruta, POST de solicitud de dispositivo y todos los escenarios de credencial, ni carreras de revocación/cambio de rol frente a cada handler. E2E y pgTAP previos aportan evidencia seleccionada, no exhaustividad. |
| Límites de QR-003 | **No ejecutado** | El modo no toca sesiones/eventos de asistencia, no llama a PIN, scan ni RPC de asistencia y no se conecta a entornos remotos. `npm test` y matriz general permanecen sin ejecutar porque incluyen esos escenarios. |

E2E: `QR004_CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e` pasó **23/23** en la última repetición, con cero solicitudes a `/api/attendance/scan` y teardown PASS. Hubo una repetición anterior con 22/23 por timeout transitorio de UI; por ello se reporta el último resultado junto con la variabilidad observada, no una garantía de estabilidad determinista.

El modo validó handlers a través de Next.js local enlazado a Supabase loopback y snapshots de PostgreSQL local. Los snapshots cubrieron branches, employees, schedule templates/days/breaks/assignments, asignaciones de supervisores, dispositivos, solicitudes de autorización y `audit_log`, no tablas de asistencia. Las pruebas de QR verificaron hash, rotación y revocación sin consultar estado PIN. La carrera ordenada explícitamente fue revocación/aceptación de invitación; otras carreras de revocación siguen pendientes.

**Estado al cierre de esta actualización:** QR-004 continúa **En curso / NOT READY**. La revisión remota segregada del 2026-11-04 sigue incompleta: Testing solo tuvo inspección parcial de catálogo; Production (`jawdrhewabqajxnswhkn`) está `INACTIVE` y las consultas de catálogo fallaron por timeout/no disponibilidad. No se presume paridad. QR-003 continúa **P0 / NO-GO** y QR-011 **P1 / Bloqueada**, dependiente de QR-003 y QR-004. No hubo escritura remota, commit, push, Actions ni despliegue.

### Revisión remota segregada actualizada — 2026-11-04

Testing: se confirmó el ref `llxyziffgtqnzlguxhyt`, estado `ACTIVE_HEALTHY`, y 27 versiones/nombres de migración. El inventario de catálogo incluyó 46 funciones `SECURITY DEFINER` (owner `postgres`, `search_path` vacío, sin EXECUTE observado para `anon`), 45 políticas permisivas y 32 tablas públicas/privadas (30 RLS habilitada, 0 FORCE; `private.bootstrap_requests` y `private.device_token_hashes` sin RLS). Se capturaron hashes de definiciones, pero no se contrastaron con SQL canónico; expresiones de políticas revisadas sin análisis exhaustivo; resumen de grants incompleto y configuración Auth no consultada. No se leyeron datos de negocio ni se escribió.

Producción: ref `jawdrhewabqajxnswhkn`, `INACTIVE`; el listado de migraciones expiró por timeout y el listado de tablas no estuvo disponible. No se obtuvieron catálogos ni configuración Auth y no se infirió paridad. Estos límites impiden completar la revisión segregada requerida.

El estado de pruebas HTTP/Auth final fue 148 aserciones (el resultado inicial 27 quedó sustituido), más 59/59 y 115/115 pgTAP, E2E 23/23, unitarias compatibles 67/67, lint, typecheck y build aislado PASS. `npm test` y matriz general no ejecutados por los escenarios PIN/scan/asistencia explícitamente excluidos. La evidencia ampliada cubre credenciales QR, supervisores y dispositivos seleccionados; R10-05 y las carreras no son exhaustivos. QR-004 permanece **En curso / NOT READY**; QR-003 **P0/NO-GO**; QR-011 **P1/Bloqueada**.
