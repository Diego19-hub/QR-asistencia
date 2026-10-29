# QR-003 — Reconciliación de migraciones para Testing

## Alcance y resultado ejecutivo

Revisión realizada el 28 de octubre de 2026 contra el proyecto Supabase `QR-asistencia-testing`, ref `llxyziffgtqnzlguxhyt`. La identidad del proyecto se confirmó por lectura como `QR-asistencia-testing`, estado activo y saludable. El PR #8 está integrado en `main` por el commit `8e92ab1c99212c0db681914c3993099e7638b008`.

No se ejecutó `migration repair`, `db push` real ni ninguna escritura remota. Se consultaron en modo de lectura el historial, el catálogo de funciones, grants y estructura de columnas. Toda aplicación y prueba con escritura en Testing sigue requiriendo una autorización futura separada.

**Conclusión:** hay una ruta técnica acotada que puede presentar únicamente QR-003 a `db push`: construir fuera del repositorio un manifiesto temporal mediante `supabase migration fetch` contra el ref exacto, preservar los 24 SQL ya registrados con sus timestamps de Testing y añadir una copia byte a byte de la migración QR-003 canónica. Con CLI 2.120.0, su dry-run mostró solo `20261018120000_persist_employee_pin_failures.sql`. La secuencia se reprodujo localmente y las pruebas de PIN pasaron. La aplicación remota permanece detenida hasta una tarea autorizada que repita el preflight y confirme de nuevo el alcance.

## Inventario y matriz de correspondencia

En la lectura actual se encontraron 24 entradas en Testing y 25 archivos en `main`. De las 23 migraciones con nombres comunes, 18 tienen distinto timestamp y 5 conservan el mismo. La matriz completa, junto con hashes SHA-256 del archivo canónico y del SQL recuperado por CLI, está en [QR-003-TESTING-MIGRATION-MANIFEST.csv](QR-003-TESTING-MIGRATION-MANIFEST.csv).

| Versión en `main` | Versión en Testing | Migración | Timestamp |
|---|---|---|---|
| 20261011003946 | 20261011211051 | `multi_tenant_attendance` | Distinto |
| 20261011004021 | 20261011211055 | `harden_attendance_rls_indexes` | Distinto |
| 20261011004205 | 20261011211058 | `attendance_periods_and_rls` | Distinto |
| 20261011004350 | 20261011211101 | `explicit_tenant_write_policies` | Distinto |
| 20261011004418 | 20261011211104 | `consolidate_admin_read_policies` | Distinto |
| 20261011005201 | 20261011211107 | `bootstrap_owner_and_review_adjustments` | Distinto |
| 20261011005250 | 20261011211110 | `index_bootstrap_owner_reference` | Distinto |
| 20261011161700 | 20261011211112 | `no_employee_hard_delete` | Distinto |
| 20261011163001 | 20261011211115 | `schedule_management` | Distinto |
| 20261011163215 | 20261011211120 | `enforce_labor_rule_effective_periods` | Distinto |
| 20261011163633 | 20261011211123 | `schedule_aware_attendance_snapshots` | Distinto |
| 20261011163737 | 20261011211131 | `cap_assignments_to_schedule_validity` | Distinto |
| 20261011163826 | 20261011211135 | `schedule_advisor_indexes_rls` | Distinto |
| 20261011182929 | 20261011211138 | `safe_schedule_rule_deletion` | Distinto |
| 20261011182937 | 20261011211143 | `employee_qr_credentials` | Distinto |
| 20261011184307 | 20261011211146 | `supervisor_mobile_scanner` | Distinto |
| 20261011200400 | 20261011211149 | `fix_supervisor_scanner_context_nullable_device` | Distinto |
| 20261011212752 | 20261011211200 | `attendance_calculation_consistency` | Distinto |
| 20261011232050 | 20261011232050 | `distributed_report_export_rate_limit` | Igual |
| 20261012030630 | 20261012030630 | `scanner_branch_scope_and_legacy_rpc_lockdown` | Igual |
| 20261012050537 | 20261012050537 | `global_report_export_lease` | Igual |
| 20261012120000 | 20261012120000 | `employee_portal_self_service` | Igual |
| 20261012143000 | 20261012143000 | `company_user_access_management` | Igual |

Testing también registra, sin equivalente en `main`, `20261011211215_enable_pgtap_test_extension.sql`. QR-003 (`20261018120000`) y QR-002 (`20261028120000`) no aparecen en el historial de Testing. El CSV separa estas dos migraciones pendientes e identifica QR-002 como excluida de la simulación de QR-003.

## Comparación del SQL archivado

Se ejecutó Supabase CLI **2.120.0**. `migration fetch --project-ref llxyziffgtqnzlguxhyt` recuperó 24 archivos a un directorio temporal fuera del repositorio. El comando `migration list --project-ref` confirmó que esos 24 timestamps coinciden con las 24 entradas remotas.

Los 23 pares por nombre tienen secuencias de tokens SQL equivalentes. La comparación descarta espacios, comentarios y separadores `;` fuera de literales; además, se compararon aparte los comentarios, que coincidieron en todos los pares. En una comparación de líneas no vacías, 22 archivos quedan idénticos al retirar líneas vacías y líneas que contienen solo `;`; `distributed_report_export_rate_limit` difiere además por un `;` terminal duplicado (`;;`) en el archivo reconstruido por CLI. No se encontraron diferencias de tokens ejecutables. El CSV registra SHA-256 y bytes de cada fuente para que el cotejo se pueda repetir.

Esta equivalencia de SQL histórico **no prueba** que nunca se hayan aplicado cambios manuales después de las migraciones. Para abordar ese riesgo en las dependencias de QR-003, también se comparó el estado actual leído de Testing con una reconstrucción local en la versión anterior a QR-003:

- Los MD5 normalizados de `private.verify_employee_pin`, `private.scanner_device`, `public.scan_employee_attendance` y `public.confirm_employee_attendance` coincidieron exactamente con la réplica local reconstruida desde los SQL históricos.
- Coincidieron `owner`, `SECURITY DEFINER`, `search_path=""` y ACL. Las RPC públicas permiten `authenticated` y `service_role`, deniegan `anon`; el helper de PIN y el helper de dispositivo solo permiten ejecución a `postgres`.
- El fingerprint de las columnas de `private.employee_pin_credentials`, `private.employee_qr_tokens`, `private.device_token_hashes`, `public.authorized_devices` y `public.employees` coincidió: 36 columnas, MD5 `ba3ac75e543b92cbb3cb1b7049f26c85`.
- En ambas RPC de asistencia, la definición actual aún lanza excepción para PIN inválido y no contiene la respuesta `pinError`. Esto confirma que QR-003 sigue pendiente.

La comprobación se limita a estas funciones, ACL y forma de columnas vinculadas al PIN, QR y dispositivo; no afirma ausencia de cambios manuales en objetos ajenos a ese alcance.

| Función | MD5 de definición sin espacios | ACL remota observada |
|---|---|---|
| `private.verify_employee_pin(uuid,uuid,text)` | `7475e03ded423640c85cb9c6a13f16a0` | `postgres` |
| `private.scanner_device(uuid,text)` | `7ae9629219081ad9055cbd194ce44d5f` | `postgres` |
| `public.scan_employee_attendance(uuid,text,text,text)` | `295d2e48c75d264ebf5299bbcb0a1872` | `postgres`, `authenticated`, `service_role` |
| `public.confirm_employee_attendance(uuid,text,text,text,public.attendance_event_type,uuid,uuid)` | `078c0671629a3c2a92100ee31e8c7e42` | `postgres`, `authenticated`, `service_role` |

## Divergencia que ve el CLI desde `main`

Con los 25 archivos canónicos de `main`, `migration list --project-ref llxyziffgtqnzlguxhyt` compara solo timestamps y separa los 18 pares con versión distinta en 18 versiones locales no registradas y 18 versiones remotas sin archivo local. Añade la extensión pgTAP solo remota y QR-003/QR-002 solo locales: **39 entradas sin pareja por timestamp**.

El `db push --dry-run --project-ref llxyziffgtqnzlguxhyt --skip-vault` con el checkout canónico terminó con `DbPushMissingLocalError`: faltan 19 versiones remotas en el directorio (los 18 timestamps históricos de Testing y la extensión pgTAP). El CLI sugirió `migration repair --status reverted` para esas versiones y `db pull`. No ejecuté ninguna de esas sugerencias. El dry-run no aplicó SQL y `--skip-vault` evita actualizar secretos de Vault.

## Alternativas evaluadas

| Alternativa | Resultado y riesgo |
|---|---|
| `db push` desde `main` canónico | Bloqueado por `DbPushMissingLocalError`. Las entradas históricas no emparejan por timestamp; resolver el bloqueo con repair sin revisar el estado real cambiaría el ledger. |
| `migration repair` para las 36 versiones divergentes | No recomendado. Cambia el registro sin ejecutar SQL; un estado equivocado puede ocultar un cambio faltante o permitir reejecutar SQL histórico. La migración pgTAP requeriría otra decisión independiente. Ninguna reparación se necesita para la propuesta temporal. |
| Renombrar timestamps canónicos de `main` | Rechazado: cambia identificadores versionados y altera cómo se compara `main` con otros entornos, incluida Producción, cuyo historial no se ha evaluado aquí. |
| `db pull`/baseline desde Testing | No es un cambio acotado a QR-003. Puede consolidar un estado que incluya deriva manual y no debe sustituir una revisión de esquema completa. |
| Manifiesto temporal con SQL archivado de Testing + solo QR-003 | Viable para el estado auditado. Los 24 archivos recuperados coinciden con las entradas remotas; no quedan como pendientes porque conservan exactamente sus timestamps. Se agrega la migración canónica QR-003 sin cambiar su contenido y se omite QR-002. El dry-run resultó en una sola migración. Debe reconstruirse y verificarse de nuevo antes de cualquier aplicación futura. |

El manifiesto alternativo usado aquí solo existió en `/private/tmp`; no cambia ni duplica archivos SQL en el repositorio. Su composición se reproduce con la CLI fijada, los hashes del CSV y el procedimiento de abajo.

## Simulación local

La simulación usó el proyecto `qr_pin_lockout_disposable_reconcile_20261028`, puertos locales separados y solo el servicio PostgreSQL. La carpeta temporal no tenía enlace de proyecto durante los comandos locales. La secuencia fue:

1. Aplicar en una base vacía los 24 SQL que `migration fetch` recuperó de Testing, incluyendo la extensión pgTAP exclusiva. La historia local quedó con 24 entradas y última versión `20261012143000`.
2. Antes de QR-003, verificar que existen las tablas/funciones dependientes y que las RPC aún tienen el comportamiento de excepción observado en Testing. Los fingerprints de funciones, ACL y columnas relevantes coincidieron con Testing.
3. Volver a añadir al manifiesto temporal una copia de `20261018120000_persist_employee_pin_failures.sql` desde `main`. SHA-256 idéntico en origen y copia: `b89aff6a3a5aead2df6047ae0cb859d20d17585154d016628d00c58bb622ee79`. QR-002 no estaba en la carpeta.
4. `migration list --local` señaló solo QR-003 como pendiente. `migration up --local` aplicó solo esa migración. La historia local quedó en 25 entradas, última versión `20261018120000`; el catálogo confirmó que QR-002 y `share_token_hash` seguían ausentes.
5. Las RPC resultantes ya no lanzaron excepción para PIN inválido y devolvieron `pinError` estructurado.
6. `npm run test:pin-lockout:db`, con `PIN_LOCKOUT_SUPABASE_WORKDIR` y `PIN_LOCKOUT_DATABASE_URL` apuntando solo a loopback, pasó pgTAP **35/35** y la integración PostgreSQL. Esta verificó persistencia de intentos, bloqueo a cinco durante 15 minutos, expiración/reset, 12 solicitudes concurrentes, dispositivo/QR no autorizados o revocados, aislamiento multiempresa y ausencia de eventos/sesiones para PIN rechazado. Solo se usaron identidades y datos sintéticos.
7. Se detuvo el stack con `supabase stop --no-backup` para el proyecto desechable. La inspección Docker no encontró contenedores del proyecto temporal y confirmó que el stack preexistente `codigo_QR` permaneció activo.

## Procedimiento para una aplicación futura autorizada

Volver a ejecutar todos los pasos siguientes en una tarea separada y sobre la historia actual; esta evidencia es una fotografía fechada, no autorización para escribir.

1. Crear un directorio temporal fuera del repositorio, sin `.env*`, dumps ni credenciales del proyecto. Usar la CLI fijada en `package.json` (2.120.0) y revisar `--help` antes de cada comando. Confirmar en Supabase que `llxyziffgtqnzlguxhyt` sigue siendo `QR-asistencia-testing`.
2. Ejecutar `supabase migration fetch --project-ref llxyziffgtqnzlguxhyt` en ese directorio. Comparar los 24 timestamps/nombres y todos los SHA-256 del manifiesto. Si el historial cambió, hay un hash diferente, falta una entrada o aparece una migración nueva, detenerse y rehacer revisión.
3. Hacer consultas remotas estrictamente `SELECT` para confirmar las funciones, ACL, settings y columnas dependientes. Los MD5 y la forma del esquema deben coincidir con la evidencia de este informe. Investigar cualquier cambio manual; la equivalencia de archivos por sí sola no basta.
4. Copiar al directorio temporal, sin editarlo, el archivo canónico `20261018120000_persist_employee_pin_failures.sql`; validar su SHA-256. Confirmar que QR-002 y cualquier otra migración local no estén presentes.
5. Con `migration list --project-ref llxyziffgtqnzlguxhyt`, comprobar que los 24 archivos históricos coinciden y que la única diferencia local pendiente sea QR-003.
6. Ejecutar el dry-run exacto:

   ```sh
   supabase --workdir "$TMP" db push --dry-run --project-ref llxyziffgtqnzlguxhyt --skip-vault
   ```

   Debe listar solo `20261018120000_persist_employee_pin_failures.sql`. Si hay otra salida, error, versión adicional o discrepancia, detenerse. No usar `--include-all`, `migration repair`, `db reset --linked`, `migration up --linked` ni archivos elegidos para ocultar una divergencia.

7. Solicitar autorización explícita separada para la escritura. Solo si se aprueba y se repite el dry-run inmediatamente antes, la escritura prevista sería `supabase --workdir "$TMP" db push --project-ref llxyziffgtqnzlguxhyt --skip-vault`, revisada por una segunda persona. Nunca ejecutar contra Producción.
8. Después, verificar por lectura que QR-003 quedó en el historial, revisar la definición/grants de RPC y, mediante autorización separada para pruebas con escritura, probar lockout únicamente con una identidad, empleado, QR y dispositivo sintéticos aprobados. Confirmar que no se generen sesiones/eventos. Si falla la migración o la comprobación, detenerse; no reintentar ni revertir a las funciones de `20261012030630` a ciegas. El rollback no está validado; preparar una corrección hacia adelante.

## Criterios de aceptación y bloqueos

QR-003 estará técnicamente lista para la revisión de cambio cuando el preflight repetido confirme el mismo ref, historia y fingerprints; el manifiesto regenerado coincida con el CSV; el dry-run enumere únicamente QR-003; exista aprobación de ventana/respaldo y estén aprobados los fixtures sintéticos y su limpieza. La tarea se cierra solo tras aplicación autorizada, verificaciones posteriores correctas y evidencia registrada.

**Estado actual:** la ruta técnica de una sola migración funcionó en el dry-run y la simulación local; no se detectó discrepancia en las dependencias inspeccionadas. La aplicación en Testing sigue pendiente de autorización explícita. Cualquier cambio manual fuera del alcance de estas consultas o una nueva divergencia obliga a detenerse. Producción no fue consultada.

## Evidencia de solo lectura

- `supabase migration fetch --project-ref llxyziffgtqnzlguxhyt`: recuperó 24 archivos.
- `supabase migration list --project-ref` con los archivos canónicos de `main`: informó `DbPushMissingLocalError` y listó 19 versiones remotas ausentes; no se aplicó repair.
- `supabase migration list --project-ref` con los 24 archivos fetch de Testing: 24 timestamps coincidieron.
- `supabase db push --dry-run --project-ref llxyziffgtqnzlguxhyt --skip-vault` con manifiesto fetch + QR-003: mostró exclusivamente `20261018120000_persist_employee_pin_failures.sql`.
- `migration list --local`, `migration up --local`, `db reset --local` y `test db --local` se limitaron al proyecto desechable identificado arriba.
- No se ejecutó `migration repair`, aplicación remota ni `db push` real; no se accedió a Producción.

## Referencias oficiales

- [Supabase Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [CLI `migration fetch`](https://supabase.com/docs/reference/cli/supabase-migration-fetch)
- [CLI `migration list`](https://supabase.com/docs/reference/cli/supabase-migration-list)
- [CLI `db push`](https://supabase.com/docs/reference/cli/supabase-db-push)
