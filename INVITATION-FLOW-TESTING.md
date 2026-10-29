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

## QR-002 — Invitaciones individuales compartibles

### Diseño de identidad y alta

El enlace de WhatsApp no crea una identidad ni prueba quién lo abrió. El administrador primero crea la invitación de correo existente para el correo de trabajo y el rol, y desde esa invitación pendiente puede generar un enlace individual. La ruta de correo y sus templates se mantienen. El enlace manual comparte la misma invitación y fecha de vencimiento; no crea una segunda membresía ni otra invitación duplicada.

- **Cuenta existente:** inicia sesión mediante Supabase Auth. La RPC consulta el correo actual en `auth.users`, exige `email_confirmed_at`, y compara el correo normalizado con el destinatario guardado en la invitación. Debe presentar además el token individual.
- **Cuenta nueva:** no hay alta directa desde el enlace. La configuración local del proyecto mantiene deshabilitado el alta pública y la pantalla de login no ofrece registro. La persona debe completar primero la invitación de Supabase Auth recibida por correo, confirmar su dirección y configurar su contraseña; después vuelve al enlace de WhatsApp. En hosting Supabase, la verificación de correo está activa por defecto, aunque cada proyecto debe conservar esa condición en su configuración. La RPC valida `email_confirmed_at` directamente para no confiar solo en la interfaz o en un claim antiguo. Referencias: [Supabase Password-based Auth](https://supabase.com/docs/guides/auth/passwords) y [Supabase Auth general configuration](https://supabase.com/docs/guides/auth/general-configuration).
- **Empleado:** conserva la regla de vincular opcionalmente el expediente solo al aceptar, y el correo debe coincidir. El portal solo queda habilitado por las comprobaciones vigentes de rol, membresía y expediente propio.
- **Supervisor:** recibe el rol actual de invitación. Aceptarlo no autoriza un escáner; continúa requiriendo membresía, permiso, sucursal y dispositivo autorizados.
- **Administrador:** solo el propietario puede crear y gestionar una invitación con rol administrador, conforme a la regla SQL vigente. El propietario no puede volver a asignarse mediante invitación.

La consecuencia operativa para personas sin cuenta es que todavía necesitan el correo Auth para completar el alta inicial. La alternativa de registro por teléfono/SMS requeriría una identidad telefónica y un proveedor OTP verificado, fuera de QR-002. No se habilita registro público ni se sustituyen contraseñas, sesiones o credenciales compartidas.

### Token, privacidad y aceptación

1. `POST /api/admin/access/invitations/:id/share-link` exige sesión administrativa activa y `company.manage`; la RPC valida la misma empresa, expiración y restricción owner-only para rol administrador.
2. El servidor genera 32 bytes criptográficos en Base64URL y guarda únicamente su SHA-256 hexadecimal. La respuesta entrega el URL completo una sola vez al administrador autorizado. El panel ofrece copiarlo o abrir WhatsApp sin número destinatario; el texto no incluye correo ni nombre de empresa. Regenerar sobrescribe el hash anterior e invalida el enlace previo. La invitación sigue venciendo en su `expires_at` de 14 días y puede revocarse desde el control existente, que también borra el hash.
3. El token va en el fragmento `#t=...`, no en la consulta ni en la ruta. El navegador lo copia a `sessionStorage` de esa pestaña, elimina el fragmento de la barra con `history.replaceState` y solo lo envía mediante `POST` después del clic explícito **Aceptar invitación**. El servidor calcula el hash y nunca lo devuelve. La página de entrada, la API y la respuesta usan `no-store`; se establece `Referrer-Policy: no-referrer`. El GET de un escáner/previsualizador no consume ni modifica nada.
4. La aceptación bloquea la fila pendiente, compara hash, correo Auth confirmado, vencimiento y estado; luego ejecuta dentro de la misma transacción la lógica existente de permisos, expediente, membresía y auditoría. Se borra el hash al aceptar. El correo y la empresa no se aceptan como argumentos del usuario. Una invitación vencida, revocada, repetida, de otra identidad o con membresía activa no cambia estado ni crea membresía. Las aceptaciones concurrentes se serializan con `FOR UPDATE`; solo una puede consumir el token.
5. Las invitaciones con enlace pendiente aparecen para su correo Auth confirmado en `/invitacion` como “requiere enlace WhatsApp”; esa página no permite aceptarlas sin token. Esto guía a una persona nueva de vuelta al mensaje después de verificar el correo sin divulgar el token.

El token es una credencial al portador adicional a la identidad Auth: si alguien lo reenvía, solo una cuenta con el correo confirmado destinatario puede usarlo, y solo una vez antes de expirar/revocarse. La URL se entrega intencionalmente a WhatsApp cuando el administrador comparte el mensaje; el administrador debe enviarla solo a la persona destinataria. No se configuran analítica ni logging del cuerpo de aceptación. La protección no cubre un buzón o una sesión Auth comprometidos.

### Evidencia local QR-002

La migración `20261028120000_share_company_invitations.sql` se aplica solo dentro del runner QR-004 local desechable. El runner valida RLS/grants de la nueva RPC y HTTP/Auth con usuarios sintéticos: generación autorizada, usuario anónimo, rol y permiso insuficientes, empresa distinta, token almacenado como hash, previsualización GET sin efecto, correo no confirmado, destinatario distinto, expiración, revocación, membresía existente, reutilización, concurrencia, auditoría y regresión de invitación/reenvío por correo con SMTP local/Mailpit. La matriz no consulta Testing ni Producción ni aplica migraciones remotas.

**Resultados de esta rama:** `npm run test:security:matrix:local` terminó con código 0: 156/156 aserciones pgTAP y todos los escenarios HTTP/Auth del runner, incluida la carrera de dos aceptaciones (una acepta, la otra es rechazada), snapshots sin efectos ante rechazos y preservación de los recursos Docker preexistentes. La invitación de correo devolvió HTTP 201 y el reenvío HTTP 200; Mailpit local recibió los mensajes esperados. También pasaron `npm run lint`, `npm run typecheck`, `npm test` (70 pruebas) y `npm run build`. El build aislado excluyó `.env*` y terminó correctamente; Next mostró el aviso conocido de trazado standalone porque `node_modules` estaba enlazado desde fuera de la copia temporal. `npm test` mostró avisos existentes de módulos TypeScript sin `type: module`, sin fallos. Testing y Producción no se consultaron ni modificaron.

## Sesión cuyos tokens se vieron en una captura

No compartas la captura ni copies sus tokens al chat, tickets o logs. En el Dashboard de **Testing**, identifica internamente la cuenta y termina todas sus sesiones. Si un operador debe automatizarlo, use un proceso local de confianza con la clave administrativa de Testing y el JWT afectado leído desde un almacén temporal protegido; invoque `auth.admin.signOut(jwt, "global")`. No guardes ese JWT en Git ni lo imprimas. Después, fuerza un cambio de contraseña y pide iniciar sesión de nuevo.

La revocación global invalida los refresh tokens y evita renovar la sesión, pero un access token JWT ya emitido puede continuar verificándose hasta su `exp`. Comprueba la expiración configurada en Auth; espera ese intervalo antes de considerar que desapareció el riesgo residual. Si se requiere cortar JWTs inmediatamente, trátalo como incidente y evalúa la rotación de la clave de firma, que tiene impacto en todas las sesiones del proyecto; no hagas esa rotación como una corrección ordinaria del callback.

## Referencias

- [Supabase: Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase: Customizing email templates for local development](https://supabase.com/docs/guides/local-development/customizing-email-templates)
- [Supabase: Signing out](https://supabase.com/docs/guides/auth/signout)
- [Supabase JS: verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp)
