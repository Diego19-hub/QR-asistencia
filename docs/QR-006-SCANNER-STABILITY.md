# QR-006 — Auditoría de estabilidad del escáner

## Estado

**En curso.** La corrección y sus pruebas locales están implementadas en `fix/qr-006-scanner-stability`. Falta CI del PR y validación en navegadores/dispositivos móviles físicos. QR-003 permanece P0, pospuesta y NO-GO; QR-004 y QR-005 siguen En curso.

## Alcance y aislamiento

Se revisaron `AGENTS.md`, `TASKS.md`, `docs/TESTING.md`, las skills de testing y seguridad, el componente `MobileScanner`, la página protegida del supervisor, `GET/POST /api/supervisor/scanner/context`, `isAllowedRequestOrigin`/`isCurrentContextRequest` y la suite `tests/e2e/supervisor-scanner.spec.ts`.

La validación usa el runner QR-005: proyecto Supabase local y desechable, Auth y PostgreSQL locales, usuarios/empresas/sucursales/dispositivos sintéticos, Next en loopback y Chromium con cámara simulada. El runner confirmó teardown y conservación de los recursos Docker preexistentes. No se accedió a Testing o Producción, no se aplicaron migraciones remotas y no se ejecutó `migration repair`, backup ni despliegue.

Las pruebas observan y bloquean `/api/attendance/scan`; no procesan QR, no llaman funciones de PIN ni registran movimientos de asistencia.

## Hallazgos

### Inicialización simultánea de cámara

**Confirmado, severidad funcional/media.** La inicialización anterior esperaba `decodeFromVideoDevice` sin una guarda síncrona. Con la respuesta de `getUserMedia` retenida artificialmente y dos activaciones rápidas, el runner observó cuatro invocaciones: dos fallos sintéticos de ausencia/permiso y **dos** adquisiciones para el tercer intento, cuando debía haber solo una. La prueba falló antes de la corrección con `Expected: 3, Received: 4`.

Si varias adquisiciones llegan a completarse, el componente solo conserva la última referencia de controles; la posibilidad de dejar una adquisición sin control era consecuencia del patrón observado. No se afirma que esto haya causado un acceso no autorizado ni un registro de asistencia.

### Contexto de autorización y conexión

Antes del cambio, una respuesta de contexto con error diferente de 401/403 conservaba el último contexto en memoria. La cámara podía seguir visible/activa mientras no se confirmaba de nuevo el contexto. Además, ocultar la interfaz de cámara al perder autorización no detenía por sí mismo las pistas de medios de `getUserMedia`.

Las respuestas antiguas ya se filtraban mediante `isCurrentContextRequest`; la prueba unitaria existente comprueba tanto IDs supersedidos como señales abortadas. `GET/POST` del contexto siguen validando sesión, membresía, empresa y dispositivo en el backend; esta fase no cambia sus controles ni su contrato. El guard de origen permanece intacto.

## Correcciones

- `cameraStartingRef` bloquea inmediatamente adquisiciones concurrentes, antes de que React vuelva a renderizar; el botón muestra “Abriendo cámara…” y queda deshabilitado.
- Un número de generación invalida callbacks y promesas de una apertura que terminó después de cerrar, desmontar, cambiar empresa o perder autorización. Si la promesa termina tarde, se detienen los controles y las pistas recién creadas sin actualizar el estado del componente.
- `stopCamera` y el cleanup conservan y detienen tanto los controles ZXing como las pistas `MediaStream`, incluso cuando el elemento `<video>` ya se desmontó.
- Contextos fallidos se limpian de forma fail-closed. El evento `offline` invalida solicitudes pendientes, borra contexto y lectura transitoria y detiene la cámara. `online` y `focus` revalidan el contexto con el backend.
- Los errores distinguen cámara no encontrada, permiso denegado y cámara ocupada; los intentos pueden repetirse cuando termina el error.
- El cambio de empresa borra estado de lectura y detiene la cámara antes de cambiar el contexto. La navegación a selección de empresa también desmonta el escáner y ejecuta su cleanup.

No se modificaron la política de origen, autorización de páginas/APIs, migraciones, reglas de asistencia, PIN ni rutas de registro.

## Evidencia de pruebas

### Pruebas Playwright

Comando local:

```bash
QR004_CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e
```

**Resultado: 17/17 pruebas aprobadas.** La cobertura de escáner incluye:

- ausencia sintética de cámara y permiso denegado, con mensajes diferenciados y reintento;
- doble activación mientras `getUserMedia` está demorado: una sola adquisición;
- terminación de pistas al cerrar manualmente;
- pérdida simulada de conexión: contexto y cámara se cierran; al recuperar conectividad se recarga contexto;
- revocación de dispositivo en el backend local y revalidación por evento de foco; una adquisición de cámara que concluye después de revocar se detiene;
- cambio entre dos membresías propias con cámara abierta: desmontaje y pistas terminadas;
- cero solicitudes a `/api/attendance/scan` en estos flujos.

La E2E previa a la corrección reprodujo la doble inicialización (4 llamadas frente a 3 esperadas). Los dos reruns intermedios fallaron por un selector ARIA ambiguo y por solicitar datos antes de completar el login del admin sintético; se corrigieron únicamente los tests y el resultado final pasó. En cada ejecución el runner eliminó el stack y los datos temporales, conservando recursos Docker preexistentes.

### Otras validaciones

- `npm run test:security:matrix:local`: PASS; 201 aserciones pgTAP, matrices HTTP/Auth/RLS/Server Actions y teardown local correctos. Los escenarios de dispositivos y permisos ejecutaron el backend real local.
- `npm test`: PASS, sin fallos. Una prueba de la suite de backup se omitió porque el sandbox bloqueó el socket local del agente GnuPG. Node emitió advertencias conocidas `MODULE_TYPELESS_PACKAGE_JSON`.
- `npm run test:scanner`: PASS, 6/6, incluida la protección contra respuestas supersedidas/abortadas.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS, build aislado con 41/41 páginas estáticas. Se omitió `.env.local` y se usaron valores locales ficticios para impedir conexiones externas. Next mostró su advertencia conocida de 27 archivos omitidos del output standalone porque `node_modules` se enlazó fuera del temporal.

Un intento inicial de build desde el checkout se interrumpió al observar que Next cargaba `.env.local`; no se leyó ni imprimió su contenido y no se usó esa configuración en el build aprobado. El build válido se ejecutó en una copia temporal sin archivos `.env*`.

## Límites y riesgo residual

- Chromium usa dispositivo multimedia fake y permisos concedidos por el runner; no certifica cámaras físicas, Safari/iOS, Chrome Android, cambios reales del permiso del sistema, suspensión del proceso móvil ni redes celulares.
- `focus`, `online` y el sondeo de contexto dan detección eventual; una revocación realizada en otro dispositivo se refleja al siguiente sondeo (12 segundos como máximo en la condición normal) o al regresar al foco. El backend vuelve a autorizar cada operación sensible.
- No se valida lectura/decodificación QR, escaneo repetido, idempotencia de asistencia, PIN ni lockout. Permanecen bloqueados por QR-003 y fuera de esta fase.
- La prueba local no reemplaza revisión segregada de QR-004.

**Conclusión:** las regresiones reproducibles de inicialización doble, liberación de cámara, desconexión, cambio de empresa y revocación tienen cobertura local y corrección mínima. QR-006 permanece En curso hasta CI y revisión de dispositivos móviles reales.
