# QR-asistencia — Reconciliación de migraciones, Etapa 10C

Fecha: 2026-10-12
Repositorio/HEAD inspeccionado: `main`, `aa518fe400c4d8c24ac7100beebe34b3b0d82cbd`
Testing consultado solo en lectura: `llxyziffgtqnzlguxhyt` (`QR-asistencia-testing`, PostgreSQL 17.11, activo).
Producción `jawdrhewabqajxnswhkn`: no consultada ni modificada.

## Decisión

**NO-GO para el dry-run remoto en esta ejecución; NO-GO para aplicar migraciones.** La comprobación CLI se detuvo antes de contactar la base por falta de sesión. La simulación local pasó; el dry-run remoto requiere que el usuario autentique la CLI localmente y vuelva a autorizar esa lectura. No se modificó historial, SQL ni esquema remoto.

La estrategia aplicada mantuvo intactos los archivos históricos de `main` y simuló el historial en una copia temporal local; el dry-run local dejó pendiente solo `20261012050537_global_report_export_lease.sql`. El dry-run remoto aún requiere credenciales CLI seguras.

## Estado de Git, CI y herramientas

- `git status`: `main`, árbol limpio; HEAD es el commit base indicado.
- GitHub Actions del commit base: workflow `CI`, resultado **success** (run 38276393610).
- `origin` apunta al repositorio privado esperado. `git ls-remote origin refs/heads/main` no pudo resolver `github.com` desde este entorno; no se alteró Git.
- Supabase CLI local: **2.120.0**. Se consultó la ayuda real de `db push`, `start` y `migration list`. `db push --dry-run` está disponible y declara que imprime las migraciones pendientes sin aplicarlas.
- Para evitar intentos de escritura en `~/.supabase`, todas las llamadas de CLI se hicieron con `SUPABASE_TELEMETRY_DISABLED=1`.
- `SUPABASE_ACCESS_TOKEN` no está configurado en este proceso.
- `docker info` inicialmente falló por acceso al socket local; con autorización de acceso elevado se usó Docker Desktop 29.7.2 solo para la simulación desechable. El stack temporal usó PostgreSQL 17 de Supabase. Se comprobó que los recursos de `codigo_QR` no cambiaron y se retiraron contenedores/volúmenes/red del proyecto temporal.
- Hay binarios `psql`/PostgreSQL 18 instalados en el host; no se usaron como sustituto de PostgreSQL 17.

## Historial de Testing verificado

Consulta de solo lectura por el conector Supabase, después de verificar el ID del proyecto: **21 registros**, PostgreSQL 17.11. PgTAP está instalado en el esquema `extensions`, versión 1.3.3.

| Local (archivo/version) | Testing (versión registrada) | Resultado |
| --- | --- | --- |
| `20261011003946` `multi_tenant_attendance` | `20261011211051` | nombre coincide; versión difiere |
| `20261011004021` `harden_attendance_rls_indexes` | `20261011211055` | nombre coincide; versión difiere |
| `20261011004205` `attendance_periods_and_rls` | `20261011211058` | nombre coincide; versión difiere |
| `20261011004350` `explicit_tenant_write_policies` | `20261011211101` | nombre coincide; versión difiere |
| `20261011004418` `consolidate_admin_read_policies` | `20261011211104` | nombre coincide; versión difiere |
| `20261011005201` `bootstrap_owner_and_review_adjustments` | `20261011211107` | nombre coincide; versión difiere |
| `20261011005250` `index_bootstrap_owner_reference` | `20261011211110` | nombre coincide; versión difiere |
| `20261011161700` `no_employee_hard_delete` | `20261011211112` | nombre coincide; versión difiere |
| `20261011163001` `schedule_management` | `20261011211115` | nombre coincide; versión difiere |
| `20261011163215` `enforce_labor_rule_effective_periods` | `20261011211120` | nombre coincide; versión difiere |
| `20261011163633` `schedule_aware_attendance_snapshots` | `20261011211123` | nombre coincide; versión difiere |
| `20261011163737` `cap_assignments_to_schedule_validity` | `20261011211131` | nombre coincide; versión difiere |
| `20261011163826` `schedule_advisor_indexes_rls` | `20261011211135` | nombre coincide; versión difiere |
| `20261011182929` `safe_schedule_rule_deletion` | `20261011211138` | nombre coincide; versión difiere |
| `20261011182937` `employee_qr_credentials` | `20261011211143` | nombre coincide; versión difiere |
| `20261011184307` `supervisor_mobile_scanner` | `20261011211146` | nombre coincide; versión difiere |
| `20261011200400` `fix_supervisor_scanner_context_nullable_device` | `20261011211149` | nombre coincide; versión difiere |
| `20261011212752` `attendance_calculation_consistency` | `20261011211200` | nombre coincide; versión difiere |
| `20261011232050` `distributed_report_export_rate_limit` | `20261011232050` | nombre y versión coinciden |
| `20261012030630` `scanner_branch_scope_and_legacy_rpc_lockdown` | `20261012030630` | nombre y versión coinciden |
| — | `20261011211215` `enable_pgtap_test_extension` | solo Testing |
| `20261012050537` `global_report_export_lease` | — | solo local; pendiente en Testing |

Resumen: 20 nombres compartidos, 18 versiones diferentes; dos nombres/versiones coincidentes. La comparación previa confirmó que el SQL de las 20 migraciones compartidas es equivalente ignorando únicamente espacios exteriores. El historial conserva las sentencias en `supabase_migrations.schema_migrations.statements`.

## PgTAP y cambios de esquema

La migración registrada solo en Testing se llama `enable_pgtap_test_extension`. El catálogo de extensiones de Testing confirma `pgtap` 1.3.3 instalado en `extensions`. El SQL histórico se recuperó mediante una consulta de solo lectura a `supabase_migrations.schema_migrations.statements` en Testing: `create extension if not exists pgtap with schema extensions;`. La copia temporal 10D incorpora esa sentencia exacta, sin aplicarla en remoto. PgTAP es infraestructura de pruebas y no es un cambio funcional de la aplicación, pero sí debe representarse como registro existente en la simulación.

Las consultas de lectura confirmaron inventarios de tablas y funciones en `public` y `private`, RLS activado en las tablas `public` y en las tablas privadas de credenciales, autorización de dispositivos y rate limit. También aparecieron tablas privadas `bootstrap_requests` y `device_token_hashes` con RLS desactivado; pertenecen a un esquema privado, pero esta inspección parcial no equivale a comprobar todas las políticas, grants, exposición de API y definiciones de cada objeto.

No se pudo probar la ausencia de cambios de esquema fuera de las migraciones: faltó un `db diff`/dump estructural verificable y el acceso de CLI no estaba autenticado. Los datos observados no demuestran por sí solos que todo el esquema vivo corresponda exactamente a esos 21 SQL. No ejecutar comandos de escritura para resolver esa incertidumbre.

## Estrategia de reconciliación recomendada

No renombrar las 18 migraciones en `main`. Sus versiones pueden ser parte del historial de otros entornos (incluida Producción, que queda fuera de este alcance). Un simple cambio de timestamp en Git no modifica el historial remoto, y podría provocar que otro entorno intente repetir DDL histórico.

En una copia temporal fuera del repositorio:

1. Copiar `supabase/config.toml`, `supabase/migrations/` y lo necesario para la simulación. Asignar un `project_id` temporal único y puertos libres. Mantener esa copia separada de `codigo_QR`.
2. Conservar el contenido byte por byte y mapear los 20 nombres comunes a las versiones listadas arriba. Validar que el mapeo sea uno a uno y que ningún timestamp choque.
3. Incorporar `20261011211215_enable_pgtap_test_extension.sql` con la sentencia histórica recuperada. Ejecutarla únicamente en el stack local desechable, nunca en Testing para alinear el historial.
4. Levantar una instancia Supabase local desechable con PostgreSQL 17. Aplicar en ella el conjunto ya alineado de 21 migraciones. Después copiar la migración del lease a la copia temporal y ejecutar `supabase db push --local --dry-run`.
5. Exigir que la salida enumere únicamente `20261012050537_global_report_export_lease.sql`; además comprobar con `migration list --local` que las 21 versiones previas están registradas y que no se repite DDL histórico.
6. Guardar la salida sanitizada y destruir únicamente el stack/volúmenes identificados por el `project_id` temporal.

**Simulación local ejecutada.** Se creó un workdir y proyecto temporales fuera del repositorio, con puertos únicos. Se copiaron sin cambios los 20 SQL comunes y se renombraron solo dentro de la copia a los 20 timestamps de Testing. Se aplicaron en el stack local esos SQL más la misma sentencia pgTAP que ahora se recuperó del historial remoto. Luego se añadió la migración de lease a la copia y se ejecutó `supabase db push --local --dry-run`. La salida se validó automáticamente: solo contenía `20261012050537_global_report_export_lease`; `migration list --local` contenía las 21 versiones previas y no volvió a listar timestamps originales de los SQL comunes. Duración total observada: aproximadamente 51 segundos. Resultado: **21 migraciones históricas simuladas, lease único pendiente, cero migraciones históricas pendientes/reaplicadas**. El script comprobó la parada y ausencia de recursos temporales, así como la invariancia del stack `codigo_QR`; el workdir se eliminó.

La simulación demuestra el comportamiento del CLI con el mapa propuesto, no que el esquema vivo remoto carezca de drift fuera de las migraciones. Tampoco valida el SQL de lease en una base Testing. No usar `migration repair` para corregir metadata ni `db reset`, `db push` o `db pull` contra un proyecto remoto.

## Autenticación CLI y futuro dry-run remoto

La CLI necesita una sesión de Management API y, según operación, conectividad/credenciales de base de datos. En esta ejecución `SUPABASE_ACCESS_TOKEN` estaba ausente; `supabase migration list --project-ref llxyziffgtqnzlguxhyt --workdir <copia-temporal>` terminó con `AccessTokenRequiredError`, antes de consultar la base. No se suministró ni imprimió ningún secreto. El usuario debe iniciar sesión localmente con `SUPABASE_TELEMETRY_DISABLED=1 ./node_modules/.bin/supabase login` (flujo de navegador/terminal); no copiar un Personal Access Token al chat, shell history, repositorio o logs. Un PAT representa el alcance de la cuenta/organización que lo creó y no debe asumirse limitado a un proyecto; comprobar rol y alcance antes de usarlo.

Después de completar `supabase login` y recibir autorización para la consulta remota:

1. Autenticar localmente con `SUPABASE_TELEMETRY_DISABLED=1 ./node_modules/.bin/supabase login` y verificar por el canal seguro de Supabase que la sesión es la esperada.
2. Confirmar el project ref con `supabase projects list` y el panel del proyecto; detenerse si no coincide literalmente con `llxyziffgtqnzlguxhyt`.
3. En una copia temporal cuyo historial esté alineado, ejecutar `SUPABASE_TELEMETRY_DISABLED=1 supabase migration list --project-ref llxyziffgtqnzlguxhyt`.
4. Solo si el resultado reproduce las 21 versiones esperadas, ejecutar `SUPABASE_TELEMETRY_DISABLED=1 supabase db push --project-ref llxyziffgtqnzlguxhyt --dry-run`.
5. Si solicita credencial de DB, obtenerla y usarla solo por el prompt/gestor seguro local; no pasarla como argumento visible. Detenerse ante cualquier salida distinta de una única migración de lease.
6. No ejecutar `db push` sin `--dry-run`. La autorización de despliegue de migración debe ser independiente.

El paso 2 puede mostrar metadatos de otros proyectos; evitarlo si se puede validar el ref en el panel de Testing. No consultar bases ajenas. En 10D el project ref se verificó por ID con Supabase: `QR-asistencia-testing`, `llxyziffgtqnzlguxhyt`, PostgreSQL 17.11. Sin embargo, el dry-run remoto no se ejecutó porque faltó sesión CLI.

## Validaciones y cierre

- Ejecutado: `git status`, inspección de HEAD/remoto, `git diff --check` inicial, ayuda de CLI 2.120.0, consultas remotas de solo lectura al proyecto Testing, verificación pgTAP y estado de CI del commit base.
- Ejecutado en 10D: CLI 2.120.0 y `--help` de login, migration list y db push; proyecto Testing verificado por ID; consulta de `statements` confirmó el SQL pgTAP exacto. La copia temporal incluyó 22 archivos SQL (20 históricos comunes byte idénticos, pgTAP recuperado y lease); frente a las 21 entradas remotas, la única diferencia local fue el lease. Los 20 SQL comunes quedaron byte idénticos a los originales locales; el archivo pgTAP contiene la sentencia exacta recuperada del historial remoto. Copia temporal eliminada.
- La simulación CLI local previa terminó con el lease como única pendiente; usó la misma sentencia pgTAP que ahora quedó confirmada por el historial remoto.
- No ejecutado: CLI migration list remoto por error de autenticación, dry-run remoto, migración, pruebas de app, lint/typecheck/build (cambio solo documental).
- No hubo escrituras remotas ni acceso a Producción.
- Etapa 10C fue publicada en `f289621ca5f3848c3e4a3f433927f11bbc212dcd`; esta actualización 10D está pendiente de commit/push y CI.

**GO/NO-GO del dry-run remoto:** **NO-GO hasta autenticar la CLI localmente**. Tras `supabase login`, verificar Testing por ID/ref, leer historial y ejecutar únicamente `supabase db push --dry-run` con el `--workdir` temporal alineado. Detenerse ante cualquier ref o migración adicional, error de autenticación o prompt inesperado. La aplicación del lease requiere autorización independiente.
