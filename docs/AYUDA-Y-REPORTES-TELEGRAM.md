# Ayuda y reportes por Telegram

## Funcionamiento

El botón **Ayuda** abre un panel disponible en escritorio y móvil. La búsqueda divide `docs/MANUAL-USUARIO.md` en secciones y párrafos y devuelve fragmentos coincidentes de ese archivo. No usa modelos ni servicios de IA externos. Cuando no encuentra una coincidencia clara, lo indica y ofrece **Reportar un problema**.

El reporte es opcional. El formulario solicita solo una descripción y una página de la aplicación. Antes de enviar, el servidor valida el tamaño, la longitud y la ruta; además, redacta patrones comunes de correos, teléfonos, credenciales, tokens e identificadores. No envía la pregunta del chat, la sesión, el usuario, la empresa, los datos del navegador ni la URL completa. No incluyas información personal, contraseña, PIN, token o cookie: la redacción es una defensa adicional, no una garantía de detectar cualquier dato sensible.

Los envíos se hacen desde el servidor con `sendMessage` de la [Telegram Bot API oficial](https://core.telegram.org/bots/api#sendmessage). Si falta una de las variables privadas, el endpoint no intenta conectarse a Telegram y explica que el canal no está configurado. El bot solo envía notificaciones de reportes; la aplicación no recibe ni responde mensajes de Telegram.

El límite actual admite cuatro intentos por clave de cliente durante 15 minutos. La clave se calcula como hash de `CF-Connecting-IP` o `X-Real-IP`; no se guarda el texto del reporte ni la IP en la memoria del limitador. Es una limitación por proceso, por lo que puede reiniciarse con el servidor y no coordina instancias independientes. Para producción con varias réplicas, se debe configurar un limitador distribuido antes de considerar esta protección global.

## Crear y preparar el bot

1. En Telegram, abre la cuenta oficial **@BotFather** e inicia la conversación.
2. Envía `/newbot` y sigue las instrucciones para elegir nombre y nombre de usuario.
3. Guarda el token que entrega BotFather en un gestor de secretos. Quien tenga ese token puede controlar el bot: no lo publiques, no lo pegues en incidencias y no lo añadas a Git.
4. Abre el chat privado del bot recién creado y envíale `/start`. El propietario debe iniciar esa conversación; Telegram no permite al bot escribirle primero.
5. Obtén el `chat_id` de ese chat usando el método `getUpdates` de la Bot API oficial después de enviar `/start`. Hazlo desde una herramienta local confiable, evita guardar la URL que incluye el token y no compartas la respuesta; el objeto `message.chat.id` contiene el identificador. Si `getUpdates` no devuelve actualizaciones, confirma que no haya un webhook configurado para ese bot y vuelve a enviar `/start`.
6. En la configuración privada del servidor que ejecuta QR-asistencia, define:

   - `TELEGRAM_BOT_TOKEN`: el token de BotFather.
   - `TELEGRAM_CHAT_ID`: el identificador del chat privado iniciado por el propietario.

   No uses prefijos `NEXT_PUBLIC_`. En Dokploy, guarda ambas como variables de entorno privadas del servicio de aplicación. En desarrollo local, añádelas a un archivo local ignorado por Git, nunca a `.env.example` con valores reales ni a mensajes del chat. Los valores pueden dejarse vacíos para mantener el envío deshabilitado.

7. Reinicia el proceso de aplicación para que lea la configuración. Comprueba el canal solo con un reporte sintético y un chat de prueba controlado. La respuesta de éxito de la aplicación confirma que Telegram aceptó el envío; no prueba que la configuración esté instalada en otros entornos.

La cuenta receptora debe conservar acceso al bot/chat. Si se revoca o cambia el token, actualiza el secreto del servidor y prueba nuevamente con contenido sintético.

## Pruebas

Ejecutar `npm run test:help`. Las pruebas usan un `fetch` falso y un token/chat sintéticos: no hacen solicitudes a Telegram. Verifican respuestas extraídas del manual, respuesta sin coincidencia, validación, redacción de datos sensibles, límite de intentos, ausencia de envío con configuración incompleta y manejo de errores del proveedor.

El envío real queda **Por verificar** hasta configurar un bot y chat de prueba y enviar un reporte sintético. No se deben usar datos personales ni secretos para esa comprobación.
