# QR-asistencia — Cierre técnico de Fase 7

Fecha: 2026-11-03

PR: [#28](https://github.com/Diego19-hub/QR-asistencia/pull/28)

Commit publicado revisado: `133b356ae1ce47c861332d8a761a3e110856e114`

Rama local: `test/qr-fase-7-supervisor-lifecycle`

## Alcance y publicación

Se conserva el bloqueo preventivo del endpoint de escaneo en los cuatro contextos del E2E y se incorpora una suite SQL específica de supervisores/dispositivos, con un modo aislado del runner desechable. Los cambios se publican únicamente en la rama existente del PR #28; no se crea otro PR, no se modifica `.github/workflows/ci.yml` y no se realiza merge.

El SHA publicado anteriormente, `133b356`, no contiene estos cambios y sus checks no los validan. Los checks iniciados por el nuevo commit deben revisarse por separado; las pruebas automatizadas del workflow que manipulan PIN o asistencia usan fixtures sintéticas dentro de infraestructura local desechable, según la autorización de Fase 7. No hay conexiones ni escrituras en Supabase alojado.

## E2E de ciclo de supervisor

`tests/e2e/supervisor-lifecycle.spec.ts` instala `context.route("**/api/attendance/scan**", ...)` en los contextos de administrador A, invitado, otro supervisor y administrador B. La ruta se aborta preventivamente; el único dato acumulado es el literal `/api/attendance/scan`. Una aserción final falla si se intenta la ruta. No se registran URL completa, query, cuerpos, cookies ni credenciales.

Se conserva el flujo de invitación local por Mailpit/Auth, aceptación, asignación de sucursal, solicitud/aprobación/revocación del dispositivo y liberación de la cámara mediante la comprobación de `MediaStreamTrack.readyState === "ended"`.

## Suite PostgreSQL/RLS

Se incorporó `supabase/tests/qr007_supervisor_device_rls_test.sql`, recuperada del archivo temporal existente `/private/tmp/qr7-supervisor-device-rls.sql`. Antes de copiarla se comprobó que no contuviera referencias a RPC/endpoint de escaneo, funciones de PIN, sesiones ni eventos de asistencia. La suite declara `plan(27)` y finaliza con `ROLLBACK`.

Las fixtures son sintéticas: cinco identidades Auth, dos empresas, dos sucursales, membresías activas/inactivas, filas de supervisor, un dispositivo y dos solicitudes de autorización. El rol `authenticated` y sus claims se usan para probar lectura por empresa, RPC de supervisores/solicitudes, asignación, rechazo por rol, rechazo de membresía inactiva, acceso a solicitudes privadas, revocación y snapshots de efectos secundarios. Las fixtures iniciales se insertan dentro de la transacción local; no se usa `service_role` para representar a los usuarios probados.

El runner agregado es `npm run test:security:supervisor-devices:local`. Reutiliza la inicialización y limpieza del runner QR-004, pero el modo `--supervisor-device-rls-only` copia únicamente los 27 SQL versionados de `supabase/migrations`, instala solo esta suite y sale antes de consultar claves, hacer peticiones a la API local, iniciar Next.js, crear usuarios o sesiones Auth, u operar asistencia. `supabase start` levanta los servicios locales necesarios para PostgreSQL/pgTAP. El proyecto tiene ID aleatorio `qr004_disposable_*`, puertos locales libres, directorio temporal, no se enlaza a un proyecto remoto y se verifica que el teardown quite sus recursos y preserve los Docker preexistentes. No lee `.env.local`; el proceso CLI elimina variables de entorno de Supabase/Postgres heredadas.

Resultado observado: **27/27 aserciones PASS**. Se imprimió el resultado de migraciones locales y el teardown confirmó que no quedaron contenedores, volúmenes, redes ni directorio temporal del proyecto.

## Validaciones locales

| Comando / validación | Resultado |
|---|---|
| `npm run test:security:supervisor-devices:local` | PASS, 27/27 pgTAP; exclusivamente Supabase local desechable |
| `QR004_CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e` | PASS, 23/23; Auth/Next/Supabase locales, loopback, limpieza confirmada |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` en copia temporal | PASS |
| `git diff --check` | PASS |

El build se ejecutó en una copia temporal fuera del repositorio. Se excluyeron `.git`, `node_modules` original, `.next`, archivos `.env*`, resultados de pruebas y cobertura; las dependencias se clonaron localmente para que el trazado standalone permaneciera dentro del directorio aislado. Se usaron valores placeholder de Supabase y no se inició conexión remota. El directorio temporal se eliminó al terminar.

No se ejecutaron `npm test`, `test:security:matrix:local`, `test:pin-lockout:db`, la integración de lease ni GitHub Actions en esta tarea.

## CI, límites y riesgos

En GitHub se observan para el SHA publicado `133b356`:

- Push CI [#41737544381](https://github.com/Diego19-hub/QR-asistencia/actions/runs/41737544381): **SUCCESS**.
- PR CI [#41737573922](https://github.com/Diego19-hub/QR-asistencia/actions/runs/41737573922): **CANCELLED** durante `test:reports:lease:local`; después quedaron omitidas la matriz general, E2E y build.

El check exitoso pertenece exclusivamente a `133b356`; no valida esta suite o runner que ese SHA no contiene. El workflow general se dispara en `push` y `pull_request`. Incluye pruebas unitarias de PIN, fixtures sintéticas de sesiones/eventos en `test:reports:lease:local`, y la matriz QR-004 con pruebas locales de autorización de escáner que pueden llamar RPC con identidades y PIN sintéticos. La autorización recibida para esta publicación cubre esas pruebas solamente dentro de la instancia local desechable. El runner general elimina variables heredadas de Supabase/Postgres, requiere loopback, crea un proyecto local aleatorio y limita su limpieza a sus propios recursos. El workflow se conserva sin cambios.

No fue posible confirmar checks obligatorios de `main`: GitHub respondió 403 al endpoint de protección de rama. La lectura de rulesets visibles devolvió `[]`, lo que no prueba que no existan otras reglas de protección. Se requiere confirmación del administrador del repositorio sobre los checks requeridos y la ruta aceptable para una validación acotada.

Limitaciones:

- La suite nueva cubre PostgreSQL/RLS, no sustituye Auth HTTP ni el E2E, y no es una revisión remota segregada.
- El build demuestra compilación en el árbol copiado; no verifica despliegue.
- No se ejecutaron pruebas dinámicas de PIN, escaneo ni registros de asistencia. QR-003 continúa P0 y NO-GO.
- QR-004 permanece en curso.

## Publicación y decisión

Se revisó el workflow antes de publicar. La autorización vigente permite ejecutar el workflow general porque sus operaciones de asistencia/PIN se limitan a fixtures sintéticas y recursos locales desechables. Se publican solo los cinco archivos enumerados en el diff del cierre de Fase 7. Los resultados de Actions corresponden al nuevo SHA y se registran una vez terminen.

No fue posible confirmar checks obligatorios de `main`: GitHub respondió 403 al endpoint de protección de rama. La lectura de rulesets visibles devolvió `[]`, lo que no demuestra que no haya otras reglas. No se cambia ninguna protección.

**Recomendación: mantener PR #28 sin merge hasta que finalicen y se revisen los checks asociados al nuevo SHA.** No se accedió a Supabase Testing ni Producción. QR-003 continúa P0/NO-GO; QR-004 permanece en curso.
