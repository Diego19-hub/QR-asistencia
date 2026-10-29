# QR-003 — Persistencia y bloqueo del PIN

## Diagnóstico

`private.verify_employee_pin` bloquea la fila de credencial con `FOR UPDATE`, compara el hash bcrypt y, si el PIN no es válido, incrementa `failed_attempts` hasta cinco y establece `locked_until` por 15 minutos. La rutina devuelve un resultado JSON.

Las definiciones previas de `public.scan_employee_attendance` y `public.confirm_employee_attendance` inspeccionaban ese resultado y lanzaban una excepción para PIN inválido o bloqueado. Al propagarse la excepción desde la RPC, se abortaba la transacción que contenía la actualización del contador. PostgreSQL documenta que un error no manejado aborta la función/transacción y que el rollback revierte cambios persistentes del bloque afectado: [PL/pgSQL control structures](https://www.postgresql.org/docs/current/plpgsql-control-structures.html).

## Reproducción local

Se inició un proyecto Supabase temporal identificado como `qr_pin_lockout_disposable_legacy_20261021`, en `/private/tmp`, con migraciones hasta `20261012143000` y sin la migración correctiva.

En esa base, con identidades, empresas, empleado, QR y dispositivo sintéticos:

| Función anterior | Resultado SQL | Contador después del rollback |
|---|---|---:|
| `scan_employee_attendance` (preview) | SQLSTATE `22023` (`pin invalid`) | 0 |
| `confirm_employee_attendance` | SQLSTATE `22023` (`pin invalid`) | 0 |

Después se ejecutó **la migración existente**, únicamente en ese stack local desechable. Las mismas llamadas devolvieron `{"pinError":"pin_invalid"}` normalmente y el contador persistió en 1 y luego 2. No se creó ningún evento de asistencia. El test de reproducción usó una transacción por llamada, como hace el cliente RPC.

## Corrección existente

`supabase/migrations/20261018120000_persist_employee_pin_failures.sql` redefine ambas RPC para devolver respuestas estructuradas (`pin_invalid`, `pin_locked`, `pin_not_configured`) en vez de lanzar una excepción después de modificar el contador. La ruta `src/app/api/attendance/scan/route.ts` transforma esos valores en los estados HTTP existentes.

No se necesitó una migración nueva ni cambios en código de negocio. La migración conserva los controles de autenticación, dispositivo, empresa/sucursal, credencial QR activa, `SECURITY DEFINER`, `search_path` vacío y permisos de ejecución; las pruebas existentes verifican esos límites. El PIN sigue almacenándose como hash bcrypt, nunca en texto plano.

## Resultados de validación

- `npm run test:pin-lockout`: 3/3 pruebas pasaron.
- `npm run test:pin-lockout:db`: pgTAP 35/35; la integración PostgreSQL pasó. Comprobó persistencia de intentos en preview/confirm, lockout de cinco intentos, ventana de 15 minutos, PIN correcto durante/bajo bloqueo, vencimiento/reset, concurrencia de 12 solicitudes, acceso con dispositivo no autorizado, credencial QR revocada, aislamiento por empresa y ausencia de eventos/sesiones con PIN inválido.
- `npm test`: 63/63 pruebas pasaron.
- `npm run lint`: pasó.
- `npm run typecheck`: pasó.
- `npm run build`: pasó usando los valores públicos de CI para Supabase.
- `git diff --check`: pasó tras los cambios documentales.

Las pruebas Node mostraron avisos no fatales `MODULE_TYPELESS_PACKAGE_JSON` en módulos TypeScript importados; no afectaron los resultados.

La matriz `tests/security-jwt-matrix.integration.mjs` está fijada explícitamente al proyecto QR-asistencia-testing y no se ejecutó para respetar la restricción de no probar contra Testing. La validación multiempresa incluida en esta tarea se ejecutó en la base local desechable.

## Estado de Supabase Testing

La consulta histórica anterior se actualizó en una auditoría de solo lectura el 2026-10-28: el proyecto `llxyziffgtqnzlguxhyt` tenía 24 migraciones, incluidas 23 con nombre común respecto a `main`. No constaban QR-003 ni QR-002. Las RPC remotas todavía lanzaban excepción para PIN inválido. Las dependencias relevantes, definiciones y grants comparados coincidieron con una réplica local construida desde los SQL archivados; esa comparación limitada no descarta modificaciones manuales ajenas a esos objetos. No se modificó Testing ni Producción.

El preflight, estrategia de manifiesto y dry-run exclusivo de QR-003 están en [QR-003-MIGRATION-RECONCILIATION.md](QR-003-MIGRATION-RECONCILIATION.md). No aplicar la migración como parte de una tarea documental.

## Procedimiento para futura revisión autorizada

Regenerar el manifiesto temporal a partir del estado actual de Testing, verificar hashes e inspeccionar las funciones/grants con `SELECT`, y exigir que `supabase db push --dry-run --project-ref llxyziffgtqnzlguxhyt --skip-vault` liste solo QR-003. El dry-run confirmado en la auditoría del 2026-10-28 no sustituye la repetición inmediata antes de un cambio. La aplicación y las pruebas con datos sintéticos en Testing requieren autorización explícita en una tarea posterior.

## Reversión y riesgos

No se recomienda volver a las definiciones de `20261012030630_scanner_branch_scope_and_legacy_rpc_lockdown.sql`: estas lanzan excepciones para rechazos de PIN y reintroducen el rollback del contador. Si la migración provoca un problema operativo, detener la promoción y preparar una corrección hacia adelante que conserve las respuestas estructuradas, la autorización y la contabilidad de intentos. No existe una migración de reversión validada en esta tarea.

El riesgo abierto es que Testing siga ejecutando las definiciones anteriores hasta que la migración versionada se aplique por un flujo autorizado. No se realizó ningún cambio remoto.
