# Auditoría y limpieza segura

Este inventario inicial contiene candidatos a investigar, no eliminaciones autorizadas ni hallazgos de código muerto. Un resultado de búsqueda vacío no demuestra que no exista uso dinámico, uso por convención de Next.js, referencia desde SQL/configuración o entrada de script.

## Candidatos de revisión

| Candidato | Evidencia observada | Qué comprobar antes de decidir | Riesgo |
|---|---|---|---|
| Componentes grandes, empezando por `src/components/schedules/schedule-management.tsx` (424 líneas), `src/components/admin/user-access-management.tsx` (323) y `src/components/employees/employee-credentials.tsx` (280). | Conteo de líneas estático. | Responsabilidades, estados, referencias/imports, interacciones y pruebas; determinar si la división reduce complejidad real. | Refactor puede alterar permisos, formularios o estados. |
| Dependencias declaradas en `package.json`. | Manifiesto y lockfile presentes. | Imports directos, carga dinámica, scripts, plugins Next/PostCSS y uso de build/servidor; calcular impacto de dependencias transitivas. | Eliminar paquetes puede romper build o módulos nativos. |
| Documentos operativos por etapas en la raíz. | Hay reportes históricos de backup, despliegue, seguridad y reconciliación; README enlaza solo parte. | Fecha, vigencia, enlaces entrantes, secretos/IDs, relación con runbooks actuales y valor como historial. | Borrar evidencia operativa o pasos aún vigentes. |
| Directorios con `.gitkeep` y scripts/tests de integración. | Placeholders visibles en `src/**`, Supabase y rutas API; scripts existen bajo `scripts/`/`tests/`. | Convenciones de generación, uso externo/documental, referencias CI y propósito del placeholder. | Eliminar estructura requerida por rutas futuras o tests especializados. |

No se comprobó ningún archivo como huérfano o dependencia sin uso en esta primera revisión; por eso no se propone borrar nada todavía.

## Pruebas que deben protegerse

Mantener cobertura de aislamiento entre empresas, RLS/permisos, JWT, Auth/invitaciones, PIN y lockout, credenciales QR, dispositivos, integridad temporal de asistencia, concurrencia de exportaciones y preparación de despliegue. El inventario en `tests/` y `supabase/tests/` es evidencia de pruebas críticas que requieren análisis antes de consolidar.

## Procedimiento para cada candidato

1. Identifica símbolo/archivo y referencias en código, rutas, configuración, scripts, migraciones, templates y workflows.
2. Confirma el rol de la funcionalidad con historial/documentación y responsables de llamadas.
3. Mapea el comportamiento protegido y enumera consumidores directos e indirectos.
4. Comprueba cobertura equivalente; añade prueba si es necesaria antes de retirar implementación.
5. Expón riesgo, alcance, rollback y evidencia en una tarea/PR acotados.
6. Obtén aprobación del módulo y ejecuta pruebas aplicables antes de eliminar.
7. Actualiza este inventario y documenta qué se retiró y por qué.

La auditoría corresponde a QR-007; la eliminación de pruebas/archivos obsoletos, a QR-008.
