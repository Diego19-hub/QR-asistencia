# QR-asistencia — Etapa 9.2: revisión de seguridad y plan de producción

Fecha: 11 de octubre de 2026
Commit revisado: `5644c1d012a1817187f1106780de5dc71227469a`
Alcance Supabase: únicamente `QR-asistencia-testing` (`llxyziffgtqnzlguxhyt`). No se consultó ni modificó producción (`jawdrhewabqajxnswhkn`). No se aplicaron migraciones, cambios de ACL, despliegues ni modificaciones a GitHub.

## Resultado ejecutivo

- No se encontró una ruta de acceso anónimo a las funciones o tablas privadas examinadas. El advisory `authenticated_security_definer_function_executable` identifica una superficie de invocación intencional, no demuestra por sí solo una omisión de autorización.
- Las 18 funciones `SECURITY DEFINER` en `public` permiten `EXECUTE` a `authenticated` y `service_role`, no a `anon`; todas tienen `search_path` vacío. Las funciones públicas están expuestas como RPC porque `public` sí es un esquema del Data API. Por eso sus validaciones internas siguen siendo una barrera crítica.
- En una transacción revertida, `anon` fue rechazado al invocar el RPC de cuota y consultar tablas privadas. Un rol `authenticated` con un `auth.uid()` sintético, sin membresía, fue rechazado por 28 invocaciones a funciones administrativas, de asistencia, QR y escáner, usando dos UUID de tenant sintéticos. La transacción terminó con `ROLLBACK`.
- La base de pruebas permanece sin usuarios ni fixtures: 0 usuarios Auth, empresas, membresías, sucursales, empleados, jornadas ni filas de cuota.
- **Pendiente de seguridad:** las pruebas no utilizaron sesiones JWT reales ni datos de tenants existentes. No prueban todavía owner/admin frente a objetos reales de otra empresa ni el rol supervisor con sucursal asignada. No se declara esa cobertura aprobada.

## Revisión de funciones privilegiadas

La inspección de catálogos remotos en el proyecto de pruebas confirmó 18 funciones públicas `SECURITY DEFINER`, `EXECUTE` negado a `anon`, permitido a `authenticated`, y `search_path=""` en todas. Las funciones internas privadas no están en los esquemas del Data API (`public`, `graphql_public`). El usuario `authenticated` tiene `USAGE` del esquema `private`, pero carece de privilegios de tabla sobre las tablas allí incluidas. `private.bootstrap_first_company` solo otorga `EXECUTE` a `service_role`.

| Área prioritaria | Funciones | Guardas observadas en el código versionado | Riesgo residual |
| --- | --- | --- | --- |
| Asistencia | `public.confirm_employee_attendance`, `public.scan_employee_attendance`, `private.record_attendance_event` | Sesión, membresía/rol supervisor, equipo asociado a supervisor y sucursal, empleado activo, token QR y PIN, secuencia/idempotencia y empresa antes del registro. El RPC de confirmación delega la escritura al helper privado. | Función pública invocable por cualquier usuario autenticado. Cambios futuros deben conservar guardas de empresa, sucursal, empleado y dispositivo. Pruebas negativas reales por tenant quedan pendientes. |
| Credenciales | `public.issue_employee_qr_token`, `public.revoke_employee_qr_token`, `public.set_employee_pin`, `public.get_employee_credential_status` | Permiso `employees.manage`, membresía activa owner/admin en la empresa y empleado que pertenece a esa empresa. QR se almacena como hash; PIN se almacena con bcrypt. | Riesgo alto por impacto si se debilita la comprobación de tenant/rol. No se escribieron credenciales durante esta revisión. |
| Dispositivos y asignaciones | `public.request_supervisor_device`, `public.redeem_supervisor_device`, `public.review_supervisor_device_request`, `public.revoke_supervisor_device`, `public.set_supervisor_branch`, `public.get_supervisor_scanner_context` | Sesión y permiso de dispositivos/escaneo; los registros se acotan por empresa; se comprueba que supervisor, sucursal, solicitud y dispositivo correspondan al mismo tenant y que la sucursal esté asignada/activa. | Deben seguir ejecutándose con roles y sucursales reales en testing antes de un cambio SQL. Las funciones son la frontera para escribir en tablas privadas sin grant directo. |
| Eliminación administrativa | `public.delete_schedule_template`, `public.delete_labor_rule_set` | Sesión, owner/admin activo, permiso de gestión, selección y bloqueo por empresa, comprobación de asignaciones e historial; las referencias concurrentes se protegen con FK/bloqueos. | Operaciones destructivas, pero con guardas y resultado explícito de bloqueado/no encontrado. No se probaron borrados con fixtures en esta etapa. |
| Reportes | `public.consume_report_export_quota` | `auth.uid()`, membresía activa owner/admin, `reports.read`; la clave de cuota incluye empresa y usuario. Escritura atómica por ventana de cinco minutos. | Necesaria para la cuota distribuida. La prueba HTTP previa en testing confirmó el 429. |
| Empresa inicial | `private.bootstrap_first_company` y wrapper `public.bootstrap_first_company` | Implementación verifica `auth.role() = service_role`, usuario Auth existente, empresa inicial ausente y clave de idempotencia; el wrapper invoker y el helper solo conceden ejecución a `service_role`. | Función de privilegio máximo. Mantener fuera del navegador y ejecutar solo desde entorno administrativo confiable. |

Otras funciones públicas enumeradas en `SECURITY-AUDIT.md` son listados administrativos de dispositivos, solicitudes, supervisores/sucursales. Deben conservar la comprobación de sesión, permiso y filtro de empresa. Las funciones privadas de permisos (`has_company_permission`, `is_company_owner`, `can_access_branch`) están concedidas a `authenticated` para apoyar RLS; no están expuestas como RPC por el esquema privado y no sustituyen la comprobación explícita de empresa de las funciones llamadoras.

### Pruebas negativas ejecutadas

En `llxyziffgtqnzlguxhyt`, una transacción usó `SET LOCAL ROLE anon` y luego `SET LOCAL ROLE authenticated` con un UUID de identidad sintético. Se invocaron directamente funciones de lectura/cambio de asistencia, QR/PIN, dispositivos, asignaciones, administración de horarios/reglas y contexto de scanner con dos UUID de empresa sintéticos. Las 28 invocaciones autenticadas fueron rechazadas con `42501`; la función no pudo devolver una respuesta exitosa. `anon` tampoco pudo ejecutar el RPC de cuota ni leer hashes QR o hashes de dispositivos. En otro bloque se rechazó SELECT autenticado a cuatro tablas privadas sensibles. Todo quedó dentro de transacciones revertidas.

Estas pruebas validan la denegación para una identidad sin membresía. **No** equivalen a JWT real ni demuestran la denegación de un administrador válido de A al solicitar el ID de un empleado, dispositivo o solicitud existente de B. Para autorizar producción hace falta ejecutar la matriz autenticada indicada al final con usuarios Auth de prueba, dos empresas reales sintéticas y registros centinela.

## Tablas privadas y avisos RLS

Inventario remoto de `private`:

| Tabla | RLS | Grants SELECT/escritura a `anon` o `authenticated` | Lectura del hallazgo |
| --- | --- | --- | --- |
| `device_authorization_requests` | activa, sin políticas | ninguno | Denegación por defecto; solo las funciones privilegiadas acceden. |
| `employee_pin_credentials` | activa, sin políticas | ninguno | Denegación por defecto; conserva hash y estado de bloqueo. |
| `employee_qr_tokens` | activa, sin políticas | ninguno | Denegación por defecto; conserva hashes, no tokens crudos. |
| `report_export_rate_limits` | activa, sin políticas | ninguno | Denegación por defecto; el RPC de cuota escribe bajo `SECURITY DEFINER`. |
| `bootstrap_requests` | desactivada | ninguno | El advisor marca RLS desactivada, pero actualmente no hay grants de tabla y el esquema `private` no está expuesto por PostgREST. Solo el helper de bootstrap privilegiado la utiliza. No se encontró acceso efectivo del cliente. |
| `device_token_hashes` | desactivada | ninguno | Igual que arriba; el escáner accede por helper privado privilegiado. Hash de token, sin token crudo. No hay acceso efectivo del cliente según los privilegios inspeccionados. |

El advisor de Supabase presenta como crítica cualquier tabla sin RLS y advierte las tablas con RLS sin políticas. En este esquema, el aviso de las dos tablas con RLS desactivada no demuestra exposición: no tienen privilegios de tabla para `anon`/`authenticated`; `private` no está en la lista de esquemas API local (`public`, `graphql_public`), y el rol `anon` tampoco tiene `USAGE` en `private`. Para tablas con RLS activa y sin políticas, el resultado práctico también es denegar filas; además no existen grants directos. No aplicar el SQL genérico del advisor sin verificar las funciones y propietarios que dependen de esas tablas. La recomendación es conservar grants mínimos y agregar pruebas que fallen si se concede acceso accidental; evaluar RLS de defensa en profundidad en una migración posterior, junto con pruebas de helpers/owner, sin cambiar el comportamiento del escáner.

El otro aviso relevante de Auth en la auditoría previa es la protección contra contraseñas filtradas deshabilitada. Habilitarla en Auth antes de producción y comprobar que login/alta responde correctamente a credenciales débiles, sin registrar contraseñas.

## Cinco alertas High de desarrollo

La última auditoría npm verificada antes de esta etapa informó cinco High en la cadena de herramientas de desarrollo, con `braces` como causa raíz en `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch`. No existe en esa evidencia una actualización segura compatible de la cadena; la alternativa que npm propuso requería bajar `eslint-config-next` a una versión incompatible con Next 16.4.0. El paquete no forma parte de las dependencias de producción (`npm audit --omit=dev` informó cero).

En esta ejecución, ambos comandos de `npm audit` quedaron **sin resultado actualizado** porque el runner no pudo resolver `registry.npmjs.org` (DNS). No se asume que el resultado anterior siga siendo actual. Antes del release, volver a correr ambos comandos con conectividad. Mitigaciones: mantener workflow con token de solo lectura y sin secretos de producción; no usar `pull_request_target` para ejecutar código no confiable; restringir quién puede cambiar `.github/workflows`; mantener lockfile; revisar y actualizar el paquete cuando exista una versión compatible; no usar `npm audit fix --force`.

## GitHub y protección de `main`

La consulta del estado de protección de la rama devolvió 403 por permisos del conector; GitHub también indicó que las rulesets no están disponibles para repositorios privados en el plan actual. No se pudo confirmar la configuración real de la rama. El repositorio sí es privado. Un push directo autorizado a `main` fue aceptado en el cierre anterior, por lo que hoy no hay una barrera efectiva para este usuario que obligue a integrar mediante PR.

Para protección efectiva del repositorio privado, GitHub documenta que branch protection/rulesets para repos privados requiere GitHub Pro, Team o Enterprise. Sin cambiar la visibilidad del repositorio, controles recomendados al habilitar un plan compatible:

1. Bloquear force push y borrado de `main`.
2. Exigir pull request con al menos una aprobación; exigir CODEOWNERS para SQL, autenticación, RLS, APIs de reportes y workflows.
3. Exigir el check `verify` de `.github/workflows/ci.yml` antes de integrar; descartar aprobaciones obsoletas tras nuevos commits.
4. Limitar quién administra reglas y quién puede hacer bypass; no permitir bypass rutinario de administradores.
5. Mantener `permissions: contents: read`, secretos de producción fuera de CI y un flujo de despliegue separado con aprobación de ambiente.

El conector no pudo leer las reglas actuales; el administrador debe confirmarlas en Settings → Branches/rulesets.

## Hosting: memoria y concurrencia

Benchmark sintético anterior, buffers completos en memoria: una exportación de 500 filas alcanzó 252.2 MB RSS para XLSX y 214.8 MB RSS para PDF; dos exportaciones concurrentes de 1,000 filas alcanzaron 472 MB RSS. Son mediciones locales, no del proveedor final. El tope HTTP de 500 se comprueba en servidor antes de serializar, pero el RPC permite hasta 10 solicitudes por usuario/empresa cada cinco minutos y **no limita cuántas generaciones corren simultáneamente**.

Requisito inicial conservador: instancia Node con al menos 2 GiB de memoria disponible para el proceso y concurrencia máxima de una exportación por instancia; no operar exportaciones de 500 filas con límite de 512 MB. Si se necesita concurrencia de dos, reservar al menos 3 GiB para la instancia y validar RSS/p95 en el proveedor con carga realista. Antes de escalar horizontalmente, implementar semáforo distribuido o límite de concurrencia en el runtime y probar solicitudes de 500 filas y ráfagas. Mantener el tope de 500; no habilitar generación de 1,000/5,000 hasta implementar streaming o trabajo en background y medir memoria en hosting.

## Plan de despliegue (no ejecutado)

1. **Preflight y backup:** fijar release SHA; revisar diff; confirmar proyecto destino por ID en CLI/dashboard; exportar backup lógico y confirmar que existe una ruta de restauración verificada. Asegurar que el punto de restauración precede a la migración.
2. **Variables:** configurar `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` para el proyecto correcto. Usar secretos de backend solo si una ruta realmente los necesita, sin prefijo `NEXT_PUBLIC_`; esta migración/API de cuota usa la sesión autenticada y no necesita `service_role` en Next. Verificar que variables preview/staging apunten a pruebas y que producción no use publishable key de testing.
3. **Migración primero:** aplicar `20261011232050_distributed_report_export_rate_limit.sql` en producción con procedimiento aprobado, tras revisar el ID `jawdrhewabqajxnswhkn`, historial, SQL y backup. Confirmar tabla/índice, RLS, grants privados y RPC/ACL/`search_path`; correr advisor y smoke SQL. No desplegar API nueva antes de la migración: esta invoca `consume_report_export_quota` y responde 503 si no puede obtener cuota.
4. **Aplicación después:** desplegar el commit aprobado que contiene la ruta de exportación y el límite servidor de 500. La migración precede al código. La migración es aditiva y el código previo no llama el nuevo RPC, por lo que se puede volver a desplegar la app anterior dejando tabla y función intactas.
5. **Canary:** validar login/admin, un reporte de la propia empresa, exportación XLSX/PDF, respuesta 401 sin sesión, 403 para rol/tenant ajeno, 413 sobre 500 jornadas y 429 + `Retry-After` al superar cuota. Confirmar cuatro hojas XLSX, PDF legible, ausencia de datos ajenos y de secretos.
6. **Monitoreo:** observar 4xx/5xx en `/api/reports/export`, errores del RPC, latencia, RSS, reinicios/OOM y filas de cuota; configurar alertas de memoria y error rate. Mantener el canary acotado y desactivar tráfico de exportación si se acerca al límite de memoria.

### Dependencia y rollback

La nueva API depende del RPC SQL: **migración antes de aplicación**. Si la migración falla, detener el release de la API. Si el despliegue de la app falla, volver al SHA anterior; no eliminar la migración durante el rollback porque no afecta al código anterior y su eliminación puede introducir una carrera con instancias nuevas. Corregir la migración con una migración forward-only probada en testing. Solo retirar tabla/función en otro cambio planificado después de confirmar que ninguna versión de la app las usa, con backup y ventana de mantenimiento.

## Gate para autorizar producción

- [ ] Repetir `npm audit` y `npm audit --omit=dev` con registry accesible; decidir formalmente sobre High dev-only y confirmar cero vulnerabilidades de runtime.
- [ ] Ejecutar pruebas negativas HTTP/RPC en testing con Auth JWT reales: dos admins en empresas A/B, un supervisor de A, IDs centinela existentes; probar cada lectura/escritura privilegiada desde tenant opuesto y confirmar estado de datos sin cambios.
- [ ] Verificar limpieza posterior y conteos cero de fixtures; conservar resultados sanitizados.
- [ ] Resolver la revisión de protección de `main`; hacer obligatorio CI/revisión o documentar limitación del plan privado actual.
- [ ] Habilitar protección contra contraseñas filtradas y evaluar el advisor Auth.
- [ ] Acordar hosting con 2 GiB y concurrencia 1 como mínimo inicial, o validar una configuración equivalente con prueba de carga.
- [ ] Confirmar backup/restauración y ventana, publicar migración antes de API, probar canary/rollback.
- [ ] Aprobación expresa del usuario para migración y despliegue a producción.

## Comprobaciones de esta etapa

Consultas de solo lectura y pruebas SQL transaccionales dirigidas exclusivamente a `llxyziffgtqnzlguxhyt`. `SECURITY-AUDIT.md` contiene la matriz previa de las 18 funciones públicas; esta revisión verificó de nuevo ACL/`search_path`, 28 denegaciones sin membresía, privilegios de las tablas privadas y el estado limpio del proyecto. No se aplicaron migraciones ni cambios persistentes. Las pruebas autenticadas por JWT real y la revisión visual de settings de GitHub siguen pendientes.

## Addendum de cierre Etapa 9.3

Se conserva este informe original. La reevaluación, resultados actuales, vulnerabilidades npm, configuración de Auth, revisión de GitHub, backup/restore, pruebas ejecutadas y decisión GO/NO-GO están en [SECURITY-AUDIT-ETAPA-9.3.md](SECURITY-AUDIT-ETAPA-9.3.md). Las pruebas JWT reales siguen pendientes; no deben inferirse como aprobadas a partir de las pruebas transaccionales con `auth.uid()` sintético.
