# QR del empleado y requisito de clave

La credencial QR activa se persiste en PostgreSQL como SHA-256 para validación del escáner y como sobre AES-256-GCM cifrado para que la persona empleada pueda volver a mostrar su propio QR en `Mi credencial`. El texto en claro solo se conserva durante la solicitud de emisión o recuperación; la API de empleado responde `no-store, private`, deriva el expediente desde la sesión y no incluye el token en URLs ni logs. La RPC de recuperación comprueba sesión, membresía activa con rol `employee`, vínculo `auth_user_id` y expediente activo. La revocación elimina el sobre cifrado y conserva el digest revocado para auditoría/estado.

## Configuración requerida

`QR_CREDENTIAL_ENCRYPTION_KEY` es un secreto exclusivamente de servidor que debe codificar 32 bytes en Base64URL. Debe aprovisionarse en cada entorno mediante su almacén de secretos y mantenerse estable mientras existan credenciales cifradas. No añadirlo a `NEXT_PUBLIC_*`, Git, logs o imágenes cliente. Si falta o es inválido, la API rechaza la emisión/recuperación con un error genérico y el código QR no se muestra.

La migración `20261107230000_optional_attendance_pin_and_recoverable_qr.sql` añade la columna cifrada y la RPC de recuperación propia. Debe aplicarse mediante el flujo de migraciones autorizado de cada entorno antes de habilitar esta versión; esta tarea no la aplica remotamente.

Las credenciales creadas antes de esta migración contienen solo el hash irreversible. No es posible reconstruir su QR. Después de configurar la clave y aplicar la migración, un administrador deberá regenerar cada QR que necesite aparecer en el portal; la regeneración invalida el QR anterior.

## PIN opcional

La misma migración añade `companies.require_employee_pin`, `NOT NULL DEFAULT false`. Por tanto, las empresas existentes quedan con PIN desactivado inicialmente; no se altera ni elimina su hash PIN. Un owner/admin con `company.manage` puede cambiarlo desde Configuración → Asistencia. El Route Handler acepta un PIN vacío para no romper el contrato de transporte, pero las RPC SQL consultan la preferencia de empresa: si está activada, mantienen íntegra la verificación, los intentos y el lockout; si está desactivada, omiten exclusivamente la verificación PIN. Autenticación, credencial QR, empresa, sucursal, dispositivo, transiciones e idempotencia permanecen obligatorias.

## Validación local

Las pruebas unitarias usan claves y credenciales sintéticas. La prueba pgTAP y la integración PostgreSQL de PIN solo deben ejecutarse en una instancia Supabase local desechable cuyo `project_id` esté marcado `qr_pin_lockout_disposable_*`. Ninguna prueba de esta documentación autoriza acceso o cambios en Testing o Producción.
