# Flujos de acceso

Este documento resume las rutas observadas en el árbol del repositorio. Los controles exactos deben verificarse en la implementación y pruebas antes de afirmar una propiedad de seguridad.

| Actor | Entrada | Destino observado | Componentes principales |
|---|---|---|---|
| Usuario administrativo | `/login`, `/auth/callback`, `/auth/confirm` | `/admin` o selección de empresa | `src/app/(auth)`, `src/app/(admin)`, `src/lib/access` |
| Supervisor | sesión/membresía y dispositivo autorizado | `/scanner` | `src/app/(supervisor)/scanner`, `/api/supervisor/scanner/context`, `/api/attendance/scan` |
| Empleado | sesión autenticada | `/mi-qr` | `src/app/(employee)/mi-qr`, `/api/employee/portal`, rutas API de credenciales |
| Administrador que invita | `/admin` | invitación y flujo `/invitacion` | `src/app/(admin)/admin`, `/api/admin/access`, `src/lib/access` |

## Revisión para cada flujo

1. Validar sesión en servidor y rechazo de usuario anónimo.
2. Resolver membresía activa y empresa elegida desde estado confiable.
3. Comprobar permiso para la acción y alcance de sucursal cuando aplique.
4. Verificar RLS, grants y funciones SQL; no asumir que la protección del UI basta.
5. Revisar expiración, revocación, reuso y destinatario de credenciales/invitaciones.
6. Confirmar que las respuestas y logs no revelen secretos ni permitan enumerar usuarios.

## Enlaces permanentes de acceso (QR-001)

La configuración administrativa muestra enlaces absolutos para `/scanner` y `/mi-qr`, construidos con el origen canónico de `APP_BASE_URL`. Los enlaces no incluyen empresa, correo, PIN, token ni identificadores. WhatsApp recibe solo un texto general y la URL codificados; no se requiere número destinatario.

Los enlaces son puntos de entrada, no credenciales. `/scanner` vuelve al login con un destino de retorno permitido y sigue validando sesión, membresía activa de supervisor y la autorización del dispositivo en el contexto de escaneo. `/mi-qr` sigue validando sesión, membresía activa de empleado y expediente propio activo vinculado. El retorno de login acepta únicamente `/scanner` o `/mi-qr`; el destino solo se conserva si coincide con el rol activo. Las identidades con varias membresías conservan la selección explícita de empresa y rol. Si existen invitaciones pendientes, el flujo de invitación mantiene prioridad sobre la navegación al destino.

Copiar usa primero la API del portapapeles y recurre a `document.execCommand("copy")` cuando la API falta o rechaza el permiso. Si ambos métodos fallan, el enlace permanece seleccionable y se informa cómo copiarlo manualmente.

## Rutas clave

- Acceso: `/login`, `/invitacion`, `/seleccionar-empresa`, `/auth/callback`, `/auth/confirm`.
- Administración: `/admin` y páginas hijas para empleados, supervisores, asistencias, horarios, horas extra, reportes y configuración.
- Operación: `/scanner`, `/mi-qr`.
- API: `src/app/api/**/route.ts`; inspecciona el Route Handler correspondiente y sus helpers antes de ampliar acceso.

## Casos por cubrir

- Miembro sin empresa, membresía inactiva y usuario con varias empresas.
- Supervisor sin permiso o dispositivo revocado, y dispositivo de otra sucursal.
- Empleado intentando acceder a datos ajenos o credencial rotada/revocada.
- Invitación vencida, revocada, ya consumida o usada por identidad no destinataria.
- Navegación directa a ruta protegida y llamadas API sin sesión.

Registra matriz de permisos y evidencia en QR-004 y amplía la estrategia E2E en QR-005.
