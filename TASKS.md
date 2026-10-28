# Backlog de QR-asistencia

Estados: **Pendiente**, **En curso**, **Bloqueada**, **Hecha**. No marques una tarea hecha sin evidencia revisable. Las referencias describen código/documentación observados al preparar este backlog; no implican que el objetivo ya esté resuelto.

| ID | Prioridad | Estado | Dependencias | Tarea |
|---|---|---|---|---|
| QR-001 | P1 | Hecha | — | Enlaces permanentes de acceso |
| QR-002 | P1 | Pendiente | QR-004 | Invitaciones manuales |
| QR-003 | P0 | En curso | — | Verificar persistencia de fallos de PIN; la migración está validada localmente y falta desplegarla en Testing |
| QR-004 | P1 | En curso | — | Auditoría multiempresa; matriz local sintética ejecutada para RLS, roles, sucursales, RPC, credenciales y dispositivos. La verificación remota de Testing/Producción sigue separada y no se hizo en esta fase. Informe: [docs/QR-004-SECURITY-AUDIT.md](docs/QR-004-SECURITY-AUDIT.md) |
| QR-005 | P1 | Pendiente | QR-004 | Pruebas E2E con Playwright |
| QR-006 | P2 | Pendiente | QR-005 | Estabilidad del escáner |
| QR-007 | P1 | Pendiente | — | Auditoría y optimización general del código |
| QR-008 | P2 | Pendiente | QR-007 | Limpieza segura de pruebas y archivos obsoletos |
| QR-009 | P1 | Pendiente | QR-007 | Optimización de velocidad web |
| QR-010 | P2 | Pendiente | QR-007 | Mantenibilidad y refactorización |

## QR-001 — Enlaces de acceso

- **Objetivo:** mostrar en administración enlaces permanentes para supervisores (`/scanner`) y empleados (`/mi-qr`), con opciones para copiar y compartir.
- **Criterios de aceptación:** el administrador ve las URLs del origen actual sin datos de empresa/usuario; los destinos exigen sesión autenticada y membresía/permisos activos; copiar y compartir tienen alternativa funcional si Web Share no está disponible; otras empresas no pueden alterar el acceso.
- **Evidencia requerida:** rutas y controles revisados; pruebas de permisos, copiar/compartir y acceso denegado documentadas.
- **Referencias iniciales:** `src/app/(supervisor)/scanner/page.tsx`, `src/app/(employee)/mi-qr/page.tsx`, `src/app/(admin)/admin/configuracion/page.tsx`.
- **Resultado:** configuración muestra enlaces absolutos construidos desde el `APP_BASE_URL` validado: `/scanner` y `/mi-qr`. Copiar admite Clipboard API y fallback DOM; compartir usa `https://wa.me/?text=...` codificado y sin número. El texto compartido no incluye datos de empresa o persona.
- **Retorno de autenticación:** las rutas protegidas conservan un destino cerrado (`/scanner` o `/mi-qr`) en el login. Solo se usa si coincide con el rol activo; múltiples membresías siguen requiriendo selección explícita. Las invitaciones pendientes conservan prioridad. El retorno no acepta URLs externas ni parámetros arbitrarios.
- **Seguridad revisada:** las páginas siguen comprobando sesión y membresía activa por rol. El API del portal valida empleado activo y expediente vinculado; el contexto del escáner mantiene autorización de dispositivo y sucursal.
- **Pruebas:** `node --experimental-strip-types --test tests/access-links.test.mjs` pasó (6/6); `npm run test:user-access` pasó (6/6); `npm run lint`, `npm run typecheck`, `npm test` y `npm run build` terminaron con código 0. Node mostró avisos existentes de módulos TypeScript sin `type: module` durante las pruebas; no hubo fallos.

## QR-002 — Invitaciones manuales

- **Objetivo:** permitir invitaciones individuales compartibles por WhatsApp, conservando el flujo actual por correo y usando Supabase Auth de forma segura.
- **Criterios de aceptación:** token individual de un solo uso, expiración y revocación comprobadas en servidor; destinatario verificado y vinculado al flujo Auth; el token no otorga permisos sin autenticación/membresía activa; rate limiting/auditoría y protección ante enumeración evaluadas; correo actual sigue funcionando.
- **Evidencia requerida:** modelo de amenazas breve, pruebas para expiración/revocación/destinatario/reutilización y regresión del correo.
- **Referencias iniciales:** `src/lib/access/`, `src/app/(auth)/invitacion/`, `src/app/api/admin/access/`, `INVITATION-FLOW-TESTING.md`, `supabase/migrations/20261012143000_company_user_access_management.sql`.

## QR-003 — Verificar persistencia de fallos de PIN

- **Objetivo:** reproducir y verificar la persistencia de intentos fallidos; reutilizar la corrección versionada existente si resuelve la causa.
- **Criterios de aceptación:** reproducir el flujo legacy y el corregido en una base local desechable; comprobar contador, bloqueo, expiración y ausencia de evento cuando el PIN no es válido; documentar causa raíz y pruebas.
- **Restricción de tarea:** las migraciones se aplican solo en bases locales desechables para esta verificación. No ejecutar cambios, RPC de prueba ni migraciones en Testing o Producción; coordinar cualquier despliegue remoto en una tarea autorizada separada.
- **Diagnóstico:** las versiones anteriores de `scan_employee_attendance` y `confirm_employee_attendance` lanzaban una excepción después de que `private.verify_employee_pin` incrementaba el contador. La excepción abortaba la transacción y revertía el incremento.
- **Corrección en el repositorio:** ya existe `supabase/migrations/20261018120000_persist_employee_pin_failures.sql`. Ambas RPC devuelven un rechazo estructurado `pinError` sin lanzar una excepción después de verificar el PIN. No se creó ni duplicó una migración.
- **Reproducción local:** en un stack Supabase desechable con migraciones hasta `20261012143000`, preview y confirm devolvieron SQLSTATE `22023` y el contador quedó en 0. Tras aplicar la migración existente solo en esa base local, preview y confirm devolvieron `pin_invalid`, el contador persistió en 1 y 2, y no se creó ningún evento de asistencia.
- **Pruebas:** `npm run test:pin-lockout` pasó (3/3); `npm run test:pin-lockout:db` pasó (pgTAP 35/35 e integración PostgreSQL); la integración verificó intentos concurrentes, bloqueo de cinco intentos por 15 minutos, expiración, reset, dispositivo no autorizado/revocado y aislamiento entre empresas. `npm test`, lint, typecheck y build también pasaron; detalles en [docs/PIN-LOCKOUT-FIX.md](docs/PIN-LOCKOUT-FIX.md).
- **Estado de Testing:** la consulta de solo lectura del historial de migraciones de Testing mostró como última versión `20261012143000`; no aparece `20261018120000`. No se consultó el cuerpo de las funciones ni se ejecutaron pruebas o cambios en Testing. El despliegue de la migración existente sigue pendiente de revisión y de un procedimiento autorizado separado.
- **Riesgo/pendiente:** mientras Testing no registre la migración, se debe asumir que ese entorno puede conservar el comportamiento anterior. No hacer rollback a las definiciones de `20261012030630`, porque volverían a lanzar la excepción y podrían revertir los contadores.

## QR-004 — Seguridad multiempresa

- **Objetivo:** auditar RLS, sesiones, permisos, `SECURITY DEFINER`, sucursales, credenciales QR y dispositivos autorizados.
- **Criterios de aceptación:** matriz rol × operación × empresa/sucursal; inventario de funciones privilegiadas y grants; pruebas negativas entre empresas y membresías inactivas; hallazgos con evidencia, severidad, mitigación y pruebas de regresión.
- **Evidencia inicial:** migraciones multiempresa, RLS, QR, escáner, portal y acceso de usuarios en `supabase/migrations/`; pruebas SQL en `supabase/tests/` y pruebas de seguridad en `tests/`.
- **Resultado fase 2:** se agregó `tests/qr004-auth-matrix.local.integration.mjs` y `supabase/tests/qr004_scanner_authorization_test.sql`. Se ejecutaron 142 aserciones pgTAP en un stack local desechable: tenant/RLS y roles, sucursales, membresías y revocaciones, RPC de acceso, ACL de credenciales, escáner directo, cruce de empresa/sucursal, dispositivo desconocido, QR revocado y ausencia de eventos/sesiones ante denegaciones. Sin intentos de PIN incorrectos. No se consultó ni modificó Testing o Producción. QR-004 sigue en curso por la revisión remota separada y otros dominios/rutas aún no incluidos en esta matriz. Evidencia completa: [docs/QR-004-SECURITY-AUDIT.md](docs/QR-004-SECURITY-AUDIT.md).

## QR-005 — Pruebas E2E

- **Objetivo:** planificar y añadir cobertura Playwright para login, permisos, escáner y registro de asistencia.
- **Criterios de aceptación:** entorno E2E aislado con datos sintéticos; cobertura de flujos positivos, permisos denegados y fallos de red/cámara; secretos y credenciales reales fuera del repositorio; ejecución CI con artefactos diagnósticos seguros.
- **Evidencia inicial:** `package.json` no declara Playwright; confirmar herramientas y estrategia antes de agregar dependencia.

## QR-006 — Estabilidad del escáner

- **Objetivo:** investigar cámara, conexión, concurrencia, mensajes de error y reintentos.
- **Criterios de aceptación:** escenarios reproducibles en móvil, permisos de cámara, pérdida de conexión, escaneos repetidos y solicitudes paralelas; estados visibles sin filtrar secretos; reintentos acotados/idempotentes donde corresponda; pruebas de regresión.
- **Evidencia inicial:** `src/components/scanner/mobile-scanner.tsx`, rutas `src/app/api/attendance/scan/route.ts` y `src/app/api/supervisor/scanner/context/route.ts`, pruebas `tests/scanner-context.test.mjs`.

## QR-007 — Optimización general del código

- **Objetivo:** auditar código muerto, componentes sin referencias, funciones e imports no usados, dependencias npm, duplicaciones, archivos obsoletos, complejidad, consultas redundantes y trabajo de cliente innecesario.
- **Criterios de aceptación:** inventario por candidato con referencias estáticas/dinámicas, dependencias y riesgo; evidencia de comportamiento cubierto; plan por módulos pequeños y ramas separadas; cambios posteriores aprobados por módulo.
- **Restricción:** esta tarea de auditoría no autoriza eliminaciones. No clasificar un archivo como sin uso hasta revisar rutas, imports dinámicos, convención Next, scripts, reflexión y referencias SQL/documentales.
- **Evidencia inicial:** los scripts `lint`, `typecheck`, build y tests están definidos en `package.json`; componentes con mayor tamaño incluyen `schedule-management.tsx` (424 líneas), `user-access-management.tsx` (323) y `employee-credentials.tsx` (280). El tamaño solo orienta revisión, no demuestra complejidad innecesaria.

## QR-008 — Limpieza de pruebas y archivos obsoletos

- **Objetivo:** revisar tests duplicados u obsoletos, fixtures, scripts, temporales, depuración y documentación redundante.
- **Criterios de aceptación:** por cada eliminación: demostrar obsolescencia/duplicación, indicar funcionalidad protegida, cobertura equivalente si aplica, riesgos y pruebas ejecutadas; registrar la decisión.
- **Restricciones:** conservar pruebas de seguridad, integración y regresión; no borrar pruebas solo para reducir archivos.
- **Evidencia inicial:** existen suites unitarias, integración Node, pgTAP y archivos de evidencia operativa por etapas. Los documentos históricos no enlazados desde el README son candidatos a revisar, no obsoletos confirmados.

## QR-009 — Optimización de velocidad web

- **Objetivo:** medir carga inicial, móvil, JavaScript, renderizado, Server Components, solicitudes, recursos, división/carga diferida, caché, Supabase, índices, paginación, panel y escáner.
- **Criterios de aceptación:** línea base reproducible y resultados antes/después; identificar entorno, dispositivo, ruta, tamaño de muestra y herramienta; analizar privacidad antes de modificar caché; documentar métricas y cambios en `docs/PERFORMANCE.md`.
- **Evidencia inicial:** `next.config.ts` configura standalone y trazado de recursos PDFKit; Docker compila para `linux/amd64`; hay pruebas específicas de exportación y lease. No hay métricas de Lighthouse/Core Web Vitals capturadas en esta configuración inicial.

## QR-010 — Mantenibilidad y refactorización

- **Objetivo:** identificar componentes grandes, responsabilidades mezcladas y código difícil de mantener, y proponer divisiones pequeñas.
- **Criterios de aceptación:** cada propuesta explica la responsabilidad actual, división sugerida, dependencias y riesgo; cambios preservan interfaz y comportamiento con pruebas relevantes; no se reescribe la aplicación completa.

## Evidencia de esta configuración

Revisión estática de árbol, manifiestos, documentación y configuración de CI realizada en la rama observada `main`. No se ejecutaron pruebas de aplicación ni se modificó código de negocio. La validación de enlaces y estructura se registra al cerrar esta tarea documental.
