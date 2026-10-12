# QR-asistencia — Etapa 9.4B: plan de remediación del escáner

Fecha: 12 de octubre de 2026
Código de referencia: `9305ed70d1efeb6167f105753205b0c24e7e66a8`
Migración: `20261012030630_scanner_branch_scope_and_legacy_rpc_lockdown.sql`

## Alcance y estado

Este documento prepara una intervención para revisión. **No se consultó ni modificó producción** (`jawdrhewabqajxnswhkn`), no se aplicó SQL en producción y no se desplegó frontend. La migración ya está aplicada y validada únicamente en `QR-asistencia-testing` (`llxyziffgtqnzlguxhyt`). La aplicación en producción requiere autorización expresa posterior.

Los dos defectos abordados son: (1) un dispositivo de supervisor autorizado en A1 podía escanear a un empleado asignado a A2; y (2) `authenticated` podía invocar el RPC heredado `public.record_attendance_event` para registrar eventos fuera del flujo que exige PIN.

## Revisión del cambio y dependencias

La migración usa `CREATE OR REPLACE FUNCTION` para conservar las firmas públicas ya consumidas por el servidor, agrega comprobaciones de igualdad entre `employee.branch_id` y la sucursal del dispositivo en `scan_employee_attendance`, `confirm_employee_attendance` y el escritor privado, y revoca `EXECUTE` del wrapper legado para `PUBLIC`, `anon` y `authenticated`. También revoca acceso directo al helper privado.

Dependencias comprobadas en el código versionado:

- `src/app/api/attendance/scan/route.ts` llama `scan_employee_attendance` para preview y `confirm_employee_attendance` para movimientos confirmados. No llama al wrapper heredado.
- `private.scanner_device(company_id, device_token)` comprueba token del dispositivo, empresa, membresía activa de rol `supervisor`, permiso `attendance.scan`, perfil de supervisor y asociación de la sucursal.
- `private.verify_employee_pin(company_id, employee_id, pin)` valida el PIN; el token QR se compara mediante SHA-256 y no se devuelve ni persiste en texto plano.
- El escritor inserta eventos en `attendance_events`, crea una `attendance_session` en `clock_in` y actualiza el descanso asociado. Las transiciones e idempotencia se validan antes de delegar la escritura.
- La creación de la sesión consulta `branches`, `schedule_assignments`, `schedule_templates`, `schedule_template_days` y `labor_rule_sets` para conservar la captura del horario vigente.
- La tabla de sesiones conserva snapshots de jornada. La migración no ejecuta `INSERT`, `UPDATE` ni `DELETE` sobre sesiones, eventos, descansos o auditoría, y no altera tablas, restricciones o políticas RLS.

El historial de migraciones contiene la versión `20261012030630`. En Testing, las firmas SQL y el `search_path` vacío coinciden con la migración local. Los cuerpos almacenados en Postgres de las dos funciones públicas modificadas y del helper privado coinciden exactamente con el SQL local. Los grants observados: las funciones nuevas del escáner pueden ejecutarse por `authenticated` y `service_role`, no por `anon`; el RPC legado no permite `anon` ni `authenticated`. El helper privado no concede `EXECUTE` a roles API. El wrapper legado es `SECURITY INVOKER`; `service_role` conserva un grant explícito anterior, pero no ejecuta el helper privado. No se amplió ningún permiso.

La matriz de Testing con JWT reales se ejecutó antes de limpiar los fixtures: **44/44 RPC y 2/2 pruebas HTTP** aprobadas. Incluyó escaneo autorizado con PIN, entrada, descansos, salida, sucursal no asignada y denegación del RPC legado. Estas cifras son evidencia previa de Testing; no son una nueva prueba de producción.

### Riesgos técnicos del cambio

- `CREATE OR REPLACE FUNCTION` conserva firma y grants existentes, pero cada reemplazo puede bloquear brevemente la modificación de catálogo y las llamadas concurrentes a esa función. Ejecutar en ventana de baja actividad y observar latencia/errores de RPC.
- La nueva guarda de sucursal rechaza movimientos donde empleado y dispositivo no comparten `branch_id`. Si hay asignaciones operativas inconsistentes, el escaneo se negará hasta corregir esas asignaciones mediante el proceso normal.
- La revocación del wrapper es deliberada: un cliente antiguo que todavía invoque `record_attendance_event` recibirá denegación. La API de la versión actual no lo usa.
- La migración es transaccional, por lo que un error dentro de su aplicación revierte el DDL de esa transacción. **Eso no significa que el cambio sea reversible después de commit** ni que una restauración de backup sea inocua.

## Checklist previo obligatorio

No comenzar sin todas las casillas aprobadas:

- [ ] Autorización expresa para intervenir en producción y ventana acordada. Este plan por sí solo no autoriza la ejecución.
- [ ] Confirmar el identificador del proyecto dos veces: Dashboard y `supabase projects list`/CLI. Debe ser exactamente `jawdrhewabqajxnswhkn`; cancelar ante cualquier discrepancia.
- [ ] Confirmar rama de trabajo y SHA de release `9305ed70d1efeb6167f105753205b0c24e7e66a8`; revisar que incluya el archivo SQL correcto y sin cambios no revisados.
- [ ] Confirmar desde `supabase migration list --project-ref jawdrhewabqajxnswhkn` que todas las migraciones anteriores están aplicadas y que esta es la única pendiente. Si hay cualquier otra diferencia, detenerse.
- [ ] Ejecutar `supabase db push --project-ref jawdrhewabqajxnswhkn --dry-run`; la salida debe mostrar únicamente `20261012030630`. No aplicar si aparece otra migración.
- [ ] Revisar las definiciones y grants de las funciones en producción **después de autorización**, para detectar cambios hechos fuera del repositorio. No sobrescribir una diferencia inesperada.
- [ ] Respaldo previo obligatorio, completo y verificado, con punto/fecha de recuperación registrado. Archivos cifrados y con permisos restringidos fuera del repositorio; no subirlos a GitHub ni copiarlos al Testing sin autorización de tratamiento de datos.
- [ ] Comprobar espacio y restauración del respaldo en un entorno aislado autorizado. No considerar el archivo de backup suficiente si nunca se verificó su legibilidad/restauración.
- [ ] Confirmar que el entorno de hosting ejecuta el commit validado. La migración no requiere un despliegue frontend simultáneo, pero la ruta actual debe seguir invocando solo los RPC protegidos.
- [ ] Congelar cambios concurrentes al esquema mientras se valida la migración.

### Preparación de backup

Supabase recomienda a proyectos Free mantener exportaciones lógicas fuera de la plataforma; los backups gestionados diarios están disponibles para planes Pro, Team y Enterprise. La documentación de CLI separa backup de roles, esquema y datos. Usar almacenamiento cifrado restringido y calcular/verificar checksums, sin registrar URLs de conexión o contraseñas en consola compartida. La base no incluye los objetos de Storage; si hay objetos que deban conservarse, respaldarlos aparte.

Comandos documentados para ejecutarse únicamente después de autorización y con las credenciales suministradas de forma segura:

```sh
supabase db dump --project-ref jawdrhewabqajxnswhkn --file "$BACKUP_DIR/roles.sql" --role-only
supabase db dump --project-ref jawdrhewabqajxnswhkn --file "$BACKUP_DIR/schema.sql"
supabase db dump --project-ref jawdrhewabqajxnswhkn --file "$BACKUP_DIR/data.sql" --data-only --use-copy -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

El backup de datos contiene información personal/laboral: cifrarlo, limitar accesos y eliminar copias temporales conforme a la política de retención. Verificar que existan los tres archivos, tamaño no nulo y checksums; después demostrar restauración en un destino aislado aprobado. La restauración completa de una base reemplaza estado y puede provocar indisponibilidad. En Free, considerar además conservar una copia externa porque no hay backup diario gestionado automático.

Fuentes oficiales consultadas: [Database Backups](https://supabase.com/docs/guides/platform/backups) y [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). La ayuda local de CLI confirma `db push --dry-run`, `--project-ref` y `migration list --project-ref`.

## Instrucciones de aplicación, solo tras autorización

1. En el checkout del SHA aprobado, enlazar explícitamente el proyecto correcto con `supabase link --project-ref jawdrhewabqajxnswhkn`. Este comando prepara el enlace local; no sustituye la verificación visual del ref.
2. Revisar de nuevo el listado local/remoto: `supabase migration list --linked`.
3. Ejecutar `supabase db push --linked --dry-run`. Si no muestra exactamente una migración pendiente, cancelar.
4. Aplicar con `supabase db push --linked` únicamente cuando la salida de dry-run contenga solo la migración acordada. No usar `--include-all`, `db reset` ni push forzado.
5. Guardar la salida saneada (sin credenciales), confirmar que la versión `20261012030630` aparece aplicada y ejecutar consultas de solo lectura para revisar firmas, `search_path` y `EXECUTE` de `anon`, `authenticated` y `service_role`.

Si el historial informa que la versión ya está aplicada, no volver a ejecutarla: comparar el contenido local con el registro/definiciones efectivas y reportar cualquier diferencia.

## Pruebas de aceptación inmediatas

Ejecutar con supervisores, sucursales y empleados sintéticos en un entorno de staging que replique el release; si se autorizan pruebas funcionales en producción, usar una cuenta/empleado de prueba designado y no crear movimientos sobre empleados reales sin aprobación.

1. Supervisor activo con dispositivo autorizado en A1: preview de empleado A1, PIN válido, entrada, inicio/fin de descanso, salida; cada operación responde correctamente y crea un solo evento por idempotency key.
2. El mismo dispositivo intenta empleado A2 y empleado de otra empresa: denegación; comprobar que no se creó sesión/evento y que ningún dato del empleado se devuelve.
3. PIN incorrecto y QR inválido: respuesta de rechazo y sin evento nuevo.
4. Sin sesión, usuario `anon`, usuario autenticado sin permiso y dispositivo revocado: todos denegados. `anon` y `authenticated` no pueden invocar el RPC legado; verificar grants además del código HTTP.
5. Cliente actual de `/api/attendance/scan`: preview y confirm siguen usando los RPC actuales y el supervisor autorizado opera normalmente.
6. Consultar con conteos y snapshots de solo lectura que la cantidad/IDs de sesiones y eventos históricos no cambiaron durante la aplicación. No comparar contra métricas volátiles sin fijar el corte temporal.
7. Comprobar logs por errores SQL, 401/403 inesperados, 5xx, latencia y caída de autorizaciones durante al menos 30 minutos.

Los criterios de aceptación son cero escrituras para los intentos denegados, cero fallos en operaciones autorizadas, rechazo del wrapper legado para roles API y ninguna alteración de sesiones/eventos preexistentes.

## Recuperación si algo falla

La transacción protege contra una aplicación parcial, no contra una incompatibilidad descubierta después de confirmar el commit.

- **Falla antes del commit SQL:** detener el cambio; confirmar que la migración no aparece aplicada y que las definiciones/grants conservan el estado anterior. Corregir el SQL en Testing antes de reintentar.
- **Migración aplicada y escaneo autorizado falla:** activar mantenimiento/pausar temporalmente el acceso a `/scanner` o deshabilitar el flujo de escaneo desde el hosting, conservando los registros existentes. Capturar SQLSTATE, función y hora, sin tokens ni PIN. No volver a habilitar el RPC heredado.
- **Incompatibilidad en función/grant:** reparar con una migración forward-only revisada y probada primero en Testing. Mantener la igualdad de sucursal, validación PIN y denegación del wrapper. No editar a mano ni hacer `db reset`.
- **Reversión de aplicación:** el cambio SQL no requiere frontend nuevo; si el release de Next causara otro fallo, volver al SHA anterior solo si sigue llamando `scan_employee_attendance`/`confirm_employee_attendance`. Esto no revierte las funciones SQL.
- **Restauración de backup:** solo último recurso, con mantenimiento, autorización y evaluación de pérdida de operaciones posteriores al punto del backup. La migración no modifica datos históricos, así que una restauración total no es la respuesta normal a una incompatibilidad de función. Tras restaurar, revalidar migraciones, RLS, grants y Auth, y reconciliar movimientos del intervalo de recuperación.
- **Cierre del incidente:** no reabrir `/scanner` hasta que pasen las pruebas positivas/negativas, los permisos estén verificados y la tasa de errores vuelva a normalidad.

No se recomienda revertir las funciones a las versiones previas vulnerables. Cualquier rollback que restablezca la ejecución del wrapper heredado requeriría aislar primero la API/red y aprobación de seguridad; la opción preferida es corregir hacia delante.

## Error separado: HTTP 500 / SQLSTATE `P0002` en estado de credenciales

Este problema no forma parte del hotfix del escáner. La función `get_employee_credential_status` usa `P0002` cuando el empleado no existe dentro de la empresa consultada. El endpoint Next.js `src/app/api/employees/[id]/qr/route.ts` ya convierte `P0002` a HTTP 404 con mensaje genérico; las rutas de QR/PIN también ocultan la existencia fuera del tenant. La matriz anterior observó HTTP 500 en llamada directa al RPC de PostgREST, por lo que hay que distinguir la ruta REST de la API de aplicación.

Diseño recomendado para una tarea posterior:

- Mantener la respuesta indistinguible para ID inexistente y empleado de otra empresa (404 uniforme en la API de aplicación); no cambiarla a 403 si eso permite enumerar IDs.
- Verificar por separado: admin tenant propio/existente → 200; inexistente en su empresa → 404; ID real de otro tenant → mismo 404/cuerpo; usuario sin permiso o supervisor → 403; anónimo → denegado; error real de base de datos → 503.
- Confirmar la respuesta a través de `/api/employees/{id}/qr`, y probar llamada directa REST solo para determinar el mapeo de SQLSTATE de PostgREST; no declarar un RPC 500 como bypass de autorización sin evidencia de acceso o modificación.
- Si se requiere que Data API directa devuelva 404, probar primero en Testing el mapeo de excepción compatible con PostgREST y sus contratos. No cambiar `get_employee_credential_status` ni su firma dentro del hotfix de sucursal.

## Bloqueos de lanzamiento que permanecen

- **Backup/restore:** se completó el ensayo sintético local de la Etapa 9.5. Se aplicaron las 20 migraciones, se respaldó y restauró una base PostgreSQL 18.4 vacía de datos reales, y se compararon esquema, conteos, claves foráneas, funciones, permisos y RLS. Esto valida el flujo lógico en PostgreSQL local; no valida el servicio Auth de Supabase, Storage, configuración gestionada ni una restauración de un backup de producción. Antes de GO sigue siendo obligatorio definir y demostrar el proceso de backup/restore gestionado o externo que se usará en producción, con destino aislado y autorización para esos datos.
- **Exportaciones simultáneas:** el límite distribuido restringe frecuencia, no tareas concurrentes. Mantener hosting con al menos 2 GiB disponibles y concurrencia de exportación 1; medir en hosting y añadir semáforo distribuido antes de aumentar capacidad/límites.
- **Contraseñas filtradas:** la protección se detectó desactivada en Testing; la configuración productiva no fue consultada. Verificar/habilitar en un plan compatible y comprobar login/alta.
- **GitHub:** repositorio privado, CI pasó para el commit validado; no se ha demostrado una regla obligatoria de protección de `main`, revisión de PR/CODEOWNERS ni restricción de bypass. Verificar Settings y exigir CI/revisión para migraciones y seguridad.
- **P0002:** respuesta 500 en el camino directo de RPC permanece como trabajo independiente; verificar el endpoint Next actual antes de cambiar.

## Estimación y decisión

Una vez generado y verificado el respaldo, reservar **45–60 minutos** para intervención: 5–10 minutos de preflight final, 5 minutos de dry-run/aplicación, 15–20 minutos de aceptación y 20–30 minutos de monitoreo inicial. El tiempo de generación y restauración del respaldo depende del tamaño de la base y queda fuera de esa ventana; no empezar la intervención hasta completarlo.

**Decisión: NO-GO para producción por ahora.** La corrección está técnicamente respaldada por la validación de Testing, pero este documento no sustituye la autorización para consultar o cambiar producción. GO condicionado a: autorización expresa, proyecto verificado, historial sin diferencias, respaldo/restauración verificados, una sola migración pendiente, ventana de cambio y aceptación completa.

## Ensayo de respaldo y restauración — Etapa 9.5

El ensayo local y sus límites están documentados en [BACKUP-RESTORE-ETAPA-9.5.md](BACKUP-RESTORE-ETAPA-9.5.md). Se ejecutó con datos sintéticos en PostgreSQL local aislado; no se consultó ninguno de los proyectos Supabase. El dump y los clústeres temporales se eliminaron al finalizar la comprobación. El resultado no convierte en GO el despliegue productivo: la restauración de un backup Supabase y la cobertura de Auth/Storage/configuración siguen pendientes.
