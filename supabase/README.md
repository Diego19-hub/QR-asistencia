# Inicialización administrativa de la primera empresa

La migración `bootstrap_owner_and_review_adjustments` define `public.bootstrap_first_company(p_request_id uuid, p_owner_user_id uuid, p_company_name text, p_legal_name text default null, p_rfc text default null)`, que devuelve `company_id`, `owner_user_id` y `role`. En el proyecto QR-asistencia la función es `SECURITY INVOKER`, solo `service_role` tiene `EXECUTE`, y `anon`/`authenticated` no lo tienen. El wrapper invoca la función privada, que comprueba `auth.role() = 'service_role'`, bloquea inicializaciones simultáneas, exige un usuario existente en Supabase Auth y rechaza la creación si ya existe una empresa. Empresa, membresía `owner` y registro de idempotencia se insertan en una transacción.

El script `scripts/bootstrap-first-company.mjs` es para un operador en un equipo/entorno de confianza. Valida que la URL use HTTPS y corresponda exactamente al ref `jawdrhewabqajxnswhkn` antes de hacer llamadas, confirma que el UUID Auth existe y luego ejecuta la RPC. No se ejecuta desde Next.js, navegador ni cliente. La clave privilegiada se lee únicamente de `SUPABASE_SERVICE_ROLE_KEY` del proceso; nunca la pongas en `NEXT_PUBLIC_*`, en `.env.local` compartido, ni en el repositorio. Cárgala desde un gestor de secretos o introdúcela de forma oculta en la terminal.

## Procedimiento de una sola ejecución

1. En **Supabase Dashboard → Authentication → Users**, crea/invita al usuario propietario y copia su UUID. No compartas su contraseña. Antes del bootstrap se requiere este usuario Auth existente.
2. Ten listos el UUID Auth, nombre de empresa, razón social (opcional) y RFC (opcional, si aplica). El RFC se normaliza a mayúsculas.
3. En una terminal `zsh`, desde la raíz del repositorio, carga la clave privilegiada sin escribirla en el historial y ejecuta el comando con los datos reales:

```zsh
read -s "SUPABASE_SERVICE_ROLE_KEY?Clave service_role (entrada oculta): "
export SUPABASE_SERVICE_ROLE_KEY
printf '\n'
node --env-file=.env.local scripts/bootstrap-first-company.mjs \
  --auth-user-id "UUID_AUTH" \
  --company-name "NOMBRE_DE_EMPRESA" \
  --legal-name "RAZON_SOCIAL" \
  --rfc "RFC"
unset SUPABASE_SERVICE_ROLE_KEY
```

Omite `--legal-name` o `--rfc` si no aplican. El script genera un `request_id` aleatorio y conserva ese mismo UUID y una huella de los parámetros en `.supabase-bootstrap/first-company.json`, con permisos locales restringidos. Esa carpeta está en `.gitignore`. Reejecuta el mismo comando con exactamente los mismos datos si la conexión se interrumpe: se reutilizará la clave idempotente. No borres ni edites el archivo de estado mientras se investiga un intento incompleto. La RPC rechaza el uso de la clave con otros datos.

La ejecución imprime únicamente el ref, UUIDs de referencia, rol y estado. Si falla antes de la RPC, no crea la empresa. Si la RPC confirma el resultado pero falla la comprobación de membresía, conserva el archivo de estado y revisa Supabase antes de intentar cualquier operación manual.

## Comprobación después del bootstrap

El script confirma la fila activa `owner` consultando `company_memberships` con la clave administrativa. Después, inicia sesión desde `/login` como el usuario creado y comprueba `GET /api/me` (sesión normal; no requiere ni usa clave privilegiada). Debe devolver una membresía cuyo `role` sea `owner` y `companyName` sea el nombre de la empresa. Finalmente, visita `/admin`: debe cargar para ese usuario. Una sesión sin membresía será redirigida a `/login?error=no-company`.

No compartas la clave administrativa para estas comprobaciones de aplicación. La prueba de `/admin` solo puede completarse luego de crear el usuario Auth y ejecutar el bootstrap con los datos reales.

## Revisar correcciones

Un supervisor autorizado puede enviar una fila a `attendance_adjustments`. Un usuario con `attendance.review_adjustments` distinto del solicitante puede llamar `public.review_attendance_adjustment(p_adjustment_id, p_approve, p_review_note)`. La función cambia solo el estado de la solicitud y añade la nota de revisión; la auditoría registra el cambio y los eventos originales permanecen intactos.

## Pruebas pgTAP

Ejecuta `npx supabase start` y luego `npx supabase test db --local`. Las pruebas solo deben apuntar a la base local desechable; no insertes fixtures en producción.
