# QR-asistencia

Sistema web multiempresa para administrar personal y registrar asistencia mediante códigos QR. La aplicación ofrece acceso administrativo, gestión de empleados y supervisores, horarios y sucursales, registro de entrada/salida desde un escáner móvil, portal personal con credenciales QR, revisión de ajustes, horas extra y reportes exportables.

## Tecnologías y arquitectura

- Next.js 16 con App Router, React 19 y TypeScript.
- Supabase Auth y PostgreSQL; el aislamiento por empresa se aplica en la base de datos mediante políticas RLS y funciones SQL.
- Tailwind CSS para estilos, Zod para validación, ZXing para lectura QR, ExcelJS y PDFKit para exportaciones.
- Renderizado y API en Next.js. `next.config.ts` configura salida standalone; `Dockerfile` empaqueta la aplicación para contenedores.
- Los detalles y límites conocidos están en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Funcionalidades implementadas

- Autenticación, confirmación de correo, invitaciones y selección de empresa.
- Administración de empresas, miembros, permisos, supervisores, empleados y sucursales.
- Horarios, asignaciones, reglas laborales, asistencias, ajustes y horas extra.
- Escáner QR móvil para supervisores y portal QR del empleado con PIN opcional.
- Panel, reportes paginados y exportaciones PDF/XLSX.
- Auditoría, límites de concurrencia/exportación y controles multiempresa en Supabase.

Las rutas de la aplicación y sus flujos se describen en [docs/ACCESS-FLOW.md](docs/ACCESS-FLOW.md).

## Requisitos

- Node.js 24.21.0 para coincidir con CI y Docker; el mínimo declarado por el proyecto es Node.js 20.9.
- npm y un proyecto Supabase configurado.
- Para pruebas SQL, Docker y Supabase CLI; ver [supabase/README.md](supabase/README.md).

## Instalación y configuración local

```bash
npm ci
cp .env.example .env.local
```

Completa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` con valores del proyecto Supabase elegido. Las demás variables documentadas en `.env.example` se requieren solo para flujos específicos (invitaciones, origen de callbacks o túnel de desarrollo). Consulta [docs/DEVELOPMENT-WORKFLOW.md](docs/DEVELOPMENT-WORKFLOW.md) para los límites de Testing y Producción.

No guardes claves `service_role`, secretos JWT, contraseñas ni tokens en el repositorio o en variables `NEXT_PUBLIC_*`. Las claves públicas se incrustan en el bundle al compilar; verifica que apunten al entorno correcto.

## Comandos disponibles

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run test
```

La suite puede ejecutarse por área con los scripts listados en `package.json`, como `npm run test:scanner`, `npm run test:reports`, `npm run test:pin-lockout`, `npm run test:employee-portal`, `npm run test:user-access`, `npm run test:auth-flow`, `npm run test:credentials` y `npm run test:deployment`. Las pruebas de integración y de base tienen precondiciones de entorno; consulta [docs/TESTING.md](docs/TESTING.md) antes de ejecutarlas. CI ejecuta lint, typecheck, pruebas, una integración local y build en `.github/workflows/ci.yml`.

## Testing y Producción

El workflow `publish-ghcr-testing.yml` construye y publica una imagen para Testing únicamente tras CI exitosa en `main` y con variables públicas de Testing configuradas. La imagen se publica en GHCR con etiqueta de SHA y digest. Los detalles de despliegue documentados están en [DOKPLOY-GHCR-TESTING.md](DOKPLOY-GHCR-TESTING.md), [DEPLOYMENT-FASE-6A.md](DEPLOYMENT-FASE-6A.md) y [docs/DEVELOPMENT-WORKFLOW.md](docs/DEVELOPMENT-WORKFLOW.md).

No se encontró en los workflows inspeccionados un proceso de despliegue automático a Producción. Revisa y autoriza cualquier cambio de entorno, migración o despliegue según el procedimiento operativo vigente.

## Desarrollo con Codex

Antes de cambiar el sistema, lee [AGENTS.md](AGENTS.md), selecciona una tarea de [TASKS.md](TASKS.md), consulta la documentación de [docs/](docs/) y carga la skill pertinente de `.agents/skills/`. Trabaja con cambios pequeños, conserva el aislamiento por empresa y ejecuta las verificaciones aplicables al alcance. Usa `.github/pull_request_template.md` para documentar la revisión; espera aprobación antes del merge y despliegue.

## Documentación del proyecto

- [AGENTS.md](AGENTS.md): reglas permanentes para Codex.
- [TASKS.md](TASKS.md): backlog con criterios de aceptación y evidencia.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ACCESS-FLOW.md](docs/ACCESS-FLOW.md), [docs/TESTING.md](docs/TESTING.md) y [docs/DEVELOPMENT-WORKFLOW.md](docs/DEVELOPMENT-WORKFLOW.md): arquitectura, acceso, validación y flujo de trabajo.
- [docs/DECISIONS.md](docs/DECISIONS.md), [docs/PERFORMANCE.md](docs/PERFORMANCE.md) y [docs/CODE-CLEANUP.md](docs/CODE-CLEANUP.md): decisiones, medición y limpieza segura.
- [docs/PIN-LOCKOUT-FIX.md](docs/PIN-LOCKOUT-FIX.md): diagnóstico y validación local de QR-003; el despliegue a Testing queda separado.
- [supabase/README.md](supabase/README.md) y los documentos operativos enlazados allí: operación de base de datos, bootstrap e invitaciones.
