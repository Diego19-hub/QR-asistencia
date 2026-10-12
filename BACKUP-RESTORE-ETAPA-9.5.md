# QR-asistencia — Etapa 9.5: ensayo de backup y restore

> La continuación compatible con Supabase local/PostgreSQL 17.11 está documentada en [BACKUP-RESTORE-ETAPA-9.5B.md](BACKUP-RESTORE-ETAPA-9.5B.md). Ese ejercicio no sustituye un restore autorizado de un backup remoto.

Fecha: 11 de octubre de 2026
Base de código: `9305ed70d1efeb6167f105753205b0c24e7e66a8`
Alcance: PostgreSQL local, datos exclusivamente sintéticos

## Resultado

**El respaldo lógico y la restauración local se completaron correctamente.** Se crearon dos clústeres PostgreSQL locales aislados y dos bases separadas. Las 20 migraciones versionadas se aplicaron en orden al origen; el archivo se restauró en una base nueva y vacía. Tras restaurar, coincidieron los conteos por tabla y los metadatos de esquema, restricciones, funciones, permisos, RLS y registro local de migraciones.

No se conectó, consultó ni modificó `QR-asistencia-testing` (`llxyziffgtqnzlguxhyt`) ni producción (`jawdrhewabqajxnswhkn`). No se creó ningún recurso Supabase, no hubo cargos y no se usaron datos personales o laborales reales.

## Entorno y compatibilidad

- Docker CLI estaba instalado, pero Docker Desktop no permitió acceder a `~/.docker/run/docker.sock`: `permission denied`. No se modificó Docker ni se instaló software.
- Alternativa usada: PostgreSQL 18.4 de Homebrew; `pg_dump` y `pg_restore` también eran 18.4.
- Los dos servidores escucharon solo en `127.0.0.1`, en puertos distintos, y sus directorios estaban bajo `/private/tmp` con permisos restringidos.
- Se crearon roles locales `anon`, `authenticated` y `service_role`, esquemas `auth` y `extensions`, y una tabla/funciones `auth` mínimas para que las políticas y migraciones pudieran compilarse.
- La tabla local `supabase_migrations.schema_migrations` fue un registro sintético para comprobar el conjunto y el orden de las 20 versiones. No es el historial administrado de Supabase.

Por tanto, esto demuestra restaurabilidad lógica en PostgreSQL 18.4 para el esquema del repositorio. No demuestra compatibilidad con la versión exacta del motor administrado en Supabase ni reemplaza una restauración de Supabase en un proyecto de recuperación autorizado.

## Datos sintéticos

El origen contenía:

| Tipo | Cantidad |
|---|---:|
| Empresas | 2 |
| Sucursales | 3 |
| Usuarios Auth sintéticos / membresías | 3 / 3 |
| Supervisores | 2 |
| Empleados | 3 |
| Jornadas cerradas | 3 |
| Eventos de asistencia | 6 |

Las dos jornadas de Empresa A sumaron 960 minutos efectivos; la jornada de Empresa B sumó 480 minutos. Una jornada cruzaba medianoche. Todos los objetos, IDs, correos y registros fueron sintéticos.

## Comandos representativos

Se omitieron claves porque no se usaron credenciales remotas. El usuario PostgreSQL local se autenticó mediante `trust` dentro de los clústeres temporales aislados.

```sh
initdb -D "$TMP/source-data" --auth=trust --username=postgres
initdb -D "$TMP/restore-data" --auth=trust --username=postgres
pg_ctl -D "$TMP/source-data" -o "-p 55432 -k $TMP/source-sock -h 127.0.0.1" -l "$TMP/source.log" start
pg_ctl -D "$TMP/restore-data" -o "-p 55433 -k $TMP/restore-sock -h 127.0.0.1" -l "$TMP/restore.log" start
createdb -h 127.0.0.1 -p 55432 -U postgres qr_stage95

# Bootstrap local de roles/esquemas Auth sintéticos; después, migraciones por nombre:
for migration in supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U postgres \
    -d qr_stage95 -f "$migration"
done

pg_dump -Fc -h 127.0.0.1 -p 55432 -U postgres \
  -d qr_stage95 -f "$TMP/qr_stage95.dump"
chmod 600 "$TMP/qr_stage95.dump"
pg_restore --list "$TMP/qr_stage95.dump"
createdb -h 127.0.0.1 -p 55433 -U postgres qr_stage95_restored
pg_restore --exit-on-error -h 127.0.0.1 -p 55433 -U postgres \
  -d qr_stage95_restored "$TMP/qr_stage95.dump"
```

El dump de formato custom no contiene roles globales del clúster. Para el ensayo, los tres roles API se crearon en el clúster destino antes del restore. En una recuperación real se debe restaurar también la definición de roles compatible con el destino, con revisión de atributos y grants; no copiar indiscriminadamente atributos privilegiados.

## Evidencia medida

- Duración de `pg_dump`: **85 ms**.
- Duración de `pg_restore`: **121 ms**.
- Tamaño del dump: **271,651 bytes**.
- SHA-256: `965feedbe01ae73f23d3abb229aed067f0000488b3151bed433da68c402d6f84`.
- Modo del archivo durante la validación: `600`.
- `pg_restore --list`: correcto; la restauración con `--exit-on-error`: correcta.
- Esquema normalizado: SHA-256 idéntico `39d97eaf62d2aa533ba0e50d0b30192d85c7ea3d54b8f895a383b82fdbc88872`. Se normalizaron los marcadores aleatorios `restrict/unrestrict` de `pg_dump` y tres aliases `AS text` que PostgreSQL vuelve a emitir al decompilar la vista de periodos.

## Comparación y pruebas

La comparación entre origen y restore aprobó todos los grupos:

- 5 esquemas y 2 extensiones.
- 32 tablas con conteos fila por fila idénticos.
- 347 constraints, incluidas FKs, todas validadas; cero constraints sin validar.
- 80 funciones: firmas, cuerpo, lenguaje, `SECURITY DEFINER`, `search_path`, volatilidad y ACL idénticos.
- 54 políticas RLS y 34 flags de RLS idénticos.
- 35 ACLs de objetos y 5 ACLs de esquema idénticos.
- 20 entradas del registro sintético de versiones, idénticas.

Pruebas funcionales con claims de identidad sintéticos en PostgreSQL, ejecutadas tanto en origen como en restore: **8/8 aprobadas** (4 por base). Admin A vio sus dos jornadas y cuatro eventos, sumó 960 minutos y no vio sesiones B. Admin B vio su jornada/eventos, sumó 480 minutos y solo vio Empresa B. El supervisor A vio una jornada, dos eventos y 480 minutos de su sucursal asignada, sin sesiones B. `anon` no tiene permiso directo de lectura sobre jornadas.

En el restore, una inserción negativa que intentaba combinar la empresa/sucursal B con el empleado de A fue rechazada por FK; el conteo permaneció en tres jornadas. El RPC heredado `record_attendance_event` no concedía `EXECUTE` a `anon` ni `authenticated`; el RPC actual de escáner sí lo concede a `authenticated` y no a `anon`. Las tablas privadas `bootstrap_requests` y `device_token_hashes` no tienen RLS, pero no conceden SELECT a `anon`, `authenticated` ni `service_role`; se registran como excepción de endurecimiento, no como acceso público observado en este ensayo.

Los claims se configuraron con `set_config` en una instancia local; **no eran JWT firmados ni sesiones de Supabase Auth**. Las pruebas validan políticas PostgreSQL y límites de rol bajo el stub local, no el proceso de inicio de sesión de GoTrue.

## Cobertura de recuperación y límites

El dump lógico cubrió los objetos y datos de la base de datos del esquema cargado: tablas, datos, funciones, vistas, triggers, constraints, extensiones disponibles, políticas RLS y ACL de objetos. La restauración conservó las FKs, las políticas y los grants comprobados.

No quedó cubierto:

- GoTrue/Supabase Auth como servicio, hashes reales de contraseñas, proveedores, plantillas/correo, MFA, sesiones, claves JWT ni configuración de Auth. `auth.users` fue una tabla sintética local, no una copia ni un backup del servicio.
- Objetos o configuración de Storage, secretos de Edge Functions, configuración de API/Data API, DNS, hosting, variables de entorno, monitoreo y servicios externos.
- Roles globales y atributos de clúster incluidos fuera del dump de base de datos; se recrearon solo los tres roles API mínimos para este ensayo.
- Rendimiento, duración o restauración de un backup real de Supabase, así como compatibilidad con su versión de PostgreSQL.

Para producción, el responsable debe definir cifrado, retención, control de acceso, custodia de claves, backups externos de Storage si se requieren y una restauración aislada autorizada de los componentes necesarios. No debe probarse un restore sobre Testing con datos productivos ni sobre producción.

## Limpieza y decisión

Después de completar las verificaciones, se detuvieron ambos servidores y se eliminaron los dos clústeres, el dump y los archivos temporales sintéticos. No quedan fixtures ni backups de este ensayo en el repositorio.

**Conclusión del ejercicio:** GO para la afirmación acotada “el dump sintético del esquema versionado se restauró y validó en PostgreSQL local 18.4”. **NO-GO para producción**: sigue pendiente demostrar el proceso de recuperación que realmente se utilizará con Supabase (incluyendo Auth/Storage/configuración según alcance), verificar la versión del motor destino y completar los bloqueos de lanzamiento descritos en `SECURITY-HOTFIX-ETAPA-9.4B.md`.
