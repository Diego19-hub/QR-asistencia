# QR-asistencia — Etapa 10B: preparación de Testing en VPS

Fecha: 2026-10-12
Commit base inspeccionado: ca3bfdeae431cbb6c9360a27d60dee927b75aea4
Supabase consultado en modo lectura: llxyziffgtqnzlguxhyt (QR-asistencia-testing)
Producción jawdrhewabqajxnswhkn: no consultada ni modificada.

## Decisión

**NO-GO para aplicar migraciones o iniciar el despliegue.** La inspección del historial remoto halló divergencias inesperadas: Testing registra enable_pgtap_test_extension, que no tiene archivo local, y 18 migraciones con versiones distintas aunque sus nombres coincidan. La única migración presente localmente y ausente en el listado remoto es 20261012050537_global_report_export_lease.sql, pero aún no puede afirmarse que sea lo único que el CLI aplicaría. No se ejecutó SQL ni se desplegó nada.

La preparación local de infraestructura sí está lista para revisión. El CLI se pudo ejecutar con telemetría desactivada, pero la consulta con --project-ref llxyziffgtqnzlguxhyt se detuvo antes de consultar por falta de SUPABASE_ACCESS_TOKEN. No ejecuté el dry-run porque primero debe resolverse el desajuste de historial.

## Inventario y compatibilidad

- Next.js App Router, versión 16.4, ejecuta en Node.js 22 en CI. PDFKit 0.17.2 y ExcelJS 4.4.0 son dependencias de producción.
- La instalación bajo Node 22 muestra EBADENGINE para la dependencia browser-side @zxing/library 0.23.0, que declara Node >=24. El build de Next bajo Node 22 terminó correctamente, y el escáner importa @zxing/browser desde un componente cliente, pero la versión del paquete mantiene una advertencia de motor; Safari/Chrome real sigue siendo una aceptación obligatoria. No degradé ZXing ni cambié el runtime pedido sin validar el escáner.
- PDFKit se externaliza y busca sus métricas AFM junto al paquete; la imagen copia las dependencias completas de producción y verifica Helvetica.afm durante el build.
- XLSX/PDF se crean en memoria como Buffer. El endpoint rechaza más de 500 jornadas en el servidor, antes de construir el archivo.
- Supabase SSR usa NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Next.js inserta esas variables públicas al compilar, por lo que cada imagen debe construirse para Testing con los valores de Testing y no reutilizarse en producción.
- La app no requiere service_role, contraseña Postgres, Redis ni credencial administrativa.
- El proyecto Testing consultado está en us-east-1, PostgreSQL 17.11. Mantener el VPS en región cercana y medir latencia.
- Auth usa cookies SSR; con NODE_ENV=production se marca Secure. Caddy termina HTTPS y suministra X-Forwarded-Proto.
- Escáner QR requiere HTTPS para cámara móvil. La política del proxy permite cámara al mismo origen.
- Las descargas usan ReadableStream; el lease se conserva mientras se consume/cancela. Caddy usa modo de baja latencia, pero la respuesta completa aún debe probarse en el VPS.

No se encontró Dockerfile, Caddyfile, healthcheck ni definición de monitoreo antes de esta etapa. Se agregaron. El repositorio ya contiene pruebas locales del lease.

## Topología propuesta

Un VPS Linux de 4 GiB, Docker Compose, un contenedor Next.js y Caddy como proxy TLS. Caddy publica 80/443. La app solo escucha en 3000 dentro de Compose y el puerto del host queda enlazado a 127.0.0.1. Compose fija una réplica.

La imagen usa node:22-bookworm-slim, ejecuta como usuario node, elimina capacidades Linux de la app y conserva dependencias necesarias para PDFKit/ExcelJS. Límite del contenedor: 3 GiB; heap V8: 2 GiB. Reservar al menos 1 GiB para sistema operativo, Docker, Caddy y margen; no ejecutar otros servicios pesados.

Medidas históricas locales para 500 jornadas: RSS aproximado de 252 MiB XLSX, 215 MiB PDF y 339 MiB en una prueba concurrente. No son medidas de esta imagen ni del hosting. Mantener máximo 500 y una exportación global activa.

El límite global reduce capacidad: todas las empresas comparten una sola exportación simultánea. Las demás reciben 429 con Retry-After; los rechazos por concurrencia no consumen cuota de frecuencia.

Archivos añadidos:

- Dockerfile: build/runtime Node 22, usuario no root, verificación de AFM, heap y healthcheck.
- compose.testing.yml: una app, memoria/CPU limitadas, puertos privados, permisos reducidos y Caddy.
- Caddyfile.testing: HTTPS automático, streaming, cabeceras de seguridad y logs JSON sin query, referer ni user-agent, con IP enmascarada.
- .dockerignore: omite Git, builds, .env, cachés, temporales y respaldos.
- .env.testing.example: solo marcadores ficticios.
- src/app/api/healthz/route.ts: liveness mínimo con Cache-Control no-store.

## Variables y configuración

| Variable | Dónde | Valor | Secreto |
| --- | --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Build y runtime | URL de Testing | No |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Build y runtime | Publishable key de Testing | No |
| QR_ASISTENCIA_DOMAIN | Compose/Caddy | Host HTTPS del VPS | No |

Crear un archivo /etc/qr-asistencia/.env.testing fuera del repositorio, desde .env.testing.example; completar valores de Testing y aplicar chmod 600. No agregar service_role, contraseña de base de datos ni claves administrativas. La publishable key queda incluida en JS público, por diseño.

En Supabase Auth Testing configurar Site URL con el origen HTTPS exacto y permitir solo callbacks necesarios. Comprobar login, refresh y logout. La política Permissions-Policy habilita cámara al mismo origen y deniega micrófono/geolocalización. Se omite CSP estricta hasta validar recursos de Next y ZXing.

## Pasos futuros en el VPS

Requiere aprobación manual de VPS, dominio, IP y proveedor/costo; usuario Linux; Docker Engine/Compose; DNS A/AAAA; abrir TCP 80/443 y SSH 22 limitado a IP administrativa; bloquear 3000 y puertos de base de datos; usar llaves SSH y actualizaciones de seguridad.

En un checkout exacto del commit autorizado:

~~~sh
cp .env.testing.example .env.testing
chmod 600 .env.testing
# Completar localmente URL/key de Testing y el dominio real.
docker compose --env-file .env.testing -f compose.testing.yml config --quiet
docker compose --env-file .env.testing -f compose.testing.yml build
docker compose --env-file .env.testing -f compose.testing.yml up -d --scale app=1
docker compose --env-file .env.testing -f compose.testing.yml ps
curl --fail --silent --show-error https://HOST_REAL/api/healthz
~~~

Validar /login, cabeceras, cookies Secure, cámara en Safari iOS/Chrome Android y descargas completas y canceladas. Añadir una descarga lenta para comprobar renovación del lease y flushing del proxy.

Firewall: entrada TCP 22 solo desde IP administrativa, TCP 80/443 públicos, UDP 443 opcional para HTTP/3; denegar el resto. Mantener 3000 en localhost y no exponer Docker socket. Usar SSH keys, deshabilitar login root y password SSH según política, aplicar parches y reinicios controlados.

## Salud, logs y observación

/api/healthz comprueba liveness, no disponibilidad de Postgres/Auth/migraciones. Docker lo consulta cada 30 s. La ruta de exportación registra JSON con ID aleatorio, formato, estado, duración del handler y RSS; omite URL, filtros, empresa/usuario, cookies, PIN, token QR, JWT y archivo. El tiempo del handler no incluye necesariamente toda la descarga; Caddy registra duración HTTP y el lease queda sujeto al consumo/cancelación.

Durante aceptación revisar compose logs, compose ps y docker stats. Investigar 5xx, RSS sostenido sobre 70% del límite, unhealthy, 413, 429 y fallos de lease. Caddy filtra query, Referer, User-Agent y enmascara IP. Rotación Caddy: 10 MiB por archivo y 5 archivos; configurar también rotación del log de app en el host y vigilar espacio. No hay proveedor de métricas/alertas; hasta elegirlo, requiere inspección operativa diaria.

## Estado de migraciones y dry-run

ID confirmado: llxyziffgtqnzlguxhyt, QR-asistencia-testing, activo, us-east-1, PostgreSQL 17.11. No se consultó producción.

El listado remoto contiene 21 entradas. 20 nombres existen también localmente, incluidas 20261011232050_distributed_report_export_rate_limit y 20261012030630_scanner_branch_scope_and_legacy_rpc_lockdown. Remota adicional: enable_pgtap_test_extension, versión 20261011211215, sin archivo local. Local adicional: 20261012050537_global_report_export_lease.sql, ausente del listado remoto. 18 migraciones de igual nombre tienen versión distinta entre archivo local y registro remoto; attendance_calculation_consistency es 20261011212752 local y 20261011211200 remoto.

CLI Supabase 2.120.0; --dry-run está disponible y no aplica SQL. El CLI no tiene token; el intento explícito de migration list terminó con AccessTokenRequiredError antes de contactar el remoto. Como hay diferencias, no se ejecutó db push --dry-run. No usar --include-all, migration repair, db reset --linked ni push para alinear automáticamente.

Después de resolver el historial, usar el siguiente procedimiento, que sigue siendo de solo lectura hasta que se autorice por separado la aplicación:

1. Confirmar el proyecto Testing en CLI.
2. Ejecutar migration list con project-ref llxyziffgtqnzlguxhyt.
3. Ejecutar db push --project-ref llxyziffgtqnzlguxhyt --dry-run.
4. Detenerse salvo que enumere únicamente 20261012050537_global_report_export_lease.sql.
5. Solicitar autorización expresa, aplicar solo en Testing, verificar fila, tabla privada, RLS, firmas y grants, y probar acquire/ocupación/renew/expiry/release/owner anterior/permisos.

El lease debe aplicarse y verificarse antes de desplegar la API actual de exportación. Sin los RPC, la ruta falla con 503. No aplicar SQL productivo ni inferir su historial desde Testing.

## Aceptación y rollback

Orden: resolver drift; CI y build de imagen; autorización de hosting/dominio/secretos Testing; dry-run que muestre solo lease; autorización explícita de migración; aplicación/verificación en Testing; pruebas HTTP, pgTAP y concurrencia; desplegar la imagen; aceptación de roles, empleados, QR/PIN, asistencia, filtros, XLSX/PDF, 401/403 A/B, 413 a 501, 429, stream lento/cancelado y reinicio.

Para fallo de app, volver al tag anterior conservado, no usar latest. Si el lease no está disponible, deshabilitar exportaciones mientras se investiga. Tras una migración, preferir una migración forward; no asumir reversibilidad transaccional ni ejecutar DROP/migration repair. Restaurar solo en una base nueva e aislada, tras haber ensayado backup/restore.

## Verificación de esta etapa

- Base inicial: rama main, SHA ca3bfdeae431cbb6c9360a27d60dee927b75aea4; árbol limpio. GitHub Actions del commit base tuvo éxito.
- Testing se consultó por ID confirmado y se detectó drift; no hay dry-run ni SQL aplicado.
- El socket Docker no estaba accesible inicialmente; build de imagen/Compose aún no está verificado.
- Después de habilitar acceso al daemon local: build Docker con Node 22.23.3 completó; healthcheck de contenedor y /api/healthz respondieron 200; /login respondió 200; un smoke test dentro de la imagen generó PDFKit y ExcelJS y halló Helvetica.afm. Compose config y Caddyfile validaron con variables .invalid. Se usaron valores ficticios, no hubo conexiones Supabase remotas.
- Suite nueva de infraestructura: 3/3; reportes: 16/16; scanner: 4/4; credenciales: 7/7. Suite aislada local del lease: 14/14, incluidos 13 checks pgTAP, JWT, export HTTP y limpieza; el arnés confirmó que codigo_QR preexistente no cambió. npm ci, lint, typecheck, build y git diff --check pasaron. npm ci observó 5 High en el árbol de build; el npm prune --omit=dev del runtime informó 0 vulnerabilidades. No se ejecutó auditoría npm detallada en esta etapa.
- `npm ci` de imagen generó advertencia de motor @zxing/library bajo Node 22; el build de la aplicación sí pasó. Prueba móvil real pendiente.
- No se desplegó, contrató infraestructura, cambió plan ni consultó producción.
- Decisión: NO-GO migración por drift; NO-GO VPS hasta reconciliar historial, obtener dry-run inequívoco, autorización para aplicar lease y probar HTTPS/descargas y cámara en dispositivo real.
