# QR-asistencia — Etapa 10F: preparación del despliegue en Testing

Fecha: 2026-10-12
Alcance: revisión y plan reproducible. No se contrató ni configuró infraestructura, no se cambió DNS, no se desplegó la aplicación y no se consultó producción.

## Estado

Los artefactos de infraestructura de la Etapa 10B existen: `Dockerfile`, `compose.testing.yml`, `Caddyfile.testing`, `.env.testing.example`, `.env.example` y `/api/healthz`. La migración del lease se aplicó y verificó en Testing en la Etapa 10E. Esto actualiza el estado de migraciones que aparece en el informe histórico 10B; las otras observaciones de 10B no se reinterpretan aquí.

**Preparación: lista para completar con datos del hosting. Inicio del despliegue: NO-GO hasta recibir y validar VPS, dominio/DNS, acceso SSH y valores públicos de Supabase Testing.** No se requiere una clave `service_role`, contraseña PostgreSQL ni credencial administrativa en el VPS.

## Revisión de la infraestructura existente

- `Dockerfile`: Node.js 22 sobre Debian slim, build de Next.js, usuario no root, heap V8 de 2 GiB, verificación del archivo AFM de PDFKit y healthcheck. Las variables públicas de Supabase se insertan durante el build y deben apuntar a Testing para esta imagen. No hay carpeta `public/` que falte copiar en el árbol actual.
- `compose.testing.yml`: una instancia de app, límite de 3 GiB y 2 CPU, puerto 3000 enlazado solo a loopback, y Caddy en 80/443. La respuesta de la app no expone el puerto 3000 públicamente. Los certificados y configuración de Caddy viven en volúmenes Docker.
- `Caddyfile.testing`: HTTPS automático para el nombre configurado, proxy de baja latencia y tiempo de transmisión extendido; registra solicitudes con filtros de query, referer, user-agent e IP. Las cabeceras incluyen `Permissions-Policy` para la cámara del mismo origen.
- `.env.testing.example`: contiene marcadores de ejemplo para URL/key de Testing y dominio; no contiene valores de cuenta. `.env.example` es para desarrollo y añade `NEXT_ALLOWED_DEV_ORIGIN`, que no se debe usar en el VPS.
- El código usa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. La tercera variable necesaria para Compose/Caddy es `QR_ASISTENCIA_DOMAIN`. No se identificaron variables de servicio adicionales que deban configurarse en el VPS.
- La publishable key es pública por diseño. No añadir `service_role`, JWT, password de base de datos ni credenciales de Auth al entorno, build args, logs o bundle.

### Pendientes de infraestructura antes de una operación estable

1. Las imágenes de Node y Caddy usan tags móviles (`node:22-bookworm-slim` y `caddy:2`). Para builds reproducibles, fijar versiones exactas y, al cerrar el release, sus digests. Registrar también el digest de la imagen de la aplicación.
2. Caddy limita la rotación de sus logs, pero `app` no declara límites de logs. Antes de dejar el VPS en operación, configurar rotación para el driver `json-file` de `app` o una política equivalente en Docker.
3. El healthcheck solo comprueba que Next responda; no comprueba Supabase Auth, RPC ni migraciones. Las pruebas de disponibilidad de servicios externos deben ser checks operativos separados.
4. El build de Next se ejecuta en la etapa Docker y no se midió en el VPS definitivo. Si se construye allí, vigilar memoria y disco durante `docker compose build`; como alternativa, preparar una imagen OCI para la arquitectura exacta del VPS en un builder autorizado.
5. Los benchmarks anteriores de exportación no sustituyen la prueba en el VPS. Conservar una réplica, el límite de 500 jornadas y el lease global de una exportación activa. Las exportaciones de empresas diferentes comparten ese único cupo.

## Requisitos mínimos por confirmar

| Área | Requisito para Testing |
| --- | --- |
| VPS | Linux x86-64 compatible con Docker; Ubuntu Server 24.04 LTS recomendado; 2 vCPU; 4 GiB RAM; 40 GB SSD recomendado para sistema, imágenes, logs y margen. Confirmar arquitectura y espacio real. |
| Docker | Docker Engine y plugin Docker Compose v2 instalados; usuario de despliegue autorizado; daemon protegido, sin publicar el socket. |
| Red | IPv4 estática. TCP 80/443 públicos para Caddy y certificados. UDP 443 opcional. SSH restringido a la IP administrativa. Bloquear 3000 y puertos de base de datos desde Internet. |
| Dominio | Subdominio dedicado, por ejemplo `asistencia-test.example.mx`, cuyo DNS pueda administrar el usuario; registro A hacia la IP del VPS. Crear AAAA solo si hay IPv6 público operativo y firewall equivalente. |
| Acceso a código | Para clonar el repositorio privado, provisionar una deploy key de solo lectura en el VPS o aprobar otro método de entrega de imagen. No copiar un token personal al servidor. |
| Supabase | URL y publishable key del proyecto Testing; configurar el Site URL de Auth con el origen HTTPS final. No se requieren permisos de escritura de base de datos ni claves privilegiadas. |
| Custodia local | Guardar `.env.testing` en el servidor, fuera del checkout, con permisos `600`; directorio de configuración accesible solo por el usuario de despliegue/root. |

Los 4 GiB y el límite de 3 GiB para la app provienen de la preparación 10B; no constituyen una medición del proveedor seleccionado. El heap de 2 GiB deja margen para buffers y runtime, pero debe comprobarse con `docker stats` durante la aceptación. No aumentar concurrencia ni el límite de filas con estas medidas.

## Datos necesarios para reservar el procedimiento

El usuario debe facilitar en el canal apropiado (sin enviar contraseñas ni claves aquí):

1. Proveedor/instancia de VPS ya autorizada, región, sistema operativo, arquitectura, IP pública y memoria/disco contratados.
2. Dominio y subdominio que se asignará, confirmación de acceso a su DNS y si el VPS tiene IPv6 operativo.
3. Usuario Linux y método SSH habilitado; IP o rango desde el que se restringirá SSH.
4. Procedimiento aprobado para dar acceso de solo lectura al repositorio privado desde el VPS, o entrega de imagen OCI.
5. URL y publishable key de Testing disponibles directamente en el servidor mediante un gestor seguro o archivo local protegido. No pegarlas en el chat.

## Procedimiento reproducible cuando esos datos estén listos

No ejecutar hasta autorizar el VPS y el dominio. Estos pasos describen el despliegue futuro y no se han ejecutado en un servidor.

1. **Preparar host:** aplicar actualizaciones del sistema; crear usuario de despliegue sin login por contraseña; instalar Docker Engine/Compose desde su repositorio oficial; habilitar firewall con SSH solo desde IP administrativa y HTTP/HTTPS públicos. No exponer Docker socket ni puerto 3000.
2. **Configurar DNS:** crear el A del subdominio hacia la IP estática. Añadir AAAA únicamente después de validar conectividad IPv6 entrante. Esperar que el DNS público resuelva a la instancia esperada.
3. **Autorizar código:** instalar una deploy key de solo lectura fuera del repositorio o recibir una imagen OCI con digest verificable. Revisar que no haya otros cambios locales y seleccionar el commit aprobado.
4. **Preparar entorno:** crear `/etc/qr-asistencia/.env.testing` con las tres variables del ejemplo y valores de Testing/dominio; protegerlo con permisos `600`. Nunca incluir `NEXT_ALLOWED_DEV_ORIGIN` en producción ni claves privilegiadas.
5. **Validar configuración:** en el checkout aprobado y con el entorno local configurado, ejecutar `docker compose --env-file .env.testing -f compose.testing.yml config --quiet`. Comprobar que la URL pertenece a Testing y que dominio y DNS coinciden.
6. **Construir y arrancar una sola app:** ejecutar `docker compose --env-file .env.testing -f compose.testing.yml build` y luego `docker compose --env-file .env.testing -f compose.testing.yml up -d --scale app=1`. Confirmar `docker compose ... ps` y `docker stats`; mantener el tag/digest anterior disponible para rollback.
7. **Validar HTTPS:** `curl --fail --silent --show-error https://<subdominio>/api/healthz`. Revisar redirección HTTP→HTTPS, cabeceras, cookies `Secure`, ausencia de errores 5xx y que 3000 no sea accesible desde fuera.
8. **Aceptación funcional:** probar login/logout, sesión SSR y roles; acceso admin y supervisor; flujos de empleados y permisos; cámara QR desde Safari/Chrome en teléfono HTTPS; reportes Excel/PDF, filtros y stream completo/cancelado; límite de 500; 401/403 multiempresa; 429 por cuota y lease; renovación y liberación; reinicio del contenedor.
9. **Observar:** revisar `docker compose logs`, `docker compose ps` y `docker stats`; comprobar rotación de logs, disco, memoria, latencias y respuestas 5xx/429. El check `/api/healthz` es solo liveness.

### Rollback de aplicación

Mantener el commit y digest anterior. Ante fallo, volver al checkout/tag anterior, aplicar el entorno Testing existente y recrear solo `app` con una réplica; conservar volúmenes de Caddy y no tocar la base. La migración del lease debe estar antes que la API que la invoca; 10E confirma que ya está aplicada en Testing. Si el fallo es de base o de permisos, detener exportaciones y diagnosticar; no revertir metadata ni borrar tablas. No desplegar ningún cambio a producción desde este procedimiento.

## Comprobaciones de publicación

- El repositorio confirmado por GitHub es privado y su `main` coincide con el HEAD base al preparar esta guía.
- `DEPLOYMENT-ETAPA-10E.md` se saneó antes de publicarlo: se retiraron refs de proyectos y metadatos identificables del respaldo; no contiene contraseñas, tokens, claves ni datos laborales.
- Este informe no contiene valores reales de entorno. Los archivos `.env.testing` y cualquier credencial quedan fuera de Git.
- El push de esta documentación debe iniciar CI. Registrar aquí el SHA publicado y el resultado del workflow al finalizar.

## Decisión

**NO-GO para iniciar el despliegue ahora.** La configuración local ya existe y la migración de Testing está lista, pero faltan los datos y accesos del VPS/dominio, la clave de acceso de solo lectura al repositorio o método de imagen, y la configuración real de Auth/entorno para ese origen. Cuando se reciban, completar los controles previos, fijar imágenes y rotación de logs, ejecutar el procedimiento y pruebas de aceptación; no tocar DNS ni servidor antes de la autorización correspondiente.
