# Auditoría y limpieza segura

Este inventario inicial contiene candidatos a investigar, no eliminaciones autorizadas ni hallazgos de código muerto. Un resultado de búsqueda vacío no demuestra que no exista uso dinámico, uso por convención de Next.js, referencia desde SQL/configuración o entrada de script.

## Candidatos de revisión

| Candidato | Evidencia observada | Qué comprobar antes de decidir | Riesgo |
|---|---|---|---|
| Componentes con responsabilidades combinadas: `src/components/schedules/schedule-management.tsx` (424 líneas), `src/components/admin/user-access-management.tsx` (372), `src/components/employees/employee-credentials.tsx` (280) y `src/components/scanner/mobile-scanner.tsx` (311). | Conteos, estados/hooks y operaciones observadas en la auditoría QR-007; no son por sí solos defectos. | Responsabilidades, dependencias, interacciones y pruebas antes de plantear extracción; medir impacto cuando se alegue rendimiento. | Refactor puede alterar permisos, formularios, tokens o ciclo de cámara. |
| Dependencias declaradas en `package.json`. | Manifiesto y lockfile presentes. | Imports directos, carga dinámica, scripts, plugins Next/PostCSS y uso de build/servidor; calcular impacto de dependencias transitivas. | Eliminar paquetes puede romper build o módulos nativos. |
| Documentos operativos por etapas en la raíz. | Hay reportes históricos de backup, despliegue, seguridad y reconciliación; README enlaza solo parte. | Fecha, vigencia, enlaces entrantes, secretos/IDs, relación con runbooks actuales y valor como historial. | Borrar evidencia operativa o pasos aún vigentes. |
| Directorios con `.gitkeep` y scripts/tests de integración. | Placeholders visibles en `src/**`, Supabase y rutas API; scripts existen bajo `scripts/`/`tests/`. | Convenciones de generación, uso externo/documental, referencias CI y propósito del placeholder. | Eliminar estructura requerida por rutas futuras o tests especializados. |

No se comprobó ningún archivo como huérfano o dependencia sin uso en esta primera revisión; por eso no se propone borrar nada todavía.

## Evidencia QR-007 (2026-10-30)

La auditoría completa y su matriz de hallazgos están en [docs/QR-007-CODE-AUDIT.md](QR-007-CODE-AUDIT.md). La búsqueda estática no confirmó archivos o componentes huérfanos. argon2 es el único candidato a revisar por no encontrar imports en src, tests, scripts o workflows; requiere validar consumidores operativos y build antes de considerar retiro. No se eliminaron dependencias.

Se registraron oportunidades de mantenibilidad para horarios, usuarios/accesos, credenciales y escáner. No se consideran errores por su tamaño. El escáner queda postergado hasta cerrar QR-006. Portal y reportes tienen oportunidades de rendimiento condicionales a mediciones; no hay baseline ni afirmación de cuello de botella.

El informe de seguridad local aún cataloga braces@3.0.3 como High; GitHub Advisory Database muestra que GHSA-vfj7-8cjw-p6xm fue retirado el 2026-10-23. npm audit no pudo consultar registry.npmjs.org por DNS en esta auditoría, así que sigue pendiente verificar el árbol completo y conciliar SECURITY-AUDIT.md. Este dato no equivale a afirmar que no existan vulnerabilidades.

Estado: candidatos documentados, sin retiro/refactor aprobado. QR-008, QR-009 y QR-010 conservan implementación separada.

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
