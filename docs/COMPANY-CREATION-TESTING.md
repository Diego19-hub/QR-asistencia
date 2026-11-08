# Pruebas locales para crear otra empresa

La suite SQL `supabase/tests/create_additional_company_test.sql` verifica que la RPC permita la creación solo a una identidad autenticada con membresía Owner activa, genere una membresía Owner para el actor, registre auditoría y respete RLS entre empresas. La suite termina con `ROLLBACK`.

Para ejecutarla, prepara una instancia Supabase desechable aislada con las migraciones del repositorio. En su `supabase/config.toml`, usa un `project_id` con el prefijo `qr_company_creation_disposable_` y no la enlaces a ningún proyecto alojado. Después ejecuta:

```sh
COMPANY_CREATION_SUPABASE_WORKDIR=/ruta/al/proyecto-local-desechable npm run test:company-creation:db
```

El script rechaza rutas sin el prefijo de proyecto desechable y pasa `--local` a Supabase CLI. No uses Testing o Producción para esta prueba. La ruta HTTP/Auth complementaria está en la matriz `npm run test:security:matrix:local`; esa matriz requiere Docker y un stack local desechable.
