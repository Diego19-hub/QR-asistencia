# QR-009 — Fase 3: experimento comparativo aislado

**NO-GO para merge/despliegue.** Este experimento no forma parte del PR #25 y no representa una optimización validada. QR-003 sigue P0/NO-GO.

**Base de comparación fija:** `5f41479c399f94be38a981e3443c68581fb08829` (PR #25). Reproducir en Mac local, con Chrome y Supabase **exclusivamente desechable**, el protocolo `docs/QR-009-VALIDACION-SEGURA.md`. No ejecutar flujos PIN, registrar asistencia ni llamar a `/api/attendance/scan`; no tocar Testing/Producción.

Antes de medir: comprobar con `git rev-parse HEAD`, `git status --short` y versionado del runtime. Usar igual versión de Chrome, máquina, Node, fixture, perfil, límites de red y CPU. Para cada variante correr `npm run lint`, `npm run typecheck`, las suites E2E permitidas y `QR004_CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run benchmark:qr009:local`. No ejecutar el workflow CI integral bloqueado.

Registrar para **baseline y candidato** al menos las 5 muestras por grupo de `/admin/reportes` y `/scanner`: JS transferido, transferencia total, navegación, FCP, LCP, tareas largas, fallos de red, control de origen y resultado de permisos. `cold` y `repeated-no-cache` no representan caché caliente. Nunca atribuir bytes de toda la ruta a un paquete sin desglosar sus chunks. Los valores previamente registrados (256,672 B de JS en reportes y 271,907 B en scanner) son una referencia histórica, no resultados de la nueva corrida.

**Criterio de aceptación:** no regresión observable en acceso/seguridad y mejoría consistente de bytes iniciales sin empeoramiento injustificado del tiempo de primera interacción. Si no hay datos equivalentes o el resultado es mixto, mantener el código original. El check integral de CI sigue sin aprobarse.

## Variante A — Carga diferida de Recharts

**Hipótesis:** al extraer los 5 gráficos a `reports-charts.tsx` e importar con `next/dynamic` **solo tras abrir** el panel de métricas avanzadas, la ruta inicial `/admin/reportes` puede transferir menos JS.

**Cambio experimental:** el dashboard conserva resumen, filtros, tabla, exportaciones y permisos. Al abrir el `<details>`, `onToggle` activa la importación del módulo de gráficos (no debe solicitarse antes). Las 5 series y etiquetas originales permanecen iguales.

### Comprobaciones adicionales
1. Visitar `/admin/reportes` sin abrir las gráficas: inspeccionar Network (JS) y verificar que el chunk de Recharts no se solicita.
2. Abrir «Análisis y métricas avanzadas»: esperar a que se renderice `svg.recharts-surface` y confirmar las 5 tarjetas.
3. Medir por separado el tiempo **desde el clic hasta la primera gráfica visible**; la prueba histórica reportaba solo 0 B adicionales al abrir, no medía esta latencia. Comparar el mismo procedimiento en el baseline.
4. Repetir abrir/cerrar, cambiar filtros, navegar entre páginas y revisar exportaciones sin introducir datos de asistencia.

**Estado:** código de prototipo preparado; NO se ha compilado ni medido en el entorno de autoría.
