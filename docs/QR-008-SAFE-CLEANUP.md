# QR-008 — Limpieza segura: inventario y decisiones

**Fecha:** 2026-10-30

**Base:** `e30c4cdab1d9071b1be7fa6bc95b0f47e775674c` (PR #22 integrado)

**Rama:** `chore/qr-008-safe-cleanup`

**Alcance:** inspección estática e inventario conservador. Se conserva todo candidato sin evidencia suficiente. No se modificaron código funcional, pruebas, dependencias, scripts, SQL, RLS ni configuración.

## 1. Resumen

Se revisaron los candidatos de QR-007, con atención a `argon2`. No se encontró una eliminación que cumpla el criterio de obsolescencia demostrada. `argon2@0.45.1` queda en `package.json` y `package-lock.json`: no se encontraron imports ni consumidores transitivos en el repositorio, pero la presencia de una referencia de compatibilidad ABI en `Dockerfile` y del lifecycle nativo en evidencia operativa no permite descartar todos los usos de build u operación.

No se retiraron archivos, dependencias, código, scripts ni pruebas. Esta fase entrega el inventario y la razón de conservación; no considera la reducción de líneas un objetivo por sí mismo.

## 2. Alcance y método

Se revisaron `AGENTS.md`, `README.md`, `TASKS.md`, `docs/ARCHITECTURE.md`, `docs/CODE-CLEANUP.md`, `docs/QR-007-CODE-AUDIT.md`, `docs/TESTING.md`, `docs/DEVELOPMENT-WORKFLOW.md`, `package.json`, `package-lock.json`, `Dockerfile`, `next.config.ts` y `.github/workflows/ci.yml`.

Se buscaron referencias en el código fuente, pruebas, scripts, workflows, documentación, Docker y migraciones; se inspeccionó el historial Git y se usó `npm explain`/`npm ls` para el grafo local. Se consideraron entrypoints convencionales de Next.js, carga dinámica, ejecución de scripts y uso por CI. No se leyeron archivos `.env*`, no se usaron secretos y no se accedió a Testing ni Producción.

## 3. Inventario de candidatos

| Candidato | Clasificación | Evidencia y decisión |
|---|---|---|
| `argon2@0.45.1` | B — posiblemente innecesario; conservar | Dependencia raíz en `package.json` y lockfile. `npm explain argon2` muestra solo la raíz; `npm ls argon2 --all` no encontró dependientes transitivos. Búsquedas de imports y llamadas a la API no hallaron usos en código, scripts, pruebas o workflows. Sin embargo, `Dockerfile` incluye explícitamente argon2 en la nota de compatibilidad ABI para módulos nativos y `DEPLOYMENT-ETAPA-10A.md` registra lifecycle scripts de argon2. No se demuestra si ese comentario refleja un consumidor funcional actual, ni se descartan integraciones operativas fuera del repo. **No retirar.** |
| `schedule-management.tsx`, `user-access-management.tsx`, `employee-credentials.tsx`, `mobile-scanner.tsx` | A/E — uso confirmado y funciones sensibles | La auditoría QR-007 confirmó referencias desde páginas/componentes y operaciones funcionales. Son candidatos de extracción para QR-010, no limpieza de código muerto. Se conservan. |
| `.gitkeep`, placeholders y estructura de rutas | B/E — propósito posible por convención | Una referencia textual vacía no descarta generación futura ni convención de framework. No se eliminaron. |
| Scripts de seguridad e integración | E — protegidos | `package.json`, CI y documentación los llaman o explican. `test:security:jwt` tiene destino remoto documentado y no se ejecutó. Se conservan todos; no se interpreta que esté fuera de CI como obsolescencia. |
| Pruebas Node, pgTAP, HTTP/Auth y E2E | E — protegidas | Cubren PIN, Auth, invitaciones, RLS, empresa, dispositivos, asistencia, exportaciones y restauración. No se consolidaron ni retiraron pruebas. |
| Migraciones y documentación operativa | E — protegidas | Incluyen historial de esquema, seguridad, respaldo, recuperación, despliegue y reconciliación. No se eliminó evidencia histórica ni runbooks. |
| Imports, símbolos y archivos restantes | Sin candidato confirmado | No se encontró un elemento concreto cuyo consumidor estuviera ausente en todas las capas revisadas. ESLint/typecheck se usan como comprobaciones, no como prueba única de obsolescencia. |

## 4. Investigación de argon2

### Referencias y grafo

- `package.json` declara `argon2` como dependencia directa `^0.45.1`.
- `package-lock.json` fija la resolución instalada `0.45.1`.
- `npm explain argon2` indica que la dependencia llega desde la raíz; no se observaron consumidores transitivos.
- `npm ls argon2 --all` muestra un solo nodo raíz.
- Búsqueda global del repositorio, excluyendo `.git` y `node_modules`, no encontró imports estáticos/dinámicos, `require()` ni llamadas `argon2.hash`/`argon2.verify` en la aplicación. Los resultados de `hash`/`verify` corresponden a nombres genéricos del flujo de PIN y no a la biblioteca argon2.

### Docker, scripts e historial

- `Dockerfile` no invoca argon2 directamente. Su primer comentario incluye argon2 como ejemplo de módulo nativo cuya ABI debe coincidir entre build y runtime. Esto es indicio de que el paquete fue considerado al diseñar la imagen, pero no prueba un consumidor de runtime; quitarlo sin aclaración dejaría ese comentario y la compatibilidad del artefacto sin explicar.
- El Dockerfile ejecuta `npm ci`, construye Next.js y copia `.next/standalone`. No ejecuta un script de hashing con argon2. El manifiesto de producción conserva las dependencias que Next tracea; no se generó un artefacto comparativo sin argon2 porque la decisión actual es conservarlo.
- Los scripts npm, CI, scripts de operación y pruebas no importan argon2. Un registro histórico de despliegue menciona lifecycle scripts nativos de argon2 durante `npm ci`; eso acredita instalación/build, no uso funcional.
- `git log -S'argon2'` muestra referencias históricas en el manifiesto y artefactos operativos. No hay evidencia que cierre el posible consumo externo ni la razón inicial de incorporación.

### Decisión

**Conservar.** La falta de importaciones dentro del árbol no demuestra que el paquete sea completamente innecesario. Antes de reevaluar su retiro, debe aclararse con quien mantiene el build/runtime si existe código o proceso externo que importe la dependencia o espere su presencia en la imagen. No se sustituyeron algoritmos ni se modificó autenticación, hashing o PIN.

## 5. Cambios implementados y descartados

- **Implementado:** documentación del inventario, la evidencia de `argon2`, las decisiones de conservación y el estado de QR-008.
- **Descartado:** retirar `argon2`, modificar Docker, dependencias, imports, componentes, scripts, fixtures, pruebas o archivos históricos. La evidencia disponible no satisface el criterio para ninguna de esas eliminaciones.
- **Archivos eliminados:** ninguno.
- **Dependencias retiradas:** ninguna.
- **Pruebas eliminadas o modificadas:** ninguna.

La decisión es reversible: una futura PR acotada puede retirar argon2 si documenta el propósito original, consumidores operativos, impacto en Docker/standalone y resultados de instalación limpia, build y pruebas.

## 6. Validaciones

| Comando | Resultado observado |
|---|---|
| `npm run lint` | PASS, código 0. |
| `npm run typecheck` | PASS, código 0. |
| `npm test` | PASS: 80 aprobadas, 0 fallidas, 1 omitida porque el sandbox bloqueó el socket del agente GnuPG. Node emitió avisos existentes `MODULE_TYPELESS_PACKAGE_JSON`; no se cambió el modo global del proyecto. |
| `npm run test:security:matrix:local` | PASS. Matriz pgTAP y HTTP/Auth/Server Actions contra `qr004_disposable_03845a5b9cba`, loopback y migraciones locales; casos tenant/rol/permisos y snapshots rechazados pasaron. Teardown eliminó stack y datos temporales y preservó recursos Docker previos. No se accedió a Supabase alojado. |
| `QR004_CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:e2e` | PASS: 22/22 con Google Chrome instalado. Auth, Next y Supabase locales/sintéticos. Teardown eliminó stack y datos temporales y preservó recursos Docker anteriores. No registró asistencia ni ejecutó verificación real de PIN. |
| Build aislado con `npm run build` | PASS: compilación TypeScript y 41/41 rutas. Se construyó desde archivo de `HEAD` en `/private/tmp`, sin archivos `.env*`, con URL/clave pública placeholder y `node_modules` enlazado. Next avisó que 27 archivos trazados están fuera de `outputFileTracingRoot` por el enlace. El build acabó con código 0, pero la advertencia limita lo que se puede concluir sobre integridad del standalone en esta copia. |

Las pruebas no alteraron código ni dependencias. La matriz local cubre controles Auth/RLS de los módulos existentes, sin pretender ser una prueba de que un candidato de limpieza es prescindible. No se ejecutó `test:security:jwt`, documentado para destino remoto.

No se declara el árbol libre de vulnerabilidades. `npm audit` de QR-007 quedó sin resultado por DNS a registry.npmjs.org; esta tarea no rebaja ni silencia ese estado y no actualiza el inventario de advisories.

## 7. Riesgos y límites

- El análisis estático no prueba ausencia de imports desde consumidores externos o configuración proporcionada fuera del repo.
- La referencia ABI de Docker y el historial de lifecycle no demuestran uso funcional; se registran como incertidumbre, no como fallo.
- El build pasó con advertencia de trazado por el symlink de `node_modules`; no se usó un artefacto de esa copia para despliegue.
- No se ejecutó `test:security:jwt`, que está documentado para un destino remoto.
- No se alteró el estado de seguridad: QR-003 sigue P0 y NO-GO; QR-004, QR-005 y QR-006 siguen en curso.

## 8. Recomendaciones

1. Mantener dependencias, pruebas y archivos sin evidencia inequívoca de obsolescencia.
2. Si se confirma que no hay consumidor operativo de argon2, preparar un cambio separado que solo elimine esa dependencia y su lockfile; comparar `npm ci`, salida standalone/Docker, build y suites.
3. Reservar extracciones de componentes para QR-010 y mediciones para QR-009.
4. Mantener actualizada la auditoría de dependencias cuando el registro y las fuentes de advisories sean accesibles; no interpretar una falla de red como resultado limpio.
