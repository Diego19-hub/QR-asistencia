# QR-asistencia

Sistema de control de asistencia laboral con Next.js, TypeScript y Supabase. Incluye gestión multiempresa de empleados, horarios, asistencias, horas extra, reportes y exportaciones, además del flujo móvil de escaneo QR para supervisores.

## Requisitos

- Node.js 20.9 o posterior.
- npm.
- Un proyecto Supabase configurado para la aplicación.

## Instalación local

```bash
npm ci
cp .env.example .env.local
```

Completa `.env.local` con la URL del proyecto Supabase y su clave publicable (`NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). `NEXT_ALLOWED_DEV_ORIGIN` solo se necesita para permitir un origen HTTPS temporal durante desarrollo.

No coloques claves `service_role`, secretos JWT, contraseñas ni tokens en variables `NEXT_PUBLIC_*` ni en archivos versionados. `.env.local` está excluido por Git.

## Desarrollo y validaciones

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
npm run test:scanner
npm run test:reports
```

Las pruebas SQL pgTAP se ejecutan únicamente contra una base local desechable:

```bash
npx supabase start
npx supabase test db --local
```

Revisa las migraciones antes de aplicarlas. Este repositorio no ejecuta migraciones automáticamente contra producción.

## Configuración administrativa

Consulta [supabase/README.md](supabase/README.md) para el procedimiento seguro de inicialización administrativa y las instrucciones de pgTAP. Los scripts privilegiados deben ejecutarse desde un entorno de confianza; nunca desde el navegador ni desde una ruta pública de la aplicación.
