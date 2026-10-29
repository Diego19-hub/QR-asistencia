# QR-003 — Preparación para reconstruir Testing

## Resumen y decisión

La configuración versionada y las migraciones de `main` permiten levantar una base local nueva con el esquema actual, Auth local y datos sintéticos. La evidencia de esta revisión incluye restauración local cifrada, pruebas HTTP/Auth multiempresa y persistencia/bloqueo del PIN.

Esto **reconstruye una aplicación vacía con fixtures sintéticos**. No restaura usuarios, sesiones, empleados, asistencia, invitaciones, archivos ni configuración que exista solo en el proyecto alojado. No se leyó ni exportó información remota en esta tarea.

**QR-003 permanece NO-GO para escritura en Testing.** No hay evidencia aprobada de que se puedan descartar todos sus datos y recursos únicos, y la reconstrucción local no es una estrategia de recuperación de esos recursos.

## Inventario versionado

- `supabase/config.toml` configura Postgres, Auth, Storage, Realtime, Edge Runtime y Analytics local, puertos, registro de Auth, redirects, expiración JWT y plantillas de correo. El signup global de Auth está deshabilitado; el email local usa confirmaciones deshabilitadas para facilitar pruebas sintéticas. Los providers externos y SMS están deshabilitados. La configuración local de SMTP está habilitada para capturar correo en el servidor local de pruebas (Mailpit/Inbucket), no para enviarlo externamente.
- `supabase/migrations/` contiene **25 migraciones canónicas**. La secuencia actual incluye QR-003 `20261018120000_persist_employee_pin_failures.sql` y, después, QR-002 `20261028120000_share_company_invitations.sql`.
- `supabase/tests/` contiene pgTAP de asistencia, integridad, RLS, horarios, credenciales, PIN, portal, accesos, invitaciones, scanner y reportes.
- `supabase/templates/invite.html` y `magic_link.html` son recursos de Auth referenciados por `config.toml`; deben copiarse junto a la configuración al crear workdirs fuera del checkout.
- No se encontró `supabase/seed.sql`, aunque `config.toml` declara `sql_paths = ["./seed.sql"]`. La referencia es actualmente inactiva porque `[db.seed].enabled = false`; el reset limpio ejecutado no intenta cargarla. No es un bloqueo de reconstrucción presente. Si se habilitan seeds automáticos, se deberá añadir el archivo sintético o retirar/cambiar la referencia antes de hacerlo.
- No hay llamadas a `supabase.storage` ni buckets declarados en el código/configuración versionada revisada. Storage está habilitado en `config.toml`, pero las pruebas de restauración y PIN excluyeron Storage API; la matriz QR-004 también la excluye. No se puede inferir de esto que Testing remoto carezca de buckets u objetos.

## Fixtures y servicios externos

Los runners existentes generan identidades y contenido sintéticos; no dependen de un `seed.sql`:

- `tests/integration/supabase_restore_auth_local.py` crea usuarios Auth por API local, empresas A/B, sucursales, membresías, supervisores, empleados, dispositivos autorizados, hashes de tokens QR y PIN, sesiones/eventos de prueba. Verifica login, JWT, RLS, RPC, scanner y restore a una base nueva.
- `tests/qr004-auth-matrix.local.integration.mjs` crea empresas, membresías/roles y empleados sintéticos con Auth local, SSR cookies y una instancia Next.js local. Sus suites pgTAP cubren tenant/RLS, invitaciones, credenciales, scanner y autorización. Mailpit captura invitación y reenvío; se verifica el destinatario sintético.
- `tests/attendance-pin-lockout-postgres.integration.mjs` inserta en PostgreSQL aislado dos empresas, sucursales, empleados, hashes sintéticos de PIN/QR/dispositivo, membresía de supervisor y datos de autorización. Ejecuta intentos inválidos, bloqueo, expiración, concurrencia y denegaciones sin eventos.

La aplicación puede usar `RESEND_API_KEY` y `INVITATION_FROM_EMAIL` para entrega externa, además de `APP_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y una clave de servidor `SUPABASE_SERVICE_ROLE_KEY` en tareas administrativas controladas. `.env.local` existe en el equipo, pero no fue leído ni copiado. Los runners locales eliminan variables Supabase heredadas y fuerzan endpoints de loopback; QR-004 usa Mailpit del stack aislado. Ningún secreto debe incluirse en fixtures, manifests, logs o el repositorio.

## Dos modos de reconstrucción

### A. Estado canónico actual de `main`

Es el modo reproducible recomendado para desarrollo y validación del código actual:

1. Copiar a un directorio temporal solo `supabase/config.toml`, `supabase/templates/`, las 25 migraciones y las pruebas requeridas. No copiar `.env*`, `.temp`, credenciales ni recursos Docker existentes.
2. Asignar un `project_id` marcado como desechable y un bloque de puertos libres; confirmar que los endpoints entregados por el CLI sean loopback. El runner debe quitar credenciales y refs remotos heredados.
3. Iniciar el stack local. La reconstrucción completa puede iniciar todos los servicios configurados; las pruebas realizadas aquí usaron exclusiones explícitas (ver resultados), por lo que no prueban todos los servicios opcionales.
4. Aplicar la lista canónica ordenada de migraciones con un reset local de la base vacía. `db.seed` está deshabilitado; cargar fixtures sintéticos mediante los helpers de prueba. No enlazar el workdir ni usar flags `--linked`.
5. Ejecutar suites locales de Auth/RLS/scanner/PIN y comprobar que QR-003 está aplicada y QR-002 también está presente en el estado actual de `main`.
6. Detener solo el workdir temporal, comprobar que no quedan contenedores/volúmenes/redes con su ID, borrar el directorio temporal y comparar que los recursos preexistentes sigan presentes.

Este modo produjo una base nueva con el arreglo PIN ya activo. No es un modelo del estado de Testing antes de QR-003.

### B. Esquema históricamente equivalente a Testing antes de QR-003

Este modo sirve solo para investigar el comportamiento anterior; debe permanecer separado del modo A:

- El estado auditado antes de QR-003 tenía 24 entradas: 23 migraciones históricas comunes y una migración exclusiva de Testing para habilitar pgTAP. QR-003 y QR-002 estaban ausentes.
- Las 18 parejas antiguas usan timestamps diferentes. El informe del PR #9 documenta SQL archivado equivalente por tokens/estructura y fingerprints revisados, pero el checkout actual conserva el manifiesto/hash CSV, **no los 24 archivos SQL archivados**. Los archivos recuperados para la simulación anterior vivieron en un directorio temporal que se eliminó.
- Por ello, hoy se puede reproducir un estado **de esquema equivalente** usando las migraciones canónicas comunes hasta `20261012143000`, excluyendo QR-003 y QR-002; no se puede reconstruir desde el repo el ledger remoto exacto ni garantizar byte por byte sus SQL archivados/timestamps. No se deben copiar/renombrar archivos canónicos como si fueran los archivos históricos, ni tomar el nombre/timestamp como prueba de equivalencia.
- El test-only de pgTAP no representa una dependencia de runtime de la aplicación. Para reproducir fielmente el historial de Testing, primero se necesitaría conservar y revisar el archivo SQL archivado que corresponde a esa entrada además de los otros archivos históricos; no se añadieron copias ni se modificó el manifiesto en esta tarea.
- La documentación previa registra que un manifiesto temporal con los 24 archivos que fueron recuperados y la migración canónica QR-003 produjo un dry-run exclusivamente de QR-003 y pgTAP 35/35. Ese resultado es evidencia histórica, no un artefacto reproducible en este checkout ni autorización para una operación remota.

Esta estrategia B no se ejecutó de nuevo en esta revisión porque requeriría recuperar los archivos SQL históricos ausentes. No se consultó Testing para reobtenerlos.

## Validación local ejecutada en esta revisión

Fecha: 2026-10-29. CLI local fijado por el proyecto: **Supabase CLI 2.120.0**. No se enlazó ningún workdir a un proyecto alojado. Los intentos fallidos previos al ensayo de PIN se detuvieron antes de correr pruebas (selección inicial de puertos y omisión temporal de plantillas); ambos workdirs se limpiaron. El intento final pasó.

| Comando / entorno | Resultado | Alcance y limitación |
|---|---|---|
| `python3 tests/integration/supabase_restore_auth_local.py` | **56/56 PASS**, 0 fallos/omitidas; `TEARDOWN PASS` | Dos stacks locales con puertos/IDs efímeros, usuarios/empresas/sucursales/empleados/dispositivos/QR/PIN sintéticos. Dump cifrado, SHA-256 y restore a stack nuevo; login/Auth, RLS, RPC y scanner. El runner excluye Realtime, Storage API, Mailpit, Studio, Edge Runtime, Analytics y Supavisor. Preservó `codigo_QR`. |
| `node tests/qr004-auth-matrix.local.integration.mjs` | **156/156 pgTAP PASS** (37+21+36+25+14+13+10) y todos los grupos HTTP/Auth PASS; código 0 | Stack Supabase local desechable, Auth real local, Next.js temporal, Mailpit local, invitaciones y permisos multiempresa. `TEARDOWN PASS`; Docker preexistente preservado. Excluyó Realtime, Storage API, Imgproxy, Studio, Edge Runtime, Analytics, Vector y Supavisor. |
| `npm run test:pin-lockout:db` con workdir temporal `qr_pin_lockout_disposable_rebuild_*`, DB URL loopback y 25 migraciones de `main` | **pgTAP 35/35 PASS**; integración PostgreSQL PASS; limpieza temporal PASS | Persistencia de 1–5 fallos, bloqueo de 15 minutos, expiración/reset, doce intentos concurrentes, QR/dispositivo no autorizados o revocados, aislamiento A/B, cero sesiones/eventos rechazados. QR-003 estaba aplicada; las pruebas de PIN no ejercitan QR-002. Solo fixtures sintéticos. |
| Verificación posterior de contenedores, volúmenes y redes Docker | Sin recursos con los prefijos efímeros de los tres ensayos | No se usó `docker prune`; stacks `codigo_QR`, proyectos de pruebas anteriores y otros recursos no fueron detenidos ni eliminados. |

No se ejecutaron lint, typecheck, `npm test` ni build porque no hubo cambios de código. CI del PR deberá validar el cambio documental. No se ejecutaron pruebas contra Testing o Producción, ni se exportaron datos remotos.

## Reconstrucción frente a restauración

| Reconstrucción A/B | Recuperación de Testing |
|---|---|
| Crea esquema desde migraciones disponibles y filas/usuarios sintéticos de prueba. | Necesita copiar datos únicos existentes desde un artefacto verificable o del punto de recuperación. |
| Usa configuración local codificada; las claves locales son efímeras y se generan de nuevo. | Requiere inventariar/restaurar o rotar secretos, API/JWT keys, Auth SMTP/OAuth, redirect URLs y configuración administrada. |
| Los tests de esta revisión no crearon ni inspeccionaron objetos Storage. | Necesita respaldo separado de bytes de Storage y metadatos/buckets; base SQL por sí sola no acredita esos objetos. |
| No conserva Auth users/sesiones, historial de asistencia, invitaciones, auditoría ni credenciales únicas del host. | Debe recuperar cada conjunto de datos sujeto a la decisión de retención, privacidad y RPO del propietario del entorno. |

La equivalencia de migraciones no demuestra que no haya SQL manual, configuración de dashboard, secretos, usuarios, datos de negocio, sesiones o archivos no versionados. La Free tier no agrega automáticamente una garantía de restauración remota en esta tarea; la situación efectiva deberá volver a verificarse si se plantea un cambio. Esta investigación no volvió a inspeccionar el plan, backup, PITR ni datos de Testing.

## Riesgos y condiciones para tratar Testing como desechable

**Riesgo alto:** descartar el proyecto puede eliminar identidades Auth, membresías, empresas/sucursales, expedientes, PIN/QR/dispositivos, asistencias, invitaciones, auditoría, sesiones de refresco y archivos/configuraciones existentes. Los respaldos lógicos y migraciones locales no recrean estos datos únicos.

Antes de aceptar Testing como desechable, el dueño de producto/datos y el responsable técnico deben aprobar por escrito:

1. Qué significa “datos de Testing desechables” y quién es el dueño de cada entidad/archivo/servicio.
2. Un inventario del contenido y dependencias que se perderían, obtenido por personal autorizado. Esta tarea no lo hizo ni inspeccionó tablas de usuarios/empleados remotos.
3. Que no se requiere conservar usuarios Auth, empresas, registros laborales/asistencia, auditoría, invitaciones, archivos Storage, secretos, proveedores de Auth/correo, dominios, webhooks o configuración de red; o, si algo sí debe preservarse, una estrategia de backup autorizada, custodiada, cifrada y con restore probado de ese componente.
4. Retención/borrado, RPO/RTO aceptables, aviso a usuarios/operadores, ventana, responsables, prueba posterior y plan de recuperación/forward-fix.
5. Una revisión actual de las diferencias remotas, funciones SQL y migraciones, autorización específica para lectura/escritura requerida, y dry-run que vuelva a listar únicamente QR-003 antes de una futura aplicación.

Crear una segunda copia alojada para ensayo podría tener costo y no está autorizado por esta tarea. Sin la aprobación e inventario anteriores, Testing no puede clasificarse como desechable por inferencia.

## Conclusión

- **Reconstrucción canónica local (A): técnicamente viable** para esquema actual y validación con identidades y datos sintéticos, con la cobertura/servicios indicados.
- **Reconstrucción del ledger histórico exacto pre-QR-003 (B): no es reproducible solo desde el checkout actual** porque faltan los SQL archivados de Testing; su copia exacta requiere una fuente autorizada y preservación auditable. La equivalencia de esquema está respaldada por las auditorías previas, no por una lectura remota de esta tarea.
- **Recuperación del Testing alojado: no demostrada.** La reconstrucción local no constituye una copia de los datos actuales del host.
- **Decisión: NO-GO para desplegar QR-003.** Mantener el estado hasta que se confirme formalmente la política de descarte de Testing o exista backup/restore aprobado y probado; completar además el preflight de migraciones inmediatamente antes de cualquier autorización de escritura.

## Referencias

- [Plan de respaldo y recuperación](QR-003-BACKUP-RECOVERY-PLAN.md)
- [Preflight de Testing](QR-003-TESTING-PREFLIGHT.md)
- [Reconciliación de migraciones](QR-003-MIGRATION-RECONCILIATION.md)
- [Fix y pruebas del PIN](PIN-LOCKOUT-FIX.md)
- [Pruebas del proyecto](TESTING.md)
- [Supabase: desarrollo local y CLI](https://supabase.com/docs/guides/local-development)
- [Supabase: flujo local y archivos versionados](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Supabase: configuración `config.toml`](https://supabase.com/docs/guides/local-development/cli/config)
- [Supabase: seed de bases locales](https://supabase.com/docs/guides/local-development/seeding-your-database)
