# Etapa 9 — auditoría de seguridad y preparación

Fecha: 11 de octubre de 2026. Referencia: `2d06438d705000de936321747393a0f6ced3a945`.

## Estado y límites de verificación

La auditoría se hizo sobre el árbol local y el proyecto Supabase aislado `QR-asistencia-testing` (`llxyziffgtqnzlguxhyt`). El proyecto principal `jawdrhewabqajxnswhkn` no se consultó ni modificó. El proyecto aislado no tenía empresas, membresías ni datos de asistencia. No se crearon usuarios ni registros para completar esta auditoría.

Antes de la corrección, `npm audit` reportó siete paquetes afectados: cinco High en una sola cadena de desarrollo y dos Moderate (`exceljs` y `uuid`) en producción. Tras el override y la actualización del lockfile, `npm audit` reporta cinco High, todos en desarrollo; `npm audit --omit=dev` reporta cero. No hay advisories moderados de producción en el árbol final.

## Dependencias vulnerables

| Hallazgo disponible | Alcance y ruta | Reachability en esta aplicación | Corrección segura verificada |
| --- | --- | --- | --- |
| `braces@3.0.3`, High, GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 | Dev: `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`. npm muestra cinco paquetes afectados en esta cadena, con una causa raíz. | No se carga en el runtime de producción. Se ejecuta con herramientas de lint/build; el código de aplicación no entrega patrones externos a `braces`. Una contribución maliciosa que ya se ejecuta en CI queda dentro del riesgo del proceso de build. | Sin versión corregida. npm solo ofrece `eslint-config-next@14.2.35`, downgrade incompatible con Next.js 16.4.0. No hay override seguro para `braces`; se documenta como pendiente solo de desarrollo. |
| `exceljs@4.4.0` + `uuid@8.3.2`, Moderate, GHSA-w5hq-g745-h8pq / CVE-2026-41907 — corregido | Producción; ExcelJS declara `uuid@^8.3.0`, y npm cuenta ambos paquetes afectados. | Afectaba `v3`, `v5`, `v6` con buffer/offset externo. El código de ExcelJS usado aquí importa solo `v4` para emitir UUIDs. | Override anidado `exceljs.uuid = 11.1.1`. Verificado en workspace temporal y en instalación del proyecto. La versión 11 mantiene exportaciones CommonJS; las pruebas de exportación pasan. `npm audit --omit=dev` reporta cero. |

Referencias primarias: [advisory de braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [advisory de uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq), [advisory de tmp](https://github.com/advisories/GHSA-ph9p-34f9-6g65), [incidencia de actualización de dependencias de ExcelJS](https://github.com/exceljs/exceljs/issues/3055).

No se ejecutó `npm audit fix --force` ni se degradó ExcelJS o Next.js. `uuid@8.3.2` no se llama directamente desde el código del proyecto; el override de UUID está limitado a ExcelJS. `npm audit` final devuelve código 1 por los cinco hallazgos High de desarrollo, y `npm audit --omit=dev` termina correctamente con cero.

## Exportaciones PDF y Excel

- `GET /api/reports/export` exige una sesión validada en el servidor y rol `owner` o `admin` mediante `resolveAdminScope`. El `companyId` se valida contra membresías activas; las consultas filtran por la empresa autenticada y también quedan sujetas a RLS. Un ID de otra empresa recibe 403.
- El rango acepta fechas reales y limita a 366 días. Las exportaciones usan el tope de 5,000 jornadas; si exceden ese tope responden 413 antes de generar el archivo.
- Excel evita fórmulas en texto que comienza con `=`, `+`, `@`, `-` o controles. PDF neutraliza CR/LF/tabulaciones y elimina caracteres fuera de su rango soportado en celdas. Los nombres de descarga se normalizan y acotan.
- Se generan buffers completos en memoria (`writeBuffer` y acumulación de chunks PDF); 5,000 jornadas es un tope finito, pero la memoria máxima no se midió en un host de producción. Medir RSS con 5,000 filas realistas antes de habilitar exportaciones de gran volumen y bajar el límite si el runtime del host lo exige.
- La integración existente comprueba cuatro hojas, XLSX legible, PDF válido/vacío y escape de fórmulas. La nueva prueba HTTP autenticada está preparada, pero no se pudo ejecutar: faltan cuentas autenticadas y fixtures en el proyecto aislado vacío.

## APIs, sesiones y mitigaciones

- Los clientes servidor/navegador usan la publishable key; no hay `service_role` en rutas del navegador. Las APIs administrativas llaman `auth.getUser()` y comprueban rol/permisos; el middleware/proxy refresca cookies. Cookies `httpOnly` provienen de Supabase SSR, `sameSite=lax` y `secure` sobre HTTPS/producción.
- Las rutas de reportes validan fechas, UUID, estado y empresa. El escáner verifica origen, sesión y autorización del dispositivo. La emisión QR usa limitación temporal en la función SQL; no se encontró limitador distribuido genérico para APIs de reportes y exportación. Recomendación: agregar rate limit compartido (p. ej. Redis/servicio de rate limit) si el despliegue es multi-instancia; el rate limit en memoria local no protegería todos los procesos.
- En el proyecto de prueba el asesor Supabase encontró: (a) 3 tablas del esquema `private` con RLS activa sin políticas, (b) 17 funciones `SECURITY DEFINER` ejecutables por `authenticated`. La consulta de grants confirmó que `authenticated` tiene `USAGE` en `private`, `anon` no; no encontró grants directos a tablas privadas para `anon`/`authenticated`. Funciones `private` y de `public` incluyen rutinas protegidas de asistencia, escáner, QR/PIN, permisos y borrado; el linter avisa por ser invocables, no demuestra por sí mismo bypass. Deben revisarse cuerpos y permisos de cada función; retirar ejecución solo donde no sea intencional, con migración nueva y prueba aislada. No se cambiaron grants ni RLS.
- El proyecto aislado tiene RLS activa en las tablas públicas revisadas. No se probaron respuestas autenticadas ni el aislamiento HTTP entre dos empresas por falta de cuentas/fixtures. Los hallazgos del asesor pertenecen al proyecto de prueba, no son una inspección reciente de producción.

## CI y pendientes antes de producción

`.github/workflows/ci.yml` ejecuta lint, typecheck, pruebas unitarias de reportes/escáner y build en push y pull request. El build usa URL y publishable key ficticias; no requiere secretos de Supabase ni contiene pasos de despliegue.

Antes de producción:

1. Resolver el High de `braces` cuando exista una versión corregida o compatible de `eslint-config-next`; no bajar Next.js para silenciar el reporte.
2. Con usuarios y datos exclusivamente de prueba, ejecutar `npm run test:reports:integration` con las variables `QR_TEST_*` documentadas por la prueba. Incluir dos empresas, dos administradores y un supervisor; agregar jornadas centinela para verificar contenido de exportaciones.
3. Revisar los cuerpos y grants de funciones `SECURITY DEFINER` advertidas, y decidir cuáles requieren `EXECUTE` para `authenticated`; añadir pruebas por rol antes de cambios.
4. Medir memoria y duración de PDF/XLSX en el runtime objetivo con 5,000 filas; añadir rate limiting distribuido al endpoint de exportación si queda expuesto a tráfico público.
5. Ejecutar validación manual con una sesión real en entorno de pruebas y desplegar solo tras revisión separada.

No se consideran formalmente aceptadas las vulnerabilidades pendientes; requieren decisión de riesgo del responsable antes del despliegue.
