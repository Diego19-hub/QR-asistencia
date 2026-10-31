# QR-009 — Fase 4: comparación local de experimentos

**Estado:** sin JSON reales adjuntos; todavía no hay evidencia de mejora cuantificada. **NO-GO** para merge/despliegue; QR-003 P0/NO-GO y CI integral obligatorio bloqueado.

## Tres commits fijados

- Baseline (PR #25): `5f41479c399f94be38a981e3443c68581fb08829`
- Recharts: `0889ab9ba1a79c9854d062800f173b746dd5b716`
- ZXing: `92ef1507a6c9d798a7613e7d09c85f3c72aba5d8`

La aprobación local de ambos prototipos es **reportada por el desarrollador**; los JSON y logs no han sido adjuntados. No atribuir métricas históricas a un commit nuevo.

## Ejecución recomendada en Mac — un solo comando

Desde el repositorio, con Git limpio, Chrome instalado, Docker Desktop funcionando y dependencias (`node_modules`) disponibles:

```bash
git status --short
git fetch origin
git switch analysis/qr-009-phase4-comparison  # si no existe localmente, usar: git switch --track origin/analysis/qr-009-phase4-comparison
git pull --ff-only origin analysis/qr-009-phase4-comparison
node --test scripts/qr009-phase4-run.test.mjs
node scripts/qr009-phase4-run.mjs --check
node scripts/qr009-phase4-run.mjs
```

El script **no hace fetch, push, merge, despliegues ni cambios a ramas remotas**. Comprueba que el árbol Git esté limpio, que los tres SHA existan localmente, que Docker use un socket Unix local, que Chrome esté disponible y que las dependencias existan. Cambia *temporalmente* el HEAD local (modo detached) para cada benchmark, verifica el SHA, conserva los tres JSON en un directorio privado nuevo bajo `TMPDIR` y regresa a la rama inicial incluso tras un fallo. Si se interrumpe abruptamente, comprobar `git status` y volver manualmente a `analysis/qr-009-phase4-comparison`.

**Seguridad:** usa solamente `npm run benchmark:qr009:local` de las ramas existentes con Auth y PostgreSQL local desechable. No ejecuta `npm test`, `test:pin-lockout`, `test:security:matrix:local`, QR/PIN/scan, ni pruebas contra Testing/Producción. Retira variables de entorno ajenas al benchmark. Exige la evidencia de snapshots **vacíos** de `attendance_sessions/events`, cero solicitudes PIN/scan y limpieza del stack antes de aceptar cada corrida; ante fallo no realiza la siguiente.

**Archivos que genera:**
- `baseline.json`, `recharts.json`, `zxing.json`: 100 muestras cada uno, exclusivamente estadísticas agregadas del harness, sin cookies ni identidades.
- `comparison.md`: diferencias descriptivas de JS, navegación, FCP y LCP por perfil, calculadas por el comparador.
- `manifest.json`: commits, versiones y resultados de verificaciones de las tres corridas.

Los archivos quedan **fuera del repositorio** para evitar subir resultados por accidente. Compartir solo `comparison.md` y `manifest.json` tras revisarlos; no compartir otros logs, credenciales ni trazas.

## Limitaciones y criterio de decisión

El benchmark tiene únicamente 5 muestras por grupo y la caché HTTP está deshabilitada por `browserContext.route()`; una visita `repeated-no-cache` no es un cache hit. La diferencia entre rutas no atribuye bytes a Recharts/ZXing. En Recharts, además de bytes, debe medirse la experiencia de primera apertura; el JSON actual **no mide** tiempo del clic al gráfico. En ZXing no se mide cámara autorizada ni cámara lista, ya que el guard HTTPS responde 403 en loopback HTTP; **no relajar el guard**.

Si los tres JSON no pasan integridad o muestran resultados no concluyentes, no adoptar ninguna optimización. Una comparación descriptiva positiva, por sí sola, no autoriza integración: hay que revisar seguridad, funcionalidad, regresiones y CI obligatorio separado. PR #25 continúa abierto sin merge.
