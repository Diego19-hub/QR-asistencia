# Instrucciones para Codex

## Proyecto

QR-asistencia es una aplicación empresarial construida con Next.js App Router, React, TypeScript, Supabase Auth y PostgreSQL. Revisa [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) antes de cambios que crucen módulos y [TASKS.md](TASKS.md) para el alcance priorizado. La documentación operativa existente se conserva y se enlaza desde [README.md](README.md) y [docs/DEVELOPMENT-WORKFLOW.md](docs/DEVELOPMENT-WORKFLOW.md).

## Flujo de trabajo

1. Identifica una tarea de `TASKS.md`; aclara alcance y dependencias desde la evidencia disponible.
2. Lee la skill en `.agents/skills/` que corresponda al trabajo. Usa `qr-attendance-security-audit` para auditorías de seguridad, `qr-attendance-testing` para diseño o ejecución de pruebas, `qr-attendance-performance` para optimización de rendimiento y `qr-attendance-code-cleanup` para limpieza. Para funcionalidades aplica `qr-attendance-feature-delivery`.
3. Sigue el flujo de [docs/DEVELOPMENT-WORKFLOW.md](docs/DEVELOPMENT-WORKFLOW.md): investigar, establecer línea base cuando aplique, proponer un cambio acotado, implementar, verificar y documentar.
4. Ejecuta validaciones relevantes al alcance y registra los comandos y resultados reales. No afirmes que una validación pasó si no se ejecutó.
5. Actualiza documentación y el estado/evidencia de la tarea. Usa `.github/pull_request_template.md` para preparar PRs. No hagas merge ni despliegues sin aprobación.

## Convenciones

- Mantén TypeScript estricto, validación de entradas en límites de confianza y componentes con responsabilidades claras.
- Prefiere cambios pequeños, legibles y consistentes con las abstracciones existentes en `src/lib`, `src/components` y `src/app`.
- Reutiliza componentes y funciones cuando reduzca duplicación real; evita dependencias nuevas si la plataforma o una dependencia existente resuelve el caso.
- Documenta decisiones duraderas en español. Conserva nombres de APIs, tablas y términos propios en su forma técnica.
- No hagas refactorizaciones masivas sin necesidad demostrada ni cambies comportamientos fuera del alcance acordado.

## Seguridad y aislamiento multiempresa

- Trata cada empresa como un límite de seguridad. Deriva la empresa activa de la sesión/membresía autorizada en servidor; no confíes en `company_id`, rol, permisos, sucursal o identidad enviados por el cliente.
- Toda lectura/escritura debe aplicar autorización y alcance de empresa/sucursal. Revisa RLS, funciones SQL, grants y llamadas RPC como una sola frontera.
- Analiza con especial cuidado `SECURITY DEFINER`, `service_role`, cookies, redirects, callbacks, códigos QR, credenciales de dispositivo y PIN. No expongas secretos ni datos personales innecesarios.
- No pongas secretos de servidor bajo `NEXT_PUBLIC_*`. Las claves públicas compiladas deben apuntar al entorno previsto.
- Preserva auditoría, integridad transaccional, límites de intentos y procedimientos de revocación. No apliques migraciones ni ejecutes operaciones sobre bases remotas como parte de una tarea documental o de pruebas locales.

## Pruebas y rendimiento

- Consulta [docs/TESTING.md](docs/TESTING.md); las pruebas de base de datos solo se ejecutan contra una instancia local y desechable conforme a sus precondiciones.
- Conserva pruebas de seguridad, integración y regresión. Antes de borrar o sustituir una prueba, demuestra obsolescencia y cobertura equivalente.
- Para cambios de rendimiento, registra método, entorno y métricas antes/después según [docs/PERFORMANCE.md](docs/PERFORMANCE.md). No inventes resultados ni reduzcas seguridad o claridad por mejoras marginales.
- Evita consultas repetidas, cargas innecesarias al cliente y procesamiento duplicado, verificando el impacto funcional y de privacidad.

## Optimización y limpieza

- Prioriza soluciones simples y mantenibles; evita código duplicado y dependencias innecesarias.
- Elimina código muerto solo después de verificar referencias, rutas dinámicas, uso indirecto, scripts y cobertura.
- No realices refactorizaciones masivas sin justificación; mide antes y después cuando el cambio afecte rendimiento.
- No elimines código o pruebas críticas ni afectes funciones de producción.
- Documenta candidatos y evidencia en `docs/CODE-CLEANUP.md`; las eliminaciones requieren aprobación para el módulo correspondiente.

## Skills del proyecto

Las skills viven en `.agents/skills/` y deben mantenerse enfocadas en su descripción, con frontmatter YAML válido. Al modificarlas, valida su estructura y consistencia con estas reglas. Las instrucciones del usuario y el alcance autorizado prevalecen sobre sugerencias de una skill.
