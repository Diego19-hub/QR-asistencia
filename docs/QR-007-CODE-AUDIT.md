# QR-007 — Auditoría técnica, calidad y oportunidades de optimización

**Fecha:** 2026-10-30
**Base:** 3ccece4b2d1daa7d0f9f53b3d2ad65d52ee55046 (PR #21 integrado)
**Rama:** audit/qr-007-code-quality
**Alcance:** diagnóstico estático, validaciones existentes y recomendaciones. No se retiró ni modificó código funcional, pruebas, dependencias, SQL/RLS ni configuración de entornos.

## 1. Resumen ejecutivo

La aplicación presenta una separación reconocible entre rutas App Router, componentes, lógica compartida y persistencia Supabase/PostgreSQL. Esta revisión no produjo evidencia de una vulnerabilidad funcional nueva ni de archivos o pruebas que deban borrarse. Hay oportunidades para investigar una dependencia sin importación directa, extraer responsabilidades de componentes interactivos grandes y establecer una línea base de rendimiento antes de optimizar.

No se midieron Core Web Vitals, transferencia por ruta ni latencias de consulta; el informe no afirma mejoras de velocidad ni cuantifica impacto. El registro npm no pudo consultarse: npm audit --json no resolvió registry.npmjs.org (DNS ENOTFOUND). Por eso no se afirma que el árbol esté libre de alertas.

**Hallazgos:** 8 oportunidades/brechas de evidencia; 0 críticas, 0 altas. Ninguna es una vulnerabilidad funcional confirmada. Los candidatos requieren validación separada antes de cambiar código.

## 2. Alcance y método

Se leyeron AGENTS.md, TASKS.md, README.md, arquitectura, limpieza, pruebas, flujo de desarrollo y rendimiento, además de las skills qr-attendance-code-cleanup y qr-attendance-performance. Se inspeccionaron rutas src/app, componentes y lógica src/lib, configuración Next/TypeScript/ESLint, scripts npm, lockfile, migraciones y pruebas, workflow CI, referencias estáticas y estado del PR #21.

Las búsquedas consideraron imports/uso dinámico, invocaciones de scripts, convenciones Next, SQL/migraciones, workflows y documentación. Para dependencias se comparó package.json, package-lock.json, npm ls --depth=0 y referencias del repositorio. El conteo de líneas/estados solo ayudó a priorizar módulos; no se usó como prueba de mala calidad.

No se leyeron archivos .env* ni se consultó Supabase Testing o Producción. Las pruebas locales usan el runner con un proyecto desechable y datos sintéticos. No se envió PIN incorrecto ni se completó un movimiento de asistencia.

## 3. Arquitectura observada

- Next.js App Router divide áreas de acceso ((auth), (admin), (supervisor), (employee)) y Route Handlers por dominio en src/app/api.
- Componentes interactivos están en src/components; lógica compartida en src/lib.
- La sesión SSR se obtiene desde clientes Supabase compartidos. Las rutas resuelven ámbito empresarial/permisos en servidor; PostgreSQL mantiene RLS, RPC y restricciones como segunda frontera.
- Las páginas protegidas combinan Server Components para sesión/membresía con componentes cliente para formularios, cámara y filtros. Server Actions de autenticación/invitación se distinguen de Route Handlers.
- Migraciones, pruebas SQL y configuración local están en supabase/; pruebas Node/HTTP/E2E en tests/. CI ejecuta lint, typecheck, suites Node, integración sintética, matriz, E2E y build.
- Next usa salida standalone y trazado de recursos AFM de PDFKit. Orígenes de desarrollo/Server Actions se limitan al host configurado.

La estructura es adecuada para los dominios observados; no se recomienda reescribirla ni mover carpetas. Toda evolución debe conservar autorización en API/base, alcance multiempresa y respuestas privadas no-store.

## 4. Matriz de hallazgos

| ID | Archivo | Problema y evidencia | Impacto / severidad / prioridad | Solución recomendada | Riesgo / pruebas | Tarea |
|---|---|---|---|---|---|---|
| QR007-001 | package.json, lockfile, Dockerfile | argon2@0.45.1 es directa; no se encontró importación/uso en src/, tests/, scripts/ ni workflows. Aparece en un comentario Docker y documentos históricos sobre módulos nativos. La búsqueda no descarta consumidores operativos externos. | Artefacto nativo potencialmente innecesario: instalación, cadena de suministro y tamaño. **Baja, P2.** | QR-008: revisar npm explain argon2, historial, lifecycle/build/runtime e imagen; retirar solo con confirmación de que no existe consumidor. | Puede haber uso indirecto/externo; validar instalación limpia, build, pruebas e imagen en PR separado. No retirar aquí. | QR-008 |
| QR007-002 | src/components/schedules/schedule-management.tsx | 424 líneas: carga de sucursales/empleados/horarios/reglas/asignaciones/calendario, mutaciones y diálogos; el mismo archivo contiene ScheduleDialog y AssignmentHistory. | Cambios más costosos de probar/aislar; no se observó fallo. **Media de mantenibilidad, P2.** | QR-010: extraer incrementalmente historial/editor/tabs con contratos claros; preservar validación server-side. | Fechas, foco y estado entre tabs pueden cambiar. Probar formularios, accesibilidad y autorización HTTP. | QR-010 |
| QR007-003 | src/components/admin/user-access-management.tsx | 372 líneas mezclan membresías, cambio de rol/vinculación, correo y enlace compartido/portapapeles, con subcomponentes de ambas invitaciones. | Riesgo de regresión al cambiar permisos o canales; no se encontró regresión. **Media, P2.** | QR-010: separar UI de membresías e invitaciones; mantener permisos y canales en servidor. | Conservar owner-only, expiración e invalidación mutua. Matriz HTTP/Auth y regresiones de invitación. | QR-010 |
| QR007-004 | src/components/employees/employee-credentials.tsx | 280 líneas reúnen consulta/emisión/revocación QR, estado PIN, Canvas, PDF manual (makePdf), descarga e impresión. | Más superficie sensible en una unidad; uso de memoria/serialización no medido y no se observó defecto. **Media, P2.** | QR-010: separar gestión de credenciales del adaptador de exportación; evaluar escritor PDF antes de sustituirlo. | Evitar exposición de token QR/cambios de impresión. Probar regeneración, revocación, respuesta sin token persistido y exportación sintética. No tocar validación del PIN. | QR-010 |
| QR007-005 | src/components/scanner/mobile-scanner.tsx | 311 líneas concentran cámara, contexto, autorización/dispositivo, red y flujo de escaneo. PR #21 agregó abortos/generaciones y liberación de streams; hay regresiones QR-006 recientes. | Una división puede reabrir carreras o fugas; no se halló defecto adicional. **Media por riesgo de cambio, P2.** | Esperar cierre de QR-006 y evidencia en hardware; después considerar hook de cámara/contexto en QR-010. | Probar montaje/desmontaje, cambio de empresa, permiso revocado y dispositivos reales. Sin PIN incorrecto ni asistencia registrada. | QR-010 tras QR-006 |
| QR007-006 | src/app/api/employee/portal/route.ts, src/lib/reports/data.ts | El portal consulta por etapas dependientes de IDs; también ejecuta una RPC de estado de credencial por empleado con Promise.all. Reportes pagina y agrupa consultas por lotes. No hay trazas, cardinalidad ni latencias que demuestren cuello de botella. | Posible latencia/cantidad de consultas a escala, impacto incierto. **Baja, P2.** | QR-009: medir solicitudes y p50/p95 con fixtures escalables; paralelizar solo ramas independientes; evaluar RPC batch con evidencia. | Cambios pueden afectar paginación/aislamiento. Probar tenant, RLS, conteos y rendimiento antes/después. | QR-009 |
| QR007-007 | src/components/reports/reports-dashboard.tsx, package.json | recharts se importa estáticamente dentro de un componente cliente que también maneja filtros, solicitudes, tabla y exportación. Puede incluir JS de gráficos en el chunk inicial; el bundle no se midió. | Oportunidad condicional de reducir JS inicial. **Baja, P2.** | QR-009: obtener baseline/análisis de chunks con herramienta aprobada; considerar carga diferida solo si reduce bytes/tiempo. | SSR, hidratación, accesibilidad y estados vacíos. Probar reportes y móviles. | QR-009 |
| QR007-008 | SECURITY-AUDIT.md, lockfile | El informe aún registra braces@3.0.3/GHSA-vfj7-8cjw-p6xm como High. La versión instalada es 3.0.3; GitHub Advisory indica que se retiró el 2026-10-23 por no considerarlo explotable en la práctica. El audit del registro falló por DNS, así que no confirma el estado completo del árbol. | Inventario podría inducir priorización incorrecta; análisis actual de dependencias incompleto. **Baja documental, P1 para verificar cadena.** | PR separado para conciliar el informe con audit/Dependabot accesible y fuente primaria; no bajar versiones ni añadir override para silenciarlo. | Red impide descartar otras alertas. Repetir audit y contrastar lockfile/CI. | Seguridad/QR-010 |

**Agregado:** 0 críticos, 0 altos; 4 candidatos de mantenibilidad, 2 oportunidades que requieren benchmark, 1 dependencia a validar y 1 discrepancia documental de advisory. No hay hallazgo que autorice modificar seguridad o producción.

## 5. Código potencialmente innecesario

- argon2 es el único candidato con búsqueda estática amplia sin uso directo hallado. Aún hay que descartar procesos externos, hooks y consumo indirecto antes de retirarlo.
- No se identificaron archivos/componentes huérfanos: ScheduleManagement, UserAccessManagement, EmployeeCredentials, MobileScanner, TimePicker y ModulePlaceholder tienen referencias desde páginas/componentes. Rutas App Router se trataron como entrypoints convencionales.
- Scripts de integración tienen referencias desde npm/CI o ejecución separada documentada. security-jwt-matrix.integration.mjs requiere Testing según docs/TESTING.md y no se ejecutó. E2E y pruebas DB/HTTP están separadas intencionalmente de npm test y CI las invoca como pasos distintos.
- No se recomienda retirar .gitkeep, plantillas Auth, migraciones ni documentos operativos históricos por búsquedas textuales.

## 6. Dependencias y seguridad

- npm ls --depth=0 resolvió las dependencias raíz a versiones del lockfile; no mostró paquetes raíz ausentes.
- npm ls braces micromatch fast-glob exceljs uuid argon2 tailwindcss: braces@3.0.3 llega por la cadena eslint-config-next; exceljs@4.4.0 resuelve uuid@11.1.1 mediante override; tailwindcss@4.3.3 está deduplicado por @tailwindcss/postcss y raíz. No se interpretó deduplicación como duplicación problemática.
- npm audit --json falló antes de recibir un resultado: getaddrinfo ENOTFOUND registry.npmjs.org. No se afirma “cero vulnerabilidades”.
- La fuente [GitHub Advisory GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) muestra que se retiró el 23-oct-2026. SECURITY-AUDIT.md todavía lo lista como High; conciliar en cambio revisable cuando el audit actual esté disponible. [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) lista uuid 11.1.1 como corregido y esa es la versión instalada. No se consultaron alertas remotas de Dependabot.
- Node local fue v24.18.0 y CI fija 24.21.0. Esta diferencia puede causar variaciones de toolchain; evaluar un archivo de versión/engines en QR-010.

No se instalaron, eliminaron ni actualizaron dependencias. No se realizó auditoría de licencias ni SBOM.

## 7. Componentes complejos y frontend

Los cuatro componentes priorizados tienen responsabilidades relacionadas pero separables. La recomendación se basa en funciones/estados concretos, no en cantidad de líneas:

- Horarios: consultas/tabs, editor, historial y reglas.
- Usuarios: membresía/vinculación frente a invitaciones y canales.
- Credenciales: estado de QR/PIN frente a preparación/entrega de imagen.
- Scanner: lifecycle de cámara frente a contexto autorizado; mantenerlo quieto hasta cerrar QR-006.

No se contaron renders, no se perfiló React ni se midió tamaño de chunk. No se verificó que Server Components puedan reemplazar una UI interactiva concreta sin cambiar UX/autorización. Cualquier oportunidad de rendimiento queda pendiente de QR-009.

## 8. Backend, consultas y caché

El código consultado incluye filtros company_id, selección de columnas, paginación por cursor/rango y Promise.all en grupos independientes. Reportes limitan rangos/filas y agrupan detalles; portal pagina sesiones (20), limita asignaciones (200) y eventos (500). Mantener esos límites hasta probar consistencia.

La cadena del portal está condicionada por IDs devueltos por consultas previas. No se propone paralelizar sin trazar dependencias/RLS. Las RPC de credencial crecen con el número de empleados vinculados; medir cardinalidad sintética antes de batch.

No se identificaron trazas de carga ni instrumentación RUM en los archivos revisados. No se propone caché compartida para respuestas autenticadas. Conservar no-store/private, empresa activa, filtros de sucursal y RLS.

## 9. Pruebas y CI

- npm test ejecuta suites Node y la herramienta de backup; por diseño no incorpora E2E o PostgreSQL local. CI los ejecuta explícitamente en pasos separados.
- Matriz local: 201 aserciones pgTAP, más HTTP/Auth, Server Actions, invitaciones y snapshots; runner creó Supabase temporal y confirmó limpieza/preservación de recursos Docker anteriores.
- E2E con runner local crea proyecto aleatorio, datos sintéticos, usa puertos loopback y limpia artefactos. La primera ejecución falló al no encontrar Chromium Playwright en caché; se repitió con Google Chrome instalado localmente. Resultado en Validaciones.
- npm run test:security:jwt no se ejecutó porque la documentación indica destino Testing.
- Node emitió advertencias MODULE_TYPELESS_PACKAGE_JSON al importar TS desde Node; no se añadió "type": "module" ya que cambiaría el modo global del paquete.

## 10. Plan QR-008/009/010

### QR-008 — Limpieza segura

1. Verificar argon2 con grafo, lifecycle, runtime, Docker e historial; retirar solo si no hay consumidor.
2. Revisar documentos/placeholders por fecha, propietario y referencias; crear índice antes de archivar evidencia.
3. Quitar imports/variables solo con evidencia concreta; mantener toda cobertura de seguridad.

### QR-009 — Rendimiento

1. Definir ruta, actor, dispositivo, red, fixture, herramienta y repeticiones; medir LCP/INP/CLS/TTFB y bytes para login, dashboard, reportes, /scanner y /mi-qr; comparar visitas frías/calientes.
2. Analizar chunks de Recharts y carga PDF/Excel antes de proponer división.
3. Instrumentar portal/reportes con fixtures sintéticos: consultas, filas y p50/p95; medir SQL local con EXPLAIN (ANALYZE, BUFFERS).
4. Hacer una optimización por PR y repetir baseline junto con seguridad/RLS/Auth.

### QR-010 — Mantenibilidad

1. Extraer UI de horarios, usuarios y credenciales en PRs pequeños después de cobertura de regresión.
2. Revisar consistencia de Node/scripts sin cambio global accidental.
3. Considerar extracción del scanner después de QR-006 y pruebas físicas.
4. Conciliar inventario de advisory con análisis actual; no degradar para silenciar alertas.

Baseline QR-009 precede cualquier optimización; QR-008 valida antes de retirar; QR-010 avanza módulo por módulo. Cada cambio debe preservar matriz QR-004 y mantener QR-003 bloqueada.

## 11. Validaciones

| Comando | Resultado |
|---|---|
| npm run lint | PASS, sin errores/advertencias. |
| npm run typecheck | PASS (tsc --noEmit). |
| npm test | PASS: 80 aprobadas, 0 fallidas, 1 omitida (sandbox bloqueó socket del agente GnuPG). Simulación predeterminada indicó que no se conecta ni exporta. |
| npm run test:security:matrix:local | PASS: 201 pgTAP y matrices HTTP/Auth/Server Actions. Teardown PASS; proyecto loopback desechable y recursos Docker preexistentes preservados. |
| npm run test:e2e inicial | FAIL de entorno: Chromium Playwright no estaba instalado. Stack desechable limpiado. |
| E2E con QR004_CHROME_BIN=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome npm run test:e2e | PASS: 22/22 Chromium con Google Chrome instalado. Auth/Next/Supabase sintéticos locales; teardown confirmó eliminación del proyecto temporal y preservación de contenedores/volúmenes/redes previos. |
| npm run build | PASS desde copia temporal sin .env*, con URL/clave pública de placeholder y entorno de proceso reducido. 41/41 rutas estáticas generadas. Next advirtió 27 archivos trazados fuera de outputFileTracingRoot por el symlink de node_modules de la copia; compilación y build terminaron con código 0. |
| npm audit --json | No disponible: DNS ENOTFOUND registry.npmjs.org; sin informe de advisories. |

No se invocó la verificación criptográfica/RPC de PIN, no se envió un PIN incorrecto para validación y no hubo escaneo exitoso. Para la matriz HTTP local, el runner insertó tres sesiones de asistencia sintéticas y cerradas en el PostgreSQL temporal para comprobar consultas por empresa/sucursal; no registró eventos ni movimientos. También envió tres peticiones a /api/attendance/scan con QR/PIN centinela sintéticos, todas rechazadas por autenticación, rol o dispositivo antes de validar credenciales, con snapshots sin efectos secundarios. El runner eliminó la base temporal al finalizar. Las restricciones no se extendieron a datos reales ni entornos alojados.

## 12. Límites y decisión

- El análisis estático no demuestra rendimiento ni permite descartar uso externo/código dinámico.
- Auditoría npm completa bloqueada por red; el advisory de braces se contrastó con GitHub Advisory Database, no reemplaza el análisis integral.
- E2E se ejecutó con Google Chrome local, no con el Chromium administrado por Playwright; la ejecución inicial falló por ausencia de este último.
- La advertencia standalone de 27 trazas se produjo al construir desde copia temporal cuyo node_modules apunta fuera de la raíz; el build pasó, pero esa advertencia limita esta medición del artefacto standalone.
- No se accedió a Testing/Producción ni se hicieron migraciones remotas, backups o cambios funcionales.
- QR-003 permanece pospuesta, P0 y NO-GO; QR-004/005/006 continúan En curso.

El informe sirve para revisar un plan, no autoriza eliminaciones/refactorizaciones. No declara QR-004/005/006 cerradas ni dependencias libres de vulnerabilidades.
