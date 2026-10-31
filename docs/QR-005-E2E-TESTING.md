# QR-005 — Pruebas E2E con Playwright

## Estado

**En curso.** Esta primera entrega incorpora infraestructura reproducible y una matriz inicial de navegador para autenticación, roles, selección de empresa, portal de empleado y autorización del dispositivo del supervisor. La cobertura completa de asistencia permanece bloqueada por QR-003 y no se declara cerrada QR-004.

## Arquitectura

`playwright.config.ts` ejecuta Chromium secuencialmente con timeout explícito, un worker y reintento únicamente en CI. La suite se organiza por área en `tests/e2e/{auth,permissions,company-selection,employee-portal,supervisor-scanner}.spec.ts`, con fixtures y validación de entorno compartidas en `fixtures/` y `helpers/`. Los flujos de autenticación usan formularios reales de Next.js; las operaciones administrativas de preparación usan únicamente APIs locales y usuarios sintéticos.

Los comandos `npm run test:e2e` y `npm run test:e2e:local` reutilizan el bootstrap aislado de `tests/qr004-auth-matrix.local.integration.mjs` en modo `--e2e-only`. `npm run test:e2e:ui` inicia la interfaz de Playwright dentro del mismo stack desechable:

1. Crea un ID aleatorio y un directorio temporal fuera del repositorio.
2. Copia el manifiesto SQL y la configuración, reasigna puertos libres y arranca Supabase local sin enlazar un proyecto remoto.
3. Ejecuta `db reset --local`; no lee `.env.local` ni secretos alojados.
4. Comprueba que Supabase API/DB, Next, Mailpit y navegador se limiten a loopback.
5. Crea empresas, sucursales, membresías y usuarios Auth sintéticos. La clave `service_role` solo existe en memoria en el bootstrap y no se transmite al proceso Playwright.
6. Copia `src/` a un directorio Next temporal y arranca el servidor con valores Supabase exclusivamente locales.
7. Playwright bloquea solicitudes del navegador a cualquier origen distinto de Next y Supabase locales.
8. Al terminar, detiene Next, solicita `supabase stop` con el ID desechable, comprueba que no queden contenedores/volúmenes/redes de ese ID y que los recursos preexistentes sigan presentes, y elimina el temporal.

El modo `--e2e-only` omite los pgTAP y la matriz HTTP completa para evitar duplicar la etapa existente de QR-004. Sí aplica localmente las migraciones canónicas a la base desechable para que la aplicación funcione con el esquema actual.

## Requisitos y comandos

- Node de CI: 24.21.0; Chromium/Chrome instalado por CI o por Playwright local.
- Docker y Supabase CLI fijado en el proyecto.
- Instalación npm normal: `npm ci`.
- Local: `npm run test:e2e`.
- En macOS, si Chromium de Playwright no está instalado, puede usarse Chrome existente: `QR004_CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e`.
- CI: paso E2E aislado en `.github/workflows/ci.yml`, usando Chrome del job.
- Otras validaciones: `npm run test:security:matrix:local`, `npm test`, `npm run lint`, `npm run typecheck` y `npm run build`.

Los datos temporales nunca se guardan en el repositorio. La configuración desactiva capturas, video y traces porque podrían contener sesiones, cookies o datos. El reporter solo emite resultados de pruebas; el directorio de salida queda dentro del temporal y se elimina en teardown.

## Cobertura inicial

| Área | Casos E2E del navegador |
|---|---|
| Sesión y panel | Acceso anónimo a rutas protegidas; contraseña inválida; login admin real; cierre de sesión/cookie HttpOnly; dashboard con empresa sintética, navegación y recuperación al reintentar una falla de red simulada. |
| Roles | Administrador, supervisor y empleado en su destino; roles insuficientes; identidades sin membresía, membresía inactiva y membresía de empleado inactiva. |
| Empresas | Usuario admin con dos empresas, cambio explícito, datos del tenant seleccionado y rechazo de una membresía de otra identidad. |
| Portal | Empleado vinculado con datos sintéticos de su empresa; portal sin expediente; rechazo de acceso a administración/escáner; cierre de sesión y revocación de membresía. |
| Escáner/dispositivo | Supervisor con/sin sucursal; selección del contexto entre dos empresas; solicitud, aprobación, revocación del dispositivo y revocación de membresía. |
| Cámara y red | Cámara simulada sin dispositivo, permiso denegado, cámara ocupada y restricciones incompatibles; adquisición demorada, cierre/liberación, revocación tardía, pérdida/recuperación de red y errores HTTP contextualizados. Comprobación de respuestas antiguas y viewport de 320/390/430/768 px. Se comprueba que no se invoque `/api/attendance/scan`. |

Los tests usan selectores accesibles de roles, nombres y labels. No dependen de orden global; cada prueba crea un contexto de navegador nuevo. Las identidades se crean para una ejecución y la base se destruye completa.

## Límite de seguridad de QR-003

Esta fase **no** lee/decodifica QR, no solicita ni verifica PIN, no llama `private.verify_employee_pin`, no envía PIN incorrectos, no ejecuta lockout ni confirma entrada, salida o descansos. La prueba de cámara termina antes del endpoint de escaneo y afirma que `/api/attendance/scan` no fue solicitado. Los movimientos de asistencia completos siguen bloqueados mientras QR-003 permanezca pospuesta, P0 y NO-GO.

La autorización del dispositivo y la cámara fake no simulan una asistencia completa ni certifican cámaras físicas, navegadores móviles reales o comportamiento de red celular. El backend Auth, API y PostgreSQL usados para permisos son locales reales y desechables.

## CI y diagnósticos

El workflow conserva todas las suites existentes y agrega un paso separado para `npm run test:e2e`. CI usa un worker y un reintento. No se publican archivos de diagnóstico; capturas, videos y trazas están apagados. Los logs de fallos se redactan para eliminar las contraseñas/identidades sintéticas que el bootstrap pasa al proceso de pruebas.

## Criterios pendientes

- **Ejecución QR-006 (2026-10-30):** `QR004_CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e` pasó 22/22 en Chromium en 1.6 minutos con Supabase local desechable. El runner confirmó teardown y conservación de recursos Docker preexistentes.
- **Hallazgo de UI QR-005:** la prueba interactiva con un 503 sintético del endpoint dashboard reprodujo que el dashboard conservaba el mensaje de error después de una consulta válida de reintento. Causa: el estado `error` no se limpiaba en el camino exitoso del efecto. Se corrigió limpiándolo cuando se recibe una respuesta válida y la regresión E2E pasa. Severidad funcional: baja; el panel mantenía el estado visual de error y ocultaba los datos hasta actualizar la vista.
- **Regresión y calidad (2026-10-30):** `npm run test:security:matrix:local` finalizó con éxito: 201 aserciones pgTAP, matrices HTTP/Auth/Server Actions y teardown local verificado. `npm test`: 80 aprobadas, 0 fallidas y 1 omitida porque el sandbox bloqueó el socket local del agente GnuPG.
- **Validaciones estáticas/build (2026-10-30):** `npm run lint` y `npm run typecheck` pasaron. `npm run build` en un directorio temporal aislado pasó y generó 41/41 páginas/rutas. Next mostró una advertencia conocida: 27 traces no entraron al output standalone porque `node_modules` estaba enlazado desde el checkout; no se conservó el artefacto temporal.
- **Cobertura actual:** 22 casos de navegador locales, incluidos estados de dispositivo pendiente/rechazado/aprobado/revocado, errores HTTP seguros, carreras de contexto, viewports móviles/tablet y cierre/liberación de cámara. Evidencia: `docs/QR-006-SCANNER-STABILITY.md`.
- `npm audit` reportó 0 vulnerabilidades en la revisión previa de dependencias parcheadas.
- GitHub Actions debe completar con el nuevo commit antes de considerar QR-005 lista para revisión final.
- Las pruebas de cámara usan mocks de `getUserMedia` y dispositivo fake de Chromium; no representan hardware físico ni permisos de un navegador móvil real.
- Seguir la matriz de autorización multiempresa de QR-004; E2E no sustituye RLS/pgTAP ni revisión remota segregada.
- Añadir flujos completos de asistencia solo cuando exista una decisión independiente que retire el bloqueo de QR-003.
