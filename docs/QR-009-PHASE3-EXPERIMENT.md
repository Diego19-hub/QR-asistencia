# QR-009 — Fase 3: experimento comparativo aislado

**NO-GO para merge/despliegue.** Este experimento no forma parte del PR #25 y no representa una optimización validada. QR-003 sigue P0/NO-GO.

**Base de comparación fija:** `5f41479c399f94be38a981e3443c68581fb08829` (PR #25). Reproducir en Mac local, con Chrome y Supabase **exclusivamente desechable**, el protocolo `docs/QR-009-VALIDACION-SEGURA.md`. No ejecutar flujos PIN, registrar asistencia ni llamar a `/api/attendance/scan`; no tocar Testing/Producción.

Antes de medir: comprobar con `git rev-parse HEAD`, `git status --short` y versionado del runtime. Usar igual versión de Chrome, máquina, Node, fixture, perfil, límites de red y CPU. Para cada variante correr `npm run lint`, `npm run typecheck`, las suites E2E permitidas y `QR004_CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run benchmark:qr009:local`. No ejecutar el workflow CI integral bloqueado.

Registrar para **baseline y candidato** al menos las 5 muestras por grupo de `/admin/reportes` y `/scanner`: JS transferido, transferencia total, navegación, FCP, LCP, tareas largas, fallos de red, control de origen y resultado de permisos. `cold` y `repeated-no-cache` no representan caché caliente. Nunca atribuir bytes de toda la ruta a un paquete sin desglosar sus chunks. Los valores previamente registrados (256,672 B de JS en reportes y 271,907 B en scanner) son una referencia histórica, no resultados de la nueva corrida.

**Criterio de aceptación:** no regresión observable en acceso/seguridad y mejoría consistente de bytes iniciales sin empeoramiento injustificado del tiempo de primera interacción. Si no hay datos equivalentes o el resultado es mixto, mantener el código original. El check integral de CI sigue sin aprobarse.

## Variante B — Carga diferida de ZXing

**Hipótesis:** reemplazar la importación estática de `BrowserQRCodeReader` por `await import("@zxing/browser")` únicamente al solicitar la apertura de cámara puede disminuir los bytes JS iniciales de `/scanner`.

**Cambio experimental:** se mantiene el tipo `IScannerControls`, la validación de contexto autorizado y el control de generación; tras el `await import` se verifica nuevamente que la cámara sigue solicitada y autorizada para evitar aperturas tardías o revocadas.

### Comprobaciones adicionales
1. Visitar `/scanner` **sin abrir cámara** y comparar JS transferido con el baseline.
2. Inspeccionar que la descarga del decoder ocurre solo tras pulsar «Abrir cámara» en un contexto **sintético autorizado**.
3. Comprobar la revalidación de `cameraGenerationRef`, `cameraStartingRef` y `contextAuthorizedRef` si el usuario cierra, cancela o pierde autorización durante la importación.
4. Si se realiza prueba interactiva, usar exclusivamente cámara falsa **sin códigos QR ni tokens**, nunca verificar PIN ni registrar asistencia; medir tiempo desde clic hasta cámara lista contra baseline con el mismo dispositivo/fixture.
5. Conservar errores de cámara, desmontaje, revocación de dispositivos, limpieza de pistas y navegación entre empresas.

**Estado:** código de prototipo preparado; NO se ha compilado ni medido en el entorno de autoría.
