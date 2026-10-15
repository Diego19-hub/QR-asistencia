# Gestión de usuarios y accesos

## Flujo

- No existe alta pública de administradores. El bootstrap inicial existente conserva su restricción de operador y no se ejecuta desde la aplicación.
- Toda persona inicia sesión en `/login`. Si tiene una sola membresía activa, entra al módulo de ese rol; con varias, `/seleccionar-empresa` requiere elegir empresa y rol. Las invitaciones pendientes se aceptan en `/invitacion` tras autenticar el correo correspondiente.
- Propietarios y administradores con `company.manage` consultan **Configuración → Usuarios y accesos**. Administradores pueden invitar empleados y supervisores; solo el propietario puede invitar, cambiar o desactivar administradores. El rol `owner` no se asigna desde esta pantalla.
- Las membresías se aceptan mediante una función transaccional que compara el email autenticado con la invitación. Un expediente de empleado puede vincularse durante esa aceptación o desde la lista de accesos para una membresía employee activa ya existente. En ambos casos el expediente debe estar activo, sin cuenta vinculada y tener un email igual al correo Auth confirmado cuando el expediente ya define uno.
- La desactivación apaga la membresía dentro de esa empresa. No bloquea la identidad de Auth global, que podría pertenecer a otras empresas. Al desactivar o degradar a un supervisor se revocan sus dispositivos y asignaciones de sucursal.
- El registro laboral de una persona puede permanecer sin cuenta de acceso. El QR físico y la toma de asistencia supervisada continúan por sus flujos existentes.

## Migración local pendiente

`supabase/migrations/20261012143000_company_user_access_management.sql` crea invitaciones con vigencia, RLS y RPCs con `SECURITY DEFINER` y `search_path` vacío; elimina escritura directa de `authenticated` sobre `company_memberships`, conserva lectura propia y deja intacta la función bootstrap. Incluye auditoría, restricciones de empresa, comprobación de rol del invitador y aceptación por email autenticado.

La migración está creada localmente. **No se aplicó a Supabase Testing ni a producción.** La pantalla Usuarios y accesos devuelve un error de configuración hasta aplicar esta migración en un proyecto expresamente autorizado. No hay cambios de esquema remotos en este trabajo.

## Configuración requerida antes de activar invitaciones

1. En Supabase Auth, desactiva el registro público y conserva la creación de usuarios por invitación administrativa.
2. Configura SMTP de Auth y un remitente verificado para el correo inicial de invitación. En **URL Configuration**, establece el `Site URL` HTTPS de la aplicación y agrega los callbacks exactos `https://DOMINIO/auth/callback` y `https://DOMINIO/auth/confirm` a la lista de redirecciones autorizadas. Para el template de invitación usa el enlace de confirmación SSR `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`; la ruta valida el token con Supabase Auth y envía al usuario a `/invitacion` para establecer su contraseña.
3. Configura `APP_BASE_URL` como el origen HTTPS canónico. No se acepta una URL con usuario, contraseña, query o fragmento.
4. Configura `SUPABASE_SERVICE_ROLE_KEY` en el gestor de secretos del backend de Next.js, solo para que el endpoint de invitaciones llame a `auth.admin.inviteUserByEmail`. No usar prefijo `NEXT_PUBLIC_`, no incluirla en GitHub Actions ni en el cliente.
5. Para notificar/reinvitar a una dirección que ya tiene una identidad Auth, Supabase Auth no emite un segundo invite de alta. Si se desea enviar un enlace de acceso de un solo uso, configura `RESEND_API_KEY` y `INVITATION_FROM_EMAIL` en el backend. Si no se configuran, la invitación queda pendiente y el usuario existente debe iniciar sesión para verla; la interfaz no afirma que se haya enviado correo. Los links mágicos solo se generan en backend y se envían al proveedor; nunca se devuelven ni registran.
6. Revisa los límites y plantillas de correo en un entorno de pruebas. Este cambio no envía invitaciones reales ni modifica configuración remota.

`.env.example` contiene nombres y valores ficticios. No copiar credenciales reales al repositorio. La configuración local `supabase/config.toml` desactiva signup público solo para el stack local; cambia Auth Testing/producción manualmente con autorización independiente.

## API y autorización

- `GET /api/admin/access?companyId=...`: usuarios, estado de membresía/confirmación, invitaciones, sucursales y expedientes disponibles para vincular.
- `POST /api/admin/access?companyId=...`: registra una invitación en el ámbito seleccionado y entrega el correo solo desde backend.
- `PATCH /api/admin/access?companyId=...`: cambia un rol permitido, vincula un expediente de empleado, desactiva una membresía en la empresa o revoca una invitación.
- `POST /api/admin/access/invitations/:id/resend?companyId=...`: vuelve a entregar por Auth SMTP o genera un enlace Auth de un uso mediante el proveedor configurado.
- `PATCH /api/supervisors`: la asignación de sucursales reutiliza `set_supervisor_branch`; la pantalla Supervisores conserva autorización de `devices.manage`.
- `/auth/callback` intercambia el código Auth y solo permite continuar a `/invitacion`.

Todas las rutas consultan `auth.getUser()`, una membresía administrativa activa, `company.manage` y el `companyId` solicitado. La base vuelve a comprobar esos límites; las llamadas del navegador nunca usan el service role. Los cambios de acceso quedan en `audit_log`.

## Validación local y siguientes pasos

`npm run test:user-access` cubre normalización del email, roles invitables, prevención de escalada y selección explícita de membresía. `supabase/tests/company_user_access_management_test.sql` comprueba grants, RLS, RPCs y que el bootstrap siga limitado a `service_role`; requiere ejecutarse en una base local aislada con Supabase CLI/pgTAP.

Antes de activar en Testing: revisar y aplicar la migración solo con autorización, ejecutar pgTAP, probar un Auth invite real con una dirección controlada, validar callback y SMTP, probar cuenta Auth existente y nueva, y verificar roles/sucursales con dos empresas sintéticas. No se enviaron correos ni se crearon usuarios en este trabajo.
