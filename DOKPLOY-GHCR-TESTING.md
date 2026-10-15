# QR-asistencia en Dokploy mediante GHCR (Testing)

Esta guía publica una imagen privada para el proyecto Supabase **QR-asistencia-testing** (`llxyziffgtqnzlguxhyt`). El workflow construye Linux AMD64 con Node.js 22 y no despliega a Dokploy. La publicación no cambia Supabase.

## Configuración previa en GitHub

En `Diego19-hub/QR-asistencia` abre **Settings → Secrets and variables → Actions → Variables** y crea:

| Variable | Valor esperado |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://llxyziffgtqnzlguxhyt.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | La publishable key activa de QR-asistencia-testing |

El workflow compara la URL con el valor exacto antes de iniciar el login o el build. Si falta una variable, el job queda omitido; si la URL difiere, el job falla antes de publicar. La publishable key está diseñada para ser pública y termina integrada en el bundle del navegador. No configures secretos de servidor como variables de build. Después de crear ambas variables, ejecuta el workflow desde `main` con **Actions → Publish Testing image to GHCR → Run workflow** si el push inicial ya pasó.

El workflow existente `CI` permanece sin cambios. El nuevo workflow usa `GITHUB_TOKEN` con `contents: read` y `packages: write`; no requiere un PAT para publicar.

## Imagen y comprobación de digest

Al completar correctamente el workflow en `main`, la etiqueta inmutable es:

```text
ghcr.io/diego19-hub/qr-asistencia:<SHA completo del commit del workflow>
```

El resumen del job registra además `ghcr.io/diego19-hub/qr-asistencia@sha256:<digest>`. En Dokploy se recomienda desplegar por digest para fijar exactamente los bytes probados; se puede usar el tag completo del SHA para identificar el commit. No uses `latest`.

GHCR crea paquetes nuevos como privados por defecto. Después de la primera publicación, confirma en **GitHub → Packages → qr-asistencia → Package settings** que la visibilidad sea **Private** y que el repositorio tenga acceso de escritura. Si ya existía un paquete, verifica su visibilidad antes de conectar Dokploy.

## Conectar Dokploy a GHCR

1. En Dokploy agrega un registro Docker con host `ghcr.io`, el usuario de GitHub y un PAT classic con solo el alcance `read:packages`. Autoriza el PAT en SSO si GitHub lo exige. Guarda el token en el almacén de credenciales de Dokploy; no lo pongas en el repositorio ni en variables del contenedor.
2. Crea una aplicación desde **Docker Image** y selecciona el registro GHCR privado.
3. Usa como imagen `ghcr.io/diego19-hub/qr-asistencia:<SHA completo>` o fija el digest `ghcr.io/diego19-hub/qr-asistencia@sha256:<digest>` que informa el run exitoso.
4. Configura una sola instancia/replica. Expón el puerto interno `3000` al dominio HTTPS mediante el proxy de Dokploy. No publiques el puerto 3000 directamente a Internet.
5. Configura el health check `GET /api/healthz` en el puerto `3000` si Dokploy permite health checks para aplicaciones de imagen.
6. Configura el dominio y HTTPS en Dokploy. La cámara del navegador requiere HTTPS; la aplicación conserva `HOSTNAME=0.0.0.0` y `PORT=3000` en el contenedor.

## Variables del contenedor

La URL y la publishable key son valores públicos de Testing y ya están integrados durante el build; el Dockerfile también las acepta en runtime si se necesitan para inicializar rutas del servidor. Los valores deben seguir siendo los del mismo proyecto Testing.

`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, contraseñas y secretos **nunca** se pasan como build args ni se incorporan en la imagen. El flujo normal de inicio de sesión, escáner y portal no necesita service role. Si se habilita la administración de invitaciones, provisiona los secretos que esa función requiera como variables de runtime protegidas de Dokploy, después de revisar el alcance y la rotación; no los incluyas en el build. `APP_BASE_URL` e `INVITATION_FROM_EMAIL` solo son necesarios para el flujo de invitaciones. `NEXT_ALLOWED_DEV_ORIGIN` no debe configurarse en producción.

## Actualizar una versión

Cada publicación exitosa desde `main` genera una etiqueta con el SHA completo del commit y un digest. Revisa que CI y el workflow de GHCR estén verdes, copia el digest desde el resumen del workflow y selecciona esa imagen en Dokploy. El despliegue de Dokploy es una operación separada y requiere autorización. Conserva el digest anterior para poder volver a seleccionarlo si la validación de Testing falla.
