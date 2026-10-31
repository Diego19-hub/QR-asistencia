# QR-asistencia — QR-003 P0: cierre de riesgo y decisiones GO / NO-GO

**Fecha de revisión:** 2026-10-31  
**Alcance de esta revisión:** lectura del código, documentación y estado de GitHub; **sin acceso a Testing ni Producción**.  
**Decisión actual:** **NO-GO para aplicar QR-003 en Testing, fusionar el PR #25 o desplegar.**

> Este documento diferencia dos bloqueos **independientes**: (A) promoción de la migración QR-003 a un entorno alojado y (B) resultado del CI obligatorio del PR #25. Resolver uno no resuelve automáticamente el otro.

## A. QR-003: corrección implementada, aplicación remota pendiente

### Evidencia ya comprobada (histórica y versionada)

- Migración correctiva: `supabase/migrations/20261018120000_persist_employee_pin_failures.sql`.
- Causa raíz: las RPC antiguas lanzaban una excepción después de incrementar `failed_attempts`. El rollback de la transacción revertía el contador; la migración existente devuelve rechazos `pinError` sin abortar la actualización.
- Reproducción **local desechable** documentada: implementación antigua dejó `failed_attempts=0`, nueva implementación persistió incrementos 1 y 2. Se registraron pruebas de 5 intentos/15 minutos, expiración, concurrencia, aislamiento por tenant y ausencia de eventos ante PIN inválido.
- Evidencias: `docs/PIN-LOCKOUT-FIX.md`, `docs/QR-003-TESTING-PREFLIGHT.md`, `TASKS.md`. Las pruebas locales históricas no prueban que Testing alojado esté corregido actualmente.

### Riesgos remotos todavía abiertos

| Comprobación | Última evidencia documentada | Estado actual de autorización |
|---|---|---|
| Historial remoto | Auditoría de solo lectura del **28-oct-2026**: Testing tenía 24 entradas y `main` 25 migraciones, con 18 versiones de igual nombre y timestamps diferentes; QR-003 no estaba aplicada. | **No revalidado en esta revisión**. |
| Dry-run canónico | `supabase db push --dry-run` con `main` encontró `DbPushMissingLocalError` por historial remoto divergente. | **No** ejecutar `db push` normal ni `migration repair` para forzar el cambio. |
| Alternativa técnica histórica | Directorio temporal armado con SQL históricos de Testing + QR-003 canónica mostró únicamente QR-003 en dry-run; simulación local pasó. | Procedimiento de referencia, **no** permiso para ejecutarlo ahora. |
| Respaldo/PITR alojado | Última consulta documentada indicó `backups: []`, PITR deshabilitado; POC GPG + `pg_dump`/restore probó **solo datos sintéticos locales**. | Recuperación actual de Testing **no demostrada**. |
| Reconstrucción desde `main` | Reconstrucción vacía con Auth y fixtures sintéticos factible localmente. | No recupera Auth, empleados, asistencia, Storage, configuraciones ni recursos únicos del entorno alojado. |
| Permisos | Aplicación remota, respaldo/exportación y conexión a Testing requieren autorización expresa y separada. | **No autorizados** en esta tarea. |

Referencias: `docs/QR-003-MIGRATION-RECONCILIATION.md`, `docs/QR-003-BACKUP-RECOVERY-PLAN.md`, `docs/QR-003-TESTING-REBUILD-READINESS.md`.

### Puertas obligatorias para pasar de NO-GO a una revisión de GO

1. **Responsables y alcance por escrito:** propietario de datos y responsable técnico deben autorizar inequívocamente qué proyecto, qué objetos y qué operación se plantean. Una orden genérica de «continuar el proyecto» no autoriza respaldos/exportación ni aplicación de migraciones remotas.
2. **Estrategia de recuperación:** respaldos cifrados y custodiados con comprobación de restauración **de datos/recursos de Testing**, o aprobación explícita de descarte informado e inventario de recursos únicos. La POC local sintética no sustituye ninguna alternativa. Documentar RPO, RTO, retención, Storage, Auth y dependencias.
3. **Revisión remota actualizada, exclusivamente con permiso:** inventariar migraciones, firmas y grants de RPC, dependencias y cualquier deriva manual; no confiar en el snapshot histórico ni reconciliar timestamps a ciegas.
4. **Dry-run de alcance estricto:** preparar temporalmente el historial correcto; verificar que muestra **únicamente** `20261018120000_persist_employee_pin_failures.sql`, no QR-002 ni otras migraciones. Detenerse ante cualquier objeto inesperado.
5. **Plan de implementación separado y aprobado:** ventana, responsable, monitoreo y corrección **hacia delante**. No revertir a las RPC que lanzaban excepciones, pues reintroducirían el bloqueo fallido.
6. **Validación posterior autorizada:** comprobar persistencia/lockout, permisos y ausencia de escrituras indebidas con identidades sintéticas autorizadas; prohibido usar datos reales para pruebas sin un mandato explícito.

**No ejecutar ahora** ninguna de estas operaciones remotas ni instruir al CI a ejecutarlas. Si falta cualquiera de las puertas, mantener NO-GO.

## B. CI obligatorio del PR #25 — bloqueo distinto de la migración QR-003

- PR: `#25 — perf: QR-009 runtime and database benchmark`, base `main`, **abierto y no fusionado** al realizar esta revisión.
- El cuerpo del PR registra `CI #128` **cancelado en `npm ci`**, antes de las etapas de verificación; por tanto no existe aprobación integral para ese commit.
- `.github/workflows/ci.yml` contiene `npm ci`, lint, typecheck, `npm run test`, restauración local, export lease, `test:security:matrix:local`, E2E y build.
- `package.json` confirma que `npm run test` encadena `test:pin-lockout`; `test:security:matrix:local` ejecuta el runner de autorización y asistencia completo. Esos pasos siguen fuera de la autorización para este ciclo.
- La evidencia segura de QR-009 (benchmarks y pruebas E2E locales sintéticas) **no equivale** a un check CI obligatorio satisfactorio.

### Puertas para cerrar CI (sin cambios hoy)

1. Definir y aprobar el alcance de pruebas permitidas en CI, con evaluación de seguridad y de escrituras **antes** de permitir cualquier ejecución adicional del workflow integral.
2. Si es necesario cambiar el workflow o la suite, hacerlo en un PR independiente, con revisión y aprobación, conservando las reglas de protección y sin eliminar controles obligatorios de seguridad.
3. Obtener un check de GitHub Actions **aprobado** para el commit de integración previsto. Una ejecución cancelada, omitida o local no cumple ese criterio.
4. **Mantener PR #25 abierto** mientras el bloqueo no esté resuelto; nunca usar un merge forzado como sustituto.

## C. QR-009 — decisión técnica ya documentada

- Fase 4: Recharts diferido redujo JS inicial `256,671 → 155,843 B` (−39.3%); ZXing diferido `271,905 → 146,845 B` (−46.0%), en Chrome/Playwright sintético.
- Fase 5: **70 ejecuciones E2E** de las tres variantes pasaron según los logs locales proporcionados. Recharts aumentó p50 de clic→gráfica de **13.5 a 388.3 ms** (+374.8 ms): **NO-GO para la versión lazy actual**. ZXing aumentó p50 de clic→cámara simulada de **81.1 a 147.8 ms** (+66.7 ms), con prueba de revocación durante descarga PASS: candidato **condicional**, sin validar móvil físico.
- Los dos prototipos permanecen experimentales y **no** modifican QR-003 ni justifican resolver el CI bloqueado por omisión de suites.

Evidencia: `docs/QR-009-PHASE4-RESULTS-REVIEW.md` y `docs/QR-009-PHASE5-RESULTS-REVIEW.md` en la rama de análisis.

## Decisión de esta revisión

| Frente | Estado | Próxima acción permitida sin autorización remota |
|---|---|---|
| Fix QR-003 en el código | Versionado, probado localmente | Conservar el SQL existente; no duplicar ni modificar por inferencia. |
| QR-003 en Testing | **NO-GO** | Preparar documentación y matriz de responsables. Nada de backup, export, link, SQL remoto ni migración. |
| CI del PR #25 | **NO-GO** | Revisar las dependencias y el workflow de forma estática; proponer alcance seguro **sin ejecutarlo**. |
| QR-009 Recharts lazy | **NO-GO de rendimiento interactivo** | Mantener rama original intacta para revisión de otra estrategia. |
| QR-009 ZXing lazy | **Candidato condicional** | Mantener rama; pruebas adicionales únicamente en entornos desechables autorizados. |
| Merge/despliegue | **NO-GO** | Esperar autorización, evidencias de recuperación y CI obligatorio aprobado. |

**Esta revisión fue exclusivamente documental:** no ejecuta PIN/scan, no crea snapshots ni backups, no consulta Testing/Producción, no altera RLS, no reescribe CI, no hace merge ni despliegue.
