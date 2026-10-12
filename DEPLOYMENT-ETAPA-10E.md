# QR-asistencia — resultado de aplicación del lease en Testing

Fecha: 2026-10-12
Proyecto objetivo: Supabase Testing de QR-asistencia.
Producción: no consultada ni modificada.

## Resultado

**GO completado en Testing.** Se aplicó exclusivamente `20261012050537_global_report_export_lease.sql` mediante Supabase CLI 2.120.0. No se desplegó frontend ni se modificó ninguna otra migración.

La sesión de Management API de Supabase CLI no estaba presente. Se usó el modo soportado `--db-url` de la misma CLI, autenticando contra el host de base de datos de Testing. La contraseña se leyó del archivo local protegido y nunca se imprimió.

## Controles previos

- El proyecto fue verificado por ID antes de operar: nombre `QR-asistencia-testing`, estado `ACTIVE_HEALTHY`, PostgreSQL 17.11. El identificador del proyecto se omite en este informe publicado.
- El archivo local de contraseña tenía modo `600`; no se mostró su contenido.
- El respaldo real preexistente de Testing mantuvo permisos restrictivos; `pg_restore --list` terminó correctamente. Su ruta, tamaño y checksum se omiten. Se conservó sin sobrescribir.
- La restauración real de ese respaldo a una instancia PostgreSQL 17.11 aislada y la revisión de ACL/propietarios habían sido verificadas antes de esta ejecución; no se repitieron ni se usaron datos sintéticos como sustituto.
- La copia temporal alineó los 21 registros remotos con sus archivos y añadió únicamente el lease pendiente. Los SQL históricos de Git permanecieron intactos.
- `supabase migration list --db-url` mostró 21 versiones locales/remotas coincidentes y una nueva versión local pendiente.
- `supabase db push --dry-run --skip-vault` enumeró exclusivamente `20261012050537_global_report_export_lease.sql`.

## Aplicación e historial

La CLI aplicó:

```text
20261012050537_global_report_export_lease.sql
```

El historial posterior de Testing contiene las 21 versiones anteriores y `20261012050537 global_report_export_lease`; el total quedó en 22. No se utilizó `migration repair`, `--include-all`, `db reset` ni una operación manual del historial.

SHA-256 del archivo SQL local aplicado: `ccc1248fb2f41135927feba853f8ca588e4bd471bff05eacaeecbf8f6ee1d7b2`.

## Seguridad comprobada

- `private.report_export_leases` existe, tiene RLS habilitada y propietario `postgres`.
- ACL directa de la tabla: solo el propietario tiene privilegios. `anon`, `authenticated` y `service_role` no tienen `SELECT`, `INSERT`, `UPDATE` ni `DELETE` efectivos.
- Los RPC `acquire_report_export_lease(uuid,uuid,integer)`, `renew_report_export_lease(uuid,uuid,integer)` y `release_report_export_lease(uuid,uuid)` existen como `SECURITY DEFINER`, pertenecen a `postgres` y tienen `search_path` vacío.
- Los tres RPC permiten `EXECUTE` a `authenticated`; `anon` y `service_role` no tienen `EXECUTE` efectivo.

## Prueba funcional sintética

Se comprobó que no había un lease activo antes de la prueba. Se usaron dos usuarios Auth, dos empresas y membresías admin sintéticas dentro de una transacción que terminó con rollback. Las identidades solo se representaron en los claims locales de la sesión SQL; esto no fue una prueba HTTP ni una autenticación JWT real.

Pasaron estas comprobaciones del RPC:

1. Empresa A adquirió el lease global vacío.
2. Empresa B fue rechazada mientras A conservaba el lease, con tiempo de reintento positivo.
3. B no pudo renovar ni liberar el lease de A.
4. A renovó su propia concesión.
5. Al expirar la concesión sintética, B pudo adquirirla.
6. El token anterior de A no pudo renovar ni liberar la concesión nueva de B.
7. B liberó su propia concesión.

La expiración se simuló ajustando las marcas de tiempo de la fila sintética dentro de la transacción, respetando la restricción `expires_at > acquired_at`; no se esperó el vencimiento real de 60 segundos. La segunda adquisición RPC se probó mientras el lease de A seguía vigente. No se ejecutó una carrera concurrente de dos conexiones ni un benchmark HTTP de dos instancias Next.js.

La consulta posterior confirmó cero usuarios, empresas y membresías sintéticas, cero filas de lease y ningún lease activo. La tabla queda vacía tras la prueba. Las primeras dos iteraciones del arnés se revirtieron sin persistencia: una encontró correctamente el bloqueo de asignación directa del rol `owner`, y otra respetó la restricción de orden temporal. El arnés se ajustó usando rol `admin` y fechas de expiración válidas; la comprobación final pasó.

## Limpieza y límites

- Se conservó el respaldo original protegido.
- Se retiró la copia temporal de migraciones alineadas fuera del repositorio.
- No hubo cambios en migraciones históricas ni en código de aplicación. Este informe se publica como documentación junto con la guía de la Etapa 10F.
- No se validó la generación/streaming XLSX/PDF desde Next.js, el rate limit, ni carreras HTTP entre instancias; esta ejecución verificó la migración, los privilegios y el comportamiento RPC del lease.
- No se accedió a producción ni se desplegó frontend.

## Estado final

**Migración aplicada correctamente en Testing.** Las comprobaciones de historial, RLS, ACL, propietarios, funciones y ciclo de lease terminaron satisfactoriamente. No se realizó ninguna operación en producción.
