# Chatbot con Gemini

El chatbot puede usar Gemini desde `POST /api/help/answer`. La clave se mantiene en el servidor; el navegador no recibe la clave. Antes de solicitar una respuesta, el servidor busca en `docs/MANUAL-USUARIO.md` hasta tres fragmentos pertinentes y envía únicamente esos fragmentos y una pregunta redactada. No hay búsqueda web ni se envía el reporte de problemas a Gemini.

## Configuración

Obtén una clave mediante el flujo oficial de Google AI Studio y configura `GEMINI_API_KEY` como secreto privado del entorno del servidor (por ejemplo, como variable local privada o en el gestor de variables del hosting). No la agregues a archivos versionados, al cliente web, a URLs ni a logs, y no uses un prefijo `NEXT_PUBLIC_`. La integración usa el modelo `gemini-2.5-flash` por defecto. Para elegir otro modelo compatible, configura `GEMINI_MODEL` con su identificador permitido. Reinicia o vuelve a desplegar el servidor después de cambiar variables, siguiendo el procedimiento operativo de ese entorno.

Las pruebas automatizadas usan respuestas simuladas y no necesitan una clave real. No configures una clave de producción en el entorno de pruebas.

## Privacidad y uso de datos

El formulario del chat advierte que no se deben escribir nombres ni datos de empresa o trabajador, correo, RFC, NSS, contraseñas, PIN o tokens. El servidor redacta patrones detectables antes de llamar al proveedor y no registra preguntas ni respuestas. La redacción basada en patrones no puede reconocer con certeza todo dato sensible escrito en lenguaje natural; evita introducirlo.

El nivel gratuito de Gemini puede usar el contenido enviado para mejorar sus productos, según sus condiciones vigentes. Antes de habilitar la clave en un entorno real, el responsable debe revisar las condiciones y cuotas actuales del proveedor en Google AI Studio y decidir si el uso es aceptable. No se fija una cuota numérica en este documento porque el proveedor puede cambiarla; si la API devuelve límite/cuota agotada, la respuesta se resuelve con el modo extractivo local y no se reintenta en bucle.

## Fallback y límites

- Si `GEMINI_API_KEY` no está configurada, no se hace una llamada externa y se conserva la respuesta extractiva actual del manual.
- Si Gemini responde con error, alcanza una cuota, excede el tiempo límite o no devuelve una respuesta válida, el servidor usa esa misma respuesta del manual.
- Si los fragmentos no alcanzan para responder, el chatbot lo dice y remite a **Reportar un problema**; el formulario y el envío independiente a Telegram no cambian.
- Cada pregunta admite hasta 300 caracteres y el cuerpo de la solicitud está limitado. Hay un límite best-effort de 20 preguntas por cliente y ventana de 15 minutos, aplicado en memoria por proceso; no sustituye un limitador distribuido si el servicio escala a varias instancias.
- Los errores técnicos registran solo el estado HTTP o el tipo de error, nunca el contenido de la conversación ni la clave.
