# Estrategia de pruebas

## Comandos comprobados en `package.json`

- `npm run lint`, `npm run typecheck`, `npm run build`.
- `npm run test` ejecuta las suites Node definidas para asistencia, reportes, escáner, PIN, credenciales, portal, accesos, correo y despliegue.
- Hay scripts separados para integraciones de reportes y JWT; algunos necesitan credenciales/servicios locales.
- CI ejecuta instalación limpia, lint, typecheck, `npm run test`, integración local de lease y build.

Consulta los scripts actuales en `package.json`; esta lista puede cambiar. No ejecutes pruebas que necesiten base de datos hasta confirmar que la instancia es local, aislada y desechable.

## Base de datos

Las pruebas pgTAP están en `supabase/tests/`. El README de Supabase documenta `npx supabase start` y `npx supabase test db --local`; el script `test:pin-lockout:db` además exige un workdir marcado como desechable y una URL local configurada. No apuntes pruebas a Testing ni Producción. Las migraciones no deben aplicarse durante una tarea de documentación.

QR-003 documenta la reproducción legacy y los resultados de pgTAP/integración en [PIN-LOCKOUT-FIX.md](PIN-LOCKOUT-FIX.md). `tests/security-jwt-matrix.integration.mjs` apunta a Testing y requiere credenciales reales de ese entorno; no lo ejecutes como prueba local.

## Prácticas por tipo

- **Unitarias:** reglas de dominio y presentación; comprobar límites y errores.
- **Integración HTTP/Auth:** sesión, permisos, entradas inválidas, errores y aislamiento entre empresas.
- **SQL/pgTAP:** RLS, funciones, integridad transaccional, concurrencia y acceso bajo roles reales de prueba.
- **E2E local (QR-005):** `npm run test:e2e:local` levanta una copia Supabase/Next desechable, usa Playwright Chromium y limpia únicamente el proyecto temporal; no requiere ni carga `.env.local`.
- **Regresión:** ejecutar pruebas del dominio afectado y suites de seguridad relevantes.

## Reglas

1. Registra el comando exacto, ambiente y resultado observado.
2. Usa identidades y datos sintéticos; no copies datos personales de Producción.
3. No cambies una prueba de seguridad para acomodar una implementación insegura.
4. Mantén las pruebas de bloqueo de PIN, credenciales, RLS, tenant, auth y exportación concurrente salvo evidencia comprobada y cobertura equivalente.
5. Si no se pudo validar un servicio externo, indica el bloqueo y no declares la prueba pasada.

## Inventario observado

`tests/` incluye pruebas `.test.mjs`, integraciones Node, scripts de restauración Auth local y pruebas de navegador en `tests/e2e/`. `supabase/tests/` contiene pgTAP para asistencia, RLS, credenciales, portal, permisos, schedules y exportación. CI está en `.github/workflows/ci.yml`.

## QR-005 — Playwright E2E

La configuración está en `playwright.config.mjs`. Ejecuta `npm run test:e2e:local`; el comando lanza el runner local con `--e2e-only`, que crea un proyecto Supabase con ID aleatorio, aplica las migraciones únicamente en PostgreSQL desechable, prepara identidades sintéticas y arranca Next.js en loopback. El runner elimina su stack y directorio temporal incluso tras fallos, y comprueba que contenedores, volúmenes y redes preexistentes permanezcan.

Playwright bloquea toda solicitud del navegador fuera del origen Next local y la API Supabase loopback. Las pruebas usan los formularios reales y Server Actions de Next.js; no fabrican el protocolo de Server Actions. Capturas, video y trazas están desactivados; resultados temporales quedan dentro del directorio que el runner elimina. CI usa el Chrome aislado del job, un worker y un reintento; localmente no hay reintentos.

La fase inicial cubre navegación anónima protegida, inicio/cierre de sesión de owner/admin, rechazo de contraseña, roles supervisor/empleado, cuenta sin membresía activa, expediente no vinculado, selección y cambio entre empresas, sucursal faltante, ciclo de solicitud/aprobación/revocación de dispositivo y revocación de membresía. La cámara se prueba con Chromium y dispositivo multimedia simulado; la denegación inicial de `getUserMedia` es un mock del navegador, no una prueba física de hardware. Se comprueba que abrir/cerrar cámara no llama a `/api/attendance/scan`.

**Bloqueado por QR-003:** no se valida PIN, no se envía ningún PIN, no se lee una credencial QR, no se llama a `private.verify_employee_pin`, no se confirma movimiento y no se prueba el lockout. Entrada/salida/descanso quedan fuera de la aceptación E2E de esta fase.
