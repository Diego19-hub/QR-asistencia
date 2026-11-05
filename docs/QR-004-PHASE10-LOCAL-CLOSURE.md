# QR-004 — Evaluación de cierre técnico local, Fase 10

**Estado de auditoría:** En curso; no se declara cerrada.
**Rama de evaluación:** `audit/qr-004-phase10-residual-gaps`.
**Base de `main`:** `baa99e44e3515f7aeb03df1add5e56a6e4fd7e57`.
**Alcance:** consolidación de evidencia 10.1–10.3, prueba local restringida y publicación de sus 59 aserciones al CI.
**Límite:** no se consultó Testing ni Producción. No hubo migraciones remotas, despliegues ni datos reales.

## Dictamen

**Cierre técnico local: NOT READY.** La Fase 10 aporta evidencia útil y reproducible, pero no satisface aún los criterios de cierre de QR-004: quedan funciones privilegiadas y escenarios P1 con cobertura incompleta, cinco funciones P0 dependientes del alcance bloqueado de QR-003, y validación remota segregada pendiente. Los resultados 59/59 y 115/115 son suites específicas, no una certificación integral de seguridad.

**Cierre de seguridad alojada: BLOCKED.** No se obtuvo evidencia nueva de configuración efectiva en los entornos alojados, por las restricciones de esta tarea.

**Aceptación de lanzamiento: separada.** QR-011 permanece P1 / Bloqueada y depende de QR-003 y QR-004. Su lista operativa no se satisface con este paquete.

## Criterios verificables y estado

| Criterio | Estado | Evidencia | Brecha / acción pendiente |
|---|---|---|---|
| Inventario reproducible de funciones, rutas y acciones | **PASS, alcance documental** | Fase 10.1 enumera 46 funciones `SECURITY DEFINER` (32 DIRECT, 7 INDIRECT, 1 HTTP, 1 STATIC-only, 5 BLOCKED), 33 Route Handlers / 50 métodos y siete Server Actions. | Revalidar el inventario frente a cambios futuros y completar pruebas donde la clasificación no sea directa. Los conteos no implican que cada camino esté probado. |
| Prueba dirigida de bootstrap, permisos, tenant/sucursal, membresía, último owner y auditoría | **PASS, cobertura seleccionada** | `qr004_phase10_residual_authorization_test.sql`: plan 59; ejecución local documentada 59/59 con fixtures sintéticas, `BEGIN`/`ROLLBACK` y teardown. | No prueba todos los flujos ni todas las combinaciones de los 46 objetos. |
| Regresiones RPC previas | **PASS, cobertura seleccionada** | Modo restringido: 115/115 (27 + 26 + 62), sin PIN/scan/asistencia. | No sustituye la matriz general ni cubre cada RPC/Route Handler/Server Action. |
| Aislamiento de suites de Fase 10.2 | **PASS, local** | Modo exclusivo `--phase10-residual-only`; proyecto Supabase y puertos temporales; sólo migraciones canónicas; variables heredadas saneadas; sin `--linked`; asserts impiden scan/PIN e inserts de asistencia; `ROLLBACK` y cleanup verificados. | El resultado de GitHub Actions para el SHA de publicación todavía debe comprobarse en el run asociado. |
| Permisos efectivos, denegaciones y ausencia de efectos inesperados en la suite dirigida | **PASS, escenarios incluidos** | Casos autorizados/denegados con roles y claims sintéticos, snapshots y comprobación del evento de auditoría. | La cobertura de operaciones excluidas o no accesibles en la fase no cuenta como validada. |
| Brechas P0/P1 restantes de RPC, API y Server Actions | **BLOCKED / pendiente** | La matriz fase 10.1 conserva brechas con clasificación y referencias. | Cubrir o justificar cada caso permitido restante con pruebas aisladas, sin simulaciones HTTP inventadas para Server Actions. Resolver por separado dominios prohibidos por QR-003. |
| Funciones relacionadas con asistencia/PIN bloqueadas | **BLOCKED por QR-003** | `private.guard_attendance_event`, `private.record_attendance_event`, `private.review_attendance_adjustment`, `private.sync_attendance_event` y `private.verify_employee_pin` no se invocaron en Fase 10.2. | No cuentan como aprobadas. QR-003 permanece P0 / NO-GO; se requiere autorización y criterio separado para validar su dominio. |
| Revisión de carreras de autorización/revocación y consistencia de auditoría | **PARCIAL / pendiente** | Se verificaron casos dirigidos y efectos auditables descritos en la suite. | Faltan escenarios sistemáticos de concurrencia, revocación entre validación y escritura, y cobertura de cada operación relevante. |
| CI del nuevo SHA | **PENDING** | El workflow ahora incluye un paso nombrado para ejecutar `npm run test:security:phase10-residual:local`, además de preservar checks y timeout existentes. | Sólo se considerará PASS cuando el run de PR del SHA publicado termine exitoso y el paso de 59 aserciones aparezca ejecutado. CI histórico de `main` no valida este cambio. |
| Revisión de seguridad alojada por entorno | **BLOCKED por alcance** | No hubo consultas remotas en esta fase. | Requiere autorización read-only específica, evidencia separada para cada entorno y reconciliación de diferencias. No extrapolar el estado de Testing a Producción ni viceversa. |
| Aceptación operativa del lanzamiento | **BLOCKED en QR-011** | QR-011 sigue P1 / Bloqueada, dependiente de QR-003 y QR-004. | Mantener sus criterios: asistencia QR/PIN, dispositivos físicos y cámara, conexión, reglas, reportes, advisories npm, aceptación en Testing, backup/recuperación y decisión de lanzamiento. |

## Evidencia de fases consolidadas

- **Fase 10.1:** inventario estático y clasificación de las 46 funciones privilegiadas, endpoints y Server Actions en [brechas residuales](QR-004-PHASE10-RESIDUAL-GAPS.md). No confirmó vulnerabilidad nueva; documenta cobertura y riesgo residual.
- **Fase 10.2:** suite SQL versionable de 59 aserciones, aislada mediante modo propio del runner. Resultado local reportado: 59/59. La suite no invoca RPC de PIN/escaneo ni crea sesiones/eventos de asistencia.
- **Fase 10.3:** revisión de aislamiento, modos previos y cierres administrativos en [validación residual](QR-004-PHASE10-RESIDUAL-VALIDATION.md). Regresiones restringidas 115/115 documentadas.
- **CI:** se agregó un solo paso de Fase 10.2. Se mantienen `npm ci`, lint, typecheck, `npm test`, restore sintético, lease de reportes, matriz general, 115 regresiones, E2E, build y timeout de 30 minutos. El CI general conserva su prueba ya existente de PIN sintético válido en stack local desechable. La autorización del propietario cubre esa ejecución de CI, pero no Testing/Producción.
- **Cierres administrativos:** QR-002, QR-005, QR-006 y QR-007 permanecen **Hecha** en el alcance documentado; QR-009 conserva su estado previo. Esto no equivale a aceptación de lanzamiento.

## Riesgos y condiciones para cerrar QR-004

1. No hay cobertura directa completa para todas las funciones privilegiadas, métodos HTTP y Server Actions.
2. Permanecen casos de revocación/cambio de autorización concurrente y trazabilidad de auditoría que requieren pruebas explícitas por operación.
3. Cinco funciones de asistencia/PIN no se validaron en esta fase; las dependencias y cualquier ejecución autorizada se gobiernan por QR-003.
4. No existe evidencia remota nueva que pruebe paridad de configuración, grants, RLS o migraciones efectivas por entorno.
5. CI debe pasar en el SHA nuevo; el historial de CI de la base no cuenta como validación de este paquete.
6. El cierre local requiere resolver o justificar formalmente todos los casos P0/P1 permitidos y conservar evidencia reproducible. El cierre global de QR-004 además exige revisión remota segregada autorizada.

No se rebajó severidad ni se amplió privilegio para hacer pasar pruebas. No se modificaron código funcional ni migraciones.

## Relación con tareas de lanzamiento

- **QR-003:** P0, pospuesta y **NO-GO**. La corrección local no significa aplicada o validada en Testing.
- **QR-004:** **En curso**; cierre técnico local y revisión alojada todavía incompletos.
- **QR-011:** P1, **Bloqueada**, dependiente de QR-003 y QR-004. Mantener todos los criterios de aceptación operativa documentados en `TASKS.md`.
- **QR-002/005/006/007:** **Hecha** dentro del alcance de desarrollo, auditoría o automatización correspondiente; no autoriza despliegue ni sustituye QR-011.

## Publicación y decisión

La publicación autorizada permite crear un commit, publicar esta rama y abrir un PR para revisión. No incluye merge ni despliegue. La decisión recomendada será **READY para revisión del PR cuando CI termine SUCCESS**, pero **NOT READY para declarar QR-004 cerrada o aceptar lanzamiento** hasta completar las brechas descritas. Si CI falla, se debe investigar la causa y preservar todas las comprobaciones; no se debe eliminar ni debilitar pruebas para obtener un resultado verde.
