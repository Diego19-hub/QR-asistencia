# QR-asistencia — Diagnóstico del CI #127: sincronización de Server Action

**Fecha:** 2026-10-31. **Naturaleza:** corrección experimental del harness de Chrome **local desechable**. **NO es autorización de despliegue.**

## Evidencia inspeccionada

GitHub Actions `CI #127` (`9464f9f`) pasó `npm ci`, lint, typecheck, `npm run test`, restauración local y report-lease. El runner `test:security:matrix:local` pasó ocho archivos pgTAP, las verificaciones de RLS de ajuste y el arranque aislado. **Falló** después en `tests/qr004-auth-matrix.local.integration.mjs:635` (en ese commit), durante el cambio de empresa activa con `setAdminMembership`, al leer una cookie todavía asociada a la empresa previa. E2E y build quedaron sin ejecutar. En `CI #128` se canceló `npm ci` sobre el mismo SHA histórico.

En `tests/qr004-server-actions.browser.mjs`, `runForm()` marcaba terminada la petición tras `Network.responseReceived`, que notifica los **headers** antes de que termine de procesarse la respuesta. El test consultaba inmediatamente `Network.getAllCookies` y daba por fallido un posible cambio pendiente. Esta carrera es una **hipótesis sustentada por el orden del harness**, no un diagnóstico definitivo del comportamiento del servidor.

## Cambios aislados

- En `runForm()`, esperar `Network.loadingFinished` para la petición POST de la Server Action, después de `responseReceived`; conservar tiempo máximo de 20 s y fallar ante errores de red/HTTP 5xx. Esto no omite ninguna prueba.
- En las **dos** comprobaciones positivas `setAdminMembership`, esperar hasta 10 segundos el valor exacto de `qr_active_membership_id`. Si nunca cambia, **fallar cerrado**; conservar todas las aserciones sobre empresa propia, empresa ajena y membresía revocada.
- Pruebas Node puras `tests/qr004-server-action-cookie-sync.test.mjs` para transición tardía, cookie obsoleta, ausente y presupuesto de espera inválido.
- **Ninguna modificación de código de producto**, RLS, SQL, esquema, PIN, escáner, secretos, Docker, Supabase Testing o Producción.

## Validación requerida antes de integrar

1. `node --test tests/qr004-server-action-cookie-sync.test.mjs` (sin Docker ni Supabase): **NOT RUN en máquina local**; se verificó la función pura con pruebas sintéticas en V8 durante la autoría.
2. `npm run lint` y `npm run typecheck`: pendientes para este commit.
3. **Tras confirmar Docker local desechable y autorizar formalmente la matriz de integración**, ejecutar `npm run test:security:matrix:local` **en una rama aislada**, nunca enlazada a Testing/Producción. Asegurar pruebas de denegación, cookies y limpieza; revisar la causa si falla otra vez.
4. Solicitar code review; solo después decidir si incorporar este cambio al PR/una rama de integración y obtener **CI obligatorio PASS en SHA final**. No eliminar matrices ni aceptar un check saltado.

## Puertas del lanzamiento que siguen bloqueadas

- **QR-003 Testing:** tiene 24 migraciones registradas y no incluye `20261018120000_persist_employee_pin_failures.sql`; resolver respaldo/restauración y ledger divergente con revisión y aprobación explícitas, **antes** de cualquier escritura remota.
- **CI integral del PR #25:** no aprobado en HEAD; el nuevo parche no ha demostrado corregirlo todavía.
- **Proyecto de producción alojado:** figura INACTIVE en Supabase; no reactivado ni migrado.
- **Asesores de seguridad en Testing:** hallazgos WARN de permisos SECURITY DEFINER y protección contra contraseñas filtradas requieren triage; no revocar grants sin análisis.
- **No merge, reactivación, migración remota ni despliegue** en esta fase.

**Resultado:** se corrige un motivo plausible de flakiness en el harness y se preservan comprobaciones de seguridad. La validación integral sigue pendiente.
