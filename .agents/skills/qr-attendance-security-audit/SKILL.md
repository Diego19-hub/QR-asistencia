---
name: qr-attendance-security-audit
description: Audita autenticación, permisos, RLS, funciones SQL, QR, PIN, dispositivos y aislamiento multiempresa de QR-asistencia. Úsala para revisiones o cambios con implicaciones de seguridad.
---

# Auditoría de seguridad QR-asistencia

## Cuándo usarla
Para QR-004 o cambios en Auth, permisos, RLS, funciones privilegiadas, QR/PIN y dispositivos.

## Procedimiento
1. Lee `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/ACCESS-FLOW.md` y documentación de seguridad vigente.
2. Define activo, actor, empresa/sucursal y operación. Rastrea página → API/helper → Auth → RPC/SQL → tablas y efectos.
3. Construye matriz actor × operación × empresa/sucursal; incluye anónimo, membresía inactiva, rol insuficiente, otra empresa y revocación.
4. Inspecciona RLS, `SECURITY DEFINER` (owner, `search_path`, grants y validación), escritura, cookies, secretos, callbacks, intentos y auditoría.
5. Valida controles positivos y negativos con pruebas existentes o aisladas. No pruebes en Producción ni reveles tokens.
6. Reporta hallazgos con evidencia, impacto, severidad razonada, objeto y corrección sugerida; distingue riesgo confirmado de pregunta abierta.

## Verificación
- Comprueba aislamiento en API y base de datos, no solo ocultamiento de UI.
- Documenta pruebas y límites del entorno; conserva regresiones de seguridad.
- Revisa migraciones localmente; no las apliques remotamente sin autorización explícita.
