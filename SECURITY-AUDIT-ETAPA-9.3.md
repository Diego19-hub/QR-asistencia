# QR-asistencia — Etapa 9.3: cierre de seguridad y decisión GO/NO-GO

Fecha: 11 de octubre de 2026
Commit base: `5644c1d012a1817187f1106780de5dc71227469a`
Repositorio: `Diego19-hub/QR-asistencia` (privado)
Proyecto Supabase revisado: `QR-asistencia-testing` (`llxyziffgtqnzlguxhyt`)
Producción: `jawdrhewabqajxnswhkn` (fuera de alcance; sin consultas ni cambios)

## Decisión

**NO-GO para un lanzamiento público o para tocar producción.** Las revisiones estáticas, ACL, las pruebas unitarias, lint, typecheck y build son satisfactorias; siguen faltando las pruebas de autorización con JWT reales entre empresas/sucursales, una restauración de backup demostrada, y una solución de disponibilidad para protección contra contraseñas filtradas. Además, la concurrencia simultánea de exportaciones no está limitada por la aplicación.

No se crearon empresas, membresías, sucursales, empleados ni jornadas sintéticas en esta etapa. La consulta a tablas `public` de prueba devolvió cero filas para esas entidades. El panel de Auth muestra tres cuentas existentes; no se modificaron ni eliminaron. Sus contraseñas no estaban disponibles en el entorno local, y el conteo SQL de `auth.users` está sujeto a RLS, por lo que no se afirma que las cuentas hayan sido limpiadas.

## Pruebas negativas por rol, empresa y sucursal

| Caso | Resultado | Evidencia/limitación |
|---|---|---|
| Admin A contra objetos reales de Empresa B | **No ejecutado** | No había empresas, objetos centinela ni sesión JWT utilizable en Testing. |
| Admin B contra objetos reales de Empresa A | **No ejecutado** | Mismo bloqueo. |
| Supervisor A fuera de su sucursal | **No ejecutado** | No había asignación de sucursal ni JWT real. |
| Usuario sin membresía | **No repetido con JWT real** | La Etapa 9.2 documenta 28 llamadas directas rechazadas con `42501` usando `auth.uid()` sintético dentro de una transacción revertida. Esto no demuestra aislamiento con JWT real. |
| Usuario anónimo | **ACL verificada; HTTP no ejecutado** | Todas las funciones `SECURITY DEFINER` inspeccionadas niegan `EXECUTE` a `anon`; las tablas privadas no conceden SELECT ni escritura a `anon`. |
| Ausencia de modificaciones no autorizadas | **No ejecutado con JWT real** | Sin datos de prueba y sesiones reales no se puede comparar el antes/después de RPCs privilegiadas. |

El Dashboard de Supabase ofrece la opción de establecer contraseñas de Auth, pero cambiar o crear credenciales debe hacerlo el propietario en la interfaz. No se reutilizaron contraseñas conocidas ni se incluyeron secretos en variables o logs. El archivo local `~/.config/qr-asistencia-testing/admin.env` y los archivos de contraseñas de pruebas no estaban disponibles; las variables `QR_TEST_*` necesarias para `tests/reports-cross-tenant.integration.test.mjs` tampoco estaban configuradas. Esa prueba terminó con **2 casos omitidos**, no aprobados.

**Matriz verificada en esta etapa:** no hay filas de empresa/sucursal/empleado/jornada para evaluar acceso por tenant. Las comprobaciones de ACL son globales al proyecto y no sustituyen las pruebas de autorización por rol.

## Funciones `SECURITY DEFINER` y tablas privadas

En el proyecto de pruebas confirmado se inspeccionaron las funciones y privilegios actuales:

- Hay 18 funciones `public` `SECURITY DEFINER` invocables por `authenticated`; ninguna permite `EXECUTE` a `anon`. Todas las funciones examinadas tienen `search_path` vacío. Las guardas de identidad, membresía, rol, permiso y empresa están descritas en [SECURITY-AUDIT-ETAPA-9.2.md](SECURITY-AUDIT-ETAPA-9.2.md).
- `private.bootstrap_first_company` permite `EXECUTE` únicamente a `service_role`.
- Seis tablas están en `private`. Ninguna otorga SELECT o escritura directa a `anon` o `authenticated`. Cuatro tienen RLS habilitado y sin políticas (denegación por defecto); dos (`bootstrap_requests`, `device_token_hashes`) tienen RLS deshabilitado pero no exponen grants al cliente. El esquema privado no está configurado como esquema del Data API local.
- Supabase Advisor vuelve a reportar cuatro avisos informativos de tablas privadas con RLS sin políticas y 18 avisos sobre funciones `SECURITY DEFINER` ejecutables por usuarios autenticados. Con los ACL actuales no se encontró una ruta directa de acceso a las tablas. Aun así, la superficie pública de RPC es sensible: una guarda incorrecta o regresión podría exponer/modificar datos. Las pruebas negativas JWT reales siguen siendo obligatorias antes de producción.

No se revocaron permisos ni se cambió RLS. Advisor: [seguridad del proyecto de pruebas](https://supabase.com/dashboard/project/llxyziffgtqnzlguxhyt/advisors/security).

## Auth: contraseñas filtradas

En **Testing**, Authentication → Attack Protection muestra **Prevent use of leaked passwords: DISABLED**. No se cambió la configuración. La documentación vigente de Supabase indica que la protección de contraseñas filtradas requiere el plan Pro o superior ([Password security](https://supabase.com/docs/guides/auth/password-security)). Para producción se debe habilitar y probar antes del lanzamiento, lo que implica confirmar un plan compatible. La configuración de producción no se inspeccionó ni modificó.

## npm audit

Se repitieron ambos análisis con acceso de solo lectura a npm Registry:

| Comando | Resultado |
|---|---|
| `npm audit` | 5 High, 0 Critical/Moderate/Low |
| `npm audit --omit=dev` | 0 vulnerabilidades de producción |

Los cinco avisos son la cadena de desarrollo `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`. `braces` reporta riesgo de agotamiento de pila/denegación de servicio al procesar patrones profundamente anidados ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)). NPM solo propuso como arreglo disponible `eslint-config-next@14.2.35`, un downgrade mayor incompatible con Next.js 16.4.0; no se modificó el lockfile.

Riesgo residual: no se espera que esta dependencia de tooling entre en la ruta runtime de producción, pero puede afectar tareas de lint/build si se le procesa contenido de patrones no confiable. Mantener dependencias fijadas por lockfile, usar CI con permisos mínimos y sin secretos, evitar ejecutar lint/build con datos no confiables, revisar el advisory al actualizar Next/ESLint y reevaluar `npm audit` antes de cada release. No usar `npm audit fix --force` ni degradar Next.

## GitHub

El repositorio se confirmó como **privado** mediante metadatos de GitHub y la página de Settings. No se alteró su visibilidad. No se pudo inspeccionar el estado de protección de `main`: al abrir Settings → Branches, GitHub detuvo el acceso con un requisito de activar 2FA para la cuenta. No se concluye que haya reglas activas o inactivas.

GitHub documenta que reglas de protección de ramas en repositorios privados requieren GitHub Pro, Team o Enterprise; en Free están disponibles para repositorios públicos ([protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)). Mantener el repositorio privado. Si no se actualiza el plan, exigir PR y revisión como proceso operativo, conservar CI en cada push/PR y restringir administradores/secretos; esos acuerdos no sustituyen un bloqueo técnico de push directo. Para controles exigibles en repositorio privado, evaluar Pro sin hacer un cambio de plan en esta etapa. Habilitar 2FA para completar la inspección de Settings.

## Exportaciones y capacidad

Revisión estática de [API export](src/app/api/reports/export/route.ts) y [migración del limitador](supabase/migrations/20261011232050_distributed_report_export_rate_limit.sql):

- La ruta valida la sesión/rol/empresa mediante `resolveAdminScope`, consulta `consume_report_export_quota`, y aborta antes de serializar si supera 500 jornadas con HTTP 413. El límite de 500 está en el servidor, no solo en la interfaz.
- La migración registrada en el historial remoto de **Testing** como `20261011232050` crea la tabla privada de cuota y la función RPC que consume `p_company_id`; tanto el RPC como la API usan esa firma. La función valida `auth.uid()`, membresía owner/admin activa y permiso `reports.read`, y usa una actualización atómica por usuario/empresa en ventana de cinco minutos. Producción no fue consultada.
- La cuota limita frecuencia a 10 exportaciones por usuario/empresa cada cinco minutos, no el número de generaciones simultáneas. No hay semáforo o lease de concurrencia en esta versión. Configurar temporalmente hosting de una sola instancia y concurrencia de exportación máxima 1; para despliegue multi-instancia se requiere un limitador distribuido de concurrencia con lease/expiración y pruebas de carrera. No elevar el máximo de 500 hasta medir generación progresiva.
- Conservar inicialmente **2 GiB disponibles** para el proceso Node como margen sobre benchmarks previos (500 filas: ~252 MB XLSX y ~215 MB PDF RSS en el entorno local; dos exportaciones de 1,000 filas: ~472 MB). No son métricas del hosting definitivo.

La API de exportación depende de la migración SQL: despliegue seguro exige **migración primero, aplicación después**. El código devuelve 503 si el RPC no está disponible.

## Backup, restore y rollback

**No se ejecutó un restore drill.** El equipo local no tiene Supabase CLI ni daemon Docker funcional (`docker` fue denegado por el socket; no hay PostgreSQL local escuchando). No se usó backup ni datos de producción; no se copió información personal a Testing.

Procedimiento previo a producción:

1. Fijar el SHA de release y verificar proyecto destino por ID. Exportar de forma cifrada y con acceso restringido la base usando el flujo documentado de Supabase CLI (`db dump` de roles, esquema y datos, según necesidad); verificar hash, tamaño y que el archivo no se publique. Los proyectos Free deben exportar regularmente y guardar backup externo; Supabase no ofrece backup diario gestionado en Free ([Database Backups](https://supabase.com/docs/guides/platform/backups), [Backup/Restore CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)).
2. Restaurar **solo una copia sintética** en un proyecto/instancia aislada, nunca sobre el proyecto de producción, usando transacción cuando aplique. Verificar objetos, migraciones, extensiones, grants, RLS/policies, conteos sintéticos y login; ejecutar las pruebas de integración. No restaurar usuarios, empleados ni asistencias reales en Testing.
3. En producción, obtener backup previo confirmado y registrar punto de recuperación. Si la migración o smoke test falla, detener el código nuevo y revertir el frontend a su SHA anterior; no intentar revertir destructivamente la migración. Corregir con migración forward-only validada en Testing. Restauración de base solo según el plan de recuperación aprobado, con ventana de indisponibilidad.

El restore queda como gate obligatorio; hasta ejecutar un drill verificable no hay evidencia de recuperación operacional.

## Validaciones ejecutadas

| Verificación | Resultado |
|---|---|
| `npm run test:reports` | Aprobado: 9/9 |
| `npm run test:scanner` | Aprobado: 4/4 |
| `npm run test:reports:integration` | 2 omitidas por falta de `QR_TEST_*`, cuentas con contraseña utilizable, fixtures y servidor local; no se cuentan como aprobadas |
| `npm run lint` | Aprobado |
| `npm run typecheck` | Aprobado al repetir después del build. La ejecución concurrente inicial chocó con la regeneración de `.next/types`; no representa fallo del código |
| `npm run build` | Aprobado (Next.js 16.4.0, webpack) |
| `npm audit` | 5 High de desarrollo; 0 runtime (ver arriba) |
| `git diff --check` | Aprobado antes de editar este informe; se volverá a ejecutar antes del commit |
| Pruebas pgTAP / restore local | No ejecutadas: Docker bloqueado, Supabase CLI/`pg_prove` ausentes; no se simuló un resultado |

## Gate de salida a producción

- [ ] Usuario establece credenciales sintéticas aleatorias y las guarda localmente con permisos 600; no enviarlas por chat.
- [ ] Crear las dos empresas, memberships, sucursales, objetos centinela y jornadas de prueba en Testing, y conservar IDs en almacenamiento local no versionado.
- [ ] Ejecutar pruebas HTTP/RPC con JWT reales para ambos admins, supervisor limitado a sucursal, usuario sin membresía y anon; comprobar 401/403 y comparar estado antes/después de operaciones de escritura.
- [ ] Resolver la discrepancia entre el panel de Auth (tres usuarios visibles) y el conteo SQL protegido por RLS antes de declarar limpieza; eliminar solo cuentas sintéticas identificadas y confirmar el resultado.
- [ ] Habilitar protección contra contraseñas filtradas en un plan compatible y probar alta/cambio/login.
- [ ] Completar 2FA de GitHub y revisar Settings; elegir plan que permita branch protection privada si se necesitan gates obligatorios. Exigir `verify` y aprobación de PR en `main`.
- [ ] Limitar exportaciones simultáneas a una por instancia o implementar/probar semáforo distribuido; mantener límite de 500 y 2 GiB.
- [ ] Hacer restore drill aislado sin datos personales/producción, y registrar evidencia.
- [ ] Ejecutar todos los checks y revisar los avisos npm justo antes del release.
- [ ] Aprobar expresamente la migración y el despliegue; ninguno se realiza en esta etapa.

**Conclusión:** el código supera las verificaciones locales disponibles y los ACL no muestran acceso anónimo directo a datos privados. No es seguro declarar GO hasta cubrir la matriz con JWT real, probar restauración y cerrar los controles operativos enumerados.
