# Etapa 9.6 — Control distribuido de exportaciones

## Diseño

`private.report_export_leases` contiene una sola fila de concesión con `lease_key = 'global'`. La clave primaria y el `INSERT ... ON CONFLICT ... WHERE expires_at <= clock_timestamp()` hacen atómica la adquisición en PostgreSQL: todas las instancias de Next.js y todas las empresas compiten por la misma fila.

La API valida primero sesión, rol y empresa; obtiene el lease antes de consumir cuota o cargar el reporte. Una ocupación devuelve HTTP 429, código `export_concurrency_limited` y `Retry-After`, sin llamar a `consume_report_export_quota`. La cuota preexistente de 10 exportaciones por usuario y empresa cada cinco minutos y el máximo de 500 jornadas por archivo permanecen vigentes.

El servidor crea un UUID aleatorio por solicitud. Los RPC de adquisición, renovación y liberación son `SECURITY DEFINER` y fijan `search_path = ''`. Adquisición y renovación comprueban `auth.uid()`, membresía administrativa activa y permiso `reports.read`. La liberación no requiere una membresía que pudo revocarse durante el trabajo: solo elimina una fila si coinciden el `auth.uid()`, la empresa y el UUID propietario aleatorio, y no devuelve datos. El UUID nunca se incluye en la respuesta. La tabla tiene RLS y no concede acceso directo a roles de API.

El lease dura inicialmente 120 segundos y se renueva cada 20 segundos. Si el proceso termina inesperadamente, otra instancia puede adquirirlo al vencer. El lease no puede renovarse después de vencer. El token propietario evita que una instancia antigua libere la concesión que adquirió otra instancia. Si se pierde una renovación, el endpoint no sirve el archivo. La tabla deliberadamente no tiene claves foráneas con borrado en cascada: borrar una empresa o cuenta Auth no debe eliminar el mutex mientras una respuesta siga activa.

El endpoint conserva el lease durante la generación y hasta que el cuerpo de la respuesta se consume o se cancela. Las salidas de error, incluido un fallo de generación, lo liberan en `finally`. La expiración de PostgreSQL es la recuperación si Postgres no está disponible durante la liberación.

## Capacidad

El límite inicial es **una exportación activa global**. Una empresa que esté generando un archivo bloquea temporalmente a todas las demás; los clientes reciben 429 y un tiempo estimado para reintentar. La estimación puede cambiar si el trabajo activo renueva el lease o termina antes. Esta política prioriza el techo de memoria frente al paralelismo; conviene medir uso y tasas de 429 antes de cambiarla.

## Evidencia local

Suite ejecutada en un proyecto Supabase local temporal, con puertos e ID generados para esa corrida. Se aplicaron todas las migraciones versionadas y se eliminaron al final las cuentas sintéticas, las membresías, los contenedores, la red y los volúmenes. Se confirmó que el stack `codigo_QR` preexistente quedó intacto. No se usaron ni consultaron Testing (`llxyziffgtqnzlguxhyt`) ni producción (`jawdrhewabqajxnswhkn`).

- **14/14 comprobaciones locales aprobadas**, cero fallos y cero omisiones, después del último cambio a la migración y a la limpieza del arnés.
- **13/13 comprobaciones pgTAP** sobre RLS, privilegios de tabla, EXECUTE de funciones y ausencia de cascadas que borren el mutex.
- Dos JWT reales de administradores en empresas diferentes compitieron por RPC: uno obtuvo el lease y el otro fue rechazado. Una ráfaga de 12 RPC produjo un solo titular.
- Se comprobó vencimiento, adquisición por otra empresa, renovación del titular nuevo, y que el propietario anterior no puede renovar ni liberar el lease sucesor.
- Administrador de otra empresa, supervisor y anónimo no adquirieron concesiones.
- En HTTP, ocho solicitudes concurrentes mientras otra empresa retenía el lease devolvieron 429 y `Retry-After`; el conteo de cuota no cambió.
- XLSX y PDF HTTP se generaron correctamente al quedar libre el lease. Se verificó que el registro ya no existía al terminar de consumir ambos cuerpos. Una solicitud HTTP anónima devolvió 401.
- Una prueba unitaria inyecta un error de generación y verifica liberación desde `finally`; otra comprueba el cierre y cancelación del stream.

### Medición sintética de 500 jornadas

Mediciones del generador en procesos Node locales, con datos sintéticos; no incluyen consultas de Supabase ni el servidor/hardware de hosting. El baseline del proceso fue aproximadamente 119 MiB.

| Caso | Tiempo | Archivo(s) | RSS pico | Crecimiento RSS |
| --- | ---: | ---: | ---: | ---: |
| XLSX, 500 jornadas | 168 ms | 50,457 bytes | 251.8 MiB | 133.3 MiB |
| PDF, 500 jornadas | 147 ms | 84,175 bytes | 215.4 MiB | 96.1 MiB |
| XLSX y PDF simultáneos, 500 cada uno, para comparar presión sin serialización | 310 ms | 134,632 bytes combinados | 339.1 MiB | 220.0 MiB |

El benchmark de dos generadores simultáneos muestra por qué la API serializa la creación. Estas medidas no garantizan el consumo en el hosting definitivo ni incluyen carga de reportes, Next.js o buffering de red.

## Despliegue y reversión

1. Crear/verificar un respaldo y confirmar que el destino es el proyecto autorizado.
2. Aplicar `20261012050537_global_report_export_lease.sql` primero. No desplegar la API nueva si la migración falla.
3. Verificar catálogo, RLS, grants y adquisición/rechazo/liberación en el entorno aprobado.
4. Desplegar después la versión de API que llama esos RPC; conservar el límite de 500 y la cuota existente.
5. Ejecutar exportaciones XLSX/PDF, medir 429, errores RPC y duración de concesiones.

La migración es aditiva. Si la API nueva falla, el rollback inmediato compatible es volver a desplegar la versión anterior de la API y dejar la tabla/RPC sin uso. No retirar primero la migración porque rompería la API nueva. Si se decide retirar el esquema más tarde, crear una migración compensatoria nueva que elimine los tres RPC y la tabla después de revertir la API; no editar el historial ni borrar esta migración aplicada.

## Estado

La implementación está validada en un stack local, incluidos RPC concurrentes reales con JWT y rutas HTTP locales. Se fortaleció el teardown para comprobar Auth/membresías y verificar la limpieza del stack incluso si falla una aserción. La primera ejecución de CI encontró que el checkout limpio no contenía el `next-env.d.ts` local ignorado; el arnés ya no depende de ese archivo. El commit correctivo `ec51465049f76b0e219920fe582185bbf7260fd6` pasó GitHub Actions en la ejecución `38209280766`: lint, typecheck, 16 pruebas de reportes, integración local 14/14, escáner y build. Los proyectos Supabase remotos siguen sin cambios. La migración debe desplegarse antes que la API.
