# QR-005 — Pruebas E2E con Playwright

## Estado

**En curso.** Esta primera entrega incorpora infraestructura reproducible y una matriz inicial de navegador para autenticación, roles, selección de empresa, portal de empleado y autorización del dispositivo del supervisor. La cobertura completa de asistencia permanece bloqueada por QR-003 y no se declara cerrada QR-004.

## Arquitectura

`playwright.config.mjs` ejecuta un proyecto Chromium secuencial con timeout explícito, un worker y reintento únicamente en CI. `tests/e2e/qr005-auth-access.spec.mjs` interactúa con las páginas y formularios reales de Next.js. No simula Server Actions ni usa API administrativa para iniciar sesión.

El comando `npm run test:e2e:local` reutiliza el bootstrap aislado de `tests/qr004-auth-matrix.local.integration.mjs` en modo `--e2e-only`:

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
- Local: `npm run test:e2e:local`.
- En macOS, si Chromium de Playwright no está instalado, puede usarse Chrome existente: `QR004_CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e:local`.
- CI: paso E2E aislado en `.github/workflows/ci.yml`, usando Chrome del job.
- Otras validaciones: `npm run test:security:matrix:local`, `npm test`, `npm run lint`, `npm run typecheck` y `npm run build`.

Los datos temporales nunca se guardan en el repositorio. La configuración desactiva capturas, video y traces porque podrían contener sesiones, cookies o datos. El reporter solo emite resultados de pruebas; el directorio de salida queda dentro del temporal y se elimina en teardown.

## Cobertura inicial

| Área | Casos E2E del navegador |
|---|---|
| Sesión | Acceso anónimo a `/admin`, `/scanner`, `/mi-qr`; contraseña inválida; login admin real; cierre de sesión y cookie HttpOnly. |
| Roles | Administrador, supervisor y empleado en su destino; rol insuficiente ante `/admin`; Auth válido sin membresía y membresía inactiva. |
| Empresas | Usuario admin con dos empresas, selección explícita y cambio entre ambas con cookie de membresía. |
| Portal | Empleado vinculado en `/mi-qr`; cuenta employee sin expediente ve solo el estado no vinculado. |
| Escáner/dispositivo | Supervisor con/sin sucursal; solicitud real, aprobación desde la interfaz administrativa, redención por el contexto real, revocación de dispositivo y revocación de membresía. |
| Cámara | Chromium usa media fake. El primer `getUserMedia` se rechaza con un mock de permiso denegado; la repetición utiliza el dispositivo fake y puede detenerlo. Se comprueba que no se invoque `/api/attendance/scan`. |

Los tests usan selectores accesibles de roles, nombres y labels. No dependen de orden global; cada prueba crea un contexto de navegador nuevo. Las identidades se crean para una ejecución y la base se destruye completa.

## Límite de seguridad de QR-003

Esta fase **no** lee/decodifica QR, no solicita ni verifica PIN, no llama `private.verify_employee_pin`, no envía PIN incorrectos, no ejecuta lockout ni confirma entrada, salida o descansos. La prueba de cámara termina antes del endpoint de escaneo y afirma que `/api/attendance/scan` no fue solicitado. Los movimientos de asistencia completos siguen bloqueados mientras QR-003 permanezca pospuesta, P0 y NO-GO.

La autorización del dispositivo y la cámara fake no simulan una asistencia completa ni certifican cámaras físicas, navegadores móviles reales o comportamiento de red celular. El backend Auth, API y PostgreSQL usados para permisos son locales reales y desechables.

## CI y diagnósticos

El workflow conserva todas las suites existentes y agrega un paso separado para `npm run test:e2e:local`. CI usa un worker y un reintento. No se publican archivos de diagnóstico; capturas, videos y trazas están apagados. Los logs de fallos se redactan para eliminar las contraseñas/identidades sintéticas que el bootstrap pasa al proceso de pruebas.

## Criterios pendientes

- **Ejecución local observada (2026-10-30):** `npm run test:e2e:local` con Chrome 156.0.8078.79 pasó 10/10 pruebas de navegador en 49.7 s; la preparación y limpieza del stack desechable terminaron correctamente y se conservaron los recursos Docker preexistentes. Una primera ejecución sin `QR004_CHROME_BIN` falló antes de abrir el navegador porque no estaba instalado el Chromium administrado por Playwright; repetir con el Chrome ya instalado pasó. No se descargó otro navegador.
- **Otras validaciones observadas (2026-10-30):** `npm run test:security:matrix:local` pasó los ocho archivos pgTAP (201 aserciones) y la matriz dinámica HTTP/Auth; `npm test` terminó con 80 aprobadas y 1 omitida por el bloqueo del socket del agente GnuPG; `npm run lint`, `npm run typecheck` y `npm run build` pasaron. El build aislado generó 41/41 páginas estáticas; Next reportó que 27 archivos de trace quedaron fuera del output standalone porque `node_modules` se enlazó desde fuera del directorio temporal. El artefacto temporal se eliminó. `npm audit` reportó 0 vulnerabilidades después de actualizar Next.js, `eslint-config-next` y Zod a versiones parcheadas compatibles.
- GitHub Actions debe completar con el nuevo commit antes de considerar QR-005 lista para revisión final.
- Ampliar cobertura de estados de cámara/dispositivo móvil con evidencia adicional, manteniendo el bloqueo de asistencia/PIN.
- Seguir la matriz de autorización multiempresa de QR-004; E2E no sustituye RLS/pgTAP ni revisión remota segregada.
- Añadir flujos completos de asistencia solo cuando exista una decisión independiente que retire el bloqueo de QR-003.
