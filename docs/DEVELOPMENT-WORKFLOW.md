# Flujo de desarrollo

## Antes de editar

1. Revisa `AGENTS.md`, `TASKS.md`, estado de Git y documentación del módulo.
2. Carga la skill aplicable en `.agents/skills/`.
3. Sigue las referencias existentes en `README.md`, `supabase/README.md` y los documentos operativos. Evita duplicar instrucciones canónicas.
4. Identifica usuarios, rutas, API, consultas, funciones SQL, políticas y pruebas afectadas.
5. Registra comportamiento/métricas iniciales cuando la tarea trate rendimiento o una regresión.

## Implementación y entrega

1. Propón un cambio pequeño que cumpla criterios de aceptación de la tarea.
2. Verifica autorización y aislamiento multiempresa en servidor y base de datos.
3. Añade o ajusta pruebas para el comportamiento afectado; ejecuta las verificaciones aplicables.
4. Compara resultado con la línea base y actualiza documentación/evidencia de `TASKS.md`.
5. Prepara una rama/PR de alcance acotado con `.github/pull_request_template.md`.
6. Espera aprobación antes de merge, migraciones remotas o despliegue.

## Entornos

- **Local:** `.env.local` no versionado. Copia el esquema desde `.env.example`; no incluyas secretos en commits.
- **Testing:** workflow de GHCR usa `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` como variables públicas y valida que la URL corresponda a Testing. Las claves públicas se compilan en la imagen.
- **Producción:** no se encontró workflow de publicación/despliegue de Producción en los archivos CI revisados. Usa el runbook de despliegue vigente y confirma destino, secretos, migraciones, reversión y aprobación antes de actuar.
- **Base local:** los tests SQL y de integración usan instancias locales desechables. Las instrucciones detalladas de bootstrap/Auth se encuentran en `supabase/README.md` y `INVITATION-FLOW-TESTING.md`.

No copies claves entre entornos. No uses credenciales de Producción para pruebas locales o Testing.
