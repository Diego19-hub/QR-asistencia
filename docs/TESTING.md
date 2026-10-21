# Estrategia de pruebas

## Comandos comprobados en `package.json`

- `npm run lint`, `npm run typecheck`, `npm run build`.
- `npm run test` ejecuta las suites Node definidas para asistencia, reportes, escáner, PIN, credenciales, portal, accesos, correo y despliegue.
- Hay scripts separados para integraciones de reportes y JWT; algunos necesitan credenciales/servicios locales.
- CI ejecuta instalación limpia, lint, typecheck, `npm run test`, integración local de lease y build.

Consulta los scripts actuales en `package.json`; esta lista puede cambiar. No ejecutes pruebas que necesiten base de datos hasta confirmar que la instancia es local, aislada y desechable.

## Base de datos

Las pruebas pgTAP están en `supabase/tests/`. El README de Supabase documenta `npx supabase start` y `npx supabase test db --local`; el script `test:pin-lockout:db` además exige un workdir marcado como desechable y una URL local configurada. No apuntes pruebas a Testing ni Producción. Las migraciones no deben aplicarse durante una tarea de documentación.

## Prácticas por tipo

- **Unitarias:** reglas de dominio y presentación; comprobar límites y errores.
- **Integración HTTP/Auth:** sesión, permisos, entradas inválidas, errores y aislamiento entre empresas.
- **SQL/pgTAP:** RLS, funciones, integridad transaccional, concurrencia y acceso bajo roles reales de prueba.
- **E2E futuro (QR-005):** login, selección de empresa, permisos, escáner y asistencia con datos sintéticos y entorno aislado.
- **Regresión:** ejecutar pruebas del dominio afectado y suites de seguridad relevantes.

## Reglas

1. Registra el comando exacto, ambiente y resultado observado.
2. Usa identidades y datos sintéticos; no copies datos personales de Producción.
3. No cambies una prueba de seguridad para acomodar una implementación insegura.
4. Mantén las pruebas de bloqueo de PIN, credenciales, RLS, tenant, auth y exportación concurrente salvo evidencia comprobada y cobertura equivalente.
5. Si no se pudo validar un servicio externo, indica el bloqueo y no declares la prueba pasada.

## Inventario observado

`tests/` incluye pruebas `.test.mjs`, integraciones Node y scripts de restauración Auth local. `supabase/tests/` contiene pgTAP para asistencia, RLS, credenciales, portal, permisos, schedules y exportación. CI está en `.github/workflows/ci.yml`. La introducción de Playwright requiere decisión de entorno/dependencia en QR-005.
