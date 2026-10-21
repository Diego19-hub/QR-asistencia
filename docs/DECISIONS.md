# Decisiones y convenciones observadas

Este registro distingue decisiones visibles en los archivos de repositorio de propuestas pendientes de revisión.

| ID | Estado | Decisión/convenio | Evidencia |
|---|---|---|---|
| D-001 | Observado | Next.js App Router con salida standalone para despliegue en contenedor. | `next.config.ts`, `Dockerfile` |
| D-002 | Observado | Supabase Auth y PostgreSQL son la capa de identidad/persistencia; el aislamiento multiempresa se expresa también en migraciones y RLS. | `.env.example`, `supabase/migrations/`, `supabase/tests/` |
| D-003 | Observado | Los builds Docker fijan Node 24.21.0 y una imagen digest; se ejecutan como usuario `node`. | `Dockerfile` |
| D-004 | Observado | CI valida lint, tipos, suites de prueba, integración local y build; publicación de Testing está separada y condicionada a CI exitosa. | `.github/workflows/ci.yml`, `.github/workflows/publish-ghcr-testing.yml` |
| D-005 | Observado | Las pruebas SQL deben ejecutarse localmente y con datos descartables. | `supabase/README.md`, tests SQL |
| D-006 | Pendiente | Elegir estrategia y entorno E2E antes de agregar Playwright. | QR-005 |
| D-007 | Pendiente | Establecer umbrales de rendimiento después de capturar línea base representativa. | QR-009, `PERFORMANCE.md` |

Al cambiar una decisión, anota contexto, alternativas consideradas, consecuencias y referencias al PR/tarea. No conviertas convenciones inferidas en decisiones aprobadas.
