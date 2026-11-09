# Manual de usuario de QR-asistencia

Esta guía describe las pantallas y acciones encontradas en el código actual. Los nombres de algunos botones pueden variar si la versión desplegada es distinta. La revisión fue de código: **no se recorrió la aplicación en un navegador**, por lo que los puntos al final marcados «Por verificar» requieren comprobación visual.

## 1. Iniciar sesión y elegir empresa

### Iniciar sesión

1. Abre `/login`.
2. Escribe el correo y la contraseña de tu cuenta de trabajo.
3. Opcionalmente, marca **Mantener sesión iniciada en este dispositivo**. En un dispositivo compartido, déjala desactivada.
4. Pulsa **Entrar**.

Si la cuenta tiene una invitación pendiente, la aplicación puede llevarte primero al flujo de invitación. Si no tiene una membresía activa, muestra un aviso para contactar a la administración. Si los datos no son aceptados, revisa que estés usando la cuenta correcta o solicita ayuda a la administración; no compartas tu contraseña.

### Elegir empresa y rol

- Si tu cuenta tiene más de una membresía activa, abre `/seleccionar-empresa` y elige la empresa junto al rol con el que vas a trabajar. Pulsa **Continuar**.
- Si solo tienes una opción activa, la aplicación puede abrir directamente el espacio correspondiente a tu rol.
- En el panel administrativo también hay un selector de empresa. Cambiarlo cambia el alcance de la pantalla a esa empresa; las acciones del servidor vuelven a comprobar la membresía y los permisos.

Destinos habituales: Owner y Administrador → `/admin`; Supervisor → `/scanner`; Empleado → `/mi-qr`.

**Resultado esperado:** entras al espacio del rol activo; si hay varias membresías, eliges explícitamente empresa y rol. La selección no otorga permisos que no tenga esa membresía.

## 2. Owner: administrar la empresa

El Owner puede administrar las empresas de las que tiene una membresía activa de propietario. El acceso no le da permisos sobre empresas ajenas.

### Abrir configuración

1. Entra al panel `/admin`.
2. En el menú, abre **Configuración** (`/admin/configuracion`).
3. Usa las secciones **Empresa**, **Asistencia**, **Sucursales** y **Configuración avanzada**.

En **Empresa** puedes consultar y editar el nombre de la empresa, domicilio, RFC de persona moral y número de registro patronal. La razón social es opcional. El RFC se guarda en mayúsculas y debe cumplir el formato de persona moral. Los cuatro datos obligatorios se validan al guardar. El servidor exige `company.manage` y limita las operaciones a la empresa seleccionada; el RFC y los datos patronales se guardan en almacenamiento privado.

### Crear otra empresa

1. En la parte superior del panel administrativo, pulsa **Crear otra empresa**. Esta opción está disponible cuando la membresía activa seleccionada tiene rol Owner.
2. Completa nombre, domicilio, RFC de persona moral de 12 caracteres y número de registro patronal. La razón social es opcional.
3. Envía el formulario y revisa el resultado.
4. La aplicación cambia a la empresa recién creada, donde el usuario queda como Owner.

Cada empresa tiene su propio alcance de datos. Para volver a la anterior, elígela en el selector de empresas si sigue disponible en tu cuenta.

**Resultado esperado:** aparece una empresa nueva asociada a tu cuenta como Owner y el panel cambia a ella. El código valida la creación en el servidor.

### Usuarios, membresías y permisos

En **Configuración → Configuración avanzada → Usuarios y accesos** (`/admin/configuracion#avanzada`) puedes:

- Consultar membresías de la empresa.
- Invitar por correo con rol de Administrador, Supervisor o Empleado.
- Reenviar o revocar invitaciones.
- Compartir manualmente un enlace individual de invitación cuando la interfaz lo ofrece. El enlace es para la persona destinataria y no sustituye la verificación de identidad.
- Cambiar roles permitidos, desactivar accesos y vincular una membresía de empleado con un expediente.

El Owner puede administrar también membresías de Administrador. Las invitaciones y cambios dependen de `company.manage`, de las reglas del rol y de la validación del servidor. La invitación no convierte a quien recibe el enlace en una persona autenticada automáticamente: debe completar el acceso con la identidad invitada.

**Resultado esperado:** los cambios solo afectan las membresías de la empresa activa y quedan sujetos a las reglas de rol y auditoría del sistema. El Administrador no puede cambiar membresías Owner; Owner sí puede gestionar membresías Administrador.

## 3. Administrador: empleados, invitaciones y horarios

El Administrador trabaja dentro de la empresa seleccionada y de los permisos efectivos de su membresía. El código de permisos base no le concede `overtime.manage`; una autorización revocada también puede limitar acciones que normalmente están disponibles para su rol.

### Empleados

1. En el menú del panel, abre **Empleados** (`/admin/empleados`).
2. Para crear un expediente, pulsa **Nuevo empleado** y captura nombre(s), apellidos, NSS de 11 dígitos e identificador interno. El RFC personal es opcional; si lo agregas, se normaliza a mayúsculas y debe tener el formato mexicano de persona física. Correo, sucursal y fecha de ingreso se completan según las necesidades del expediente.
3. Usa la lista para localizar un expediente y pulsa **Ver expediente**. El directorio no muestra NSS ni RFC completos.
4. En el expediente puedes completar o editar esos datos con los demás datos laborales. El NSS se muestra parcialmente oculto y el RFC personal enmascarado; al editar, el formulario presenta los valores para que un rol autorizado pueda corregirlos.
5. Las credenciales QR se emiten o regeneran desde la administración; regenerar invalida la anterior.

El NSS y el RFC personal son datos sensibles. Se consultan mediante una operación de servidor para Owner/Administrador con permiso de lectura de empleados; no aparecen en listados, reportes o mensajes de error. Los registros existentes pueden completar el NSS en el expediente. La razón social de empresa es opcional.

La cuenta de acceso de una persona y su expediente de empleado son elementos relacionados, pero distintos. Para que una persona use el portal de empleado, la membresía debe estar vinculada a un expediente activo.

### Invitaciones y roles

1. Abre **Configuración → Configuración avanzada → Usuarios y accesos**.
2. Escribe el correo destinatario, elige un rol permitido y, para un Empleado, selecciona el expediente si corresponde.
3. Envía la invitación. La pantalla informa si se envió un correo, si hace falta completar la cuenta o si hubo un error de entrega.
4. Para una invitación pendiente puedes reenviar el correo, revocarla o generar un enlace manual para compartir, si la acción aparece habilitada.

El Administrador puede administrar roles no propietarios conforme a la política de la empresa, pero no puede asignar ni administrar el rol Owner. No envíes enlaces a personas distintas de la invitada.

### Sucursales

Abre **Configuración → Sucursales**. Crea o edita una sucursal y configura su zona horaria; puedes activar o desactivar sucursales según los permisos. Los horarios y accesos de supervisores deben asociarse a una sucursal activa de la empresa.

### Horarios

1. Abre **Horarios** (`/admin/horarios`).
2. Selecciona una sucursal activa y crea una plantilla con nombre, tipo de jornada, días y horas. Si aplica, configura descansos y tolerancia de entrada.
3. Guarda la plantilla.
4. Usa la opción de asignación para elegir una plantilla, una sucursal, uno o varios empleados y las fechas de vigencia.
5. Revisa el historial o calendario que ofrece la pantalla para confirmar la asignación.

El servidor valida que sucursal y empleados pertenezcan a la empresa seleccionada y que la sucursal esté activa. La disponibilidad concreta de cada acción depende del permiso `schedules.manage`.

**Resultado esperado:** queda guardada una plantilla o asignación para empleados de la sucursal activa seleccionada. Owner y Administrador pueden operar según sus permisos efectivos; otros roles no administran horarios desde este módulo.

## 4. Supervisor: escáner y asistencia

### Acceso al escáner

1. Inicia sesión con una membresía activa de rol Supervisor.
2. Si tienes varias empresas o roles, selecciona la membresía de Supervisor correspondiente.
3. Abre `/scanner`.
4. Debes tener al menos una sucursal activa asignada por la administración.
5. Pulsa el botón para abrir la cámara. El navegador o el sistema operativo puede pedir permiso de cámara; concédelo si corresponde.

La asignación de una sucursal activa habilita automáticamente el navegador para esa membresía al abrir el escáner; no se requiere una aprobación administrativa adicional del navegador en el flujo actual. La autorización se limita a la empresa y sucursales asignadas. Quitar la asignación o desactivar la membresía bloquea el acceso a ese alcance.

**Resultado esperado:** con membresía y sucursal activas aparece el contexto autorizado del escáner. Un Owner, Administrador o Empleado no obtiene acceso al escáner por su rol; debe existir una membresía activa de Supervisor.

### Registrar un movimiento

Con el escáner autorizado y la cámara habilitada:

1. Escanea la credencial QR activa del empleado.
2. Selecciona el movimiento disponible (por ejemplo, entrada, descanso o salida), siguiendo las reglas de la jornada.
3. Si la empresa requiere PIN, solicita al empleado que lo introduzca en el flujo de confirmación. Si el requisito está desactivado, el sistema no solicita ni valida PIN.
4. Confirma el movimiento y espera el resultado en pantalla.

El servidor valida la sesión de Supervisor, empresa, sucursal, dispositivo y estado de la credencial. También aplica las reglas de secuencia e idempotencia para evitar movimientos inválidos o duplicados. No intentes registrar asistencia si la pantalla informa que la autorización o la sucursal no están disponibles.

**Resultado esperado:** la pantalla confirma el movimiento aceptado o presenta un error si falta autorización, la credencial no es válida o la secuencia no corresponde. El Empleado muestra su QR y no registra su propio movimiento desde `/mi-qr`.

## 5. Empleado: perfil, horario, historial, horas extra y QR

Abre `/mi-qr` con una sesión activa y una membresía de Empleado vinculada a un expediente activo.

El portal tiene estas secciones:

- **Inicio:** muestra el estado de la jornada reciente, el identificador del expediente y el resumen de tiempo.
- **Mi horario:** muestra la asignación vigente, días, horas y descansos configurados. Si no hay asignación, consulta a la administración.
- **Asistencias:** consulta jornadas recientes, movimientos, tiempos y cálculos. Puedes usar la paginación si hay más resultados.
- **Horas extra:** muestra excedente detectado y tiempo autorizado o pendiente por separado. Un excedente detectado no significa que esté autorizado.
- **Mi credencial / Mi QR:** muestra el QR propio cuando hay una credencial activa recuperable. Si aún no se emitió, está revocada o no se puede recuperar, pide a la administración que emita o regenere la credencial.

Mostrar el QR no registra asistencia ni solicita PIN. La asistencia se registra mediante un escáner autorizado. El portal solo carga el expediente vinculado a tu propia membresía; si el perfil no está vinculado, solicita a la administración que revise la asociación.

Si tienes más de un expediente asociado a membresías activas, el portal puede mostrar un selector para cambiar entre las opciones autorizadas.

**Resultado esperado:** el Empleado ve solo los expedientes vinculados a sus membresías activas; no administra horarios ni asistencias desde este portal. Owner, Administrador y Supervisor no usan `/mi-qr` salvo que también tengan una membresía activa de Empleado.

## 6. Configuración del PIN

El requisito de PIN es opcional y está desactivado por defecto para las empresas existentes en la migración correspondiente.

1. Entra como Owner o Administrador con permiso `company.manage`.
2. Abre **Configuración → Asistencia** (`/admin/configuracion#asistencia`).
3. Activa o desactiva **Requerir PIN del empleado**.
4. El cambio se guarda y la pantalla muestra el resultado.

Cuando está activado, el escáner requiere y valida el PIN del empleado antes de mostrar los movimientos disponibles. Cuando está desactivado, no se solicita ni se valida. Si aparece un mensaje que indica que la base de datos necesita una actualización, el ajuste no puede consultarse o guardarse hasta que el equipo administrador aplique y verifique la migración requerida en ese entorno. Esta guía no confirma el estado de ninguna base desplegada.

**Resultado esperado:** la configuración de la empresa queda guardada y se aplica también en el servidor. Owner y Administrador con `company.manage` pueden cambiarla; Supervisor y Empleado no.

## 7. Asistencias, reportes y tiempo extra

### Consultar y filtrar asistencias

1. En el menú del panel, abre **Asistencias** (`/admin/asistencias`).
2. Selecciona fechas, sucursal, empleado o estado.
3. Pulsa **Consultar**. Usa **Limpiar** para restablecer los filtros o **Hoy** para fijar el día actual.
4. Abre **Ver detalle** para consultar movimientos, descansos, horario e incidencias.

La consulta solo presenta datos de la empresa activa. El filtro de sucursal requiere una sucursal activa de esa empresa. La pantalla de registros consultada en el código permite ver y filtrar; **no muestra controles para confirmar o desconfirmar manualmente una asistencia**. Los movimientos se registran en el flujo de escáner.

**Resultado esperado:** se muestran jornadas del ámbito autorizado y el detalle asociado. Owner y Administrador dependen de sus permisos `attendance.read`; Supervisor tiene consulta de asistencia según su rol y sucursal. El Empleado consulta únicamente su propio historial en `/mi-qr`.

### Reportes y exportación

1. Abre **Asistencias → Reportes** (`/admin/reportes`).
2. Elige un periodo o fechas, y opcionalmente una sucursal, empleado o estado.
3. Pulsa **Consultar**.
4. Cuando los resultados y filtros estén cargados, usa **Descargar Excel** o **PDF**. Si el reporte es muy grande, reduce el periodo o aplica filtros.

La exportación depende del permiso `reports.read` y de las reglas de límite y tamaño del servicio. Los archivos disponibles en la pantalla son Excel y PDF.

**Resultado esperado:** el informe conserva los filtros consultados y descarga un archivo Excel o PDF cuando la cuenta tiene autorización y el tamaño está dentro del límite. No se encontró exportación en el portal del Empleado.

### Consultar horas extra

Abre **Asistencias → Horas extra** (`/admin/horas-extra`) para consultar excedentes, solicitudes y autorizaciones reflejadas en los registros. El componente actual muestra información de lectura; **no se encontraron controles en esta pantalla para aprobar o rechazar solicitudes**. La administración de horas extra requiere el permiso `overtime.manage` según el modelo de permisos, pero la acción visible para aprobar o rechazar queda **Por verificar**: no se encontró una interfaz de decisión en las pantallas revisadas.

## 8. Problemas comunes

- **No puedo iniciar sesión:** comprueba que el correo corresponde a la invitación o membresía activa. Si el enlace de invitación venció o no llegó, pide que revisen o reenvíen la invitación. No compartas la contraseña.
- **No aparece una empresa o un rol:** abre **Cambiar empresa o rol** o `/seleccionar-empresa`. Si no aparece una opción, la membresía podría estar inactiva o no existir; contacta a la administración.
- **No puedo abrir el panel administrativo:** Owner y Administrador pueden entrar al espacio administrativo, pero las acciones dependen de permisos efectivos. Un Supervisor o Empleado debe usar su espacio correspondiente.
- **No aparece una sucursal o no puedo usar el escáner:** solicita a la administración que confirme que tu membresía de Supervisor está activa y que tienes asignada una sucursal activa de la empresa seleccionada.
- **El navegador no abre la cámara:** comprueba el permiso de cámara en el navegador y en los ajustes del dispositivo. La aplicación no puede saltarse ese permiso. Vuelve al escáner y usa la acción explícita para abrir la cámara.
- **El escáner dice que el dispositivo no está autorizado o que falta una actualización:** actualiza la comprobación. Si el mensaje persiste, solicita que revisen la membresía, sucursal y migraciones requeridas para el entorno. No se resuelve aprobando un dispositivo de otra empresa.
- **El QR dice “Aún no emitida”, está revocado o no aparece:** solicita a la administración que emita o regenere tu credencial. La regeneración invalida la credencial anterior.
- **El escáner solicita un PIN:** la empresa tiene activado el requisito. Si no tienes PIN o no debería solicitarse, pide al Owner o Administrador con permiso `company.manage` que revise **Configuración → Asistencia**.
- **Configuración muestra “No fue posible cargar los datos” o un error de servicio:** actualiza una vez. Si persiste, contacta a la administración con el nombre de la pantalla y el mensaje visible; no envíes capturas con datos personales o secretos.
- **No aparece tu expediente en Mi QR:** pide que verifiquen que tu membresía de Empleado esté vinculada al expediente correcto y que el expediente esté activo.

## 9. Cerrar sesión

En el menú lateral del panel administrativo o en la parte superior del portal de empleado, pulsa **Cerrar sesión**. La aplicación cierra la sesión de autenticación y vuelve a `/login`. En un dispositivo compartido, cierra sesión al terminar aunque hayas elegido mantenerla en un dispositivo personal.

**Resultado esperado:** la siguiente navegación protegida requiere autenticación otra vez. El botón está disponible en panel y portal; Supervisor debe cerrar la sesión mediante el control general disponible en la navegación de su sesión. La ubicación exacta para ese rol queda **Por verificar** visualmente.

## Resumen de roles y permisos

| Rol | Espacio habitual | Acciones confirmadas por el modelo/código |
|---|---|---|
| Owner | `/admin` | Permisos base de administración dentro de sus empresas; puede crear otra empresa y administrar membresías de Administrador. Las políticas y permisos efectivos siguen limitando cada operación al tenant. |
| Administrador | `/admin` | Administración de empresa, empleados, accesos y horarios según permisos efectivos. El modelo base no incluye `overtime.manage` ni permite administrar el rol Owner. |
| Supervisor | `/scanner` | Escanear y registrar movimientos dentro de empresas y sucursales activas asignadas, con autorización de dispositivo y cámara. Puede consultar información de asistencia permitida por su rol. |
| Empleado | `/mi-qr` | Consultar su perfil vinculado, horario, asistencias, datos de horas extra y su propia credencial QR; no administra otros expedientes. |

Los permisos efectivos pueden cambiar por revocaciones y por empresa. Las acciones se validan en el servidor; ver un enlace o una pantalla no concede por sí mismo autorización.

## Aspectos por verificar visualmente

- Confirmar en navegador los nombres, orden y visibilidad de las pestañas de Configuración y del selector de empresas en la versión desplegada.
- Confirmar el aspecto del formulario **Crear otra empresa** y los mensajes de éxito/error con la cuenta Owner correspondiente.
- Confirmar en la pantalla de Horarios los nombres exactos de botones para editar, activar/desactivar, asignar y revisar historial.
- Revisar la sección heredada **Solicitudes de dispositivos**: su texto menciona aprobación manual, mientras el flujo actual documenta habilitación automática al asignar una sucursal activa. El Supervisor no debería necesitar una segunda aprobación para esa asignación; comprobar la consistencia visual del mensaje.
- Confirmar qué rol y permisos efectivos muestran el menú de Reportes y Horas extra para cada membresía.
- Confirmar el flujo visual de selección de movimiento, PIN opcional y resultado final del escáner, sin asumir que se ejecutó una asistencia real en esta revisión.
- Confirmar el estado real de la migración de PIN y del servicio de credenciales QR en cada entorno. Este manual se basa en el repositorio, no en una consulta de bases desplegadas.
- Validar en pantalla móvil y escritorio que navegación, tablas, formularios y mensajes se presentan correctamente.
