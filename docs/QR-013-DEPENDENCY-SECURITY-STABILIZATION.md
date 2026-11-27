# QR-013 — Estabilización de seguridad de dependencias

Fecha: 27 de noviembre de 2026

Rama: `fix/dependency-security-stabilization`

Commit base: `e0c144be1a5473f8d7af368f632521c8d3b9f150`

## Alcance y decisión

La intervención corrige el rango de Next.js reportado por npm sin cambiar código de aplicación ni actualizar dependencias ajenas al framework. Se seleccionó Next.js **16.4.6**: npm lo lista como `latest`, es un release estable de la línea activa 16.x y contiene los parches de seguridad publicados en 16.4.5. Se pareó `eslint-config-next` en la misma versión para mantener sincronizadas las reglas y el plugin del framework. La página oficial de Next.js identifica 16.4.5 como release de seguridad; GitHub lista 16.4.6 como release estable posterior con correcciones de errores. [Anuncio oficial de seguridad](https://nextjs.org/blog/november-2026-security-release), [release 16.4.6](https://github.com/vercel/next.js/releases/tag/v16.4.6), [paquete npm](https://www.npmjs.com/package/next).

El release 16.4.6 también incluye compresión automática para respuestas de Route Handlers que no estén ya comprimidas. Se validó después con un build de producción aislado de Next 16.4.6 y una ruta local de 24 KB: `curl --raw -H 'Accept-Encoding: gzip'` recibió HTTP 200 con `Content-Encoding: gzip`. El test se ejecutó en loopback y sus archivos temporales se retiraron. No fue una comprobación a través de Caddy.

No se cambió React, React DOM, Supabase SSR, TypeScript, Node, Docker, middleware/proxy, App Router, reglas laborales, asistencia, Auth, SQL o RLS. No se ejecutó `npm audit fix --force`.

## Línea base y resultados

Se capturó la línea base antes de modificar dependencias en la rama de corrección, usando únicamente el proyecto local. El build recibió la URL y publishable key ficticias que define CI; no hizo consultas a Supabase.

| Verificación | Antes: Next 16.4.3 | Después: Next 16.4.6 | Resultado |
|---|---|---|---|
| `npm audit --json` | 8 paquetes moderados: Next y cadena TypeScript-ESLint/minimatch | 7 paquetes moderados, todos en herramientas de desarrollo | El advisory agregado de Next desaparece; quedan avisos de desarrollo. Npm devuelve exit 1 por esos avisos. |
| `npm audit --omit=dev --json` | 1 paquete moderado: `next` | 0 vulnerabilidades | Advisory de runtime resuelto; después devuelve exit 0. |
| `npm ls next` / árbol directo | `next@16.4.3` | `next@16.4.6`, `eslint-config-next@16.4.6` | Árbol resuelto sin dependencia inválida. React 19.2.8, React DOM 19.2.8, `@supabase/ssr` 0.12.7 y TypeScript 5.9.3 no cambian. |
| `npm test` | Exit 0 | Exit 0 | Todas las suites del script terminan correctamente; se omite la prueba de ciclo criptográfico GnuPG porque el sandbox niega el socket del agente. Persisten advertencias de Node sobre módulos TS tipados como ESM. |
| `npm run lint` | Exit 0 | Exit 0 | Sin errores. |
| `npm run typecheck` | Exit 0 | Exit 0 | Sin errores. |
| Build con variables públicas ficticias | Exit 0; Next 16.4.3 | Exit 0; Next 16.4.6 | Compilación y TypeScript correctos; genera 44/44 páginas. |
| E2E y SQL | No ejecutados antes del cambio | Aprobados en la continuación local | Ver comandos, resultados y límites en «Docker, SQL, E2E y exportaciones». |

El build ejecutado fue:

```sh
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci_placeholder \
npm run build
```

La aplicación usa cookies/consultas dinámicas en rutas de negocio; el build no contactó el host ficticio. La salida conservó el aviso del uso experimental de `serverActions`, ya presente en la configuración del proyecto.

## Advisories

Antes del cambio, `npm audit` agrupaba estos siete advisories de Next como una vulnerabilidad moderada del paquete `next`, en el rango 16.0.0–16.4.4, y un conjunto de avisos moderados de desarrollo asociados a `minimatch` y TypeScript-ESLint. `npm audit --omit=dev` confirmaba que Next era el único paquete afectado del árbol de producción.

| Advisory de Next.js | Área | Resultado en 16.4.6 |
|---|---|---|
| [GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h) | Aislamiento de caché/root params con `unstable_cache` y `use cache` | Fuera del rango afectado |
| [GHSA-vc7v-qv4w-wrv8](https://github.com/advisories/GHSA-vc7v-qv4w-wrv8) | Fuga entre root params en caché anidada | Fuera del rango afectado |
| [GHSA-7qx7-33qx-rqx2](https://github.com/advisories/GHSA-7qx7-33qx-rqx2) | Rechazo de SVG en el optimizador de imágenes | Fuera del rango afectado |
| [GHSA-f3mh-rxg3-f5g2](https://github.com/advisories/GHSA-f3mh-rxg3-f5g2) | Header interno de cookies en rutas Edge | Fuera del rango afectado |
| [GHSA-pc58-hwjq-p385](https://github.com/advisories/GHSA-pc58-hwjq-p385) | Framing de respuesta comprimida en respuesta proxy | Fuera del rango afectado |
| [GHSA-rhh4-g77r-r9qj](https://github.com/advisories/GHSA-rhh4-g77r-r9qj) | Argumentos binarios en `use cache` | Fuera del rango afectado |
| [GHSA-vvgp-ww4w-46vf](https://github.com/advisories/GHSA-vvgp-ww4w-46vf) | Cache poisoning de shared fallback shells | Fuera del rango afectado |

**Diferencia de clasificación:** `npm audit` y GitHub Advisory Database agregan los avisos anteriores bajo severidad moderada para `next`; el anuncio oficial de Next.js denomina de alta severidad el aviso GHSA-mfr8-8qww-v76h y moderados a los demás. Se registra la discrepancia; la versión afectada y el parche indicado coinciden. La auditoría completa posterior deja 7 paquetes moderados solo en la cadena de desarrollo (`minimatch`/TypeScript-ESLint), sin advisories de producción. Esos avisos no se incluyeron en esta actualización acotada.

## Cambios de dependencias

| Paquete | Anterior | Nuevo | Motivo |
|---|---:|---:|---|
| `next` | `^16.4.3` (lock: 16.4.3) | `^16.4.6` (lock: 16.4.6) | Salir del rango afectado; versión estable parcheada más reciente revisada. |
| `eslint-config-next` | `^16.4.3` (lock: 16.4.3) | `^16.4.6` (lock: 16.4.6) | Mantener la configuración de ESLint sincronizada con Next. |

El lockfile actualiza además las entradas transitivas del mismo release: `@next/env`, `@next/eslint-plugin-next` y paquetes binarios SWC opcionales de Next. No hubo cambios a otras dependencias directas.

## Docker, SQL, E2E y exportaciones

Validación ejecutada el 27 de noviembre de 2026 en la rama `fix/dependency-security-stabilization`. `docker info` confirmó servidor Docker 29.9.3, arquitectura `aarch64`, 10 CPU y 7.748 GiB; contexto `desktop-linux`. Al inicio había 47 contenedores (39 activos, 8 detenidos), 40 volúmenes y 10 redes. La suma observada de memoria de contenedores era 5.354 MiB. Se identificaron stacks Supabase preexistentes y el proyecto local `codigo_QR`; no se detuvo ni eliminó ninguno. Al terminar, los inventarios seguían en 47/40/10 y el proyecto local conservó sus contenedores. No se ejecutó `docker system prune` ni se eliminaron volúmenes preexistentes.

| Comando | Resultado observado |
|---|---|
| `npm run test:security:matrix:local` | Pasó. 11 archivos pgTAP pasaron (319 aserciones en total: 37, 49, 29, 40, 26, 14, 18, 20, 31, 15 y 40); matriz HTTP/Auth, tenant, asistencia, scanner, invitaciones y Server Actions reportó PASS. Stack y datos temporales retirados; recursos Docker preexistentes preservados. |
| `npm run test:security:invitation-onboarding:local` | Pasó. Reejecutó la base de pruebas anterior y validó alta y reenvío de invitación, usuarios nuevos/existentes, confirmación de identidad, contraseña, aceptación de una sola vez, replay, revocación y efectos laterales; todos los bloques reportaron PASS y el stack temporal se limpió. |
| `npm run test:security:rpc-ci:local` | Pasó: 138/138 aserciones pgTAP (50 + 26 + 62) en la suite RPC aislada; stack temporal retirado. |
| `npm run test:security:phase10-residual:local` | Pasó: 59/59 aserciones; runner confirmó transacciones/fixtures y limpieza del stack temporal. |
| `npm run test:security:authorization-races:local` | Pasó: 243 aserciones de concurrencia, revocación y Server Actions; sin asistencia, QR o PIN; stack temporal retirado. |
| `npm run test:e2e` | Pasó: Playwright 36/36 con un worker; stack Supabase/Next local temporal retirado y recursos preexistentes preservados. La cámara se simula; el registro operativo real QR/PIN/asistencia sigue fuera de esta suite. |
| `npm run test:reports:lease:local` | Pasó: 17/17 checks. Incluye 13 pgTAP checks del lease, reportes JSON HTTP por tenant, descargas PDF y XLSX con verificación de contenido y aislamiento, autorización, rate/concurrency, consumo del cuerpo y liberación del lease. Limpió contenedores/redes/volúmenes temporales y comprobó que el stack preexistente `codigo_QR` siguiera igual. |
| Probe HTTP de compresión, build aislado con Next.js 16.4.6 | `next build --webpack` pasó; una ruta App Router local de 24 KB respondió HTTP 200 con `Content-Encoding: gzip` a `Accept-Encoding: gzip`. El primer armado temporal falló porque omití el layout raíz; agregué el layout y la ejecución repetida pasó. No se modificó el proyecto para crear el probe. |

Las suites usan un proyecto Supabase de ID aleatorio, puertos disponibles, endpoints loopback, migraciones locales y datos sintéticos; eliminan las variables Supabase heredadas antes de llamar al CLI y verifican los recursos Docker previos. Los puertos publicados preexistentes no colisionaron. La prueba aislada de compresión valida el servidor Next local, pero no reproduce Caddy ni valida una respuesta real de exportación bajo compresión a través del proxy.

Aunque E2E pase, no declara validada integralmente la asistencia: la suite automatizada usa cámara simulada y omite la confirmación real QR/PIN/registro de movimientos. La aceptación física permanece fuera de esta misión.

## Riesgos y límites

- Persisten siete advisories moderados agrupados en dependencias de desarrollo; npm indica que hay corrección disponible, pero se dejan para una revisión separada de la cadena ESLint/TypeScript-ESLint.
- No se ejecutó `npm ci` desde un árbol vacío. `npm install` sincronizó `package.json` y `package-lock.json`; `npm ls` verificó las versiones instaladas y no reportó dependencias inválidas.
- Npm mostró una advertencia de `allow-scripts` para `argon2` y `unrs-resolver`; `npm config get ignore-scripts` devolvió `false`, `argon2` pasó una operación de hash local y las pruebas/build pasaron. La instalación limpia en CI sigue siendo la verificación final de lifecycle scripts.
- La negociación gzip de Route Handlers quedó validada en el runtime local de Next.js 16.4.6; sigue pendiente observar la compresión de una exportación real atravesando Caddy en un entorno de despliegue local.
- No se consultó ni modificó Supabase Testing/Producción, no se aplicaron migraciones remotas, no se publicaron artefactos y no se realizó commit, push, merge o despliegue. Las migraciones se aplicaron a bases locales desechables durante las pruebas.
- Producción continúa **NO-GO**.

## Estado de QR-013

**En curso — validaciones SQL/E2E y HTTP de exportación completadas localmente.** Producción sigue **NO-GO**. El commit permanece sin crear; la rama solo contiene cambios locales revisables.
