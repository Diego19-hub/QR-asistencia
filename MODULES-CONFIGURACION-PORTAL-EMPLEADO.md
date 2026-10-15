# Configuración administrativa y portal del empleado

## Configuración

Ruta: `/admin/configuracion`.

- Consulta nombre comercial, razón social y RFC de la empresa activa.
- `PATCH /api/company` valida campos y RFC, y actualiza solo la empresa de la membresía seleccionada. RLS y `company.manage` son obligatorios. El trigger existente registra el cambio en `audit_log`.
- `GET/POST/PATCH /api/branches` reutiliza la ruta de sucursales. Las escrituras requieren `company.manage`; la desactivación conserva la sucursal y su historial.
- `/api/admin/permissions` presenta el catálogo base de permisos por rol en modo lectura.
- `/api/admin/audit` filtra por fechas y acción, pagina en el servidor y devuelve solo metadatos de auditoría; no devuelve las columnas JSON `before_data` o `after_data`.
- Cada API verifica `getUser()`, la membresía activa y que `companyId` pertenezca al usuario. La lista de sucursales, empresas y auditoría siempre se consulta por la empresa seleccionada.

## Portal del empleado

Ruta: `/mi-qr`.

- `GET /api/employee/portal` deriva el empleado desde `auth.uid()`, `employees.auth_user_id`, el estado activo del perfil y una membresía activa con rol `employee`. No recibe un `employeeId` del cliente.
- Presenta empresa, sucursal, horario vigente, jornadas paginadas, cálculos de tiempo, solicitudes de horas extra y estado de credencial.
- La vista no registra asistencias. Entrada, descansos y salida siguen pasando por el escáner autorizado del supervisor.
- El portal no obtiene tokens QR, hashes ni PIN. Explica que el QR original solo se entrega una vez durante su emisión y que una regeneración invalida el anterior.
- Una cuenta autenticada sin perfil vinculado recibe un estado genérico sin datos de empleados.

## Migración local pendiente

`supabase/migrations/20261012120000_employee_portal_self_service.sql` agrega políticas RLS de lectura propia condicionadas a `auth.uid()`, empresa y membresía activa de empleado; endurece las políticas existentes de lectura propia para empleados inactivos; y agrega dos RPC:

- `current_user_has_company_permission(uuid,text)`: comprobación booleana bajo la identidad del usuario para respetar `company.manage` y los overrides.
- `get_own_employee_credential_status(uuid,uuid)`: devuelve solo estado y fechas de la credencial del empleado autenticado; no selecciona ni devuelve el hash.

La migración no cambia las funciones del escáner, las reglas de asistencia, los datos existentes ni la migración del lease. Debe revisarse y aplicarse primero en un entorno aislado antes de desplegar las APIs y el frontend que consumen las RPC nuevas. No se aplicó a Supabase Testing ni a producción durante este trabajo.

## Verificación local

- `npm test`: aprobada; incluye ocho casos de alcance del portal y las suites existentes de reportes, escáner, credenciales y preparación de despliegue.
- `npm run typecheck`: aprobada después del build.
- `npm run lint`: aprobada.
- `npm run build`: aprobada con Next.js 16.4.0.
- `git diff --check`: aprobado.
- `supabase/tests/employee_portal_access_test.sql` contiene 18 comprobaciones de catálogo, grants, RLS y RPC. `supabase/tests/employee_portal_rls_behavior_test.sql` añade 21 verificaciones de comportamiento con roles JWT sintéticos (owner, admin, supervisor, empleados de dos empresas y membresía inactiva). No se ejecutó pgTAP porque no se inició una instancia de base aislada.

No se realizó una prueba HTTP autenticada ni inspección visual en navegador: no había un entorno autenticado local aislado disponible. No se hicieron solicitudes a Supabase remoto. Antes de declarar ambos módulos listos para validación funcional, hay que aplicar la migración en Testing con autorización independiente y ejecutar pruebas JWT para owner, admin, supervisor, empleado, perfil no vinculado y membresía inactiva, además de revisar las interfaces en escritorio y móvil.
