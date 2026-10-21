---
name: qr-attendance-testing
description: Diseña, ejecuta y documenta pruebas unitarias, HTTP, Supabase/PostgreSQL, pgTAP, E2E y de regresión para QR-asistencia.
---

# Pruebas QR-asistencia

## Cuándo usarla
Al crear o cambiar pruebas, validar un cambio, reproducir una regresión o planificar cobertura Playwright.

## Procedimiento
1. Lee `AGENTS.md` y `docs/TESTING.md`; inspecciona scripts de `package.json` y el workflow CI.
2. Identifica propiedad observable, límites, roles, datos y efectos que deben probarse.
3. Reutiliza fixtures seguros; usa datos sintéticos y aísla empresas, usuarios y dispositivos.
4. Selecciona la capa mínima suficiente y cubre denegaciones, errores y regresiones.
5. Para SQL, confirma que la instancia sea local y desechable; nunca apuntes a Testing/Producción.
6. Ejecuta comandos pertinentes y registra el resultado real; no dependas solo de mocks que omitan controles críticos.

## Verificación
- Incluye escenarios permitidos/denegados, integridad y concurrencia cuando aplique.
- Conserva regresiones de PIN, QR, Auth y tenant; no borres pruebas sin cobertura equivalente demostrada.
- Informa ambiente, comando, resultado y limitaciones; no marques como pasada una prueba no ejecutada.
