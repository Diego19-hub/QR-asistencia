# QR-009 — Protocolo de revalidación segura del PR #25

Estado: **pendiente de ejecución sobre el HEAD actualizado**. Esta guía no certifica un resultado PASS; el PR permanece **NO-GO para merge** hasta satisfacer el check integral obligatorio de manera autorizada. Referencia técnica: [QR-009-RUNTIME-BENCHMARK.md](QR-009-RUNTIME-BENCHMARK.md).

## Restricciones obligatorias

- **Solo stack local desechable**, con Auth/PostgreSQL sintéticos; no utilizar Testing ni Producción, credenciales reales, enlaces remotos, `.env.local` ni migraciones remotas.
- **No ejecutar** endpoints de PIN ni `/api/attendance/scan`, ni escribir en `attendance_sessions` o `attendance_events`.
- No cambiar guardias de origen, RLS, reglas de protección, caché de aplicación, workflow integral o código de producto para facilitar una prueba.
- **No ejecutar** `npm test`, `npm run test:pin-lockout`, `npm run test:pin-lockout:db`, `npm run test:security:matrix:local` ni `npm run test:security:jwt`. Los scripts de backup/lease/integración no están autorizados por este protocolo.
- El E2E normal prueba interfaces y cámara simulada; **no** debe procesar códigos QR, verificar PIN ni registrar movimientos.
- Detenerse al primer fallo relacionado con aislamiento, solicitudes sensibles, conteos no vacíos de asistencia o teardown; no modificar las protecciones para conseguir un resultado verde.

## Precondiciones locales

1. Trabajar en `perf/qr-009-runtime-benchmark`, verificar `git rev-parse HEAD` y guardar el SHA exacto; la base examinada al redactar esta guía fue `24ae7a6215d9100fb8313885b1724c8d202c6931`.
2. Confirmar árbol limpio (`git status --short`), Node 24.x — CI usa 24.21.0 —, npm, Docker operativo, Chrome compatible y `node_modules` instalado mediante `npm ci`. La instalación no representa validación.
3. Antes de pruebas con bases locales, verificar que Docker y Supabase CLI estén disponibles; el runner debe generar su propio proyecto `qr004_disposable_*` y aislarlo de cualquier infraestructura existente.
4. No utilizar `npx supabase link` ni configurar un proyecto remoto. El runner usa `--workdir` temporal y variables locales.

## Orden de ejecución permitido

Ejecutar individualmente para atribuir resultados y detenerse ante cualquier fallo. No usar `npm test` como atajo.

```bash
git rev-parse HEAD
git status --short
node --version
npm --version
docker info
npm ci
npm run lint
npm run typecheck
npm run test:attendance
npm run test:reports
npm run test:scanner
npm run test:credentials
npm run test:employee-portal
npm run test:user-access
npm run test:auth-flow
npm run test:deployment
```

Si `npm ci` falla, detener y registrar el error exacto. No cambiar lockfile o dependencias durante este follow-up.

Tras comprobar que el stack es desechable y que el alcance E2E está permitido:

```bash
npm run test:e2e
npm run benchmark:qr009:local
```

Si Chrome no se encuentra automáticamente, se puede configurar `QR004_CHROME_BIN` con la ruta local real del ejecutable Chrome, sin agregar navegadores ni nuevas dependencias. El benchmark debe utilizar `NODE_ENV=production` con build/start aislados; el E2E ordinario conserva `development`.

## Criterios de aceptación específicos del benchmark

- 100 muestras esperadas: cinco rutas, desktop/móvil emulado y modos `cold` / `repeated-no-cache`. No confundir el modo repetido con un cache hit; `browserContext.route()` deshabilita la caché HTTP.
- Conteos `validSamples` por cada métrica; conservar `null` cuando no exista observación y no calcular percentiles para series vacías.
- Monitoreo de requests de PIN/scan registrado antes de la primera autenticación; debe reportar **cero solicitudes** en todo el recorrido.
- Comprobación del contenido total de `attendance_sessions` y `attendance_events` del proyecto local desechable, sin filtro por compañía: ambas tablas **vacías antes y después**.
- Comparación completa de snapshots previa/posterior; el conjunto de recursos temporales creado por el runner debe eliminarse incluso ante fallo.
- Consultas PostgreSQL de lectura bajo `authenticated`, JWT sintético y RLS, nunca `service_role` como rol de medición; documentar p50/p95 reales y volumen 10/100/500.
- La respuesta **403** del contexto `/scanner` sobre loopback HTTP no constituye medición de una llamada autorizada; no relajar el guard HTTPS para reemplazarla.

## Registro obligatorio de resultados

Para cada comando registrar: SHA, fecha/hora, sistema operativo, Node/npm, Chrome, duración, salida final, `PASS/FAIL/NOT RUN` y restricciones observadas. No actualizar la tabla de métricas con números anteriores presentados como nueva corrida.

| Comando | Resultado sobre HEAD | Evidencia / bloqueo |
|---|---|---|
| `npm run lint` | NOT RUN | Pendiente |
| `npm run typecheck` | NOT RUN | Pendiente |
| Suites unitarias permitidas (por separado) | NOT RUN | Pendiente |
| `npm run test:e2e` | NOT RUN | Pendiente |
| `npm run benchmark:qr009:local` | NOT RUN | Pendiente |
| GitHub Actions CI integral | NO-GO | Incluye pruebas PIN y escrituras de asistencia fuera de alcance |

**Regla de cierre:** las validaciones locales permitidas no sustituyen el check requerido de GitHub Actions. El PR debe permanecer abierto, sin merge ni despliegue; QR-003 sigue P0/NO-GO.
