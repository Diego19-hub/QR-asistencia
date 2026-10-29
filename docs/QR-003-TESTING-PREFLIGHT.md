# QR-003 — Preflight para Supabase Testing

## Alcance y estado comprobado

Este informe prepara una revisión futura de QR-asistencia-Testing (`llxyziffgtqnzlguxhyt`). En esta tarea no se consultó ni modificó Supabase Testing o Producción, no se aplicaron migraciones remotas y no se ejecutaron RPC remotas.

El PR #7 está integrado mediante squash en `main`, commit `2c574781e3cc96cd7846a2fda838eed6def5f5bc`. La rama de este informe parte de ese commit. El árbol estaba limpio al iniciar la tarea. La migración local `20261018120000_persist_employee_pin_failures.sql` existe y contiene la corrección documentada.

**El estado remoto de Testing no está confirmado actualmente.** Los documentos QR-003 existentes registran una consulta histórica que veía `20261012143000` como última migración, pero esa observación no se repitió aquí y no debe usarse como estado actual. Tampoco se sabe si cambió manualmente alguna función después de esa observación.

## Inventario local ordenado

El repositorio contiene 25 archivos de migración. La secuencia y su dependencia funcional relevante es:

| Versión | Archivo | Dependencia/área |
|---|---|---|
| 20261011003946 | `multi_tenant_attendance` | Base multiempresa y asistencia |
| 20261011004021 | `harden_attendance_rls_indexes` | Endurecimiento RLS e índices |
| 20261011004205 | `attendance_periods_and_rls` | Periodos y políticas de asistencia |
| 20261011004350 | `explicit_tenant_write_policies` | Escrituras limitadas por tenant |
| 20261011004418 | `consolidate_admin_read_policies` | Lecturas administrativas |
| 20261011005201 | `bootstrap_owner_and_review_adjustments` | Propietario inicial y ajustes de revisión |
| 20261011005250 | `index_bootstrap_owner_reference` | Índice del propietario inicial |
| 20261011161700 | `no_employee_hard_delete` | Restricciones de borrado de empleados |
| 20261011163001 | `schedule_management` | Horarios y asignaciones |
| 20261011163215 | `enforce_labor_rule_effective_periods` | Vigencia de reglas laborales |
| 20261011163633 | `schedule_aware_attendance_snapshots` | Snapshots de asistencia y horarios |
| 20261011163737 | `cap_assignments_to_schedule_validity` | Límites temporales de asignaciones |
| 20261011163826 | `schedule_advisor_indexes_rls` | Índices y RLS de horarios |
| 20261011182929 | `safe_schedule_rule_deletion` | Borrado seguro de reglas |
| 20261011182937 | `employee_qr_credentials` | Tablas privadas QR/PIN y `private.verify_employee_pin` |
| 20261011184307 | `supervisor_mobile_scanner` | Dispositivos y RPC iniciales de escaneo |
| 20261011200400 | `fix_supervisor_scanner_context_nullable_device` | Contexto de dispositivo del escáner |
| 20261011212752 | `attendance_calculation_consistency` | Cálculos de asistencia |
| 20261011232050 | `distributed_report_export_rate_limit` | Límite de exportación de reportes |
| 20261012030630 | `scanner_branch_scope_and_legacy_rpc_lockdown` | Última versión anterior de las RPC de escaneo; añade alcance de sucursal, pero aún lanza excepción por PIN inválido |
| 20261012050537 | `global_report_export_lease` | Exclusión mutua de exportación |
| 20261012120000 | `employee_portal_self_service` | Portal de empleado |
| 20261012143000 | `company_user_access_management` | Accesos, invitaciones por correo y permisos |
| 20261018120000 | `persist_employee_pin_failures` | QR-003: respuesta estructurada para que el contador de PIN se confirme |
| 20261028120000 | `share_company_invitations` | QR-002: hash de token compartible y RPC de invitaciones |

La corrección depende de las tablas `private.employee_pin_credentials` y `private.employee_qr_tokens`, del verificador `private.verify_employee_pin`, de `public.employees`, `public.authorized_devices`, el helper de dispositivo y las funciones de escaneo y confirmación creadas/modificadas por las migraciones `20261011182937`, `20261011184307` y `20261012030630`, además de sus tablas, tipos y helpers base. En particular, el fix debe reemplazar las definiciones de escaneo de `20261012030630`.

La migración posterior de QR-002 añade un hash y funciones del flujo de invitaciones. La inspección estática de sus objetos no encontró que redefina `private.verify_employee_pin`, `public.scan_employee_attendance`, `public.confirm_employee_attendance` ni las tablas de credenciales de PIN/QR. No se observó conflicto SQL directo entre ambas. Esto no demuestra que Testing tenga el mismo conjunto de objetos o el mismo orden aplicado.

## Evidencia histórica QR-003

`docs/PIN-LOCKOUT-FIX.md` registra pruebas locales desechables antes y después del fix: antes, SQLSTATE `22023` y contador revertido a cero; después, respuestas `pin_invalid` y contador persistido entre llamadas, sin eventos de asistencia. Registra además pgTAP 35/35, concurrencia de 12 solicitudes, lockout de cinco intentos/15 minutos, expiración, reset, dispositivo no autorizado/revocado y aislamiento entre empresas.

En esta tarea, `npm run test:pin-lockout` pasó 3/3. La primera invocación de `npm run test:security:matrix:local` no pudo acceder al socket de Docker; tras conceder acceso al daemon local se ejecutó correctamente en `qr004_disposable_8c13f08e1082`, sin enlace remoto. Aplicó en una base nueva las migraciones actuales del repositorio, incluyendo QR-003 y la posterior QR-002, y pasaron 156 aserciones pgTAP (37 + 21 + 36 + 25 + 14 + 13 + 10) y los grupos HTTP/Auth. El runner confirmó que eliminó stack y datos temporales y preservó los recursos Docker preexistentes. Esta matriz demuestra compatibilidad de la secuencia local actual; no sustituye la validación dedicada de persistencia de intentos de PIN, cuyas pruebas DB de 35/35 siguen siendo evidencia histórica.

## Riesgos abiertos

- El historial remoto puede haber cambiado desde la consulta histórica indicada en `TASKS.md` y `docs/PIN-LOCKOUT-FIX.md`.
- `supabase migration list` compara timestamps; no valida que los cuerpos SQL asociados a una versión sean iguales. La lista tampoco descubre cambios manuales de esquema.
- Hay antecedentes documentados de versiones históricas que no coinciden por timestamp entre Testing y `main`. La equivalencia SQL reportada entonces no se vuelve a asumir como actual.
- `migration fetch` solo proporciona el material de migración que el proyecto conserva en su historial; no certifica cambios manuales no versionados.
- La migración SQL corrige RPC privilegiadas `SECURITY DEFINER`. Un objeto ausente, reemplazado manualmente, con firma distinta o con grants inesperados cambia el riesgo.
- Un `db push` normal aplica toda migración local que el CLI considere pendiente según la historia y el orden. Como QR-002 (`20261028120000`) es posterior, si también está pendiente el dry-run debe mostrarlo; no se debe aplicar accidentalmente dentro de una autorización limitada a QR-003.
- No hay rollback seguro validado: volver a `20261012030630` reintroduciría el error de transacción que revierte intentos fallidos. Una incidencia debe detener la promoción y resolverse con una corrección hacia adelante.

## Procedimiento propuesto para una futura revisión autorizada

Esta secuencia es de solo lectura hasta que una tarea posterior autorice expresamente un cambio remoto. No ejecutar todavía.

### 1. Aislar el directorio y confirmar el destino

Usar una copia temporal del commit de `main`, fuera del checkout de trabajo, sin `.env*`, dumps, datos ni credenciales de Producción. No reutilizar la configuración enlazada del repositorio habitual. En esa copia:

```sh
supabase --version
supabase projects list
supabase link --project-ref llxyziffgtqnzlguxhyt
```

Antes de continuar, verificar de forma local que el ref enlazado sea exactamente `llxyziffgtqnzlguxhyt` y que el proyecto identificado en el Dashboard corresponda a QR-asistencia-Testing. No imprimir tokens ni contraseñas. Si la cuenta no puede confirmar inequívocamente el proyecto, detenerse. `link` prepara el enlace CLI local; no aplicar comandos de escritura.

### 2. Obtener historia y migraciones actuales

Confirmar las opciones de la versión instalada mediante `supabase migration list --help`, `supabase migration fetch --help` y `supabase db push --help`. En el directorio aislado ejecutar solo:

```sh
supabase migration list --linked
supabase migration fetch --linked
supabase migration list --linked
```

Registrar salida y hora sin incluir secretos. Comparar versiones y nombres remotos con el inventario de 25 migraciones de este documento y revisar los SQL recuperados cuando estén disponibles. Investigar cada versión únicamente local, únicamente remota, mismo timestamp con nombre/cuerpo distinto y cualquier orden adelantado. No reparar automáticamente ninguna entrada.

La lista CLI es un resumen de timestamps, no un checksum. Por eso, en una sesión SQL de solo lectura, confirmar también:

```sql
begin read only;
select version, name
from supabase_migrations.schema_migrations
order by version;

select to_regprocedure('private.verify_employee_pin(uuid,uuid,text)') as pin_verifier,
       to_regprocedure('public.scan_employee_attendance(uuid,text,text,text)') as scan_rpc,
       to_regprocedure('public.confirm_employee_attendance(uuid,text,text,text,public.attendance_event_type,uuid,uuid)') as confirm_rpc;

select pg_get_functiondef('private.verify_employee_pin(uuid,uuid,text)'::regprocedure),
       pg_get_functiondef('public.scan_employee_attendance(uuid,text,text,text)'::regprocedure),
       pg_get_functiondef('public.confirm_employee_attendance(uuid,text,text,text,public.attendance_event_type,uuid,uuid)'::regprocedure);
rollback;
```

Si la consulta de historial falla por ausencia de la tabla, registrar que no hay historia CLI verificable y detenerse. Comparar definiciones con las migraciones locales, comprobando que el verificador incrementa/limita el contador y que ambas RPC devuelven `pinError` (`pin_invalid`, `pin_locked`, `pin_not_configured`) sin lanzar excepción tras un fallo de PIN. Confirmar también `SECURITY DEFINER`, `search_path`, propietario y ACL/grants. No seleccionar filas de empleados, hashes, PIN, tokens, credenciales ni datos personales. Si las consultas de catálogo o función no están permitidas en modo de solo lectura, detenerse y pedir un método de inspección autorizado.

### 3. Decidir si existe una ruta de aplicación segura

Solo preparar un plan de escritura si se cumplen todas estas condiciones:

1. Proyecto y ref confirmados como Testing.
2. Versiones, nombres y cuerpos históricos reconciliados; todas las dependencias previas necesarias están presentes y corresponden a la secuencia conocida.
3. Las definiciones actuales de las funciones y sus grants son compatibles con el fix; no hay modificaciones manuales no explicadas.
4. `supabase db push --dry-run --linked` en el directorio aislado muestra exactamente la migración QR-003 autorizable, sin ninguna otra migración pendiente.
5. La salida se guarda como evidencia sin secretos y una segunda persona revisa destino y diff.

El dry-run se limita a:

```sh
supabase db push --dry-run --linked
```

`--dry-run` presenta lo que el CLI planea ejecutar sin aplicarlo; aun así se exige confirmar el proyecto enlazado antes. No usar `--include-all`, `db reset --linked`, `migration up --linked`, `migration repair` ni `db push` real durante el preflight. Si el dry-run muestra QR-002 u otra versión adicional, detenerse. No quitar archivos del repositorio ni crear un conjunto artificial de migraciones para forzar una salida de una sola línea: primero reconciliar la historia y pedir autorización específica para el conjunto real de cambios.

### 4. Validación posterior en una tarea futura autorizada

Si una tarea posterior autoriza aplicación, primero acordar ventana, respaldo/recuperación del entorno y responsable. Ejecutar el cambio solo con aprobación explícita, exactamente contra el ref validado y después de repetir el dry-run inmediatamente antes. Si el comando falla o queda resultado parcial, no reintentar a ciegas: releer historia, estado de transacción y definiciones.

Verificar después, en solo lectura, que la versión `20261018120000` se registró y que las definiciones/grants coinciden con el archivo. Solo tras autorizar pruebas de escritura en Testing, usar una empresa, empleado, credencial y dispositivo sintéticos aprobados. Ejecutar intentos inválidos por las RPC de escaneo, comprobar persistencia hasta cinco, bloqueo de 15 minutos y ausencia de sesiones/eventos; inspeccionar únicamente los registros sintéticos creados para esta prueba y limpiarlos conforme al runbook aprobado. No probar con empleados existentes ni revelar PIN/tokens en logs.

## Criterios para detenerse

Detener el preflight sin cambios si ocurre cualquiera de estos casos:

- El ref no es exactamente Testing o el entorno no puede confirmarse.
- Historial ausente, versiones divergentes sin explicación, cuerpos históricos distintos, migraciones manuales o pendientes adicionales.
- Falta una dependencia, las funciones tienen firma/definición/grants diferentes a lo esperado o una RPC lanza errores para PIN inválido.
- El dry-run lista cualquier migración distinta o adicional a `20261018120000_persist_employee_pin_failures.sql`.
- No hay datos sintéticos y dispositivo de prueba aprobados, o no hay forma segura de verificar/recuperar.
- Aparece un error de conexión, autorización o acceso que impide demostrar que las consultas son de solo lectura.

En esos casos, documentar evidencia no sensible y abrir una decisión de reconciliación separada. Cualquier modificación de historia, reparación manual o cambio de migraciones necesita autorización aparte.

## Autorizaciones futuras requeridas

Esta tarea no autoriza consultas remotas. Para el siguiente paso se necesitará autorización explícita para consultar Testing en modo de solo lectura. La aplicación de migración, las pruebas que escriban datos sintéticos en Testing y cualquier limpieza remota requieren autorizaciones separadas y una ventana aprobada. Producción queda fuera de QR-003.

## Referencias oficiales

- [Supabase: Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase CLI: migration list](https://supabase.com/docs/reference/cli/supabase-migration-list)
- [Supabase CLI: migration fetch](https://supabase.com/docs/reference/cli/supabase-migration-fetch)
- [Supabase CLI: db push](https://supabase.com/docs/reference/cli/supabase-db-push)

La documentación indica que `migration list` compara timestamps de las migraciones locales con `supabase_migrations.schema_migrations`, que `db push --dry-run` presenta las migraciones que aplicaría sin aplicarlas, y que el historial de CLI no sustituye la inspección del estado real del esquema.
