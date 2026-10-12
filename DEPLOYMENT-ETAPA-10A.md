# QR-asistencia — Etapa 10A: infraestructura y preparación

Fecha de revisión: 2026-10-12

Commit base revisado: `502db7dd253675230b76ff17a405760eb022e920`

Supabase Testing: `llxyziffgtqnzlguxhyt` (`QR-asistencia-testing`, activo, Postgres 17.11)

Producción: no consultada ni modificada.

## Decisión

**NO-GO para iniciar el despliegue de Testing (Etapa 10B) hasta resolver dos bloqueos operativos:** (1) Docker no está accesible desde esta sesión, por lo que no se pudo volver a ejecutar el test local de concurrencia, y (2) GitHub no resolvió por DNS desde este entorno, impidiendo refrescar `origin/main`, consultar CI de forma independiente y publicar este informe. El historial de Git local está en la rama `main`, limpio, en el commit base indicado. La migración del lease aún no está aplicada en Testing.

La arquitectura sugerida para una instancia piloto es **un VPS de 4 GiB RAM, con Next.js en Node 22, Caddy como proxy TLS y una sola instancia de aplicación**. Reservar hasta 2 GiB para Node y conservar el lease de PostgreSQL con capacidad global igual a una exportación. Esta propuesta busca memoria y ciclo de respuesta previsibles; añade administración de sistema, actualizaciones y guardias operativas. No se contrató infraestructura.

Vercel es una opción razonable si se habilita el plan adecuado y se valida el streaming en una prueba de aceptación real. Sus funciones Node tienen memoria predeterminada de 2 GiB, y máximo publicado de 4 GiB en Pro/Enterprise; el payload de respuesta de funciones tiene límite de 4.5 MB. El archivo se construye en memoria como `Buffer`; el benchmark local de 500 jornadas midió XLSX 50 KB y PDF 84 KB, pero falta probar la respuesta completa en el hosting. Vercel Hobby tiene precio base USD 0, Pro USD 20/mes por plataforma con USD 20 de crédito de uso; cargos por consumo, impuestos y límites finales deben confirmarse en la cuenta antes de elegir. Referencias: [límites de Functions](https://vercel.com/docs/functions/limitations), [precios de Functions](https://vercel.com/docs/functions/usage-and-pricing), [planes Pro](https://vercel.com/docs/plans/pro-plan) y [precios Vercel](https://vercel.com/pricing).

## Inventario del proyecto

- Next.js App Router 16.4, TypeScript, React 19; CI usa Node.js 22. Next 16 requiere Node 20.9 o posterior, así que fijar Node 22 LTS en hosting; el proyecto no declara `engines` en `package.json`. [Requisitos Next.js 16](https://nextjs.org/docs/app/guides/upgrading/version-16).
- Supabase Auth con `@supabase/ssr`; cliente servidor valida identidad con `auth.getUser()` y conserva cookies SSR. Claves públicas se limitan a URL y publishable key.
- PostgreSQL con RLS y funciones RPC transaccionales. Las API routes validan scope administrativo o de supervisor antes de operar.
- El escáner usa cámara mediante navegador y endpoints Node/Next; requiere HTTPS salvo localhost.
- Exportaciones declaran runtime `nodejs`. PDFKit genera PDF y ExcelJS genera XLSX en memoria; el endpoint limita a 500 jornadas del lado del servidor y comprueba también truncamiento de consulta.
- Lease `private.report_export_leases` serializa globalmente, entre instancias y empresas. La ruta lo adquiere antes de consultar datos/cuota y lo conserva durante el stream/cancelación. Cuota aparte: 10 exportaciones por usuario/empresa en 5 minutos. No incrementar concurrencia hasta medir.
- La aplicación no persiste archivos locales: las descargas se responden directamente. No hace falta volumen persistente de aplicación.
- No se encontraron Dockerfile, Compose de aplicación, `vercel.json`, workflow de despliegue, endpoint de healthcheck ni logger/métricas estructuradas. Existe únicamente CI (`.github/workflows/ci.yml`).
- Scripts actuales: `dev`, `build` (webpack), `start`, `lint`, `typecheck`, suites de reportes, lease local y escáner. Se añadió `npm run test` como agregador unitario y una prueba de contrato de error de credenciales; CI ejecuta también esta prueba.

## Comparación de hosting

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

## Recursos y límites de exportación

El ensayo previo local de 500 filas registró picos aproximados de RSS de 252 MiB para XLSX y 215 MiB para PDF; dos generadores simultáneos alcanzaron alrededor de 339 MiB. Son mediciones del arnés de generación, no del proceso completo de Next ni del hosting final. Para el piloto, mantener un proceso de aplicación y lease global a la vez; asignar una VM de 4 GiB y no permitir más de una exportación global activa. El proceso Node puede limitarse con `NODE_OPTIONS=--max-old-space-size=2048`, pero esto limita heap V8 y no RSS total; medir el RSS real durante aceptación.

Vercel puede dar una función de 2 GiB por defecto, con tamaño máximo sujeto a plan. El buffer del archivo actual cae muy por debajo de 4.5 MB en benchmark, pero los límites deben verificarse con datos centinela y respuesta real. En ambos hosts, el lease caduca en 120 s y se renueva cada 20 s. Antes de desplegar, confirmar que la duración máxima y ciclo de transmisión no deja al proceso detenido, y verificar renovación durante una descarga lenta/cancelada. Una expiración por proceso suspendido puede permitir que otra invocación empiece; el antiguo propietario no puede renovar ni liberar el lease nuevo por token/empresa/usuario.

## Variables de entorno

| Variable | Testing | Producción | Exposición |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto `llxyziffgtqnzlguxhyt` | URL del proyecto de producción solo cuando se autorice | Pública; compile-time, no guardar secreto |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key de Testing | Publishable key de producción, separada por entorno | Pública; la RLS debe proteger todo acceso |
| `NEXT_ALLOWED_DEV_ORIGIN` | Solo para desarrollo local/tunnel; valor exacto de host, sin esquema | Omitir | No es secreto; no usar para configurar el dominio de producción |

No se detectaron otras variables de runtime requeridas por el código de aplicación. CI usa URL y key ficticias de build. No existe `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, Redis ni clave de proveedor en runtime de Next. No añadir service role a `NEXT_PUBLIC_*`; mantenerla fuera del proceso de aplicación salvo necesidad futura demostrada.

## Auth, HTTPS y cabeceras

Configurar Supabase Auth Site URL de Testing al origen HTTPS exacto del despliegue de prueba y agregar solo URLs de callback necesarias; usar dominio de producción aparte cuando se autorice. No abrir wildcards amplios ni usar HTTP. Confirmar login, refresh, logout y expiración desde navegador móvil. `@supabase/ssr` gestiona cookies; el servidor identifica al usuario mediante `auth.getUser()`. Con HTTPS, la configuración actual marca cookies `Secure`, `SameSite=Lax`, `Path=/`; verificarlo en el navegador y no copiar cookies en logs. No forzar `HttpOnly` sin revisar la compatibilidad con el cliente browser que participa en el refresh.

No hay una política común de cabeceras en `next.config.ts`. Antes de exposición pública, definir HSTS tras comprobar dominio HTTPS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, CSP compatible con scripts y `frame-ancestors`/anti-clickjacking, además de `Permissions-Policy: camera=(self)` para el escáner. Probar Safari iOS y evitar cabeceras que bloqueen ZXing/cámara.

## Variables y migraciones

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

### Dry-run y despliegue seguro futuro

Los comandos siguientes son una guía para una futura sesión autorizada de 10B; **no se ejecutaron**. Verificar ID en CLI antes de cualquier operación y enlazar localmente solo Testing:

```sh
supabase projects list
supabase link --project-ref llxyziffgtqnzlguxhyt
supabase migration list --linked
supabase db push --linked --dry-run
```

El dry-run solo informa lo que se aplicaría. Debe mostrar exclusivamente la migración `20261012050537` pendiente (o detenerse ante cualquier otra diferencia); no ejecutar `supabase db push` en esta etapa. Después de una autorización futura y aplicación en Testing, volver a consultar `supabase migration list --linked` y comprobar la fila/versionado, las firmas y grants de los tres RPCs, RLS de la tabla privada y las pruebas de concurrencia. Supabase documenta `--dry-run` como salida de migraciones sin aplicar: [CLI `db push`](https://supabase.com/docs/reference/cli/supabase-db-push) y [workflow CLI](https://supabase.com/docs/guides/local-development/cli-workflows). No usar `db reset --linked`.

## Plan futuro de despliegue a Testing

1. Resolver acceso al CI/Actions y habilitar Docker local para repetir lease suite; revisar cualquier fallo y `git diff --check`.
2. Usar rama y build revisados, correr `npm ci`, lint, typecheck, pruebas unitarias, lease local, reportes, scanner y build. Revisar secrets/variables antes de conectar la aplicación.
3. Verificar proyecto/ref `llxyziffgtqnzlguxhyt` en Dashboard y CLI. Confirmar que el dry-run lista solo `20261012050537`; inspeccionar SQL y permisos.
4. En una ventana corta autorizada, aplicar únicamente esa migración en Testing; ejecutar pruebas SQL de lease y HTTP concurrentes, verificar fila de migración, grants, RLS, renovación, expiración, cancelación del response y rechazo por 429 sin consumir cuota.
5. Configurar variables de Testing fuera del repositorio; fijar región del compute cerca de la región Supabase (`us-east-1` para el proyecto indicado), URL de Auth y dominio HTTPS. Crear build/deployment de prueba solo tras decisión específica para 10B.
6. Hacer smoke test de sesión, API, QR, PDF/XLSX, descarga y telemetría. No conectar producción ni copiar sus datos.

## Aceptación de 10B

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

## Healthcheck, logs y observabilidad

No existe ruta de healthcheck ni logging estructurado/métricas para el endpoint de exportación. Antes del despliegue público, añadir o configurar un `/api/healthz` que pruebe solo proceso y dependencias esenciales, sin revelar versión, hostname, URL o estado sensible; diferenciar liveness de readiness. Añadir eventos JSON con request ID, empresa en forma no identificable o hash limitado, formato, filas, tiempos de consulta/generación/stream, RSS y códigos de resultado; nunca registrar sesión, credenciales, token QR/PIN, owner token del lease ni payload exportado. Alertar en RPC 5xx, pérdida de lease, timeouts, RSS acercándose al límite y elevación de 429/413.

## Rollback, respaldo y recuperación

- **Rollback de app:** detener el cambio de URL/dominio y volver a la versión anterior del contenedor/build; no borrar el deployment anterior hasta completar validación. Reestablecer variables de Testing anteriores de forma versionada fuera de Git.
- **Migración de lease:** el SQL es transaccional al aplicarse, pero no se debe asumir reversible por eso. No correr `migration repair`, `DROP` o reversión manual de objetos en la ventana. La forma segura inicial es forward fix. Para recuperar servicio mientras se investiga, volver la app al release que no llama lease sólo si se dispone de ese artefacto/commit y se acepta temporalmente restaurar la protección previa a la concurrencia; preferiblemente mantener exportaciones desactivadas por feature/ingress. El dump/restauración debe ensayarse antes de usar un restore destructivo.
- **Antes de producción:** requerir respaldo administrado reciente, prueba registrada de restauración en proyecto aislado compatible, comprobar Auth/users/config externa, objetos Storage y secrets de proveedor por separado. Guardar manifiesto/hash y duración; probar RPO/RTO en una restauración nueva. Nunca experimentar con datos reales en Testing.
- Testing actual (Free) no se presume con backup automático/point-in-time. Confirmar retención/disponibilidad con el plan contratado antes de planificar recuperación. No conectar a producción en esta etapa.

## Bloqueos y decisiones

- Protección contra contraseñas filtradas de Supabase Auth no está incluida en Free; Supabase la ofrece en Pro o superior usando HaveIBeenPwned. La documentación actual indica [password security](https://supabase.com/docs/guides/auth/password-security) y [precios](https://supabase.com/pricing). No cambiar plan: la organización debe decidir si el control es requisito de producción o aceptar mitigación temporal con política de longitud/fuerza y controles de usuario.
- `main` no tiene evidencia actual de protección obligatoria: no se pudo consultar settings de branch protection. El repositorio tiene CI para push/PR, pero la protección de CI como required check y review depende de reglas de repositorio/plan. Revisar Settings; proponer PR obligatorio, check `verify`, review para migraciones/seguridad y bloqueo de force-push/delete. No se cambiaron permisos.
- Las exportaciones se serializan globalmente, de modo que empresas concurrentes esperan/reintentan y una descarga larga ocupa el único cupo. Se conserva como decisión de lanzamiento inicial.
- Restauración de backup Auth-compatible local se documentó en etapa 9.5; no equivale a una restauración real de producción. Respaldar Auth, Storage, SMTP/OAuth, secrets, claves y URLs de redirect por procedimientos separados.
- La documentación de Etapa 9.6 registra pruebas locales anteriores 14/14 lease, 13/13 pgTAP, 16/16 reportes y 4/4 scanner. En esta sesión no se pudieron repetir pruebas que requieren Docker: socket inaccesible por permiso. Los resultados previos no se presentan como una ejecución actual.

## Verificación de cambios de esta etapa

- [x] Solo se consultó `llxyziffgtqnzlguxhyt`; no se consultó el proyecto de producción.
- [x] Estado Git local: rama `main`, HEAD igual al commit base, árbol limpio antes de los cambios.
- [x] La migración del lease está pendiente en Testing; no se aplicó.
- [x] `npm ci`: correcto; no alteró `package-lock.json`. npm avisó que lifecycle scripts de `argon2` y `unrs-resolver` requieren aprobación, pero el build usó las dependencias instaladas y terminó correctamente.
- [x] `npm run test` ejecutado dos veces: en ambas, 16 pruebas de reportes, 4 de scanner y 7 de credenciales pasaron (27/27 por ejecución; 0 fallos, 0 omitidas).
- [x] `npm run lint`, `npm run typecheck`, `npm run build` y `git diff --check`: correctos.
- [x] GitHub Actions del commit base `502db7d`: run `38209586798`, job `verify` exitoso, incluyendo instalación, lint, typecheck, reportes, lease local, scanner y build. Esta ejecución es del commit base; no valida todavía las modificaciones de Etapa 10A.
- [x] Prueba local de concurrencia `npm run test:reports:lease:local`: 14/14 comprobaciones aprobadas; incluye 13 checks pgTAP, carrera real de RPC entre empresas con JWT, burst HTTP 429, XLSX/PDF, limpieza completa y confirma que `codigo_QR` permaneció intacto. No se contactó ningún proyecto remoto.
- [x] `git ls-remote origin refs/heads/main` confirmado mediante conectividad autorizada: `main` sigue en `502db7d`, idéntico al HEAD local antes del commit.
- [ ] Commit/push y Actions de este cambio: pendientes; no se han hecho todavía.
