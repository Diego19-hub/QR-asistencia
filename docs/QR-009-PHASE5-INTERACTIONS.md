# QR-009 — Fase 5: interacciones reales con recursos sintéticos (aislado)

**Estado:** pruebas E2E instrumentadas, **sin ejecutar en este entorno de autoría**. No representan autorización para merge. QR-003 P0/NO-GO y CI integral pendiente.

## Propósito

- **Recharts**: comparar 5 muestras de **clic en «Análisis y métricas avanzadas» a primer SVG visible**, en baseline `5f41479` y variante `0889ab9`. Se miden JS acumulado antes del clic y bytes JS transferidos después.
- **ZXing**: comparar 3 muestras de **clic «Abrir cámara» a aparición de «Cerrar cámara»**, en baseline `5f41479` y variante `92ef150`. El botón «Cerrar cámara» indica que el componente pasó a estado `cameraActive` tras iniciar el lector; **no** mide la primera lectura QR ni precisión en dispositivo físico.
- **ZXing (solo variante)**: simular una descarga detenida del chunk dinámico mientras el administrador revoca el dispositivo local, confirmar que no se abre la cámara después de liberar la descarga y que no se envían solicitudes de PIN/scan.

## Aislamiento y límites

Las pruebas usan el runner existente `npm run test:e2e`, con proyecto Supabase local desechable, Auth sintético, dispositivo de supervisor autorizado mediante el flujo **real** de aprobación local, cámara falsa Chrome (`--use-fake-device-for-media-stream`) y el guard de orígenes del fixture existente. No cambian producción, guard HTTPS, RLS, migraciones ni CI.

Cada prueba protege explícitamente el endpoint de registro `/api/attendance/scan` y rutas PIN, y exige cero solicitudes observadas. Nunca se muestran códigos QR ni se envían PIN; no se crean sesiones/eventos de asistencia. La prueba de cámara sí crea y revoca un **dispositivo de prueba** en la base desechable (no constituye escritura de asistencia). Si falla un test, consultar estado de limpieza del runner y no continuar sin confirmarlo.

## Procedimiento reproducible en Mac

Ejecutar **una rama a la vez**. Todas las ramas de fase 5 parten de commits ya existentes; no fusionar ni publicar PR:

| Rama de Fase 5 | Derivada de | Pruebas |
|---|---|---|
| `experiment/qr-009-phase5-baseline` | `5f41479` | gráfica + cámara |
| `experiment/qr-009-phase5-recharts` | `0889ab9` | gráfica |
| `experiment/qr-009-phase5-zxing` | `92ef150` | cámara + carrera de revocación durante importación |

```bash
git fetch origin
git status --short
git switch --track origin/experiment/qr-009-phase5-baseline
npm run lint
npm run typecheck
QR004_CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:e2e
```

Si la rama ya existe localmente, usar `git switch experiment/qr-009-phase5-baseline`, sin `--track`. Repetir `git switch` y las mismas tres validaciones para `experiment/qr-009-phase5-recharts` y luego `experiment/qr-009-phase5-zxing`. Conservar las salidas de terminal.

El runner E2E local ejecuta además las 22 pruebas existentes permitidas de Playwright (sin scan/PIN). **NO** ejecutar `npm test`, `test:pin-lockout`, `test:security:matrix:local` ni `test:security:jwt`.

Las pruebas imprimen líneas `QR009_PHASE5_RECHARTS`, `QR009_PHASE5_SCANNER` y, solo ZXing, `QR009_PHASE5_ZXING_REVOKED_CHUNK`. Guardar esas líneas y los resultados generales PASS/FAIL, **sin publicar** credenciales, URLs completas ni logs brutos. Comprobar el teardown local al terminar.

## Criterios de interpretación

- Comparar **tiempo de primera apertura** dentro del mismo equipo, versión Chrome y carga de trabajo; tomar nota de que estas son solo 5 (gráficas) y 3 (cámara) muestras por variante, por lo que las diferencias pequeñas son exploratorias.
- El tiempo medido por DOM solo refleja **aparición de un SVG con dimensiones** y **estado listo del botón de cámara**. No sustituye observabilidad del usuario ni métricas físicas reales.
- Los campos de bytes usan PerformanceResourceTiming; el guard de orígenes deshabilita caché HTTP. El presupuesto inicial ya probado en Fase 4 fue Recharts −39.3% y ZXing −46.0%.
- Si la descarga del chunk ya está precargada o la carrera no logra detener un recurso, la prueba debe **fallar**, no simular éxito ni modificar seguridad para conseguirlo.
- No integrar ninguna optimización hasta revisar evidencia de regresiones, pruebas E2E y CI integral obligatorio. QR-003 sigue siendo P0/NO-GO.

## Evidencia pendiente

`lint`, `typecheck`, E2E de las ramas de Fase 5 y métricas de interacción: **NOT RUN en este entorno**. Validación estática de archivos preparada.
