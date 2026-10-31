# QR-asistencia — Auditoría estática del CI y plan de validación segura

**Fecha:** 2026-10-31  
**Base inspeccionada:** `main` `38652df09a8996e5baf3641e1d611e669760db3d`; PR #25 head `5f41479c399f94be38a981e3443c68581fb08829`.  
**Estado:** auditoría estática documentada; **ninguna suite ni workflow se ejecutó en esta revisión**. No se modifican CI, branch protection, Testing, Producción, RLS, QR/PIN ni la aplicación. **PR #25 NO-GO para merge.**

## 1. Resultado ejecutivo

El CI de `.github/workflows/ci.yml` tiene un solo job `verify` para `push` y `pull_request`, ejecutado en Ubuntu, con nueve comandos en orden. El primer check del PR #25 visible en esta revisión fue `CI #128`: GitHub Actions reportó `cancelled` durante `npm ci`, en un commit histórico del PR (`9464f9f`), y todas las fases posteriores quedaron en `skipped`. El head actual del PR es `5f41479`; **no transferir la conclusión de un commit anterior al head actual**. Este historial no es un CI integral aprobado.

La inspección revela **tres clases distintas** de prueba: unidad/inspección estática de archivos, integración con Docker y base local sintética, y pruebas remotas que NO son parte del CI actual pero existen en scripts separados. Clasificar simplemente «todo lo que menciona PIN es remoto» sería incorrecto; clasificar «local» como «sin escrituras» también sería incorrecto.

## 2. Inventario de comandos realmente ejecutables por CI

| Orden | Paso exacto de `ci.yml` | Lo observado en el código | Riesgo y puerta de ejecución |
|---:|---|---|---|
| 1 | `npm ci` | Instalación de dependencias fijadas en lockfile; ejecuta ciclo npm normal (que podría tener scripts de paquetes). | Dependencias/red. Revisar lockfile y procedencia; no toca Testing por diseño de este job. |
| 2 | `npm run lint` | `eslint .` | Análisis de fuente, no motor de pruebas. Candidato a fase de verificación de bajo riesgo. |
| 3 | `npm run typecheck` | `tsc --noEmit` | Análisis de tipos. Candidato a fase de verificación de bajo riesgo. |
| 4 | `npm run test` | Encadena diez scripts de pruebas de unidad/archivos, **incluido `test:pin-lockout`**. El archivo `tests/attendance-pin-lockout.test.mjs` solo inspecciona SQL y TypeScript con `readFile` y asserts; **no llama RPC**. | **Fuera del alcance de ejecución actual** por la restricción previa; no equiparar el test Node estático con `test:pin-lockout:db`, que sí usa PostgreSQL. Revisar la cadena completa antes de autorizarlo. |
| 5 | `npm run test:backup-tool:restore-local` | Python crea/usa un PostgreSQL sintético en un contenedor Docker, ejecuta dump cifrado, verifica y restaura local; incluye cleanup de contenedor. | Escribe/borra **recursos Docker locales**. Requiere revisión de daemon/socket, nombre, cleanup y ausencia de datos reales; no es un backup remoto. |
| 6 | `npm run test:reports:lease:local` | Runner Supabase local desechable con Auth sintético; inserta `attendance_sessions` y `attendance_events` sintéticos y verifica exportación/race de lease. | **Escribe asistencia sintética en PostgreSQL local**; requiere aprobación específica aunque no toque Testing. |
| 7 | `npm run test:security:matrix:local` | Runner QR-004 completo sobre `qr004_disposable_*`; ejecuta pgTAP y pruebas de permisos, crea sesiones de asistencia y operaciones HTTP/Auth sintéticas, limpia stack al terminar. | **Cubre escrituras de asistencia y flujos asociados**; permanece fuera del alcance actual. Sus guardas locales no sustituyen autorización de ejecución. |
| 8 | `npm run test:e2e` | El mismo runner QR-004 con `--e2e-only`, fixtures Auth/dispositivo, Chrome fake camera y protección de origen; evita la matriz completa. | Ya existen ejecuciones locales permitidas; produce identidades/dispositivos sintéticos pero no debe ejecutar QR/PIN/scan ni escribir asistencia. Mantener aislamiento y revisar logs. |
| 9 | `npm run build` | `next build --webpack`, con `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co` y key placeholder en CI. | Build con parámetros públicos sintéticos; no supone pruebas de la app contra Testing. |

**Precisión sobre el PIN:** `npm test` invoca `test:pin-lockout`, que solo comprueba el código del fix; `test:pin-lockout:db` es **otro comando** que integra PostgreSQL y no está en `ci.yml`. La distinción aclara riesgos; **no modifica la prohibición vigente de ejecutar `npm test` en este ciclo**.

**Prueba remota fuera del workflow:** `test:security:jwt` apunta explícitamente al proyecto alojado Testing y **no está en el CI**. Prohibido ejecutarla sin aprobación separada. No usarla como alternativa «segura» al runner local.

## 3. Efectos laterales y barreras a reforzar antes de autorizar suites completas

- **Aislamiento de credenciales:** el runner QR-004 elimina de su entorno CLI las variables `SUPABASE*`, `POSTGRES*` y `DATABASE_URL`, y comprueba URLs loopback/referencias prohibidas. El runner de report lease elimina explícitamente una lista de variables sensibles. Esto ofrece barreras parciales, **no una demostración de que todos los subprocesos carezcan de rutas o secretos heredados**.
- **Docker:** QR-004 usa un identificador aleatorio `qr004_disposable_*`, snapshots de contenedores/volúmenes/redes y `supabase stop --project-id ... --no-backup`, verificando preservación de recursos previos. Report lease usa `qrlease*`; backup-restauración emplea contenedor con limpieza. No se encontró una validación uniforme de `DOCKER_HOST` y contexto Unix local en los tres runners. **Preflight propuesto**: rechazar daemon Docker remoto y cualquier entorno con variables de enlace a Testing/Producción; abortar al no poder comprobarlo.
- **Escrituras:** que el runner sea local no lo hace read-only. Report lease y matriz QR-004 crean filas de asistencia sintética para demostrar reglas; están prohibidos bajo la restricción actual, incluso si la prueba preserva recursos externos.
- **Escáner:** conservar el guard de origen/HTTPS y no reducir RLS ni alcance de dispositivos. No intentar obtener un PASS modificando respuestas 403, deshabilitando permisos o usando credenciales reales.
- **Teardown y fallos:** revisar que `stop` sea por proyecto, que no exista `stop --all` / `docker prune` y que el runner salga con error ante recursos sobrantes, snapshots inesperados o fallo de eliminación. Un PASS funcional con limpieza fallida es **FAIL**.
- **Supply chain y ejecución de scripts:** revisar cambios en `package-lock.json`, acciones GitHub, permisos y hooks npm antes de ejecutar CI integral; `npm ci` no debe confundirse con una operación puramente estática.
- **Publicación posterior:** `.github/workflows/publish-ghcr-testing.yml` escucha el evento `workflow_run` de CI. Solo publica en GHCR si la conclusión fue `success`, el origen del CI fue un `push` a `main`, y las variables Testing están configuradas correctamente. **Publicar imagen ≠ desplegar ni migrar base**, pero una modificación futura de CI/branch policy podría cambiar su comportamiento; revisar antes de cualquier push/merge a `main`.

## 4. Propuesta de validación escalonada (sin ejecutar ni implementar hoy)

**Etapa A — Revisión estática (propuesta permitible tras verificar el árbol de trabajo):** `git status --short`, `git rev-parse HEAD`, revisión de `ci.yml` y `package.json`, análisis del diff, `npm run lint` y `npm run typecheck`. Si se desean pruebas adicionales de fuente, examinarlas una por una. **No** lanzar `npm test` por defecto.

**Etapa B — E2E local ya delimitado:** solo en Mac/runner autorizado con Docker local desechable y Chrome fake camera, ejecutar `npm run test:e2e` si ese entorno cumple las salvaguardas vigentes. Verificar log de endpoints loopback, 0 solicitudes PIN/scan y cleanup. No operar sobre Testing/Producción.

**Etapa C — Plan futuro de CI completo:** el responsable técnico y de seguridad debe autorizar explícitamente cada suite que modifica datos locales o invoca PIN; revisar conexión Docker, credenciales de entorno, inventario y limpieza. Conservar `verify` y las pruebas obligatorias; no reemplazar un required check fallido por un job de nombre similar que ejecute menos pruebas. Si hay que rediseñar el workflow, hacerlo en **PR independiente** y revisión de reglas de protección antes de habilitarlo. Esta auditoría **no** afirma que el CI integral ya sea seguro para ejecutarse.

**Etapa D — Integración:** exigir `CI` aprobado en el SHA final, branch protection validada por un responsable con permisos, verificación documental de recuperación QR-003 y autorización separada para cualquier operación alojada. Si falta algo, **NO-GO**.

## 5. Comprobaciones previas exigidas al responsable antes de un posible GO

| Condición | Estado comprobado al 31-oct-2026 |
|---|---|
| PR #25 sin merge y cabeza conocida | Confirmado; head `5f41479`. |
| CI completo exitoso en head final | **NO**. `CI #128` cancelado en SHA anterior. |
| Clasificación de scripts y runner local | **Sí, documental**; sin ejecutar nada. |
| Confirmación de Docker Unix local y bloqueo de destino remoto para cada runner | **Pendiente** de implementación/validación uniforme. |
| Revisión de branch protection/rulesets | **No verificable** por permisos de integración; verificación del administrador pendiente. |
| Aprobación para suites que escriben asistencia sintética | **No consta**; no ejecutar. |
| Recuperación/restore alojado de Testing para QR-003 | **No demostrado**; migración remota bloqueada. |
| Autorización de merge/imagen/producción | **No concedida** por esta revisión. |

## 6. Próximos entregables propuestos, todavía NO implementados

1. **Preflight de solo inspección de entorno** (en un PR/branch separado) que compruebe versión, origen loopback, contexto Docker, variables sensibles y ausencia de enlace remoto, **sin iniciar Docker ni conectar a Supabase**. Debe fallar cerrado al no poder verificar condiciones.
2. **Evidencias de suites clasificadas** con reportes adjuntos que no incluyan tokens, URLs de conexión ni identidades; matriz de propietario y autorización para cada grupo de pruebas.
3. **Revisión de reglas de protección** y evaluación de la publicación de GHCR desde `main` por un administrador con permiso. Cualquier cambio al workflow requiere aprobación explícita; no suprimir test de PIN o RLS.

## Decisión final

**AUDITADO ESTÁTICAMENTE; VALIDACIÓN COMPLETA NO APROBADA.** Las pruebas realizadas anteriormente en entornos locales desechables no autorizan automáticamente su ejecución en GitHub Actions o Testing. Se conserva el CI original, todas las barreras y **NO-GO para merge/despliegue**.

Referencias del repositorio: `.github/workflows/ci.yml`, `.github/workflows/publish-ghcr-testing.yml`, `package.json`, `tests/attendance-pin-lockout.test.mjs`, `tests/qr004-auth-matrix.local.integration.mjs`, `tests/reports-export-lease.local.integration.mjs`, `tests/integration/qr_testing_backup_restore_local.py`, `tests/e2e/helpers/qr005-env.mjs`, `docs/QR-003-GO-NOGO-CLOSURE-20261031.md` (en la rama de análisis QR-009).
