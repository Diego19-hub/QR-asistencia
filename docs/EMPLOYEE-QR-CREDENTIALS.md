# Credencial QR del empleado

El token QR se guarda en PostgreSQL como SHA-256 para validación por el escáner y, desde la migración `20261107220000_employee_self_service_qr_display.sql`, como ciphertext AES-256-GCM para que el empleado vinculado pueda volver a mostrar su credencial. El token en claro nunca se persiste. El portal obtiene el sobre cifrado únicamente mediante `get_own_employee_credential_status`, que exige sesión, membresía activa de empleado y coincidencia de `employees.auth_user_id`; la API lo descifra en el servidor, devuelve solo el token propio con `Cache-Control: no-store, private` y la interfaz genera la imagen QR.

Configura `QR_CREDENTIAL_ENCRYPTION_KEY` solo en el entorno del servidor con 32 bytes codificados como 64 caracteres hexadecimales. Se puede generar con `openssl rand -hex 32`; custódiala como secreto independiente, no en Git ni junto con respaldos. La clave no debe rotarse sin un plan de recifrado: perderla hace irrecuperables las copias cifradas. Si falta o no es válida, la emisión falla de forma cerrada y el portal no entrega un token.

Las credenciales activas emitidas antes de esta capacidad no tienen ciphertext recuperable. Siguen siendo válidas para el escáner, pero el portal informa que necesitan regeneración administrativa. La regeneración usa el RPC administrativo existente, invalida el token anterior y escribe su hash y ciphertext en una sola transacción. Revocar limpia el acceso visible del portal porque el RPC propio no devuelve ciphertext para credenciales revocadas.

`/mi-qr` solo presenta la credencial. No registra asistencia, no verifica PIN ni cambia el token. El empleado puede actualizar el portal para recibir una emisión nueva después de que la administración la regenere.
