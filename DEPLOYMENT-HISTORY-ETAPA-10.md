# Historial de despliegue — Etapa 10

> Archivo histórico consolidado. Estos informes describen decisiones y estados observados en octubre de 2026; no acreditan el estado actual de Testing o Producción ni autorizan operaciones. Para procedimientos vigentes, consulta `DEPLOYMENT-FASE-6A.md` y `DOKPLOY-GHCR-TESTING.md`.

<a id="etapa-10a"></a>


## QR-asistencia — Etapa 10A: infraestructura y preparación

Fecha de revisión: 2026-10-12

Commit base revisado: `502db7dd253675230b76ff17a405760eb022e920`

Commit de Etapa 10A: `efc1e1d9a4b61892acef01ab24538a271257daec`

Supabase Testing: `llxyziffgtqnzlguxhyt` (`QR-asistencia-testing`, activo, Postgres 17.11)

Producción: no consultada ni modificada.

### Decisión

**GO para iniciar la Etapa 10B como despliegue controlado exclusivamente en Testing, con aprobación explícita antes de aplicar la migración o desplegar el frontend.** La rama `main` está publicada y CI pasó; la prueba local de concurrencia pasó 14/14. La migración `20261012050537` está pendiente en Testing, por lo que la API que consume el lease no se debe desplegar hasta validar el dry-run, obtener autorización específica y aplicar/verificar esa migración allí. Producción sigue fuera de alcance.

La arquitectura sugerida para una instancia piloto es **un VPS de 4 GiB RAM, con Next.js en Node 22, Caddy como proxy TLS y una sola instancia de aplicación**. Reservar hasta 2 GiB para Node y conservar el lease de PostgreSQL con capacidad global igual a una exportación. Esta propuesta busca memoria y ciclo de respuesta previsibles; añade administración de sistema, actualizaciones y guardias operativas. No se contrató infraestructura.

Vercel es una opción razonable si se habilita el plan adecuado y se valida el streaming en una prueba de aceptación real. Sus funciones Node tienen memoria predeterminada de 2 GiB, y máximo publicado de 4 GiB en Pro/Enterprise; el payload de respuesta de funciones tiene límite de 4.5 MB. El archivo se construye en memoria como `Buffer`; el benchmark local de 500 jornadas midió XLSX 50 KB y PDF 84 KB, pero falta probar la respuesta completa en el hosting. Vercel Hobby tiene precio base USD 0, Pro USD 20/mes por plataforma con USD 20 de crédito de uso; cargos por consumo, impuestos y límites finales deben confirmarse en la cuenta antes de elegir. Referencias: [límites de Functions](https://vercel.com/docs/functions/limitations), [precios de Functions](https://vercel.com/docs/functions/usage-and-pricing), [planes Pro](https://vercel.com/docs/plans/pro-plan) y [precios Vercel](https://vercel.com/pricing).

### Inventario del proyecto

- Next.js App Router 16.4, TypeScript, React 19; CI usa Node.js 22. Next 16 requiere Node 20.9 o posterior, así que fijar Node 22 LTS en hosting; el proyecto no declara `engines` en `package.json`. [Requisitos Next.js 16](https://nextjs.org/docs/app/guides/upgrading/version-16).
- Supabase Auth con `@supabase/ssr`; cliente servidor valida identidad con `auth.getUser()` y conserva cookies SSR. Claves públicas se limitan a URL y publishable key.
- PostgreSQL con RLS y funciones RPC transaccionales. Las API routes validan scope administrativo o de supervisor antes de operar.
- El escáner usa cámara mediante navegador y endpoints Node/Next; requiere HTTPS salvo localhost.
- Exportaciones declaran runtime `nodejs`. PDFKit genera PDF y ExcelJS genera XLSX en memoria; el endpoint limita a 500 jornadas del lado del servidor y comprueba también truncamiento de consulta.
- Lease `private.report_export_leases` serializa globalmente, entre instancias y empresas. La ruta lo adquiere antes de consultar datos/cuota y lo conserva durante el stream/cancelación. Cuota aparte: 10 exportaciones por usuario/empresa en 5 minutos. No incrementar concurrencia hasta medir.
- La aplicación no persiste archivos locales: las descargas se responden directamente. No hace falta volumen persistente de aplicación.
- No se encontraron Dockerfile, Compose de aplicación, `vercel.json`, workflow de despliegue, endpoint de healthcheck ni logger/métricas estructuradas. Existe únicamente CI (`.github/workflows/ci.yml`).
- Scripts actuales: `dev`, `build` (webpack), `start`, `lint`, `typecheck`, suites de reportes, lease local y escáner. Se añadió `npm run test` como agregador unitario y una prueba de contrato de error de credenciales; CI ejecuta también esta prueba.

### Comparación de hosting

| Aspecto | Vercel | VPS con Node y Caddy |
|---|---|---|
| RAM | 2 GiB predeterminados; hasta 4 GiB en Pro/Enterprise según documentación. Instancias efímeras y escalan en paralelo. | RAM asignada a VM; propuesta inicial 4 GiB total, con tope de heap configurable y una instancia. Permite observar y limitar RSS. |
| Ejecución HTTP | Hobby hasta 300 s con Fluid Compute documentado; Pro hasta 800 s, pero confirmar configuración del proyecto. Functions payload máximo 4.5 MB. | Proceso persistente. El proxy debe configurarse para permitir streaming, desactivar buffering de descargas y usar timeout por encima del tiempo de generación/transferencia. Next recomienda reverse proxy al auto hospedar ([guía](https://nextjs.org/docs/app/guides/self-hosting)). |
| Lease | PostgreSQL coordina múltiples invocaciones; cada instancia sigue siendo efímera. Debe probarse el ciclo de stream/cancelación y heartbeat en el proveedor. | PostgreSQL coordina cualquier réplica. Empezar con una instancia y un proceso para respetar el límite global de un archivo. |
| HTTPS / dominios | TLS y CDN gestionados; DNS y configuración de dominios en Vercel. | Caddy puede solicitar/renovar certificados automáticamente; operar DNS, firewall, actualizaciones y alertas. |
| Logs / métricas | Logs de funciones y métricas del proveedor; revisar retención/plan y costo. Añadir correlación y no registrar cookies/tokens. | `journald`/Docker logs y métricas del host; configurar rotación, alertas y retención. |
| Escala | Escala horizontal automática; PostgreSQL sigue siendo el semáforo global. | Escala vertical sencilla. Réplicas requieren balanceador y mantienen la concurrencia limitada por el lease. |
| Operación | Menor carga de sistema; dependencia de límites y precios del proveedor. | Mayor responsabilidad de parches, backups de host, firewall, monitoreo y recuperación. |
| Precio orientativo | Hobby USD 0, sujeto a uso y condiciones de uso personal. Pro USD 20/mes base con USD 20 crédito de uso; consumo y adicionales pueden generar cargos. | DigitalOcean Basic 4 GiB/2 vCPU aparece a USD 24/mes y 4,000 GiB de transferencia. Impuestos, región, backups y add-ons deben confirmarse al ordenar. Precio consultado el 12-oct-2026: [tabla oficial](https://www.digitalocean.com/pricing/droplets). |

Los precios son referencias publicadas, no una cotización ni autorización de compra. No incluyen dominio, correo transaccional, impuestos o costos del proyecto Supabase. Supabase Testing está en organización/plan externo a esta decisión; no se consultó su facturación.

### Recursos y límites de exportación

El ensayo previo local de 500 filas registró picos aproximados de RSS de 252 MiB para XLSX y 215 MiB para PDF; dos generadores simultáneos alcanzaron alrededor de 339 MiB. Son mediciones del arnés de generación, no del proceso completo de Next ni del hosting final. Para el piloto, mantener un proceso de aplicación y lease global a la vez; asignar una VM de 4 GiB y no permitir más de una exportación global activa. El proceso Node puede limitarse con `NODE_OPTIONS=--max-old-space-size=2048`, pero esto limita heap V8 y no RSS total; medir el RSS real durante aceptación.

Vercel puede dar una función de 2 GiB por defecto, con tamaño máximo sujeto a plan. El buffer del archivo actual cae muy por debajo de 4.5 MB en benchmark, pero los límites deben verificarse con datos centinela y respuesta real. En ambos hosts, el lease caduca en 120 s y se renueva cada 20 s. Antes de desplegar, confirmar que la duración máxima y ciclo de transmisión no deja al proceso detenido, y verificar renovación durante una descarga lenta/cancelada. Una expiración por proceso suspendido puede permitir que otra invocación empiece; el antiguo propietario no puede renovar ni liberar el lease nuevo por token/empresa/usuario.

### Variables de entorno

| Variable | Testing | Producción | Exposición |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto `llxyziffgtqnzlguxhyt` | URL del proyecto de producción solo cuando se autorice | Pública; compile-time, no guardar secreto |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key de Testing | Publishable key de producción, separada por entorno | Pública; la RLS debe proteger todo acceso |
| `NEXT_ALLOWED_DEV_ORIGIN` | Solo para desarrollo local/tunnel; valor exacto de host, sin esquema | Omitir | No es secreto; no usar para configurar el dominio de producción |

No se detectaron otras variables de runtime requeridas por el código de aplicación. CI usa URL y key ficticias de build. No existe `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, Redis ni clave de proveedor en runtime de Next. No añadir service role a `NEXT_PUBLIC_*`; mantenerla fuera del proceso de aplicación salvo necesidad futura demostrada.

### Auth, HTTPS y cabeceras

Configurar Supabase Auth Site URL de Testing al origen HTTPS exacto del despliegue de prueba y agregar solo URLs de callback necesarias; usar dominio de producción aparte cuando se autorice. No abrir wildcards amplios ni usar HTTP. Confirmar login, refresh, logout y expiración desde navegador móvil. `@supabase/ssr` gestiona cookies; el servidor identifica al usuario mediante `auth.getUser()`. Con HTTPS, la configuración actual marca cookies `Secure`, `SameSite=Lax`, `Path=/`; verificarlo en el navegador y no copiar cookies en logs. No forzar `HttpOnly` sin revisar la compatibilidad con el cliente browser que participa en el refresh.

No hay una política común de cabeceras en `next.config.ts`. Antes de exposición pública, definir HSTS tras comprobar dominio HTTPS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, CSP compatible con scripts y `frame-ancestors`/anti-clickjacking, además de `Permissions-Policy: camera=(self)` para el escáner. Probar Safari iOS y evitar cabeceras que bloqueen ZXing/cámara.

### Variables y migraciones

La consulta remota de solo lectura se hizo únicamente al proyecto cuyo ID fue verificado como `llxyziffgtqnzlguxhyt`, nombre `QR-asistencia-testing`, estado activo, PostgreSQL 17.11. En su historial están registradas:

1. `20261011232050_distributed_report_export_rate_limit.sql`
2. `20261012030630_scanner_branch_scope_and_legacy_rpc_lockdown.sql`

No aparece `20261012050537_global_report_export_lease.sql`; está pendiente en Testing a la fecha de consulta. No se consultó producción y no se infiere su estado.

| Orden | Migración | Depende de | Estado/consumidor |
|---:|---|---|---|
| 1 | migraciones base hasta asistencia, empresas, membresías, horarios, QR y scanner | orden cronológico de migrations | prerequisito del esquema |
| 2 | `20261011232050_distributed_report_export_rate_limit.sql` | empresas, membresías, permisos y RPC de permisos | registrada Testing; API llama `consume_report_export_quota` |
| 3 | `20261012030630_scanner_branch_scope_and_legacy_rpc_lockdown.sql` | RPCs y tablas de supervisor/dispositivo/QR/asistencia | registrada Testing; requerida por seguridad del scanner |
| 4 | `20261012050537_global_report_export_lease.sql` | empresa/membresía, `private.has_company_permission`, tabla private | pendiente Testing; debe preceder a la API Next que llama los RPCs acquire/renew/release |

La migración del lease es aditiva y transaccional; crea la tabla privada y tres RPCs con `SECURITY DEFINER`, `search_path=''`, permisos revocados a `PUBLIC`, `anon`, `authenticated`, `service_role`, y `EXECUTE` concedido solo a `authenticated`, validando UID, membresía activa, rol owner/admin y permiso `reports.read`. Su revisión SQL local no sustituye la prueba aislada de aplicar y ejecutar en Testing. La API de exportación ya consume estos RPCs; desplegarla antes de migrar resulta en errores 503 y no debe hacerse.

#### Dry-run y despliegue seguro futuro

Los comandos siguientes son una guía para una futura sesión autorizada de 10B; **no se ejecutaron**. Verificar ID en CLI antes de cualquier operación y enlazar localmente solo Testing:

```sh
supabase projects list
supabase link --project-ref llxyziffgtqnzlguxhyt
supabase migration list --linked
supabase db push --linked --dry-run
```

El dry-run solo informa lo que se aplicaría. Debe mostrar exclusivamente la migración `20261012050537` pendiente (o detenerse ante cualquier otra diferencia); no ejecutar `supabase db push` en esta etapa. Después de una autorización futura y aplicación en Testing, volver a consultar `supabase migration list --linked` y comprobar la fila/versionado, las firmas y grants de los tres RPCs, RLS de la tabla privada y las pruebas de concurrencia. Supabase documenta `--dry-run` como salida de migraciones sin aplicar: [CLI `db push`](https://supabase.com/docs/reference/cli/supabase-db-push) y [workflow CLI](https://supabase.com/docs/guides/local-development/cli-workflows). No usar `db reset --linked`.

### Plan futuro de despliegue a Testing

1. Resolver acceso al CI/Actions y habilitar Docker local para repetir lease suite; revisar cualquier fallo y `git diff --check`.
2. Usar rama y build revisados, correr `npm ci`, lint, typecheck, pruebas unitarias, lease local, reportes, scanner y build. Revisar secrets/variables antes de conectar la aplicación.
3. Verificar proyecto/ref `llxyziffgtqnzlguxhyt` en Dashboard y CLI. Confirmar que el dry-run lista solo `20261012050537`; inspeccionar SQL y permisos.
4. En una ventana corta autorizada, aplicar únicamente esa migración en Testing; ejecutar pruebas SQL de lease y HTTP concurrentes, verificar fila de migración, grants, RLS, renovación, expiración, cancelación del response y rechazo por 429 sin consumir cuota.
5. Configurar variables de Testing fuera del repositorio; fijar región del compute cerca de la región Supabase (`us-east-1` para el proyecto indicado), URL de Auth y dominio HTTPS. Crear build/deployment de prueba solo tras decisión específica para 10B.
6. Hacer smoke test de sesión, API, QR, PDF/XLSX, descarga y telemetría. No conectar producción ni copiar sus datos.

### Aceptación de 10B

- Admin inicia/cierra sesión; sesión SSR refresca y `/api/me` valida Auth.
- Admin y supervisor reciben su menú/permiso esperado; roles sin permiso reciben 403.
- Cambios de empresa y sucursal quedan aislados por tenant y sucursal.
- Alta/edición/archivo de empleado y horario funciona con RLS.
- Emisión, estado, revocación y regeneración de QR/PIN funcionan; empleado inexistente y de otra empresa producen respuesta indistinguible en la API Next.
- Supervisor autoriza dispositivo/sucursal, escanea en Safari iOS, y se conserva orden de eventos entrada/comida/regreso/salida.
- Reportes filtran fechas, empresa, sucursal, empleado y estado; XLSX/PDF no mezclan datos; 0 filas produce archivos válidos.
- Exportación de 501 jornadas devuelve 413. Máximo 500 se aplica en servidor.
- Exportación paralela global devuelve 429 con `Retry-After`; otra puede continuar tras finish/cancel; cuota de frecuencia (10/5 min por usuario/empresa) se mantiene separada.
- Renovación/recuperación ante proceso detenido no permite que un propietario viejo libere el lease de uno nuevo.
- Carga lenta y cancelación de descarga verifican que el stream no libere anticipadamente el lease.
- Revisar logs por latencia de login/RPC/export, códigos 401/403/413/429/5xx, duración de generación, RSS y errores RPC, sin tokens, cookies, PIN ni credenciales.

### Healthcheck, logs y observabilidad

La Etapa 10B agregó `/api/healthz` como liveness mínimo y un evento JSON acotado para exportaciones; aún no existe un proveedor de métricas/alertas ni un despliegue HTTPS probado. Ver `[etapa-10b](#etapa-10b)` para configuración y límites.

### Rollback, respaldo y recuperación

- **Rollback de app:** detener el cambio de URL/dominio y volver a la versión anterior del contenedor/build; no borrar el deployment anterior hasta completar validación. Reestablecer variables de Testing anteriores de forma versionada fuera de Git.
- **Migración de lease:** el SQL es transaccional al aplicarse, pero no se debe asumir reversible por eso. No correr `migration repair`, `DROP` o reversión manual de objetos en la ventana. La forma segura inicial es forward fix. Para recuperar servicio mientras se investiga, volver la app al release que no llama lease sólo si se dispone de ese artefacto/commit y se acepta temporalmente restaurar la protección previa a la concurrencia; preferiblemente mantener exportaciones desactivadas por feature/ingress. El dump/restauración debe ensayarse antes de usar un restore destructivo.
- **Antes de producción:** requerir respaldo administrado reciente, prueba registrada de restauración en proyecto aislado compatible, comprobar Auth/users/config externa, objetos Storage y secrets de proveedor por separado. Guardar manifiesto/hash y duración; probar RPO/RTO en una restauración nueva. Nunca experimentar con datos reales en Testing.
- Testing actual (Free) no se presume con backup automático/point-in-time. Confirmar retención/disponibilidad con el plan contratado antes de planificar recuperación. No conectar a producción en esta etapa.

### Bloqueos y decisiones

- Protección contra contraseñas filtradas de Supabase Auth no está incluida en Free; Supabase la ofrece en Pro o superior usando HaveIBeenPwned. La documentación actual indica [password security](https://supabase.com/docs/guides/auth/password-security) y [precios](https://supabase.com/pricing). No cambiar plan: la organización debe decidir si el control es requisito de producción o aceptar mitigación temporal con política de longitud/fuerza y controles de usuario.
- `main` no tiene evidencia actual de protección obligatoria: no se pudo consultar settings de branch protection. El repositorio tiene CI para push/PR, pero la protección de CI como required check y review depende de reglas de repositorio/plan. Revisar Settings; proponer PR obligatorio, check `verify`, review para migraciones/seguridad y bloqueo de force-push/delete. No se cambiaron permisos.
- Las exportaciones se serializan globalmente, de modo que empresas concurrentes esperan/reintentan y una descarga larga ocupa el único cupo. Se conserva como decisión de lanzamiento inicial.
- Restauración de backup Auth-compatible local se documentó en etapa 9.5; no equivale a una restauración real de producción. Respaldar Auth, Storage, SMTP/OAuth, secrets, claves y URLs de redirect por procedimientos separados.
- La documentación de Etapa 9.6 registra pruebas locales anteriores 14/14 lease, 13/13 pgTAP, 16/16 reportes y 4/4 scanner. En esta sesión no se pudieron repetir pruebas que requieren Docker: socket inaccesible por permiso. Los resultados previos no se presentan como una ejecución actual.

### Verificación de cambios de esta etapa

- [x] Solo se consultó `llxyziffgtqnzlguxhyt`; no se consultó el proyecto de producción.
- [x] Estado Git local: rama `main`, HEAD igual al commit base, árbol limpio antes de los cambios.
- [x] La migración del lease está pendiente en Testing; no se aplicó.
- [x] `npm ci`: correcto; no alteró `package-lock.json`. npm avisó que lifecycle scripts de `argon2` y `unrs-resolver` requieren aprobación, pero el build usó las dependencias instaladas y terminó correctamente.
- [x] `npm run test` ejecutado dos veces: en ambas, 16 pruebas de reportes, 4 de scanner y 7 de credenciales pasaron (27/27 por ejecución; 0 fallos, 0 omitidas).
- [x] `npm run lint`, `npm run typecheck`, `npm run build` y `git diff --check`: correctos.
- [x] GitHub Actions del commit base `502db7d`: run `38209586798`, job `verify` exitoso, incluyendo instalación, lint, typecheck, reportes, lease local, scanner y build. Esta ejecución es del commit base; no valida todavía las modificaciones de Etapa 10A.
- [x] Prueba local de concurrencia `npm run test:reports:lease:local`: 14/14 comprobaciones aprobadas; incluye 13 checks pgTAP, carrera real de RPC entre empresas con JWT, burst HTTP 429, XLSX/PDF, limpieza completa y confirma que `codigo_QR` permaneció intacto. No se contactó ningún proyecto remoto.
- [x] `git ls-remote origin refs/heads/main` confirmado mediante conectividad autorizada: `main` sigue en `502db7d`, idéntico al HEAD local antes del commit.
- [x] Publicado en `main` por fast-forward normal: commit `efc1e1d9a4b61892acef01ab24538a271257daec`; `git ls-remote` confirmó el mismo SHA.
- [x] GitHub Actions run `38273543735`: job `verify` completó `success` (npm ci, lint, typecheck, reportes, credenciales, lease local, scanner y build).


---

<a id="etapa-10b"></a>


## QR-asistencia — Etapa 10B: preparación de Testing en VPS

Fecha: 2026-10-12
Commit base inspeccionado: ca3bfdeae431cbb6c9360a27d60dee927b75aea4
Supabase consultado en modo lectura: llxyziffgtqnzlguxhyt (QR-asistencia-testing)
Producción jawdrhewabqajxnswhkn: no consultada ni modificada.

### Decisión

**NO-GO para aplicar migraciones o iniciar el despliegue.** La inspección del historial remoto halló divergencias inesperadas: Testing registra enable_pgtap_test_extension, que no tiene archivo local, y 18 migraciones con versiones distintas aunque sus nombres coincidan. La única migración presente localmente y ausente en el listado remoto es 20261012050537_global_report_export_lease.sql, pero aún no puede afirmarse que sea lo único que el CLI aplicaría. No se ejecutó SQL ni se desplegó nada.

La preparación local de infraestructura sí está lista para revisión. El CLI se pudo ejecutar con telemetría desactivada, pero la consulta con --project-ref llxyziffgtqnzlguxhyt se detuvo antes de consultar por falta de SUPABASE_ACCESS_TOKEN. No ejecuté el dry-run porque primero debe resolverse el desajuste de historial.

### Inventario y compatibilidad

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

### Topología propuesta

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

### Variables y configuración

| Variable | Dónde | Valor | Secreto |
| --- | --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Build y runtime | URL de Testing | No |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Build y runtime | Publishable key de Testing | No |
| QR_ASISTENCIA_DOMAIN | Compose/Caddy | Host HTTPS del VPS | No |

Crear un archivo /etc/qr-asistencia/.env.testing fuera del repositorio, desde .env.testing.example; completar valores de Testing y aplicar chmod 600. No agregar service_role, contraseña de base de datos ni claves administrativas. La publishable key queda incluida en JS público, por diseño.

En Supabase Auth Testing configurar Site URL con el origen HTTPS exacto y permitir solo callbacks necesarios. Comprobar login, refresh y logout. La política Permissions-Policy habilita cámara al mismo origen y deniega micrófono/geolocalización. Se omite CSP estricta hasta validar recursos de Next y ZXing.

### Pasos futuros en el VPS

Requiere aprobación manual de VPS, dominio, IP y proveedor/costo; usuario Linux; Docker Engine/Compose; DNS A/AAAA; abrir TCP 80/443 y SSH 22 limitado a IP administrativa; bloquear 3000 y puertos de base de datos; usar llaves SSH y actualizaciones de seguridad.

En un checkout exacto del commit autorizado:

~~~sh
cp .env.testing.example .env.testing
chmod 600 .env.testing
## Completar localmente URL/key de Testing y el dominio real.
docker compose --env-file .env.testing -f compose.testing.yml config --quiet
docker compose --env-file .env.testing -f compose.testing.yml build
docker compose --env-file .env.testing -f compose.testing.yml up -d --scale app=1
docker compose --env-file .env.testing -f compose.testing.yml ps
curl --fail --silent --show-error https://HOST_REAL/api/healthz
~~~

Validar /login, cabeceras, cookies Secure, cámara en Safari iOS/Chrome Android y descargas completas y canceladas. Añadir una descarga lenta para comprobar renovación del lease y flushing del proxy.

Firewall: entrada TCP 22 solo desde IP administrativa, TCP 80/443 públicos, UDP 443 opcional para HTTP/3; denegar el resto. Mantener 3000 en localhost y no exponer Docker socket. Usar SSH keys, deshabilitar login root y password SSH según política, aplicar parches y reinicios controlados.

### Salud, logs y observación

/api/healthz comprueba liveness, no disponibilidad de Postgres/Auth/migraciones. Docker lo consulta cada 30 s. La ruta de exportación registra JSON con ID aleatorio, formato, estado, duración del handler y RSS; omite URL, filtros, empresa/usuario, cookies, PIN, token QR, JWT y archivo. El tiempo del handler no incluye necesariamente toda la descarga; Caddy registra duración HTTP y el lease queda sujeto al consumo/cancelación.

Durante aceptación revisar compose logs, compose ps y docker stats. Investigar 5xx, RSS sostenido sobre 70% del límite, unhealthy, 413, 429 y fallos de lease. Caddy filtra query, Referer, User-Agent y enmascara IP. Rotación Caddy: 10 MiB por archivo y 5 archivos; configurar también rotación del log de app en el host y vigilar espacio. No hay proveedor de métricas/alertas; hasta elegirlo, requiere inspección operativa diaria.

### Estado de migraciones y dry-run

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

### Aceptación y rollback

Orden: resolver drift; CI y build de imagen; autorización de hosting/dominio/secretos Testing; dry-run que muestre solo lease; autorización explícita de migración; aplicación/verificación en Testing; pruebas HTTP, pgTAP y concurrencia; desplegar la imagen; aceptación de roles, empleados, QR/PIN, asistencia, filtros, XLSX/PDF, 401/403 A/B, 413 a 501, 429, stream lento/cancelado y reinicio.

Para fallo de app, volver al tag anterior conservado, no usar latest. Si el lease no está disponible, deshabilitar exportaciones mientras se investiga. Tras una migración, preferir una migración forward; no asumir reversibilidad transaccional ni ejecutar DROP/migration repair. Restaurar solo en una base nueva e aislada, tras haber ensayado backup/restore.

### Verificación de esta etapa

- Base inicial: rama main, SHA ca3bfdeae431cbb6c9360a27d60dee927b75aea4; árbol limpio. GitHub Actions del commit base tuvo éxito.
- Testing se consultó por ID confirmado y se detectó drift; no hay dry-run ni SQL aplicado.
- El socket Docker no estaba accesible inicialmente; build de imagen/Compose aún no está verificado.
- Después de habilitar acceso al daemon local: build Docker con Node 22.23.3 completó; healthcheck de contenedor y /api/healthz respondieron 200; /login respondió 200; un smoke test dentro de la imagen generó PDFKit y ExcelJS y halló Helvetica.afm. Compose config y Caddyfile validaron con variables .invalid. Se usaron valores ficticios, no hubo conexiones Supabase remotas.
- Suite nueva de infraestructura: 3/3; reportes: 16/16; scanner: 4/4; credenciales: 7/7. Suite aislada local del lease: 14/14, incluidos 13 checks pgTAP, JWT, export HTTP y limpieza; el arnés confirmó que codigo_QR preexistente no cambió. npm ci, lint, typecheck, build y git diff --check pasaron. npm ci observó 5 High en el árbol de build; el npm prune --omit=dev del runtime informó 0 vulnerabilidades. No se ejecutó auditoría npm detallada en esta etapa.
- `npm ci` de imagen generó advertencia de motor @zxing/library bajo Node 22; el build de la aplicación sí pasó. Prueba móvil real pendiente.
- No se desplegó, contrató infraestructura, cambió plan ni consultó producción.
- Decisión: NO-GO migración por drift; NO-GO VPS hasta reconciliar historial, obtener dry-run inequívoco, autorización para aplicar lease y probar HTTPS/descargas y cámara en dispositivo real.


---

<a id="etapa-10e"></a>


## QR-asistencia — resultado de aplicación del lease en Testing

Fecha: 2026-10-12
Proyecto objetivo: Supabase Testing de QR-asistencia.
Producción: no consultada ni modificada.

### Resultado

**GO completado en Testing.** Se aplicó exclusivamente `20261012050537_global_report_export_lease.sql` mediante Supabase CLI 2.120.0. No se desplegó frontend ni se modificó ninguna otra migración.

La sesión de Management API de Supabase CLI no estaba presente. Se usó el modo soportado `--db-url` de la misma CLI, autenticando contra el host de base de datos de Testing. La contraseña se leyó del archivo local protegido y nunca se imprimió.

### Controles previos

- El proyecto fue verificado por ID antes de operar: nombre `QR-asistencia-testing`, estado `ACTIVE_HEALTHY`, PostgreSQL 17.11. El identificador del proyecto se omite en este informe publicado.
- El archivo local de contraseña tenía modo `600`; no se mostró su contenido.
- El respaldo real preexistente de Testing mantuvo permisos restrictivos; `pg_restore --list` terminó correctamente. Su ruta, tamaño y checksum se omiten. Se conservó sin sobrescribir.
- La restauración real de ese respaldo a una instancia PostgreSQL 17.11 aislada y la revisión de ACL/propietarios habían sido verificadas antes de esta ejecución; no se repitieron ni se usaron datos sintéticos como sustituto.
- La copia temporal alineó los 21 registros remotos con sus archivos y añadió únicamente el lease pendiente. Los SQL históricos de Git permanecieron intactos.
- `supabase migration list --db-url` mostró 21 versiones locales/remotas coincidentes y una nueva versión local pendiente.
- `supabase db push --dry-run --skip-vault` enumeró exclusivamente `20261012050537_global_report_export_lease.sql`.

### Aplicación e historial

La CLI aplicó:

```text
20261012050537_global_report_export_lease.sql
```

El historial posterior de Testing contiene las 21 versiones anteriores y `20261012050537 global_report_export_lease`; el total quedó en 22. No se utilizó `migration repair`, `--include-all`, `db reset` ni una operación manual del historial.

SHA-256 del archivo SQL local aplicado: `ccc1248fb2f41135927feba853f8ca588e4bd471bff05eacaeecbf8f6ee1d7b2`.

### Seguridad comprobada

- `private.report_export_leases` existe, tiene RLS habilitada y propietario `postgres`.
- ACL directa de la tabla: solo el propietario tiene privilegios. `anon`, `authenticated` y `service_role` no tienen `SELECT`, `INSERT`, `UPDATE` ni `DELETE` efectivos.
- Los RPC `acquire_report_export_lease(uuid,uuid,integer)`, `renew_report_export_lease(uuid,uuid,integer)` y `release_report_export_lease(uuid,uuid)` existen como `SECURITY DEFINER`, pertenecen a `postgres` y tienen `search_path` vacío.
- Los tres RPC permiten `EXECUTE` a `authenticated`; `anon` y `service_role` no tienen `EXECUTE` efectivo.

### Prueba funcional sintética

Se comprobó que no había un lease activo antes de la prueba. Se usaron dos usuarios Auth, dos empresas y membresías admin sintéticas dentro de una transacción que terminó con rollback. Las identidades solo se representaron en los claims locales de la sesión SQL; esto no fue una prueba HTTP ni una autenticación JWT real.

Pasaron estas comprobaciones del RPC:

1. Empresa A adquirió el lease global vacío.
2. Empresa B fue rechazada mientras A conservaba el lease, con tiempo de reintento positivo.
3. B no pudo renovar ni liberar el lease de A.
4. A renovó su propia concesión.
5. Al expirar la concesión sintética, B pudo adquirirla.
6. El token anterior de A no pudo renovar ni liberar la concesión nueva de B.
7. B liberó su propia concesión.

La expiración se simuló ajustando las marcas de tiempo de la fila sintética dentro de la transacción, respetando la restricción `expires_at > acquired_at`; no se esperó el vencimiento real de 60 segundos. La segunda adquisición RPC se probó mientras el lease de A seguía vigente. No se ejecutó una carrera concurrente de dos conexiones ni un benchmark HTTP de dos instancias Next.js.

La consulta posterior confirmó cero usuarios, empresas y membresías sintéticas, cero filas de lease y ningún lease activo. La tabla queda vacía tras la prueba. Las primeras dos iteraciones del arnés se revirtieron sin persistencia: una encontró correctamente el bloqueo de asignación directa del rol `owner`, y otra respetó la restricción de orden temporal. El arnés se ajustó usando rol `admin` y fechas de expiración válidas; la comprobación final pasó.

### Limpieza y límites

- Se conservó el respaldo original protegido.
- Se retiró la copia temporal de migraciones alineadas fuera del repositorio.
- No hubo cambios en migraciones históricas ni en código de aplicación. Este informe se publica como documentación junto con la guía de la Etapa 10F.
- No se validó la generación/streaming XLSX/PDF desde Next.js, el rate limit, ni carreras HTTP entre instancias; esta ejecución verificó la migración, los privilegios y el comportamiento RPC del lease.
- No se accedió a producción ni se desplegó frontend.

### Estado final

**Migración aplicada correctamente en Testing.** Las comprobaciones de historial, RLS, ACL, propietarios, funciones y ciclo de lease terminaron satisfactoriamente. No se realizó ninguna operación en producción.


---

<a id="etapa-10f"></a>


## QR-asistencia — Etapa 10F: preparación del despliegue en Testing

Fecha: 2026-10-12
Alcance: revisión y plan reproducible. No se contrató ni configuró infraestructura, no se cambió DNS, no se desplegó la aplicación y no se consultó producción.

### Estado

Los artefactos de infraestructura de la Etapa 10B existen: `Dockerfile`, `compose.testing.yml`, `Caddyfile.testing`, `.env.testing.example`, `.env.example` y `/api/healthz`. La migración del lease se aplicó y verificó en Testing en la Etapa 10E. Esto actualiza el estado de migraciones que aparece en el informe histórico 10B; las otras observaciones de 10B no se reinterpretan aquí.

**Preparación: lista para completar con datos del hosting. Inicio del despliegue: NO-GO hasta recibir y validar VPS, dominio/DNS, acceso SSH y valores públicos de Supabase Testing.** No se requiere una clave `service_role`, contraseña PostgreSQL ni credencial administrativa en el VPS.

### Revisión de la infraestructura existente

- `Dockerfile`: Node.js 22 sobre Debian slim, build de Next.js, usuario no root, heap V8 de 2 GiB, verificación del archivo AFM de PDFKit y healthcheck. Las variables públicas de Supabase se insertan durante el build y deben apuntar a Testing para esta imagen. No hay carpeta `public/` que falte copiar en el árbol actual.
- `compose.testing.yml`: una instancia de app, límite de 3 GiB y 2 CPU, puerto 3000 enlazado solo a loopback, y Caddy en 80/443. La respuesta de la app no expone el puerto 3000 públicamente. Los certificados y configuración de Caddy viven en volúmenes Docker.
- `Caddyfile.testing`: HTTPS automático para el nombre configurado, proxy de baja latencia y tiempo de transmisión extendido; registra solicitudes con filtros de query, referer, user-agent e IP. Las cabeceras incluyen `Permissions-Policy` para la cámara del mismo origen.
- `.env.testing.example`: contiene marcadores de ejemplo para URL/key de Testing y dominio; no contiene valores de cuenta. `.env.example` es para desarrollo y añade `NEXT_ALLOWED_DEV_ORIGIN`, que no se debe usar en el VPS.
- El código usa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. La tercera variable necesaria para Compose/Caddy es `QR_ASISTENCIA_DOMAIN`. No se identificaron variables de servicio adicionales que deban configurarse en el VPS.
- La publishable key es pública por diseño. No añadir `service_role`, JWT, password de base de datos ni credenciales de Auth al entorno, build args, logs o bundle.

#### Pendientes de infraestructura antes de una operación estable

1. Las imágenes de Node y Caddy usan tags móviles (`node:22-bookworm-slim` y `caddy:2`). Para builds reproducibles, fijar versiones exactas y, al cerrar el release, sus digests. Registrar también el digest de la imagen de la aplicación.
2. Caddy limita la rotación de sus logs, pero `app` no declara límites de logs. Antes de dejar el VPS en operación, configurar rotación para el driver `json-file` de `app` o una política equivalente en Docker.
3. El healthcheck solo comprueba que Next responda; no comprueba Supabase Auth, RPC ni migraciones. Las pruebas de disponibilidad de servicios externos deben ser checks operativos separados.
4. El build de Next se ejecuta en la etapa Docker y no se midió en el VPS definitivo. Si se construye allí, vigilar memoria y disco durante `docker compose build`; como alternativa, preparar una imagen OCI para la arquitectura exacta del VPS en un builder autorizado.
5. Los benchmarks anteriores de exportación no sustituyen la prueba en el VPS. Conservar una réplica, el límite de 500 jornadas y el lease global de una exportación activa. Las exportaciones de empresas diferentes comparten ese único cupo.

### Requisitos mínimos por confirmar

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

### Datos necesarios para reservar el procedimiento

El usuario debe facilitar en el canal apropiado (sin enviar contraseñas ni claves aquí):

1. Proveedor/instancia de VPS ya autorizada, región, sistema operativo, arquitectura, IP pública y memoria/disco contratados.
2. Dominio y subdominio que se asignará, confirmación de acceso a su DNS y si el VPS tiene IPv6 operativo.
3. Usuario Linux y método SSH habilitado; IP o rango desde el que se restringirá SSH.
4. Procedimiento aprobado para dar acceso de solo lectura al repositorio privado desde el VPS, o entrega de imagen OCI.
5. URL y publishable key de Testing disponibles directamente en el servidor mediante un gestor seguro o archivo local protegido. No pegarlas en el chat.

### Procedimiento reproducible cuando esos datos estén listos

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

#### Rollback de aplicación

Mantener el commit y digest anterior. Ante fallo, volver al checkout/tag anterior, aplicar el entorno Testing existente y recrear solo `app` con una réplica; conservar volúmenes de Caddy y no tocar la base. La migración del lease debe estar antes que la API que la invoca; 10E confirma que ya está aplicada en Testing. Si el fallo es de base o de permisos, detener exportaciones y diagnosticar; no revertir metadata ni borrar tablas. No desplegar ningún cambio a producción desde este procedimiento.

### Comprobaciones de publicación

- El repositorio confirmado por GitHub es privado y su `main` coincide con el HEAD base al preparar esta guía.
- `[etapa-10e](#etapa-10e)` se saneó antes de publicarlo: se retiraron refs de proyectos y metadatos identificables del respaldo; no contiene contraseñas, tokens, claves ni datos laborales.
- Este informe no contiene valores reales de entorno. Los archivos `.env.testing` y cualquier credencial quedan fuera de Git.
- El push de esta documentación debe iniciar CI. Registrar aquí el SHA publicado y el resultado del workflow al finalizar.

### Decisión

**NO-GO para iniciar el despliegue ahora.** La configuración local ya existe y la migración de Testing está lista, pero faltan los datos y accesos del VPS/dominio, la clave de acceso de solo lectura al repositorio o método de imagen, y la configuración real de Auth/entorno para ese origen. Cuando se reciban, completar los controles previos, fijar imágenes y rotación de logs, ejecutar el procedimiento y pruebas de aceptación; no tocar DNS ni servidor antes de la autorización correspondiente.


---
<a id="migration-reconciliation-10c"></a>

## QR-asistencia — Reconciliación de migraciones, Etapa 10C

Fecha: 2026-10-12
Repositorio/HEAD inspeccionado: `main`, `aa518fe400c4d8c24ac7100beebe34b3b0d82cbd`
Testing consultado solo en lectura: `llxyziffgtqnzlguxhyt` (`QR-asistencia-testing`, PostgreSQL 17.11, activo).
Producción `jawdrhewabqajxnswhkn`: no consultada ni modificada.

### Decisión

**NO-GO para el dry-run remoto en esta ejecución; NO-GO para aplicar migraciones.** La comprobación CLI se detuvo antes de contactar la base por falta de sesión. La simulación local pasó; el dry-run remoto requiere que el usuario autentique la CLI localmente y vuelva a autorizar esa lectura. No se modificó historial, SQL ni esquema remoto.

La estrategia aplicada mantuvo intactos los archivos históricos de `main` y simuló el historial en una copia temporal local; el dry-run local dejó pendiente solo `20261012050537_global_report_export_lease.sql`. El dry-run remoto aún requiere credenciales CLI seguras.

### Estado de Git, CI y herramientas

- `git status`: `main`, árbol limpio; HEAD es el commit base indicado.
- GitHub Actions del commit base: workflow `CI`, resultado **success** (run 38276393610).
- `origin` apunta al repositorio privado esperado. `git ls-remote origin refs/heads/main` no pudo resolver `github.com` desde este entorno; no se alteró Git.
- Supabase CLI local: **2.120.0**. Se consultó la ayuda real de `db push`, `start` y `migration list`. `db push --dry-run` está disponible y declara que imprime las migraciones pendientes sin aplicarlas.
- Para evitar intentos de escritura en `~/.supabase`, todas las llamadas de CLI se hicieron con `SUPABASE_TELEMETRY_DISABLED=1`.
- `SUPABASE_ACCESS_TOKEN` no está configurado en este proceso.
- `docker info` inicialmente falló por acceso al socket local; con autorización de acceso elevado se usó Docker Desktop 29.7.2 solo para la simulación desechable. El stack temporal usó PostgreSQL 17 de Supabase. Se comprobó que los recursos de `codigo_QR` no cambiaron y se retiraron contenedores/volúmenes/red del proyecto temporal.
- Hay binarios `psql`/PostgreSQL 18 instalados en el host; no se usaron como sustituto de PostgreSQL 17.

### Historial de Testing verificado

Consulta de solo lectura por el conector Supabase, después de verificar el ID del proyecto: **21 registros**, PostgreSQL 17.11. PgTAP está instalado en el esquema `extensions`, versión 1.3.3.

| Local (archivo/version) | Testing (versión registrada) | Resultado |
| --- | --- | --- |
| `20261011003946` `multi_tenant_attendance` | `20261011211051` | nombre coincide; versión difiere |
| `20261011004021` `harden_attendance_rls_indexes` | `20261011211055` | nombre coincide; versión difiere |
| `20261011004205` `attendance_periods_and_rls` | `20261011211058` | nombre coincide; versión difiere |
| `20261011004350` `explicit_tenant_write_policies` | `20261011211101` | nombre coincide; versión difiere |
| `20261011004418` `consolidate_admin_read_policies` | `20261011211104` | nombre coincide; versión difiere |
| `20261011005201` `bootstrap_owner_and_review_adjustments` | `20261011211107` | nombre coincide; versión difiere |
| `20261011005250` `index_bootstrap_owner_reference` | `20261011211110` | nombre coincide; versión difiere |
| `20261011161700` `no_employee_hard_delete` | `20261011211112` | nombre coincide; versión difiere |
| `20261011163001` `schedule_management` | `20261011211115` | nombre coincide; versión difiere |
| `20261011163215` `enforce_labor_rule_effective_periods` | `20261011211120` | nombre coincide; versión difiere |
| `20261011163633` `schedule_aware_attendance_snapshots` | `20261011211123` | nombre coincide; versión difiere |
| `20261011163737` `cap_assignments_to_schedule_validity` | `20261011211131` | nombre coincide; versión difiere |
| `20261011163826` `schedule_advisor_indexes_rls` | `20261011211135` | nombre coincide; versión difiere |
| `20261011182929` `safe_schedule_rule_deletion` | `20261011211138` | nombre coincide; versión difiere |
| `20261011182937` `employee_qr_credentials` | `20261011211143` | nombre coincide; versión difiere |
| `20261011184307` `supervisor_mobile_scanner` | `20261011211146` | nombre coincide; versión difiere |
| `20261011200400` `fix_supervisor_scanner_context_nullable_device` | `20261011211149` | nombre coincide; versión difiere |
| `20261011212752` `attendance_calculation_consistency` | `20261011211200` | nombre coincide; versión difiere |
| `20261011232050` `distributed_report_export_rate_limit` | `20261011232050` | nombre y versión coinciden |
| `20261012030630` `scanner_branch_scope_and_legacy_rpc_lockdown` | `20261012030630` | nombre y versión coinciden |
| — | `20261011211215` `enable_pgtap_test_extension` | solo Testing |
| `20261012050537` `global_report_export_lease` | — | solo local; pendiente en Testing |

Resumen: 20 nombres compartidos, 18 versiones diferentes; dos nombres/versiones coincidentes. La comparación previa confirmó que el SQL de las 20 migraciones compartidas es equivalente ignorando únicamente espacios exteriores. El historial conserva las sentencias en `supabase_migrations.schema_migrations.statements`.

### PgTAP y cambios de esquema

La migración registrada solo en Testing se llama `enable_pgtap_test_extension`. El catálogo de extensiones de Testing confirma `pgtap` 1.3.3 instalado en `extensions`. El SQL histórico se recuperó mediante una consulta de solo lectura a `supabase_migrations.schema_migrations.statements` en Testing: `create extension if not exists pgtap with schema extensions;`. La copia temporal 10D incorpora esa sentencia exacta, sin aplicarla en remoto. PgTAP es infraestructura de pruebas y no es un cambio funcional de la aplicación, pero sí debe representarse como registro existente en la simulación.

Las consultas de lectura confirmaron inventarios de tablas y funciones en `public` y `private`, RLS activado en las tablas `public` y en las tablas privadas de credenciales, autorización de dispositivos y rate limit. También aparecieron tablas privadas `bootstrap_requests` y `device_token_hashes` con RLS desactivado; pertenecen a un esquema privado, pero esta inspección parcial no equivale a comprobar todas las políticas, grants, exposición de API y definiciones de cada objeto.

No se pudo probar la ausencia de cambios de esquema fuera de las migraciones: faltó un `db diff`/dump estructural verificable y el acceso de CLI no estaba autenticado. Los datos observados no demuestran por sí solos que todo el esquema vivo corresponda exactamente a esos 21 SQL. No ejecutar comandos de escritura para resolver esa incertidumbre.

### Estrategia de reconciliación recomendada

No renombrar las 18 migraciones en `main`. Sus versiones pueden ser parte del historial de otros entornos (incluida Producción, que queda fuera de este alcance). Un simple cambio de timestamp en Git no modifica el historial remoto, y podría provocar que otro entorno intente repetir DDL histórico.

En una copia temporal fuera del repositorio:

1. Copiar `supabase/config.toml`, `supabase/migrations/` y lo necesario para la simulación. Asignar un `project_id` temporal único y puertos libres. Mantener esa copia separada de `codigo_QR`.
2. Conservar el contenido byte por byte y mapear los 20 nombres comunes a las versiones listadas arriba. Validar que el mapeo sea uno a uno y que ningún timestamp choque.
3. Incorporar `20261011211215_enable_pgtap_test_extension.sql` con la sentencia histórica recuperada. Ejecutarla únicamente en el stack local desechable, nunca en Testing para alinear el historial.
4. Levantar una instancia Supabase local desechable con PostgreSQL 17. Aplicar en ella el conjunto ya alineado de 21 migraciones. Después copiar la migración del lease a la copia temporal y ejecutar `supabase db push --local --dry-run`.
5. Exigir que la salida enumere únicamente `20261012050537_global_report_export_lease.sql`; además comprobar con `migration list --local` que las 21 versiones previas están registradas y que no se repite DDL histórico.
6. Guardar la salida sanitizada y destruir únicamente el stack/volúmenes identificados por el `project_id` temporal.

**Simulación local ejecutada.** Se creó un workdir y proyecto temporales fuera del repositorio, con puertos únicos. Se copiaron sin cambios los 20 SQL comunes y se renombraron solo dentro de la copia a los 20 timestamps de Testing. Se aplicaron en el stack local esos SQL más la misma sentencia pgTAP que ahora se recuperó del historial remoto. Luego se añadió la migración de lease a la copia y se ejecutó `supabase db push --local --dry-run`. La salida se validó automáticamente: solo contenía `20261012050537_global_report_export_lease`; `migration list --local` contenía las 21 versiones previas y no volvió a listar timestamps originales de los SQL comunes. Duración total observada: aproximadamente 51 segundos. Resultado: **21 migraciones históricas simuladas, lease único pendiente, cero migraciones históricas pendientes/reaplicadas**. El script comprobó la parada y ausencia de recursos temporales, así como la invariancia del stack `codigo_QR`; el workdir se eliminó.

La simulación demuestra el comportamiento del CLI con el mapa propuesto, no que el esquema vivo remoto carezca de drift fuera de las migraciones. Tampoco valida el SQL de lease en una base Testing. No usar `migration repair` para corregir metadata ni `db reset`, `db push` o `db pull` contra un proyecto remoto.

### Autenticación CLI y futuro dry-run remoto

La CLI necesita una sesión de Management API y, según operación, conectividad/credenciales de base de datos. En esta ejecución `SUPABASE_ACCESS_TOKEN` estaba ausente; `supabase migration list --project-ref llxyziffgtqnzlguxhyt --workdir <copia-temporal>` terminó con `AccessTokenRequiredError`, antes de consultar la base. No se suministró ni imprimió ningún secreto. El usuario debe iniciar sesión localmente con `SUPABASE_TELEMETRY_DISABLED=1 ./node_modules/.bin/supabase login` (flujo de navegador/terminal); no copiar un Personal Access Token al chat, shell history, repositorio o logs. Un PAT representa el alcance de la cuenta/organización que lo creó y no debe asumirse limitado a un proyecto; comprobar rol y alcance antes de usarlo.

Después de completar `supabase login` y recibir autorización para la consulta remota:

1. Autenticar localmente con `SUPABASE_TELEMETRY_DISABLED=1 ./node_modules/.bin/supabase login` y verificar por el canal seguro de Supabase que la sesión es la esperada.
2. Confirmar el project ref con `supabase projects list` y el panel del proyecto; detenerse si no coincide literalmente con `llxyziffgtqnzlguxhyt`.
3. En una copia temporal cuyo historial esté alineado, ejecutar `SUPABASE_TELEMETRY_DISABLED=1 supabase migration list --project-ref llxyziffgtqnzlguxhyt`.
4. Solo si el resultado reproduce las 21 versiones esperadas, ejecutar `SUPABASE_TELEMETRY_DISABLED=1 supabase db push --project-ref llxyziffgtqnzlguxhyt --dry-run`.
5. Si solicita credencial de DB, obtenerla y usarla solo por el prompt/gestor seguro local; no pasarla como argumento visible. Detenerse ante cualquier salida distinta de una única migración de lease.
6. No ejecutar `db push` sin `--dry-run`. La autorización de despliegue de migración debe ser independiente.

El paso 2 puede mostrar metadatos de otros proyectos; evitarlo si se puede validar el ref en el panel de Testing. No consultar bases ajenas. En 10D el project ref se verificó por ID con Supabase: `QR-asistencia-testing`, `llxyziffgtqnzlguxhyt`, PostgreSQL 17.11. Sin embargo, el dry-run remoto no se ejecutó porque faltó sesión CLI.

### Validaciones y cierre

- Ejecutado: `git status`, inspección de HEAD/remoto, `git diff --check` inicial, ayuda de CLI 2.120.0, consultas remotas de solo lectura al proyecto Testing, verificación pgTAP y estado de CI del commit base.
- Ejecutado en 10D: CLI 2.120.0 y `--help` de login, migration list y db push; proyecto Testing verificado por ID; consulta de `statements` confirmó el SQL pgTAP exacto. La copia temporal incluyó 22 archivos SQL (20 históricos comunes byte idénticos, pgTAP recuperado y lease); frente a las 21 entradas remotas, la única diferencia local fue el lease. Los 20 SQL comunes quedaron byte idénticos a los originales locales; el archivo pgTAP contiene la sentencia exacta recuperada del historial remoto. Copia temporal eliminada.
- La simulación CLI local previa terminó con el lease como única pendiente; usó la misma sentencia pgTAP que ahora quedó confirmada por el historial remoto.
- No ejecutado: CLI migration list remoto por error de autenticación, dry-run remoto, migración, pruebas de app, lint/typecheck/build (cambio solo documental).
- No hubo escrituras remotas ni acceso a Producción.
- Etapa 10C fue publicada en `f289621ca5f3848c3e4a3f433927f11bbc212dcd`; esta actualización 10D está pendiente de commit/push y CI.

**GO/NO-GO del dry-run remoto:** **NO-GO hasta autenticar la CLI localmente**. Tras `supabase login`, verificar Testing por ID/ref, leer historial y ejecutar únicamente `supabase db push --dry-run` con el `--workdir` temporal alineado. Detenerse ante cualquier ref o migración adicional, error de autenticación o prompt inesperado. La aplicación del lease requiere autorización independiente.

---
