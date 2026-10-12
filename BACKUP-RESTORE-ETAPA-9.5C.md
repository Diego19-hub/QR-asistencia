# QR-asistencia — Etapa 9.5C: recuperación local de Auth

Fecha: 11 de octubre de 2026
Commit base: `0f8a42becfbbef199b4654eb9863fe0461e0fcf9`
Alcance: dos stacks Docker locales independientes y datos totalmente sintéticos

## Resultado

**GO para demostrar recuperación de identidades Auth y uso de JWT en una segunda instancia local.** El dump se restauró en un PostgreSQL 17.11 nuevo; se iniciaron procesos nuevos de GoTrue, PostgREST y Kong contra esa base. Las cuatro cuentas Auth restauradas iniciaron sesión con las mismas contraseñas aleatorias que se habían usado en el origen. Sus IDs coincidieron con los originales, los nuevos JWT pasaron `/auth/v1/user` y PostgREST aplicó RLS.

**Resultado estricto de la suite: 54 aprobadas, 1 fallida, 0 omitidas.** La única falla fue la comprobación explícita de borrado de las cuentas Auth en destino: el arnés no agregó los IDs restaurados a su lista de limpieza. Luego destruyó el stack y volúmenes completos, eliminó los archivos temporales y verificó que no quedaran recursos `qr95c`; la limpieza final sí quedó confirmada. La falla es del arnés de limpieza, no del login ni de la autorización. Se informa como falla y no se cuenta como aprobada.

La demostración **no acredita recuperación de producción**. No se conectó a Testing (`llxyziffgtqnzlguxhyt`) ni a producción (`jawdrhewabqajxnswhkn`), no se desplegó frontend y no se crearon servicios remotos ni de pago.

## Entorno

- Supabase CLI local `2.120.0`, PostgreSQL `17.11`, imágenes Docker locales.
- Proyectos Docker temporales separados: `qr95c_source` y `qr95c_restore`, con puertos y redes independientes. El stack existente `codigo_QR` permaneció activo e intacto.
- El origen y destino usaron el mismo conjunto de 20 migraciones versionadas. En el destino restaurado se verificaron `20261011232050` y `20261012030630`.
- Se generaron cuatro correos `.invalid` y cuatro contraseñas aleatorias distintas. El archivo temporal de contraseñas tuvo modo `600`; no se imprimieron valores. En destino no se llamó a signup ni a la API de creación de usuarios.
- Se crearon Empresa A/B, sucursales A1/A2/B1, tres empleados y jornadas sintéticas centinela. El supervisor pertenecía a A y solo estaba asignado a A1.

La CLI permite usar configuraciones y puertos distintos para proyectos locales; el ensayo se mantuvo fuera del enlace de cualquier proyecto remoto. Referencia: [configuración de Supabase CLI](https://supabase.com/docs/guides/local-development/cli/config).

## Procedimiento ejecutado

1. Se levantó el stack `qr95c_source`; GoTrue creó las cuatro cuentas sintéticas. Las cuatro autenticaron mediante el flujo de contraseña y el JWT de cada una se validó con `/auth/v1/user`.
2. Se cargaron membresías, ramas, empleados, credenciales QR/PIN sintéticas y jornadas centinela. Admin A/B, supervisor A y usuario sin membresía demostraron sus permisos en PostgREST. El escáner registró entrada y salida autorizadas en A1.
3. `pg_dump -Fc` respaldó la base PostgreSQL completa, incluidos `auth.users` y los hashes de contraseña, con propietarios y ACL. El archivo quedó restringido a modo `600`.
4. Se detuvo y eliminó el stack de origen después de comprobar su limpieza.
5. Se levantó `qr95c_restore`, con su propio PostgreSQL, Auth y Data API. Se detuvieron sus servicios API, se eliminó solo la base local destino `postgres`, se recreó desde `template0` y se restauró el archivo con `pg_restore --exit-on-error -U supabase_admin`.
6. Se arrancaron procesos nuevos de GoTrue, PostgREST y Kong. Los servicios quedaron configurados por la CLI destino para usar la base destino restaurada; la base contenía los usuarios originales del dump.
7. Sin crear cuentas en destino, se autenticaron las cuatro identidades con las contraseñas originales. Se compararon sus UUID antes/después y los JWT nuevos se probaron en Auth, PostgREST y RPC.

### Problema encontrado y solución

El primer intento ejecutó `pg_restore --clean` contra la base `postgres` inicializada de Supabase. Falló al intentar borrar la constraint heredada `messages_2026_10_15_pkey` de una partición gestionada por Realtime. No se continuó con esa base parcialmente modificada. Se descartó el stack temporal y se repitió el ensayo recreando la base destino desde `template0`, restaurando el archivo sin `--clean` y arrancando después los servicios API. La restauración limpia terminó con código cero y los nuevos servicios autenticaron a las cuentas restauradas.

## Casos comprobados

| Área | Evidencia |
|---|---|
| Auth origen | 4/4 inicios por contraseña; JWT validado mediante `/auth/v1/user` |
| Auth destino tras restore | 4/4 cuentas originales; UUIDs iguales; JWT nuevo emitido por el GoTrue destino y validado en `/auth/v1/user` |
| Ausencia de signup destino | Conteo destino de las cuatro cuentas y sus IDs igual al origen antes y después del login |
| RLS multiempresa | Admin A vio jornadas de A y cero de B; Admin B vio B; usuario sin membresía no vio filas |
| RLS de supervisor | Supervisor A vio A1; no vio A2 ni B1 |
| Escáner | Preview, `clock_in` y `clock_out` válidos en A1; A2 y empresa B rechazados |
| RPC heredado | `record_attendance_event` rechazado para el rol de aplicación |
| Credenciales/horas extra | Estado QR/PIN sintético comprobado; RPC de límite propio permitido, cross-tenant y sin membresía rechazado |
| Restricciones | RLS del limitador habilitada, sin SELECT para `authenticated`; RPC vigente con grants requeridos y wrapper heredado sin EXECUTE para `anon`/`authenticated` |

La suite tuvo **55 comprobaciones esperadas: 54 PASS, 1 FAIL, 0 omitidas**. La falla `target_cleanup` se debió a que el arnés no registró los IDs de Auth restaurados para llamar al borrado administrativo al final. La limpieza de filas SQL se inició, pero la verificación de usuarios aún encontró las cuatro cuentas. El cierre destruyó a continuación ambos proyectos Docker, sus volúmenes y todos los archivos de `/private/tmp/qr-stage95c`; se comprobó que no quedaran contenedores ni volúmenes con el prefijo `qr95c`. El resultado final de recursos quedó limpio, aunque la aserción interna previa al teardown falló.

## Tiempos y recursos observados

| Medición | Resultado |
|---|---:|
| `pg_dump` | 200 ms |
| `pg_restore` | 380 ms |
| Inicio del stack destino hasta completar sus pruebas Auth/RLS/escáner | 39,682 ms |
| Tamaño del dump sintético | 697,971 bytes |
| SHA-256 del dump temporal | `b638a592149c46d0d7c06a35fc4b528cc10f1f36a0fb16309f2079f752f1d71c` |
| Memoria Docker, muestra del stack origen completo (12 contenedores) | 1,751,571,755 bytes; máximo por contenedor 596,849,459 bytes |
| Memoria Docker, muestra destino al probar (4 contenedores activos) | 258,033,580 bytes; máximo por contenedor 112,512,204 bytes |

Las cifras de memoria son muestras de `docker stats`, no máximos durante toda la prueba. Los tiempos corresponden a una base muy pequeña con datos sintéticos y no estiman el RTO de una base productiva.

## Cobertura y configuración externa

El dump recuperó el estado PostgreSQL requerido para que un GoTrue nuevo reconociera los cuatro usuarios y verificara sus hashes de contraseña. El destino firmó JWT nuevos con su configuración local propia; no se restauraron ni reutilizaron tokens de origen.

Para una recuperación real también se debe inventariar y recuperar por separado, de forma coordinada y segura:

- Claves de firma JWT, issuer, expiración y configuración de rotación; las sesiones/JWT existentes pueden requerir reautenticación si cambia el firmante.
- Proveedores Auth, SMTP, redirect/site URLs, MFA, plantillas y otros secretos/configuración de GoTrue.
- Configuración de Kong/Data API, variables de entorno de la aplicación, secretos de Edge Functions, hosting, DNS y monitoreo.
- Objetos de Storage si se introducen en la aplicación. En el código actual no se encontró uso de Supabase Storage; no se probaron buckets ni objetos.
- Roles globales/atributos de clúster, extensiones disponibles y permisos que el dump de una sola base no reconstruye por sí mismo; este ensayo usó la instalación destino de la misma versión para aportar los roles de plataforma.

Un restore lógico local no demuestra disponibilidad de backups administrados, PITR, retención, RPO/RTO ni compatibilidad exacta con el motor remoto. Para producción se requiere una prueba separada en un destino aprobado y aislado, con una copia protegida y un plan explícito de recuperación de configuración y secretos.

## Limpieza y decisión

Se verificó la eliminación de los contenedores, volúmenes y archivos temporales de `qr95c_source` y `qr95c_restore`. Las fixtures del origen se borraron por ID antes de detenerlo. En el destino, la comprobación por API de borrado de cuentas falló por el error de bookkeeping descrito; el teardown del stack y volumen eliminó definitivamente esas cuentas y todos los datos sintéticos. El stack `codigo_QR` siguió activo. No hubo consultas, escrituras ni despliegues remotos.

**Decisión:** GO para la prueba técnica de que un GoTrue/PostgREST nuevos pueden usar una base restaurada y autenticar las identidades originales con JWT reales. **NO-GO para dar por completamente verde el cierre automatizado** hasta corregir el registro de IDs en el cleanup del arnés y repetir esa aserción; la falla no invalida las verificaciones de recuperación/Auth, pero debe conservarse en el historial de pruebas.
