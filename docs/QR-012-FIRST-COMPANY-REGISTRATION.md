# QR-012 — Registro de primera empresa y Owner

## Resultado esperado

Crear cuenta con email/contraseña no requiere correo de confirmación. Supabase Auth devuelve la sesión, el servidor crea empresa y membresía Owner de forma atómica e idempotente, persiste las cookies de sesión por 30 días y redirige a `/admin`. La vigencia JWT se conserva en una hora. El alta solicita si opera una persona física con actividad empresarial o una persona moral, valida estructura y longitud RFC (13/12) y guarda la opción en la empresa.

## Cambios locales

- `supabase/config.toml` conserva `auth.email.enable_confirmations = false`. El runner E2E ya no la cambia a `true` y exige el valor desactivado para el registro local.
- `registerOwner` no configura `emailRedirectTo` ni ofrece reenvío de confirmación. Si Auth no devuelve sesión, explica que debe desactivarse la confirmación y no crea empresa.
- Antes de crear el cliente que ejecuta `signUp`, la acción marca la preferencia de sesión persistente. `src/lib/supabase/server.ts` aplica 30 días a las cookies SSR de Supabase. No cambia el JWT.
- Con sesión, `create_first_company_for_current_user` crea empresa, datos sensibles, auditoría y Owner en una transacción; reintentos de la RPC devuelven la misma empresa.
- La pantalla de registro y “Crear otra empresa” preguntan el tipo de contribuyente. El RFC se normaliza a mayúsculas; la aplicación comunica que valida formato, no vigencia ante el SAT. Los RPC validan nuevamente formato/tipo en servidor.
- `20261117090000_add_company_taxpayer_type.sql` agrega `companies.taxpayer_type` nullable y restringido a los dos valores conocidos. Los registros existentes conservan `NULL`; no se deduce tipo desde RFC histórico. RPCs tipados asignan el tipo solo si está vacío, por lo que un reintento no cambia el tipo existente. Los clientes dejan de poder llamar las firmas internas sin tipo.
- `20261117120000_allow_company_rfc_by_taxpayer_type.sql` amplía los validadores internos para aceptar ambas estructuras. Los RPC públicos validan primero que tipo y RFC coincidan (persona física: 13; persona moral: 12).
- El E2E sintético verifica que no se envía correo de confirmación, que el alta entra al dashboard y que la sesión/cookies duran aproximadamente 30 días. Otro caso intenta registrar un correo existente con una contraseña distinta y después inicia sesión con la contraseña original.
- La configuración de invitaciones, enlaces Auth y confirmación de cambios de correo se conserva; el correo de recuperación de contraseña no se desactiva. No se cambió configuración alojada.

## Supabase alojado

En cada proyecto que deba usar este flujo, desactiva **Confirm email** en Auth → Providers → Email antes de habilitar el registro. Supabase documenta que esa verificación está activada por defecto en proyectos alojados y se controla en Auth Providers; localmente se configura en `supabase/config.toml` ([documentación de Supabase](https://supabase.com/docs/guides/auth/passwords)). No es una migración y debe aplicarse por separado en el proyecto Supabase correspondiente. El cambio conserva las plantillas de invitación y los correos de recuperación. No inspeccioné ni modifiqué proyectos alojados.

## Formato del RFC

El SAT documenta RFC de 12 posiciones para persona moral y 13 para persona física, y ofrece por separado herramientas para verificar registro/existencia; por ello la validación local se limita a longitud y estructura sintáctica ([estructura del RFC](https://www.sat.gob.mx/cs/Satellite?blobcol=urldata&blobkey=id&blobtable=MungoBlobs&blobwhere=1461176322651&ssbinary=true), [verificación de inscripción al RFC](https://wwwmat.sat.gob.mx/aplicacion/29073/verifica-si-estas-registrado-en-el-rfc)). El CFF contempla personas físicas y morales como sujetos de obligaciones fiscales y su artículo 27 regula inscripción/avisos del RFC ([CFF, Cámara de Diputados](https://www.diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf)); el artículo 100 de la LISR regula ingresos de personas físicas por actividades empresariales y profesionales ([LISR, Cámara de Diputados](https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf)). La app no determina régimen fiscal ni acredita vigencia ante el SAT.

## Verificación

| Comando | Resultado |
|---|---|
| `npm run test:auth-flow` | PASS, 14/14 |
| `npm run test:company-registration` | PASS, 4/4 |
| `npm run test:company-creation` | PASS, 4/4 |
| `node --experimental-strip-types --test tests/deployment-readiness.test.mjs` | PASS, 8/8 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:company-registration:e2e` | PASS, 2/2; Supabase local desechable, identidades sintéticas |
| `npm run test:company-registration:db` | PASS, 31/31 pgTAP; PostgreSQL local desechable |
| `npm run test:company-sensitive-data:db` | PASS, 91/91 pgTAP, incluida creación tipada de empresa adicional; PostgreSQL local desechable |

Para la validación integral se usaron únicamente stacks locales desechables, con IDs aleatorios y datos sintéticos. El E2E cubrió registro de persona física sin correo, sesión/cookies de 30 días, creación de empresa y Owner, redirección al dashboard y reintento con correo existente/contraseña distinta seguido de login con la contraseña original. pgTAP cubrió RFC físico de 13 caracteres, moral de 12, tipo/longitud incompatibles, normalización, persistencia e idempotencia. Los runners confirmaron limpieza de sus stacks y preservación de recursos Docker preexistentes.

El primer E2E reveló que las RPC internas aún rechazaban RFC físicos de 13 caracteres aunque el RPC tipado los aceptaba; se corrigió en `20261117120000_allow_company_rfc_by_taxpayer_type.sql`. También se ajustó el selector del mensaje genérico y se completaron los campos obligatorios del escenario de reintento.

No se consultó ni modificó Testing, Producción, la cuenta o la empresa Juvenal. No hubo cambios de contraseña ni migraciones remotas.
