# QR-010 — Plan incremental de mantenibilidad

**Fecha:** 2026-11-06
**Estado:** Hecha para el paquete acotado de `AssignmentHistory`; las fases 2–5 siguen como oportunidades futuras y no pertenecen a este cierre.

## Principio

Reducir responsabilidades mezcladas con extracciones pequeñas, conservando APIs, autorización, consultas y experiencia. No se va a perseguir una reducción de líneas ni una reescritura general. Cada módulo debe mantenerse en un cambio independiente con verificación específica antes de pasar al siguiente.

## Orden recomendado

| Fase | Módulo | División propuesta | Dependencias y riesgo | Decisión |
|---|---|---|---|---|
| 1 | `src/components/schedules/schedule-management.tsx` | Extraer `AssignmentHistory` a un componente propio. Separar sus tipos de entrada y los formateadores puros `hm`/`hours`; compartir `EmptyState` sin crear importación circular. Mantener la carga dentro del componente inicialmente. | Depende de datos de empleados/horarios y de `GET /api/schedules/assignments` + `GET /api/schedules`. Preservar query de empresa, cancelación con `AbortController`, temporizador, estado vacío/error y columnas. Riesgo medio por efecto de carga y componentes compartidos. | Primer corte recomendado: es una unidad existente con límites visibles y no cambia endpoints ni permisos. |
| 2 | `schedule-management.tsx` | Extraer el editor `ScheduleDialog` y sus tipos puros a módulo separado después de estabilizar fase 1. | Riesgo de validación temporal, días, descansos, foco, cierre con cambios pendientes y reglas laborales. | Posponer hasta tener cobertura de formulario y accesibilidad. |
| 3 | `src/components/employees/employee-credentials.tsx` | Separar el adaptador de exportación PDF del flujo de credenciales. | Maneja emisión/revocación de QR y presentación de PIN; cambios podrían exponer tokens o romper impresión/descarga. No sustituir el escritor PDF sin comparación. | Después de horarios; requiere pruebas sintéticas de exportación y credenciales. |
| 4 | `src/components/admin/user-access-management.tsx` | Separar la vista de membresías de la UI de invitaciones por correo/enlace. | Hay flujos owner-only, roles, expiración, revocación e invalidación cruzada de canales. Los permisos deben seguir en servidor. | Solo con pruebas de regresión de invitaciones y permisos por rol. |
| 5 | `src/components/scanner/mobile-scanner.tsx` | Posible extracción futura de cámara/contexto en hook. | QR-006 contiene manejo reciente de carreras, abortos, permisos y liberación de streams. Riesgo alto de fugas y estados obsoletos. | Posponer hasta que QR-011 incluya hardware físico Android/iPhone. |

## Contrato de la primera fase

La primera extracción no debe cambiar el contrato de `ScheduleManagement`, la estructura de las rutas, los endpoints, la consulta de empresa ni la autorización. Debe conservar:

- Orden y texto de la tabla, formato de hora/duración y vigencia abierta.
- Consulta de empleados y asignaciones con `cache: "no-store"` y query de empresa actual.
- Cancelación de trabajo asíncrono cuando cambie la consulta o se desmonte el componente.
- Mensaje de error accesible (`role="alert"`) y estado vacío existente.
- Dependencias unidireccionales entre módulos; evitar ciclos de importación.

Antes de implementar, mapear dónde se usan `Schedule`, `Employee`, `EmptyState`, `hm` y `hours`; mover tipos/helpers compartidos solo si evita duplicación real. Mantener la extracción enfocada en `AssignmentHistory` y dejar `ScheduleDialog` fuera de ese cambio.

### Implementación local del primer corte

- Se extrajo `AssignmentHistory` a `src/components/schedules/assignment-history.tsx`.
- `Schedule`, `Employee` y tipos anidados relacionados quedaron en `schedule-types.ts`; los formateadores compartidos están en `schedule-format.ts` y el estado vacío en `schedule-empty-state.tsx`.
- La consulta sigue usando los mismos dos endpoints, el mismo `query`, `cache: "no-store"`, temporizador de cero milisegundos y cancelación con `AbortController`. No se tocaron rutas, autorización ni mutaciones.
- Inicialmente, `npm run lint` y `npm run typecheck` no pudieron iniciar porque esta copia no tenía dependencias instaladas (`eslint: not found`, `tsc: not found`). Se instalaron las dependencias fijadas por `package-lock.json` con `npm ci --ignore-scripts --no-audit --no-fund`, sin editar manifiestos ni lockfile. Después, lint/typecheck pasaron. Se quitó un conjunto de imports de tipos no usados que lint detectó. La prueba enfocada quedó integrada en `npm test`.

## Verificación requerida para los cambios de código

La búsqueda inicial no encontró una prueba de componente dedicada a `AssignmentHistory`. Se añadió una prueba enfocada del cargador con respuestas sintéticas: éxito, empresa/query, `no-store`, colecciones vacías, error HTTP y propagación de aborto. También se comprueba estáticamente el contrato visible de columnas, alerta accesible, estado vacío y cleanup del efecto. Resultado: **5/5 PASS**. `npm test` general pasó; omitió una prueba GnuPG porque el sandbox denegó el socket del agente. Lint y typecheck pasaron. El build aislado completó las 41 rutas con la advertencia conocida de 27 archivos fuera de `outputFileTracingRoot` por el enlace externo de `node_modules`. `npm run test:e2e` no pudo iniciar: `spawnSync docker ENOENT`, antes de que el runner iniciara o modificara recursos. No se ejecutó un E2E de navegador ni se montó el componente React; por tanto el contrato visual/cleanup no se presenta como validación dinámica.

## Estado

QR-008 está cerrada como inventario seguro: no se encontró código o archivo cuya eliminación tuviera evidencia suficiente. QR-009 está integrada como benchmark/decisión técnica, sin adoptar las variantes de lazy loading. El paquete acotado de QR-010 queda **Hecho**: extracción revisada, prueba enfocada **5/5**, lint, typecheck y `git diff --check` PASS. El E2E del componente no se ejecutó. Los otros módulos de la tabla son oportunidades futuras, fuera de este paquete; no se afirma que el repositorio entero esté refactorizado. No se tocaron PIN, asistencia, Testing ni Producción.
