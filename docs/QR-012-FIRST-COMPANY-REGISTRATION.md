# QR-012 — Registro de primera empresa y Owner

## Diagnóstico

El error que ve la persona no demuestra que la contraseña sea incorrecta. En `src/app/(auth)/login/actions.ts`, el rechazo de Auth por correo aún no confirmado seguía la misma rama que cualquier error 4xx y terminaba en `credentials`; el formulario traduce ese código al texto “No se pudo iniciar sesión. Revisa tus datos e inténtalo de nuevo”. El alta comunicaba que debía confirmar, pero no ofrecía reenvío. Un fallo de entrega después de que Auth aceptara el alta podía dejar el correo sin confirmación y sin una acción visible para recuperarlo.

La identidad, empresa y Owner se crean en etapas distintas cuando Auth exige confirmación. La RPC `create_first_company_for_current_user` ya protege la segunda etapa: exige `auth.uid()` confirmado, serializa reintentos por identidad y crea empresa, datos sensibles, auditoría y membresía Owner en la misma transacción. Si la cuenta ya tiene una membresía Owner única, devuelve la empresa existente. La política de contraseñas no debe modificarse para resolver este flujo.

## Cambio

- El login mantiene una respuesta de credenciales genérica y añade una instrucción que sirve para cualquier cuenta: confirmar primero y volver a “Crear empresa” para pedir otro enlace. No revela el estado de una cuenta.
- El alta ofrece reenvío mediante `supabase.auth.resend({ type: "signup", email })`. La acción normaliza el correo con el mismo esquema y devuelve el mismo mensaje para correo desconocido, cuenta confirmada, limitación de frecuencia, error de Auth o éxito. No registra credenciales ni tokens.
- Los errores de registro que pueden ocurrir después de que Auth haya aceptado la identidad conservan el correo enviado por la persona y ofrecen reenvío; una repetición con correo usado no confirma ni niega que exista una cuenta.
- La confirmación OTP del servidor redirige a un callback de destino cerrado. El callback solo continúa a `/crear-empresa` con una sesión validada por `getUser()` y correo confirmado. El callback de invitación conserva su ruta y requisito de código.
- La contraseña se pasa literalmente a `signUp`. El reenvío y una repetición de alta no llaman a `updateUser` ni establecen una contraseña nueva.
- El E2E de confirmación activa ahora verifica el mensaje, reenvío, OTP, callback, login, creación como Owner y aislamiento entre empresas. Una segunda ejecución dirigida usa Auth local con confirmación desactivada y comprueba creación inmediata, logout y login. También se comprueba una repetición con contraseña distinta y posterior login usando la contraseña original.

## Verificación

| Comando | Resultado |
|---|---|
| `npm run test:auth-flow` | PASS, 14 pruebas |
| `npm run test:company-registration` | PASS, 4 pruebas |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:company-registration:e2e` | No inició: el cliente Docker respondió `Cannot connect to the Docker daemon`. No hubo stack local ni cambios de datos. |

Las pruebas unitarias mostraron advertencias preexistentes de Node `MODULE_TYPELESS_PACKAGE_JSON`. La prueba SQL `supabase/tests/first_company_registration_test.sql` ya verifica sesión confirmada, empresa y Owner únicos, reintento idempotente, denegación sin confirmación y protección multiempresa. No se ejecutó pgTAP porque requiere el stack local desechable y Docker no está disponible.

## Estado

El cambio está implementado y las validaciones estáticas/unitarias pasaron. QR-012 permanece **En curso** hasta ejecutar `npm run test:company-registration:e2e` con Docker iniciado, que ejecuta ambos modos de confirmación en Supabase local desechable. No se consultó ni modificó Testing o Producción.
