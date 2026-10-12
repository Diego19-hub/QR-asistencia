# QR-asistencia — Etapa 9.5B: restore compatible con Supabase

> La comprobación posterior de GoTrue/PostgREST contra una base restaurada está en [BACKUP-RESTORE-ETAPA-9.5C.md](BACKUP-RESTORE-ETAPA-9.5C.md). Ese ensayo autenticó las identidades sintéticas originales en un segundo stack local y documenta una falla del chequeo automático de limpieza.

Fecha: 11 de octubre de 2026
Base de código: `d04c570e655cf6def50cc9a32f91596c75911da7`
Alcance: instancia local aislada de Supabase y datos exclusivamente sintéticos

## Decisión

**GO para el ensayo local acotado:** un dump lógico de la base PostgreSQL 17.11 de una instancia local de Supabase se restauró en una base vacía del mismo clúster. Pasaron 28 comprobaciones, no hubo pruebas omitidas y se confirmó la limpieza de usuarios y datos sintéticos.

**NO-GO como evidencia de recuperación de producción.** No se consultaron los proyectos remotos Testing (`llxyziffgtqnzlguxhyt`) ni producción (`jawdrhewabqajxnswhkn`). El ensayo no valida el motor gestionado remoto, la restauración de un backup real, la conexión de GoTrue a la base restaurada ni la recuperación de Storage/configuración externa.

## Entorno y Docker

- Docker Desktop respondió y ejecutó el entorno después de permitir acceso al socket desde el contexto de ejecución autorizado. La llamada restringida inicial recibió `permission denied` en el socket; no fue un fallo del daemon.
- No se instaló software ni se crearon recursos remotos o de pago.
- Se creó el proyecto Supabase CLI local `qr_stage95b`, separado del stack preexistente `codigo_QR`. Se usaron imágenes ya almacenadas localmente.
- PostgreSQL del stack de prueba: **17.11**. Las 20 migraciones locales se aplicaron en orden y el historial local quedó alineado.
- No se detuvo ni modificó el stack `codigo_QR`.

## Pruebas funcionales con Auth y JWT

Se crearon cuatro cuentas locales sintéticas con contraseñas aleatorias en memoria del proceso. GoTrue emitió JWT mediante el flujo de contraseña; cada token se validó en `/auth/v1/user` y después se usó contra PostgREST. No se guardaron tokens ni contraseñas en el repositorio o en la evidencia publicada.

Resultado de las verificaciones funcionales: **22 aprobadas, 0 fallidas, 0 omitidas**.

| Caso | Resultado |
|---|---:|
| Inicio de sesión real local y validación JWT (dos admins, supervisor, sin membresía) | 4/4 |
| Lectura RLS por rol y empresa | 4/4 |
| Preview y `clock_in`/`clock_out` autorizados para el supervisor en su sucursal A1 | 3/3 |
| Supervisor bloqueado en A2 y en empresa B; anónimo bloqueado | 3/3 |
| Estado QR/PIN propio, aislamiento de credencial ajena y cambio de PIN denegado al supervisor | 3/3 |
| Cuota propia permitida; cuota de otra empresa y usuario sin membresía denegados | 3/3 |
| RPC legado rechazado y estado persistido sin efectos laterales no autorizados | 2/2 |

Las llamadas negativas devolvieron 401/403 según el caso. Los intentos contra A2 y B no escribieron jornadas ni eventos. La escritura positiva produjo exactamente una jornada cerrada y dos eventos autorizados para A1.

## Backup y restore PostgreSQL 17

Se tomó un dump custom de la base local Supabase PostgreSQL 17.11 mientras solo contenía datos sintéticos, se validó el índice del archivo y se restauró en una base nueva `qr_stage95b_restore` creada desde `template0`.

Resultado: **6/6 comprobaciones de backup/restore aprobadas**: dump no vacío, archivo legible por `pg_restore --list`, restore con `--exit-on-error`, igualdad de los indicadores de datos/seguridad consultados, aislamiento RLS en la base restaurada y registro de métricas. En total, incluyendo los casos funcionales, **28/28 aprobadas**.

| Medición | Resultado |
|---|---:|
| PostgreSQL | 17.11 |
| `pg_dump` | 177 ms |
| `pg_restore` | 437 ms |
| Dump | 699,746 bytes |
| SHA-256 del archivo temporal | `00ddc6a78af90646bdeb5444e1ff5e728f88b4e1cd77d59610aee62471c6adf4` |

El dump temporal tuvo modo `600`. La primera restauración intentada como `postgres` falló porque algunos objetos pertenecen al rol `supabase_admin` y el rol `postgres` del contenedor no podía ejecutar `SET ROLE supabase_admin`. Se corrigió el procedimiento ejecutando `pg_restore` como `supabase_admin`; el segundo intento terminó correctamente. No se usó `--no-owner` ni `--no-acl`, de modo que las ACL y propietarios del dump se conservaron.

Comandos representativos dentro del contenedor local `supabase_db_qr_stage95b` (sin secretos):

```sh
pg_dump -Fc -U postgres -d postgres > /private/tmp/supabase_pg17.dump
pg_restore --list < /private/tmp/supabase_pg17.dump
createdb -U postgres --template=template0 qr_stage95b_restore
pg_restore --exit-on-error -U supabase_admin \
  -d qr_stage95b_restore < /private/tmp/supabase_pg17.dump
```

La restauración del dump se ejecutó en un contenedor local del stack aislado, no en un proyecto Supabase remoto. PostgreSQL del contenedor usa los roles de plataforma de Supabase; por eso el rol de restauración debe poder asumir los propietarios del archivo. No se recomienda quitar propietarios/ACL como arreglo general, pues eso cambia el estado recuperado.

## Datos y comprobaciones de seguridad restauradas

El origen contenía dos empresas y tres sucursales sintéticas, cuatro usuarios Auth sintéticos, tres membresías/empleados, tres jornadas (dos eventos persistidos para la prueba) y credenciales QR/PIN sintéticas. En origen y destino se compararon conteos de estas entidades, conteo de migraciones, políticas RLS, tablas con RLS y privilegios relevantes.

En la base restaurada se confirmaron los registros de migración `20261011232050` y `20261012030630` y estos resultados de catálogo:

- `private.report_export_rate_limits`: RLS habilitada; sin `SELECT` para `authenticated`.
- `public.consume_report_export_quota(uuid)`: `EXECUTE` para `authenticated`, no para `anon`.
- RPC actual `public.scan_employee_attendance(...)`: `EXECUTE` para `authenticated`, no para `anon`.
- RPC heredado `public.record_attendance_event(...)`: sin `EXECUTE` para `authenticated` ni `anon`.
- El caso de RLS en el destino restaurado mostró que el admin A veía las dos jornadas de A y cero de B.

El test RLS posterior al restore usó claims sintéticos configurados en una conexión PostgreSQL local; **no fue un JWT firmado ni una autenticación GoTrue contra la base restaurada**. La autenticación JWT real se probó antes del backup contra la instancia local de Supabase de origen.

Las migraciones verificadas corresponden al registro versionado local. No se consultó el historial ni el estado de ningún proyecto remoto. La migración del limitador conserva su tabla privada con RLS y permisos restringidos. La migración del escáner conserva el alcance por sucursal, deja el RPC vigente disponible solo para `authenticated` y bloquea el wrapper legado a `anon`/`authenticated`.

## Alcance de recuperación

El dump lógico restauró la base PostgreSQL: esquemas, tablas y datos incluidos en la base, funciones, vistas, triggers, constraints, extensiones disponibles, grants, políticas RLS y registro de migraciones. La comparación funcional y los checks de catálogo demostraron las propiedades específicas documentadas arriba; no constituyen una comparación byte a byte de cada objeto de la plataforma.

No quedó validado por este ensayo:

- **Auth/GoTrue:** aunque `auth.users` y sus filas sintéticas forman parte de PostgreSQL, no se apuntó GoTrue a `qr_stage95b_restore` ni se demostró un nuevo login después de cambiar la base. Secretos/JWT signing keys, proveedores, SMTP, MFA, plantillas, sesiones y configuración de Auth requieren recuperación/configuración coordinada e independiente.
- **Storage:** `src` no contiene uso de Supabase Storage, por lo que no se probaron buckets ni objetos. Si la aplicación empieza a utilizarlo, habrá que respaldar tanto los metadatos como los objetos y validar su correspondencia.
- Secretos de Edge Functions, configuración del gateway/Data API, variables de entorno, DNS, hosting, observabilidad e integraciones externas.
- Backups administrados, PITR, retención, RPO/RTO y versión exacta del motor gestionado de Testing/producción.

## Limpieza

Tras terminar:

- Se eliminaron por ID las dos empresas, empleados, jornadas, eventos, límites, dispositivos y demás filas de las fixtures.
- Se eliminaron exclusivamente las cuatro cuentas Auth locales creadas por esta ejecución.
- La comprobación administrativa en el origen encontró cero empresas, usuarios y empleados con los IDs/correos de prueba.
- La base `qr_stage95b_restore` se eliminó. El dump, contraseñas aleatorias y archivos temporales permanecieron fuera del repositorio con permisos restrictivos para el proceso y se eliminaron al apagar el stack.
- No se modificaron las tres cuentas Auth preexistentes del antiguo proyecto de pruebas remoto.

## Próximo paso para recuperación real

Antes de declarar listo el plan de recuperación productivo, aprobar por separado un destino aislado y una ventana de ensayo; identificar la versión PostgreSQL exacta del servicio remoto; restaurar un backup protegido en ese destino; recuperar roles/configuración compatibles; reconectar y probar Auth con usuarios sintéticos; y probar Storage si para entonces la aplicación lo usa. Medir tiempos con un conjunto representativo, fijar RPO/RTO, verificar backups externos y ejecutar pruebas de acceso/RLS antes de aceptar el entorno. No usar datos reales en este ejercicio sin una autorización y controles de tratamiento específicos.

**Decisión final de la etapa:** ensayo local Supabase/PostgreSQL 17.11 aprobado (28/28); cobertura Auth JWT positiva en origen; restore aislado y RLS aprobados. **NO-GO para declarar restauración de Supabase remoto o recuperación de producción probada.**
