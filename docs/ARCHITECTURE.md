# Arquitectura

## Alcance observado

Aplicación Next.js con App Router bajo `src/app`, componentes de interfaz en `src/components` y lógica reutilizable en `src/lib`. El backend de negocio combina Route Handlers de Next.js con PostgreSQL/Supabase; las operaciones de asistencia y varias reglas de integridad están implementadas como funciones SQL/migraciones.

## Módulos

- **Acceso:** login, callback/confirmación de Auth, invitaciones y selección de empresa (`src/app/(auth)`, `src/lib/access`).
- **Administración:** panel, empleados, supervisores, horarios, asistencias, horas extra, reportes y configuración (`src/app/(admin)`, `src/components/admin`).
- **Supervisión:** escáner QR móvil y contexto/dispositivos autorizados (`src/app/(supervisor)`, rutas API de supervisor).
- **Portal de empleado:** credenciales QR y autoservicio (`src/app/(employee)`, `src/lib/employee`).
- **API:** endpoints agrupados por dominio bajo `src/app/api`.
- **Persistencia:** migraciones, políticas, funciones y pruebas SQL bajo `supabase/`; los clientes SSR/browser están en `src/lib/supabase`.
- **Despliegue:** compilación Next standalone en `Dockerfile`; CI en `.github/workflows/ci.yml`; publicación de imagen Testing en `publish-ghcr-testing.yml`.

## Aislamiento y autorización

Las migraciones incluyen datos de empresa y sucursal, memberships/permisos, políticas RLS y restricciones para operaciones de asistencia. Las rutas deben validar sesión, membresía activa, rol/permiso y alcance de empresa/sucursal; la base debe mantener una segunda frontera con RLS/grants. No se infiere que todas las rutas estén auditadas por esta descripción. Para hallazgos verificados, consultar [SECURITY-AUDIT.md](../SECURITY-AUDIT.md) y los informes por etapa, y ejecutar QR-004.

Las funciones `SECURITY DEFINER` necesitan inspección individual de owner, `search_path`, grants, validación de empresa, identidad del solicitante y efectos secundarios. Los secretos de servicio son solo de servidor y nunca se exponen al navegador.

## Límites observados

- `next.config.ts` usa `output: "standalone"`, permite un origen de túnel configurado explícitamente y añade los archivos AFM de PDFKit al trazado del endpoint de exportación.
- `Dockerfile` fija versión/digest de Node, compila con valores públicos de Supabase y ejecuta como usuario no privilegiado; el health check consulta `/api/healthz`.
- `package.json` lista Next/React, Supabase SSR/client, ZXing, Argon2, ExcelJS, PDFKit, PostgreSQL, QRCode, Recharts y Zod, entre otras dependencias. La presencia no prueba necesidad ni obsolescencia.
- La imagen Testing está separada y el workflow exige que la URL pública corresponda al proyecto de Testing.

## Preguntas abiertas

1. Completar diagrama de llamadas por rol, acción, endpoint, función SQL y tabla durante QR-004.
2. Confirmar contratos y límites de caché/revalidación por ruta antes de cualquier cambio de caché.
3. Medir bundle/SSR y carga móvil antes de decidir divisiones de cliente o dependencias.
4. Comparar documentación operativa histórica y estado de entornos para identificar páginas canónicas sin borrar evidencia.

## Referencias

- [Flujos de acceso](ACCESS-FLOW.md)
- [Pruebas](TESTING.md)
- [Flujo de desarrollo](DEVELOPMENT-WORKFLOW.md)
- [Decisiones registradas](DECISIONS.md)
- [supabase/README.md](../supabase/README.md)
