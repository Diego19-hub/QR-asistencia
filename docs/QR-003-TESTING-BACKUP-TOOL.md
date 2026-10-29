# QR-003 — Herramienta y runbook de respaldo de Testing

## Estado y límites

Esta herramienta prepara una copia lógica cifrada de PostgreSQL y verifica/restaura archivos en un stack Supabase local desechable. El modo predeterminado solo imprime una simulación y no ejecuta procesos externos. La rama no ha exportado datos alojados, no ha consultado Testing o Producción, no ha aplicado migraciones remotas y no ha creado proyectos alojados.

**QR-003 sigue NO-GO para cambios remotos.** La herramienta local no demuestra que Testing sea desechable ni que se hayan recuperado sus datos/configuración. Para exportar Testing se necesita una aprobación independiente, explícita y registrada por el dueño de los datos y el responsable técnico. Los flags/variables de autorización son barreras contra errores, no sustituyen esa aprobación.

## Artefactos y cobertura

`scripts/qr_testing_backup.py` usa `pg_dump --format=custom` y cifra el flujo directamente con GnuPG AES-256/SHA-512; no crea un dump SQL claro intermedio. Produce fuera del repositorio:

- `*.qr-testing-backup.gpg`: archivo de base cifrado, permisos `0600`.
- `*.qr-testing-backup.json`: metadatos mínimos (ref permitida, major PostgreSQL, fecha UTC, tamaño y SHA-256 de cleartext/ciphertext), sin URL, usuario, fila ni secreto.
- `*.qr-testing-backup.gpg.sha256`: hash del ciphertext.

El directorio usa permisos `0700`; la herramienta solo acepta directorios existentes con ese modo y del usuario actual, sin cambiar permisos preexistentes. La frase GnuPG se solicita interactivamente, no se acepta como argumento y el agente temporal se apaga al cerrar el homedir. El destino debe ser externo al checkout. `verify` coteja manifest, sidecar y SHA-256 del ciphertext, descifra solo en una tubería a `pg_restore --list` y verifica el SHA-256/tamaño del archivo original sin guardarlo en claro.

El dump directo incluye los esquemas/filas que el rol de conexión pueda leer dentro de esa base, potencialmente `auth` y sus datos sensibles (incluyendo usuarios, hashes de contraseña y sesiones según permisos), además del esquema de aplicación y metadatos SQL de Storage. No incluye roles globales de PostgreSQL ni sus contraseñas, bytes/objetos de Storage, claves API/JWT, secretos de Edge Functions, SMTP/OAuth, dominios, webhooks ni configuración del plano de control. Los privileges restaurados pueden depender de roles administrados por Supabase y deben verificarse en el destino. No se debe tratar el resultado como un clon completo del proyecto.

## Barreras de la herramienta

El modo `testing` solo acepta el ref `llxyziffgtqnzlguxhyt`, bloquea explícitamente Producción `jawdrhewabqajxnswhkn`, requiere un ID externo con formato QR-003, una confirmación exacta, la variable de autorización y rechaza CI. La URL debe ser directa a `db.llxyziffgtqnzlguxhyt.supabase.co` con `sslmode=verify-full`; no acepta pooler/hosts distintos. `QR_TESTING_CA_CERT` debe apuntar a un certificado CA de Supabase descargado desde **Dashboard → Database Settings → SSL Configuration → Download certificate**. La herramienta verifica que el certificado sea legible y válido y configura `PGSSLROOTCERT`; libpq verifica CA y hostname. Si falta la CA o falla cualquiera de las comprobaciones TLS, la exportación se detiene. Nunca degrada a `require` ni a una conexión sin TLS. Mantén el certificado fuera del repo y obténlo solo desde el Dashboard oficial, siguiendo [la documentación de SSL de Supabase](https://supabase.com/docs/guides/platform/ssl-enforcement) y [conexión a Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres). Comprueba PostgreSQL 17 y requiere `pg_dump`/`pg_restore` major 17. El valor del DSN va en el entorno del proceso, nunca en argv o logs.

El comando `restore-local` solo acepta loopback y requiere un workdir fuera del repositorio cuyo `project_id` sea `qr_backup_restore_<nonce>` y coincida con el nombre de la base `qr_restore_<nonce>`. También confirma que el workdir no contiene ref enlazada, que el puerto coincide con `config.toml`, y que existe el contenedor Docker exacto, activo y publicado en loopback. Solo crea una base con nombre nuevo; no sobrescribe una base existente. Debe usarse únicamente en un workdir temporal recién creado. La comprobación de identidad del contenedor reduce errores de destino, pero quien opera debe verificar que ese proyecto/nonce se generó para el ensayo actual.

## Prueba local sintética

Comandos ejecutados en esta tarea:

| Comando | Resultado | Alcance |
|---|---|---|
| `python3 tests/qr_testing_backup_test.py` | **11/11 PASS** | TLS `verify-full`, CA ausente/inválida, URL/host permitido, autenticación sin filtrar diagnóstico, cifrado/descifrado, hashes y barreras de destino. GnuPG se ejecutó con su agente local. |
| `python3 -m py_compile scripts/qr_testing_backup.py tests/qr_testing_backup_test.py tests/integration/qr_testing_backup_restore_local.py tests/integration/supabase_restore_auth_local.py` | **PASS** | Sintaxis Python. |
| `python3 scripts/qr_testing_backup.py` | **SIMULACIÓN** | Sin conexión ni subprocess; el comando no exporta datos. |
| `python3 tests/integration/supabase_restore_auth_local.py` | **56/56 PASS**; `TEARDOWN PASS` en esta revisión | Harness existente de dos stacks locales; datos/identidades sintéticos, Auth, RLS, RPC y PIN; preserva `codigo_QR` y limpia recursos efímeros. Dump custom cifrado y restore en stack nuevo. |
| `npm run test:backup-tool:restore-local` | **20/20 PASS** | Contenedor PostgreSQL 17 aislado, fixture sintética de roles/extensión/RLS/función, invocación pública de backup/verify/restore-local, hostname TLS correcto/incorrecto, filtro efectivo RLS, fallos, limpieza de base/artefactos y recursos. CI ejecutará este comando. |

La prueba unitaria detectó y corrigió un orden de opciones incompatible con GnuPG al descifrar. También se añadió la importación explícita del helper desde la raíz para que el harness de integración funcione al invocarlo como script. La primera ejecución acabó antes de iniciar Docker por esa importación; la segunda pasó las 56 aserciones y el teardown.

La ejecución final del harness informó un ciphertext sintético de 766604 bytes, SHA-256 ciphertext `8575a780320f5d0e374204ef8e29dadb690e411d271ae84081e51acbb9fa4e9b` y SHA-256 plaintext `d8968b786ef7668112c07c54d016f0bbded50b085971b2463482b5f0ec2ad1ac`. Esos hashes corresponden únicamente a una ejecución local sintética; el artefacto fue eliminado al terminar y no es un backup remoto. El agente GPG temporal también terminó y no quedó ningún proceso agente activo tras teardown.

El harness de restauración cifrada valida el flujo de extremo a extremo incluyendo Auth en un stack Supabase nuevo. No es una exportación ni restauración del estado de Testing, y no valida objetos Storage o ajustes de servicio alojado.

La prueba nueva ejecuta `backup`, `verify` y `restore-local` como procesos del CLI público, no llama directamente a helpers internos y usa un contenedor PostgreSQL 17 temporal. Los roles globales `anon`, `authenticated` y `service_role` se crean antes del dump, como roles administrados preexistentes en Supabase. La extensión `pgcrypto` se instala en la base fuente y se crea al restaurar; el fixture comprueba la extensión, función, grants y RLS. `pg_dump --no-owner` no exporta roles globales, por lo que la restauración necesita que existan previamente los roles referenciados en ACL; en Supabase los proporciona la plataforma, y en una instancia PostgreSQL genérica el operador debe crearlos según el manifiesto aprobado. Una extensión debe estar instalada/disponible y ser compatible en destino. La prueba usa el binario `pg_dump`/`pg_restore` 17 que viene dentro del contenedor, mediante wrappers temporales que solo ejecutan `docker exec` contra el nombre efímero. En este Mac el cliente PostgreSQL del host es major 18; la prueba evita instalar herramientas adicionales. La conexión TLS de la prueba usa una CA/certificado autofirmado sintético y `hostaddr=127.0.0.1`; la variante con el hostname de Testing también queda fijada a loopback y demuestra que libpq rechaza el hostname no presente en el certificado sin intentar salir a la red. La exportación CLI de Testing tampoco se probó ni ejecutó.

Durante la prueba end-to-end se detectó que `pg_restore --list -` interpreta `-` como ruta literal en PostgreSQL 17. `verify` ahora omite el argumento de archivo y entrega el flujo descifrado por stdin, que es el comportamiento documentado por PostgreSQL 17. La primera prueba de `restore-local` confirmó además que el comando es quien crea la base destino: el runbook ya no instruye crearla manualmente. La prueba sintética confirmó rechazo de CA ausente/inválida, hostname incorrecto, frase GnuPG incorrecta, ciphertext alterado, autenticación simulada fallida, base existente y URL no loopback; verificó que la interrupción de `pg_restore` elimina la base parcial y el fallo de `pg_dump` borra los artefactos parciales. No se guardó SQL claro.

## Procedimiento futuro sujeto a autorización

### Crear respaldo de Testing

Antes de cada exportación, obtener aprobación escrita específica para exportar los datos del proyecto Testing, definir retención/fecha de borrado, custodio, destino cifrado, grupo de acceso y passphrase separada almacenada en un gestor aprobado. Confirmar que el artefacto no se guardará en Git, CI, logs, ticket abierto o equipo sin cifrado de disco. La aprobación debe incluir un identificador QR-003 real; un ID inventado o la variable `...AUTHORIZED=YES` no autorizan nada por sí solos.

El responsable autorizado prepara la conexión usando el flujo de credenciales aprobado. No copiar el password a comandos/flags ni a archivos. Ejemplo (solo después de la autorización separada; **no ejecutado**):

```sh
umask 077
export QR_TESTING_PROJECT_REF=llxyziffgtqnzlguxhyt
export QR_TESTING_BACKUP_EXPORT_AUTHORIZED=YES
export QR_TESTING_BACKUP_APPROVAL_ID='QR-003-<ID-DE-CAMBIO-APROBADO>'
export QR_TESTING_CA_CERT='/ruta-segura-fuera-del-repositorio/certificado-ca-descargado-del-dashboard.crt'
read -s 'QR_TESTING_DATABASE_URL?URL directa de Testing (entrada oculta): '
export QR_TESTING_DATABASE_URL
python3 scripts/qr_testing_backup.py backup --mode testing \
  --confirm-project-ref "$QR_TESTING_PROJECT_REF" \
  --output-dir '/ruta/aprobada/fuera-del-repositorio'
unset QR_TESTING_DATABASE_URL QR_TESTING_BACKUP_APPROVAL_ID QR_TESTING_BACKUP_EXPORT_AUTHORIZED QR_TESTING_CA_CERT
```

La herramienta vuelve a validar host, ref, TLS, versión de servidor y cliente. Si alguna comprobación falla, se detiene antes de exportar. El operador debe confirmar el hash en un registro separado controlado (idealmente firmado/inmutable) y guardar ciphertext, manifiesto y sidecar en el destino restringido aprobado.

### Verificar y restaurar en local aislado

1. Preparar un directorio temporal externo al repo; copiar solo configuración/migraciones/plantillas necesarias. Asignar `project_id = "qr_backup_restore_<nonce-hex-de-16-caracteres>"`, puerto DB libre y no crear link remoto. No copiar `.env*`, `.temp`, credenciales ni datos reales a otro archivo.
2. Iniciar solo ese workdir. Verificar visualmente el project ID, el puerto loopback, nombre del contenedor `supabase_db_<project_id>` y ausencia de ref alojada.
3. Verificar integridad sin restaurar. La herramienta pedirá la frase en el terminal:

   ```sh
   python3 scripts/qr_testing_backup.py verify --artifact '/ruta-segura/backup.qr-testing-backup.gpg'
   ```

4. **No crear manualmente la base destino.** Confirmar que `qr_restore_<mismo-nonce>` no exista previamente y que el servidor sea PostgreSQL 17. `restore-local` vuelve a comprobar que no existe y crea esa base durante la operación. No usar `codigo_QR` ni otros stacks locales persistentes.
5. Pasar la URL loopback por variable de entorno sin mostrarla y ejecutar:

   ```sh
   python3 scripts/qr_testing_backup.py restore-local \
     --artifact '/ruta-segura/backup.qr-testing-backup.gpg' \
     --workdir '/tmp/qr-backup-restore-<nonce>' \
     --database-name 'qr_restore_<mismo-nonce>'
   ```

6. La herramienta informa que creó y restauró la base. Verificar en ella hashes/manifiesto, conteos aprobados, schemas/tablas/índices, funciones y ACL, datos sintéticos/permitidos, políticas RLS y dependencias; no volcar filas personales a logs. Si la restauración falla, `restore-local` elimina la base parcial. Para comprobar los endpoints reales de Auth asociados, seguir el harness `tests/integration/supabase_restore_auth_local.py` que restaura en el `postgres` del segundo stack desechable y valida login/Auth, RLS, RPC y PIN. El destino debe tener servicios locales correspondientes, sin correo externo.
7. Capturar únicamente evidencia no sensible (exit codes, hashes, versiones, checks agregados y tiempos), detener el workdir temporal concreto, comprobar ausencia de sus contenedores/volúmenes/red y eliminar el temporal conforme a la política. No usar `docker prune`.

La restauración puede fallar si faltan roles, extensiones, privilegios, versión compatible o configuración Supabase. Un fallo debe detener el proceso, conservar el artefacto cifrado para análisis y limpiar solo la instancia temporal; nunca restaurar encima de Testing.

## Custodia, RPO/RTO y recuperación de QR-003

- La clave de cifrado se debe guardar separada del backup en un gestor de secretos aprobado, con mínimo privilegio, MFA, registro de acceso y rotación. La herramienta no almacena la frase.
- SHA-256 detecta corrupción cuando se compara contra un registro confiable; el sidecar junto al archivo no da autenticidad si ambos se alteran. Registrar la huella de forma separada y controlada.
- El backup lógico incluye datos sensibles completos de la base. Acordar minimización, finalidad, retención y borrado criptográfico. El SSD no garantiza borrado seguro del plaintext; por eso no se persiste deliberadamente.
- RPO del dump: intervalo real entre respaldos exitosos y verificados; no existe todavía frecuencia aprobada. RTO no se puede prometer con la POC pequeña; medir exportación, transferencia, restore y servicios manuales en un ensayo aprobado antes de declarar un objetivo.
- QR-003 cambia definiciones de dos RPC y sus ACL, no filas. Si falla la migración antes del commit, PostgreSQL debería revertir la transacción; confirmar estado antes de reintentar. Si se confirma y hay regresión, preferir una migración correctiva hacia adelante probada localmente. Volver a las funciones viejas recupera la excepción que revierte el contador de PIN. Restaurar SQL de funciones no recupera datos y no equivale a restaurar la base.

## Autorizaciones pendientes / criterio GO

Siguen pendientes: aprobación del dueño de los datos para exportar (o para tratar Testing como desechable), destino/custodio/retención, frase/gestor de claves, revisión de datos personales y fundamento de la copia, RPO/RTO aceptables, un ensayo completo aislado con respaldo real autorizado si fuera necesario, plan de contingencia/forward-fix y autorización de ventana para la migración y pruebas sintéticas con escritura. También se debe repetir el preflight remoto de migraciones inmediatamente antes de una futura ejecución autorizada.

La POC local y la herramienta no cambian QR-003 a GO. No se ejecutaron exportación, migración, `migration repair`, `db push`, ni ninguna escritura remota.
