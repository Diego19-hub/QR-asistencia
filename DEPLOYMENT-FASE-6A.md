# QR-asistencia — Preparación para Testing (Fase 6A)

Estado: preparación local únicamente. No desplegar ni aplicar migraciones hasta contar con autorización específica y validar el proyecto destino.

## Imagen

- Docker Official Image: `node:24.21.0-bookworm-slim`, fijada por digest en ambas etapas del [Dockerfile](Dockerfile).
- `npm ci` usa `package-lock.json`. CI usa Node 24.21.0.
- Next.js `output: "standalone"` genera el runtime mínimo. `.dockerignore` omite `.env*`, tests, fixtures, datos sintéticos, dependencias instaladas y archivos temporales. `supabase/migrations` permanece en el repositorio, fuera de la imagen de aplicación.
- La imagen escucha en 3000 como el usuario `node`; el healthcheck consulta `/api/healthz`.

## Variables y secretos de Testing

Usar `.env.testing.example` como plantilla, mantener la copia real fuera del repositorio con permisos `600` y no copiarla al contexto de build. `compose.testing.yml` necesita:

| Variable | Uso | Tratamiento |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase dedicado a Testing | Pública; se compila dentro del bundle. Debe ser la URL de Testing antes de construir. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave publicable del proyecto Testing | Pública por diseño; se compila dentro del bundle. Nunca usar una service-role/secret key aquí. |
| `QR_ASISTENCIA_DOMAIN` | Host HTTPS configurado en Caddy | Público; su DNS debe apuntar al servidor de Testing. |
| `APP_BASE_URL` | Origen canónico HTTPS para redirecciones Auth y validación de `Origin` | Debe coincidir exactamente con `https://$QR_ASISTENCIA_DOMAIN`. |

`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` y `INVITATION_FROM_EMAIL` son opcionales para el flujo de invitaciones. Solo si ese flujo se usará, guardar los secretos en el gestor de secretos del host y pasarlos al runtime; no ponerlos en `NEXT_PUBLIC_*`, build args, logs o la imagen. El escáner y las operaciones normales de asistencia no requieren service-role.

En Supabase Auth del proyecto Testing, fijar Site URL al origen HTTPS y permitir únicamente los callbacks que usa la aplicación (`/auth/confirm` y `/auth/callback`). No habilitar el origen de desarrollo `NEXT_ALLOWED_DEV_ORIGIN` en el servidor. Crear usuarios y datos de prueba exclusivos para Testing; restringir altas/autoregistro según el plan de prueba.

La aplicación fija `Secure` en sus cookies cuando `NODE_ENV=production`; usa `SameSite=Lax`. Detrás de Caddy, conservar el proxy como única vía al contenedor: en Compose el puerto 3000 está ligado a `127.0.0.1`, Caddy termina TLS y gestiona `X-Forwarded-Proto`. El proxy debe sobrescribir los encabezados `Forwarded`/`X-Forwarded-*`, no confiar los enviados por el cliente. No publicar el puerto 3000 ni PostgreSQL. Antes de aceptar usuarios externos, aplicar una lista de IP o control de acceso de Testing en firewall/proxy, pues HTTPS por sí solo no restringe el acceso.

## Migraciones

El checkout contiene 24 migraciones locales ordenadas por versión. La más reciente es `20261018120000_persist_employee_pin_failures.sql`; se aplicó y probó en la instancia desechable local de Fase 5F, junto con las anteriores. Mantener el directorio `supabase/migrations` y no incluirlo en la imagen web no impide su uso desde el checkout o CI de base de datos.

Procedimiento futuro para Testing, en un cambio separado y autorizado:

1. Confirmar visualmente el project ref de Testing y verificar que la sesión CLI apunta a ese proyecto; detenerse ante cualquier duda o si apunta a producción.
2. Crear/verificar un backup recuperable y obtener el listado remoto de migraciones. Compararlo por versión y contenido con los archivos locales.
3. Existe una observación histórica de drift en el documento `DEPLOYMENT-ETAPA-10F.md`. Reconciliar ese historial con el responsable de la base antes de intentar aplicar SQL. No usar `db reset`, `migration repair` ni `--include-all` para forzar coincidencia.
4. Solo cuando el historial esté reconciliado, preparar un dry-run. Revisar cada sentencia y confirmar que el único cambio esperado sea el aprobado para Testing. Detenerse si hay migraciones históricas adicionales o inesperadas.
5. Aplicar la migración en una ventana controlada y verificar su registro, funciones/grants y los casos de regresión SQL. No ejecutar esos pasos en esta fase.

No se ha consultado ni modificado Supabase remoto durante Fase 6A; el estado remoto actual debe volver a comprobarse en la fase de aplicación.

## Aceptación futura en Testing

1. Abrir `/login`, iniciar sesión con una cuenta de prueba y comprobar cierre/renovación de sesión y cookies `Secure`.
2. Confirmar permisos por rol y aislamiento entre dos empresas de prueba.
3. Crear un empleado sintético y validar edición/directorio.
4. Crear un horario y asignarlo al empleado.
5. Emitir la credencial QR y configurar/restablecer el PIN.
6. Solicitar dispositivo desde una cuenta de supervisor, aprobarlo desde administración y asignar su sucursal.
7. En un teléfono real, abrir `/scanner` bajo el hostname HTTPS con certificado confiable y autorizar cámara.
8. Escanear el QR, introducir PIN y confirmar Entrada, inicio y fin de descanso y Salida. No sustituir este paso con API o simulación.
9. Verificar todos los movimientos en Asistencias, junto con rechazo de PIN incorrecto/bloqueado.
10. Descargar y abrir los reportes Excel y PDF; comprobar filtros, zona horaria y contenido de solo la empresa de prueba.

Registrar evidencia, fecha, dispositivo/navegador, resultado y errores. Mantener pendiente la aceptación física hasta completar el paso 7–8; esta preparación no autoriza Testing ni producción.
