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

## Alta y aceptación de una invitación

El registro público permanece deshabilitado (`auth.enable_signup=false`). No se crea una cuenta sin una invitación pendiente válida.

1. Invita un correo nuevo desde Usuarios y accesos. Supabase Auth crea la identidad pendiente y envía el correo de invitación; la persona debe abrir el enlace y confirmar en `/auth/confirm`. El GET solo muestra una confirmación intermedia y no consume el OTP; el POST explícito llama `verifyOtp`, crea la sesión SSR y conduce a `/invitacion`.
2. Para una identidad existente, la entrega usa un magic link de un solo uso mediante el proveedor configurado. Sin proveedor se informa que no se envió ningún enlace y que la persona todavía no puede iniciar sesión/aceptar; un fallo de entrega mantiene la invitación pendiente y permite reenviarla.
3. `/invitacion` muestra el correo que devolvió Supabase Auth sin un campo editable. Solo después de validar `email_confirmed_at`, el servidor consulta las invitaciones pendientes de esa identidad y exige una coincidencia exacta de correo normalizado, permite configurar **Nombre completo**, **Contraseña** y **Confirmar contraseña**, y reporta validaciones comprensibles.
4. La contraseña se actualiza con la sesión autenticada y la política Auth vigente; el nombre se guarda únicamente en `user_metadata.full_name` para presentación. Un expediente empleado vinculado conserva su nombre propio. Después, un cliente Admin del servidor escribe el indicador de configuración en `app_metadata`; si esta segunda operación falla, no se acepta la invitación y la interfaz indica que puede ser necesario reintentar.
5. La persona pulsa **Aceptar invitación**. La RPC vuelve a validar el correo Auth confirmado, invitación pendiente, destinatario, empresa/rol, autorización del invitador, expiración, revocación, uso único y el indicador de configuración guardado por servidor. No se usa `user_metadata` para autorización. Un rechazo no debe crear membresía ni auditoría de aceptación.
6. El primer canal que completa la aceptación invalida los otros enlaces/canales conforme al comportamiento vigente. Una identidad con varias empresas sigue el flujo existente de selección explícita de empresa.

### Verificación local desechable

`npm run test:auth-flow` valida reglas de entrada, configuración local, textos, ausencia de un campo email editable, redirects fijos, `auth/confirm`, orden de actualización de contraseña/marcador y el contrato de la migración. `npm run test:security:invitation-onboarding:local` inicia un stack Supabase temporal sin enlace remoto y usa Mailpit para Auth SMTP y un doble Resend HTTP limitado a loopback. Cubre invitación Auth de una cuenta nueva, GET/POST de confirmación, configuración real mediante Server Action, aceptación, magic link para una cuenta existente, rechazos de nombre/contraseña, registro público deshabilitado, fallo/reenvío de correo y preservación del nombre del expediente empleado. También corre las regresiones de autorización existentes dentro del stack desechable. Nunca leas `.env.local` ni utilices Testing/Producción para estos tests.


**Nota sobre los enlaces Auth:** Supabase Auth entrega un `token_hash` de un solo uso en el URL del enlace de correo que llega a `/auth/confirm`; el GET muestra confirmación intermedia y solo el POST explícito consume ese verificador. La aplicación no registra ni persiste el valor en sus tablas, logs, perfil ni analítica, y los tokens de sesión no aparecen en URL. Si el requisito “ningún token en URL” incluye también este verificador temporal de Supabase, el flujo actual no lo satisface: habría que cambiar las plantillas/configuración Auth a un código OTP ingresado manualmente y probarlo en un cambio autorizado separado. Esa configuración remota no se modificó.

### Verificación manual en Testing (solo con despliegue/migración autorizados)

La nueva migración `20261105234619_invitation_account_setup_required.sql` es necesaria para exigir el marcador también a cuentas Auth existentes con `invited_at` nulo. No se ha aplicado remotamente. Por la restricción vigente de no aplicar migraciones remotas, no desplegar esta versión hasta que exista una autorización y ventana separadas para aplicar la migración a **Testing**; no cambiar configuración remota de Auth como parte de este trabajo.

La publicación/despliegue de Testing queda bloqueada hasta que la migración se aplique con autorización separada y el CI remoto pase. Antes de fusionar a `main` también debe verificarse el comportamiento de despliegue configurado en Dokploy: el workflow versionado publica una imagen inmutable de Testing después de CI en `main`, pero la configuración externa de Dokploy no está disponible para demostrar que una fusión no active o afecte Producción. No se ha hecho push, merge, publicación de imagen ni despliegue.

Después de autorización específica y de que el esquema local esperado esté disponible en Testing, usar únicamente dos identidades sintéticas y buzones controlados: una dirección nueva y una ya existente. Verificar invitación/magic link, confirmación explícita, correo no editable, configuración, aceptación única y mensajes de reenvío/fallo. Confirmar además que no hubo altas sin invitación, que el nombre del expediente no cambió y que respuestas sensibles llevan `Cache-Control: no-store` y `Referrer-Policy: no-referrer`. No usar direcciones reales ni usuarios existentes.

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
4. Tanto la aceptación tradicional desde `/invitacion` como la aceptación desde el enlace WhatsApp verifican correo Auth confirmado, destinatario, vencimiento, estado, permisos del invitador y reglas de membresía. Ambas bloquean la misma fila pendiente con `FOR UPDATE`; la transacción que gana marca la invitación como aceptada, registra una sola auditoría y borra `share_token_hash`. Así invalida el otro canal. La invitación no puede aceptarse dos veces ni cambiar de empresa por argumentos del usuario.
5. Si el enlace WhatsApp existe, la lista de invitaciones indica que ambos canales están disponibles y `/invitacion` mantiene el botón tradicional **Aceptar invitación**. Quien haya recibido el correo puede aceptar desde ahí después de autenticarse con el correo confirmado correcto. También puede usar el enlace individual; el primer método que complete invalida el otro. Si el correo se reenvía después de crear el enlace, el flujo existente de Auth/magic link sigue funcionando y conserva sus controles.

El token es una credencial al portador adicional a la identidad Auth: si alguien lo reenvía, solo una cuenta con el correo confirmado destinatario puede usarlo, y solo una vez antes de expirar/revocarse. La URL se entrega intencionalmente a WhatsApp cuando el administrador comparte el mensaje; el administrador debe enviarla solo a la persona destinataria. No se configuran analítica ni logging del cuerpo de aceptación. La protección no cubre un buzón o una sesión Auth comprometidos.

### Evidencia local QR-002


**Resultados de PR #7:** la versión inicial pasó 156/156 aserciones pgTAP, pero su revisión detectó la incompatibilidad de los canales. La corrección actualizada conserva las 156 aserciones pgTAP y añade regresiones HTTP/Auth locales para aceptación por correo con enlace creado, invalidación mutua, repetición, regeneración, concurrencia entre canales y regla owner-only. `npm run test:security:matrix:local` pasó: 156/156 pgTAP, escenarios HTTP/Auth nuevos y previos, correo HTTP 201/reenvío 200 con Mailpit y limpieza con recursos Docker previos preservados. También pasaron `npm run lint`, `npm run typecheck`, `npm test` (70 pruebas) y `npm run build` en una copia temporal sin `.env*`. Permanecen los avisos conocidos de `MODULE_TYPELESS_PACKAGE_JSON` en pruebas y de trazado standalone por `node_modules` enlazado fuera de la copia; no hubo fallos. Testing y Producción no se consultaron ni modificaron.

## Sesión cuyos tokens se vieron en una captura

No compartas la captura ni copies sus tokens al chat, tickets o logs. En el Dashboard de **Testing**, identifica internamente la cuenta y termina todas sus sesiones. Si un operador debe automatizarlo, use un proceso local de confianza con la clave administrativa de Testing y el JWT afectado leído desde un almacén temporal protegido; invoque `auth.admin.signOut(jwt, "global")`. No guardes ese JWT en Git ni lo imprimas. Después, fuerza un cambio de contraseña y pide iniciar sesión de nuevo.

La revocación global invalida los refresh tokens y evita renovar la sesión, pero un access token JWT ya emitido puede continuar verificándose hasta su `exp`. Comprueba la expiración configurada en Auth; espera ese intervalo antes de considerar que desapareció el riesgo residual. Si se requiere cortar JWTs inmediatamente, trátalo como incidente y evalúa la rotación de la clave de firma, que tiene impacto en todas las sesiones del proyecto; no hagas esa rotación como una corrección ordinaria del callback.

## Referencias

- [Supabase: Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase: Customizing email templates for local development](https://supabase.com/docs/guides/local-development/customizing-email-templates)
- [Supabase: Signing out](https://supabase.com/docs/guides/auth/signout)
- [Supabase JS: verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp)
