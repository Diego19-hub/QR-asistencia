# QR-003 — Plan de respaldo y recuperación de Testing

## Estado y alcance

Este plan prepara recuperación para QR-asistencia-Testing (`llxyziffgtqnzlguxhyt`) sin cambiar el proyecto. La última lectura registrada informó que no había respaldos listados y PITR estaba deshabilitado. No se exportaron datos alojados ni se modificaron Testing o Producción.

**Decisión vigente: NO-GO para escribir QR-003.** La simulación local demuestra que una copia sintética puede cifrarse, verificarse y restaurarse en un stack nuevo. No demuestra que exista hoy un respaldo recuperable de Testing ni que pueda restaurarse el proyecto alojado. Esas condiciones requieren autorización y verificación separadas.

## Alternativas de respaldo

| Opción | Cobertura y recuperación | Costos y límites | Evaluación |
|---|---|---|---|
| Respaldo diario administrado de Supabase | Copia física administrada de la base Postgres; restauración desde Dashboard, con indisponibilidad mientras se recupera. Retención publicada: Pro 7 días, Team 14 días y Enterprise hasta 30 días. | No disponible en Free. Incluida en los planes pagos indicados; el costo base del plan y el tamaño del proyecto dependen de la cuenta. Las contraseñas de roles Postgres personalizados no aparecen en el respaldo y se deben restablecer. No contiene archivos de Storage. | Mejor barrera operativa para restaurar la base existente; no cubre toda la configuración ni objetos de Storage. Confirmar plan, fecha y restore point en el Dashboard antes de cambiar a GO. |
| PITR administrado | Recuperación de la base a un punto temporal con granularidad de segundos; Supabase advierte que el peor RPO puede rondar 2 minutos y que el punto más reciente puede estar retrasado. El proyecto queda inaccesible durante la restauración. | Add-on en planes pagos; la guía consultada publica aproximadamente USD 100/mes por 7 días de retención, USD 200 por 14 y USD 400 por 28, facturados por hora. Requiere compute Small como mínimo. Verificar precio y requisitos actuales antes de activar. | Adecuado si el RPO diario no basta. Actualmente PITR estaba deshabilitado; activarlo implica costo y requiere autorización del dueño de facturación. |
| Backup lógico con Supabase CLI | `supabase db dump` usa `pg_dump` y genera SQL de roles, esquema o datos. Permite restauración selectiva en una instancia Postgres compatible. | CLI y Docker local; almacenamiento externo cifrado puede tener costo. Es una exportación que contiene datos sensibles. El dump CLI excluye esquemas administrados como `auth`, `storage` y los de extensiones; por defecto no incluye datos ni roles personalizados. | Útil como copia adicional de datos/esquema propios, no como copia íntegra de un proyecto Supabase. |
| `pg_dump` directo | Puede producir un archivo de formato custom y capturar la base completa que el rol pueda leer, incluidas tablas de `auth`. | Requiere conexión/credenciales de base y revisión de privilegios; captura solo PostgreSQL. No es un mecanismo certificado para reproducir el plano de control o ficheros binarios. | Ensayado aquí solo en un stack local sintético. No ejecutar contra Testing sin autorización específica de exportación de datos. |
| Migraciones, seed y configuración versionada | Reconstruye esquema y fixtures declarados por el repositorio. | No incluye estado/datos no versionados, Auth users, Storage objects ni secretos administrados. | Recuperación de código/esquema, nunca reemplazo de backup de datos. |
| Restaurar a un proyecto nuevo / branching | Copia de base desde un respaldo a otro proyecto para validar recuperación sin sobrescribir el origen. Puede copiar tablas y datos Auth de la base. | La función publicada está en beta y requiere plan pago/backup físico; proyecto/compute puede generar costo. No copia objetos de Storage, Edge Functions ni varias configuraciones de Auth/API/Realtime; hay que reconfigurarlas manualmente. | Opción preferida para un ensayo alojado sin tocar Testing, solo después de aprobación de costo, privacidad y acceso. Esta tarea no creó ningún proyecto. |

### Qué incluye y qué no incluye un dump SQL

Un archivo SQL no es una copia completa del proyecto. El `supabase db dump` oficial filtra esquemas administrados, incluidos `auth`, `storage` y esquemas de extensiones. Por tanto, no debe suponerse que conserva usuarios/sesiones Auth ni metadatos/buckets de Storage. Su dump estándar tampoco trae datos ni roles custom sin las opciones correspondientes (`--data-only`, `--role-only`). Al restaurar, los roles custom requieren volver a establecer contraseñas y deben revisarse los privilegios por defecto.

Tampoco se exportan desde SQL los archivos binarios de Storage, las claves API/JWT, ajustes SMTP/OAuth de Auth, secretos de Edge Functions, configuración de red, configuración de servicios/plataforma ni otros recursos del plano de control. Realtime/publications, extensiones no estándar, Vault/column encryption y webhooks deben inventariarse y reconstruirse o validarse de forma específica. Incluso el backup físico de base no contiene los bytes de los objetos de Storage; estos necesitan un mecanismo independiente.

Para un backup lógico propio, la guía oficial ejemplifica tres artefactos: roles, esquema y datos. Ejecutar eso contra Testing requiere autorización separada de exportación de datos, un método de credenciales aprobado y una política de retención. No se ejecutaron esos comandos remotos en esta tarea.

## Protección, custodia y verificación

1. Usar un destino aprobado fuera del repositorio y del directorio de trabajo; nunca subir dumps a Git, artefactos públicos, tickets o chat.
2. Limitar acceso por grupo mínimo, MFA y registro de descargas/restauraciones. Usar cifrado cliente (por ejemplo, GnuPG AES-256 con passphrase interactiva o clave pública administrada) además del cifrado de plataforma. La clave vive separada del archivo en un gestor corporativo; no se pasa como argumento de shell ni se registra.
3. Aplicar `umask 077`, permisos `0700` al directorio y `0600` a archivos. Evitar archivos en claro persistentes; trabajar en almacenamiento efímero cifrado y verificar la eliminación conforme a la política del dispositivo. No confiar en borrado seguro de SSD.
4. Calcular SHA-256 del ciphertext después de cerrar/escribir el archivo, almacenar el checksum en un manifiesto separado firmado o controlado por el mismo repositorio seguro, y comprobarlo antes de descifrar. Tras descifrar, cotejar el hash del plaintext con el calculado en origen. El checksum prueba integridad frente a corrupción, no identidad/autenticidad; conservar además firma/MAC del artefacto.
5. Retener varias generaciones cifradas en almacenamiento separado del proyecto, con política aprobada de expiración y borrado. Probar de forma periódica una restauración aislada y documentar versión de PostgreSQL, CLI, extensiones, hashes, duración y verificaciones.

Las contraseñas, tokens, URL de conexión completa y claves de cifrado no deben aparecer en historial, logs ni manifiestos. Un dump SQL puede contener empleados, eventos, credenciales hash, correos, identificadores, datos Auth u otros secretos almacenados por la aplicación; tratarlo con la misma clasificación que los datos originales.

## Procedimiento de recuperación recomendado

### Recuperación completa de base

1. Abrir un incidente/cambio, identificar proyecto origen y punto de recuperación en Dashboard y validar con el dueño del entorno la ventana, impacto, retención y permisos. Confirmar un respaldo recuperable por identificador/fecha; no inferirlo por el plan contratado.
2. Preferir una restauración **a proyecto aislado nuevo** para ensayo alojado. Antes de crear ese proyecto, obtener aprobación explícita de costo y acceso; no usar Testing como destino del ensayo. Si no hay presupuesto o backup físico descargable, detenerse y ensayar en Supabase local solo con datos sintéticos.
3. Descargar/procesar el backup mediante el canal oficial, cifrarlo durante la transferencia o inmediatamente al destino aprobado, calcular SHA-256, verificarlo de forma independiente y registrar el custodio. Nunca guardar temporalmente el backup real en este repositorio.
4. Restaurar en el destino vacío compatible. Si es un backup físico, respetar el procedimiento/versiones soportadas de Supabase. Si es lógico, preparar versiones PostgreSQL y extensiones, roles y ajustes; restaurar en orden roles → esquema → datos, dentro de transacción cuando sea compatible. Preservar el historial de migraciones solo si se exportó y validó expresamente.
5. Restaurar de forma independiente los objetos de Storage y configuraciones inventariadas. Reconfigurar Auth (SMTP/OAuth, URLs de redirect, límites, MFA/proveedores), API keys/JWT, Edge Functions/secrets, webhooks, realtime publications, restricciones de red y extensiones; rotar/recrear credenciales según política. No copiar claves de producción en una instancia de prueba.
6. Validar integridad estructural: conteos acordados por tabla, restricciones, índices, funciones/triggers/RLS, ACL, roles, historial de migraciones, extensiones, jobs y relaciones. Validar Auth con usuarios sintéticos, login/session, correo/configuración de providers sin enviar correo externo. Validar Storage con objetos de prueba y checksum por objeto. Verificar aislamiento multiempresa y RPC de asistencia en el destino aislado.
7. Comparar resultados con inventario previo, registrar hashes, fecha de punto recuperado, tiempos y diferencias. Mantener el proyecto original intacto hasta aceptación explícita. Eliminar el entorno restaurado según política cuando termine el ensayo.

### Restauración local repetible

Para desarrollo local, crear dos workdirs desechables con IDs y puertos únicos; copiar `supabase/config.toml`, migraciones **y los recursos referenciados por config**; bloquear variables remotas heredadas. Generar el dump solo desde PostgreSQL de origen local, cifrarlo fuera del checkout, verificar SHA-256, descifrarlo y restaurarlo a una base local nueva. Confirmar `API_URL` loopback y el conjunto exacto de contenedores antes y después. El runner `tests/integration/supabase_restore_auth_local.py` implementa esta prueba con datos sintéticos y limpia los dos stacks, volúmenes, red y temporal; no hace link ni acepta credenciales alojadas.

## Evidencia local de esta tarea

Se corrigió el runner de restauración local, que inicialmente no copiaba las plantillas de correo Auth requeridas por `config.toml` y tenía aserciones obsoletas de 20 migraciones/PG 17.11. Una ejecución intermedia llegó a **54/55**: falló únicamente la comprobación que fijaba esos valores antiguos. La comprobación ahora exige el major 17 y compara la historia con la cantidad de archivos SQL que realmente copió. La ejecución final cifrada pasó 56/56.

Comando:

```sh
python3 tests/integration/supabase_restore_auth_local.py
```

Resultado final: **56/56 PASS**, 0 fallos, 0 omitidas. `TEARDOWN PASS`: no quedaron recursos temporales y el stack preexistente `codigo_QR` quedó sin cambios. Se usaron dos stacks Supabase locales en loopback, identidades/empresas/sucursales/empleados/dispositivos/QR/PIN y eventos sintéticos.

La prueba hizo `pg_dump -Fc` en la base local de origen, cifró el archivo con GnuPG AES-256 a un artefacto temporal con permisos 0600, verificó SHA-256 antes y después del descifrado, comprobó el índice del archivo con `pg_restore --list` y restauró a una base local nueva. Luego verificó Auth users y logins, membresías/RLS multiempresa, funciones/RPC, permisos y operaciones sintéticas. El ciphertext tuvo 164724 bytes y SHA-256 `25dc22a2ad0fbe190b4f45d12a4c8e92387c4ae30e575b68a4b41fedde4e650b`; SHA-256 del plaintext antes y después: `ee6fa0790adb54c482194b4a07b024393e936b140ca41b8b8fefd0384570d24a`. El dump y la clave temporal se eliminaron con la carpeta del ensayo.

Esta POC **no prueba** exportación/restauración de datos reales, objetos Storage, ajustes de Auth/SMTP, API keys, configuración administrada, ni restauración de un proyecto alojado. Los tiempos medidos (pg_dump ~1.31 s, pg_restore ~1.44 s; ensayo total ~76 s) son únicamente para una base pequeña local y no son estimaciones del RTO remoto.

## RPO y RTO

| Mecanismo | RPO esperado | RTO esperado |
|---|---|---|
| Backup diario administrado | Hasta 24 h, condicionado a que el respaldo programado exista y sea recuperable. | No publicado como garantía en este plan; objetivo operativo propuesto ≤4 h desde autorización/selección hasta validación, sujeto a tamaño, downtime y servicios manuales. Falta ensayo alojado. |
| PITR | Supabase publica granularidad de segundos y hasta ~2 min de RPO en peor caso; revisar el recovery window real antes del incidente. | Objetivo propuesto ≤4 h; depende del tamaño y tiempo de recuperación. No medido para Testing y PITR estaba apagado. |
| Dump lógico diario propio | ≤24 h solo si la extracción completa y su verificación concluyen cada día; fallos de job empeoran ese RPO. | Objetivo propuesto ≤4 h en instancia aislada compatible; requiere restaurar datos, Auth/Storage/config por separado y no está probado con datos reales. |

Los objetivos de 4 h son metas de operación por aprobar, no promesas del proveedor. Actualmente no se confirma RPO/RTO recuperable para Testing porque la última consulta no mostró respaldos y PITR estaba deshabilitado.

## Recuperación acotada de QR-003

La migración `20261018120000_persist_employee_pin_failures.sql` hace `CREATE OR REPLACE FUNCTION` sobre `public.scan_employee_attendance` y `public.confirm_employee_attendance`, ajusta sus ACL, notifica a PostgREST y lo envuelve en `BEGIN/COMMIT`. No cambia columnas ni filas. Si falla antes del commit y el servidor conserva la transacción, PostgreSQL revierte las definiciones/grants de esa migración y el estado previo permanece; hay que confirmar el estado real antes de reintentar.

Si la migración confirma pero luego se detecta una regresión, la recuperación preferida es **corrección hacia adelante**: preparar y probar en una réplica local una definición corregida y sus grants; luego autorizar y aplicar una migración de recuperación nueva, inspeccionada y versionada. No reemplazar las funciones por las versiones antiguas: esas lanzan excepciones después de actualizar el contador de PIN y revierten el incremento. Una restauración de definiciones SQL no restaura datos y no es un backup de la base. QR-003 no altera datos al aplicarse, pero los intentos, sesiones/eventos producidos después son estado de datos y no se recuperan restaurando funciones.

No hay script de rollback verificado. Antes de cualquier escritura, revisar el cuerpo y ACL pre/post, preparar mecanismo de forward-fix, saber si habrá indisponibilidad de RPC y confirmar backup de datos acorde al RPO. La recuperación exacta de un incidente de datos requiere el backup/PITR del proyecto completo y un cambio separado.

## Autorizaciones y criterios para cambiar NO-GO a GO

Se requiere autorización explícita separada para:

- exportar cualquier dato real de Testing mediante CLI/pg_dump o descargar un backup;
- cambiar plan, habilitar PITR/compute o incurrir en costo de backup/Storage/proyecto;
- crear un proyecto alojado aislado para ensayo/restauración y otorgar accesos;
- acceder a credenciales/gestor de claves, almacenar backups, y definir retención/borrado;
- restaurar/modificar cualquier entorno remoto, incluido Testing, y aprobar la ventana e impacto;
- crear fixtures sintéticos en Testing y ejecutar las validaciones post-QR-003 con escritura.

Solo reconsiderar GO cuando se confirme un artefacto de respaldo recuperable, su identidad/hash y custodio; se aprueben plan/costo, RPO/RTO y punto de restauración; la restauración aislada y los servicios manuales estén ensayados; el preflight de migraciones siga mostrando exclusivamente QR-003; y exista un plan revisado de forward-fix más aprobación de ventana. El `dry-run` de QR-003 no satisface por sí solo estos criterios ni autoriza aplicación.

## Documentación oficial consultada

- [Database Backups](https://supabase.com/docs/guides/platform/backups): backup diario, retención, PITR, requisitos y precios; omisiones de Storage y roles.
- [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore): comandos `db dump`, alcance/omisión de esquemas y restauración lógica.
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project): copia de base Auth y servicios/configuraciones que deben reconfigurarse.
- [Restoring a downloaded backup locally](https://supabase.com/docs/guides/local-development/restoring-downloaded-backup): ensayo físico local y versiones soportadas.
- [Precios de Supabase](https://supabase.com/pricing): planes, almacenamiento y add-ons vigentes; confirmar el precio en la cuenta antes de solicitar gasto.
