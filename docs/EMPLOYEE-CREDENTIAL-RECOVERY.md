# QR del empleado y requisito de clave

La credencial QR activa se persiste en PostgreSQL como SHA-256 para validación del escáner y como sobre AES-256-GCM cifrado para que la persona empleada pueda volver a mostrar su propio QR en `Mi credencial`. El texto en claro solo se conserva durante la solicitud de emisión o recuperación; la API de empleado responde `no-store, private`, deriva el expediente desde la sesión y no incluye el token en URLs ni logs. La RPC de recuperación comprueba sesión, membresía activa con rol `employee`, vínculo `auth_user_id` y expediente activo. La revocación elimina el sobre cifrado y conserva el digest revocado para auditoría/estado.

## Configuración requerida

`QR_CREDENTIAL_ENCRYPTION_KEY` es un secreto exclusivamente de servidor representado por exactamente 64 caracteres hexadecimales (32 bytes). Puede generarse localmente con `openssl rand -hex 32`; guarda la salida directamente en el gestor de secretos aprobado, no en el chat, el repositorio, una captura, un archivo del proyecto ni en `NEXT_PUBLIC_*`.

### Configurarla en Dokploy

1. Genera una clave nueva en un terminal privado: `openssl rand -hex 32`.
2. En Dokploy, abre el servicio de la aplicación del entorno correspondiente y entra a su configuración de variables de entorno/secrets del contenedor.
3. Añade `QR_CREDENTIAL_ENCRYPTION_KEY` con el valor generado. Debe estar disponible solo para el servidor Next.js, sin prefijo `NEXT_PUBLIC_`.
4. Guarda y reinicia/reconstruye el servicio siguiendo el procedimiento de operación de ese entorno. La aplicación necesita leer la variable en el proceso del servidor.
5. Comprueba la configuración desde el mensaje de estado de credenciales y una operación autorizada. No imprimas ni copies la clave a logs.

Mantén exactamente la misma clave estable en reinicios y nuevas versiones mientras exista cualquier sobre cifrado. Perderla o cambiarla sin volver a cifrar las credenciales hará irrecuperables los QR cifrados con la clave anterior. No rotes la clave sin un plan explícito de descifrado/re-cifrado. Si la variable falta o no tiene el formato exacto, la API muestra un aviso administrativo claro y bloquea emisión y recuperación para no crear QR que no se puedan volver a mostrar. Esta documentación no confirma que la variable ya esté configurada en ningún entorno.

Las migraciones canónicas separan las responsabilidades: `20261109011259_optional_employee_pin_requirement.sql` hace optativo el PIN con valor predeterminado `false`; `20261107220000_employee_self_service_qr_display.sql` añade el ciphertext y la RPC de estado/recuperación propia; `20261107230000_optional_attendance_pin_and_recoverable_qr.sql` conserva la autorización/auditoría de revocación y borra el ciphertext al revocar; `20261110011000_admin_employee_qr_credential_recovery.sql` añade la lectura administrativa no mutante del sobre activo con autorización de empresa y `employees.manage`. Deben aplicarse en orden mediante el flujo autorizado de cada entorno; esta tarea no aplica migraciones remotamente.

Las credenciales creadas antes de habilitar el almacenamiento cifrado contienen solo el hash irreversible. No es posible reconstruir su QR. Después de configurar la clave y aplicar las migraciones requeridas, un administrador deberá regenerar cada QR antiguo que necesite volver a mostrar; la regeneración invalida el QR anterior.

En el expediente administrativo, **Mostrar QR** consulta la credencial activa existente. No emite ni rota el token; se puede volver a usar después de cerrar la vista. La API obtiene el sobre cifrado, lo descifra en el servidor y entrega el QR con `Cache-Control: no-store, private`. El hash usado para validar el QR nunca se devuelve. Si el QR está revocado, no puede recuperarse; si solo tiene hash y no sobre cifrado, la pantalla indica que hace falta una regeneración única. Revocar una credencial elimina su sobre cifrado.

La emisión y recuperación del QR dependen de la autorización administrativa, de que el expediente esté activo y de una clave de cifrado válida. No dependen de RFC ni NSS.

## PIN opcional

`20261109011259_optional_employee_pin_requirement.sql` añade `companies.require_employee_pin`, `NOT NULL DEFAULT false`. Por tanto, las empresas existentes quedan con PIN desactivado inicialmente; no se altera ni elimina su hash PIN. Un owner/admin con `company.manage` puede cambiarlo desde Configuración → Asistencia. El Route Handler acepta un PIN vacío para no romper el contrato de transporte, pero las RPC SQL consultan la preferencia de empresa: si está activada, mantienen íntegra la verificación, los intentos y el lockout; si está desactivada, omiten exclusivamente la verificación PIN. Autenticación, credencial QR, empresa, sucursal, dispositivo, transiciones e idempotencia permanecen obligatorias.

## Validación local

Las pruebas unitarias usan claves y credenciales sintéticas. La prueba pgTAP y la integración PostgreSQL de PIN solo deben ejecutarse en una instancia Supabase local desechable cuyo `project_id` esté marcado `qr_pin_lockout_disposable_*`. Ninguna prueba de esta documentación autoriza acceso o cambios en Testing o Producción.
