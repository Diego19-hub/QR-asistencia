# Invitaciones seguras en QR-asistencia Testing

Este flujo valida invitaciones y magic links en `https://asistencia-test.duob.tech` sin depender del host interno del contenedor. El servidor usa exclusivamente `APP_BASE_URL` para `Location`; acepta rutas de retorno cerradas (`/auth/confirm`, `/invitacion` y páginas de error predefinidas), y no usa el `Host` ni `request.url` como origen.

## Configuración alojada de Supabase Testing

El proyecto alojado no lee los templates de `supabase/config.toml`; estos archivos son para desarrollo local. En Dashboard, verifica primero el proyecto `llxyziffgtqnzlguxhyt`, luego:

1. **Authentication → URL Configuration:** configura Site URL como `https://asistencia-test.duob.tech` y permite exactamente `https://asistencia-test.duob.tech/auth/confirm` y, mientras existan enlaces PKCE antiguos, `https://asistencia-test.duob.tech/auth/callback`. No agregues comodines.
2. **Authentication → Email → Templates → Invite:** usa asunto `Invitación a Asistencia QR` y el contenido de `supabase/templates/invite.html`.
3. **Authentication → Email → Templates → Magic link:** usa asunto `Iniciar sesión en Asistencia QR` y el contenido de `supabase/templates/magic_link.html`.
4. En Dokploy, configura la variable de runtime `APP_BASE_URL=https://asistencia-test.duob.tech`. No incluyas una ruta, consulta ni fragmento.

El template de invitación debe generar un enlace con `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite`; el de magic link usa el mismo endpoint con `type=magiclink`. El GET muestra una confirmación intermedia y no consume el OTP al ser previsualizado por un escáner de correo. El POST llama `verifyOtp` en el servidor, guarda la sesión en las cookies SSR y redirige al flujo fijo de invitación. Las cuentas existentes reciben un enlace creado desde `hashed_token`, no el `action_link` que puede terminar en un fragmento de tokens.

**Pendiente de configuración alojada:** los templates anteriores están versionados localmente, pero aún se deben pegar en el Dashboard de Testing. La sesión de navegador del Dashboard no estaba disponible y no hay un token de Management API configurado en este entorno; no se intentó cambiar el proyecto remoto. No uses una clave `service_role` como sustituto del token de Management API.

## Prueba funcional desde cero

Usa una cuenta sintética con un buzón controlado y autorizado para la prueba. No mandes invitaciones a direcciones reales sin autorización.

1. Desde Usuarios y accesos, invita un email nuevo en Testing.
2. Abre el correo y confirma que el destino sea `asistencia-test.duob.tech/auth/confirm` y que el fragmento no contenga `access_token` ni `refresh_token`.
3. La vista intermedia exige un clic explícito para que los escáneres de enlaces no consuman el OTP. Confirma; el servidor debe guardar la sesión por cookies SSR y abrir `/invitacion`.
4. Establece la contraseña y acepta la invitación. Debe ir a `/admin`, `/scanner` o `/mi-qr` según el rol; usuarios con múltiples membresías deben elegir empresa.
5. Repite con una cuenta Auth ya existente: debe recibir un magic link, confirmar en la vista intermedia por el mismo endpoint y continuar a `/invitacion` sin alterar sus membresías hasta aceptar.
6. Prueba un enlace vencido y otro ya usado: ambos deben mostrar el error genérico de invitación y no abrir una sesión nueva.
7. Intenta `next=https://sitio-no-permitido.example` y solicita la ruta desde un Host interno: el destino debe continuar siendo el origen de `APP_BASE_URL` y una ruta local permitida.
8. Revisa que la respuesta de confirmación tenga `Cache-Control: no-store` y `Referrer-Policy: no-referrer`, que el redirect elimine cualquier fragmento heredado y que logs de Next/Caddy no contengan tokens. Caddy ya redacta la consulta de URI.

Las pruebas automatizadas `npm run test:auth-flow` cubren las rutas fijas, host interno, token hash, templates, callback legacy, errores reutilizados/vencidos y el flujo SSR de contraseña/aceptación. La aceptación completa con un correo requiere deploy manual de la nueva imagen y un buzón sintético controlado.

## Sesión cuyos tokens se vieron en una captura

No compartas la captura ni copies sus tokens al chat, tickets o logs. En el Dashboard de **Testing**, identifica internamente la cuenta y termina todas sus sesiones. Si un operador debe automatizarlo, use un proceso local de confianza con la clave administrativa de Testing y el JWT afectado leído desde un almacén temporal protegido; invoque `auth.admin.signOut(jwt, "global")`. No guardes ese JWT en Git ni lo imprimas. Después, fuerza un cambio de contraseña y pide iniciar sesión de nuevo.

La revocación global invalida los refresh tokens y evita renovar la sesión, pero un access token JWT ya emitido puede continuar verificándose hasta su `exp`. Comprueba la expiración configurada en Auth; espera ese intervalo antes de considerar que desapareció el riesgo residual. Si se requiere cortar JWTs inmediatamente, trátalo como incidente y evalúa la rotación de la clave de firma, que tiene impacto en todas las sesiones del proyecto; no hagas esa rotación como una corrección ordinaria del callback.

## Referencias

- [Supabase: Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase: Customizing email templates for local development](https://supabase.com/docs/guides/local-development/customizing-email-templates)
- [Supabase: Signing out](https://supabase.com/docs/guides/auth/signout)
- [Supabase JS: verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp)
