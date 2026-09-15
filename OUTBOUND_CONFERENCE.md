# Llamadas salientes mediante Twilio Conference

## Objetivo

La llamada saliente ahora usa una conferencia privada para que el operador:

- escuche el saludo al mismo tiempo que el cliente;
- pueda reconocer de oído si atendió una persona o el buzón;
- pueda dejar un mensaje después del tono del buzón;
- reciba un aviso claro si no atendió ni una persona ni un buzón.

No se usa Answering Machine Detection (AMD). La decisión persona/buzón queda en manos
del operador, evitando falsos positivos y retrasos de detección.

## Qué cambió

### `src/infra/twilio.js`

Se añadieron operaciones de Twilio para:

- crear la llamada saliente al cliente con timeout de 40 segundos;
- anunciar TwiML dentro de una conferencia activa;
- contar participantes conectados;
- redirigir al operador al mensaje de no respuesta;
- finalizar la pata del cliente si el operador abandona.

La grabación sigue siendo una grabación dual de la llamada original del operador.
Se inicia antes de crear la llamada al cliente, por lo que incluye la espera, el saludo
y la conversación o mensaje.

### `src/modules/voice/service.js`

Se añadió la coordinación del flujo:

1. Genera una sala única: `outbound-{OperatorCallSid}`.
2. Inicia la grabación con `client` y `direction=outbound` en el callback.
3. Crea la llamada al cliente mediante la API de Twilio.
4. Evita duplicar el inicio si Twilio reintenta el mismo webhook dentro del proceso.
5. Cuando hay dos participantes, reproduce el saludo en la sala.
6. Si la pata del cliente termina como `busy`, `failed`, `no-answer` o `canceled`,
   redirige al operador al aviso de no respuesta.
7. Si el operador abandona, intenta terminar la pata del cliente.

### `src/modules/voice/twiml.js`

Se añadieron respuestas TwiML para:

- unir al operador a la conferencia en espera;
- unir al cliente y arrancar la conferencia;
- informar al operador mientras se llama;
- reproducir el saludo para ambos participantes;
- informar que nadie atendió;
- informar si no fue posible iniciar la llamada.

La conferencia está limitada a dos participantes, no emite beeps y termina cuando sale
cualquiera de las dos partes.

### `src/modules/voice/routes.js`

El flujo saliente usa nuevos webhooks firmados:

- `POST /voice/outbound/client`: une al cliente a la sala;
- `POST /voice/outbound/conference-wait`: audio de espera del operador;
- `POST /voice/outbound/conference-announcement`: saludo compartido;
- `POST /voice/outbound/conference-status`: eventos de entrada, salida y fin;
- `POST /voice/outbound/client-status`: resultado de la pata saliente;
- `POST /voice/outbound/no-answer`: aviso final al operador.

`/voice/outbound/client` conserva un fallback para una llamada que hubiera recibido el
TwiML anterior justo antes de desplegar esta versión. `/voice/dial-status` se conserva
para llamadas a departamentos y para esa compatibilidad.

## Flujo resultante

```text
Empresa llama al número Twilio
  -> elige idioma
  -> marca cliente + #
  -> backend crea/encuentra usuario
  -> backend inicia grabación dual en la llamada de la empresa
  -> backend crea llamada al cliente (timeout configurado: 40 s)
  -> operador entra a outbound-{OperatorCallSid} y espera

Si persona o buzón atiende:
  -> cliente entra a la misma conferencia
  -> Twilio reproduce el saludo dentro de la conferencia
  -> ambos lo oyen
  -> operador oye a la persona o el saludo/tono del buzón
  -> habla con la persona o deja el mensaje
  -> al colgar se completa la grabación
  -> backend descarga MP3, lo sube a S3 y crea el audio outbound en DynamoDB

Si nadie atiende:
  -> la pata del cliente termina como no-answer/busy/failed
  -> Twilio saca al operador de la espera
  -> operador oye que no contestaron y no se activó el buzón
  -> termina la llamada y se procesa la grabación del intento
```

## Qué permanece igual

- El flujo de llamadas entrantes.
- El menú de idiomas y departamentos.
- El `Dial` hacia administración, soporte y operadores.
- El buzón fuera de horario.
- La validación `X-Twilio-Signature`.
- La estructura de S3: `clients/{userId}/audios/outbound/{callSid}.mp3`.
- El item de audio en DynamoDB y su visualización en el panel.
- El saludo de salida existente.
- El aviso de grabación de las llamadas entrantes.

## Aclaración sobre el inicio de la grabación

`record-from-start` de una conferencia empieza cuando Twilio conecta participantes, no
durante el timbrado. Para grabar desde antes de marcar al cliente se usa la grabación de
la llamada original del operador. Comienza después de que el sistema acepta el número
del cliente y antes de crear la pata saliente.

## Comportamiento del buzón

Twilio no intenta clasificar si respondió una persona o una máquina:

- si responde una persona, oye el saludo junto con el operador;
- si responde el buzón, el operador oye su locución y deja el mensaje después del tono;
- si nadie ni ningún buzón responde dentro del tiempo permitido, se reproduce el aviso
  de no respuesta al operador.

El saludo corto de Restoration A R y la locución del buzón pueden coincidir
parcialmente. El aviso largo de grabación se retiró únicamente de las llamadas
salientes para reducir ese solapamiento.

## Configuración y despliegue

No es necesario habilitar Conference en el dashboard de Twilio. Antes de desplegar:

1. Confirmar `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` y
   `PUBLIC_BASE_URL`.
2. Confirmar permisos geográficos de llamadas salientes.
3. Desplegar todos los archivos juntos.
4. Probar con un teléfono que conteste, otro que envíe al buzón y un destino que no
   responda.
5. Revisar `Monitor > Logs > Voice > Conferences` y Twilio Debugger.

## Pruebas manuales recomendadas

1. Persona atiende: ambos oyen el saludo y luego conversan.
2. Buzón atiende: operador oye la locución, espera el tono y deja mensaje.
3. No respuesta: operador recibe el aviso correcto después del timeout.
4. Ocupado o llamada rechazada: operador recibe el mismo aviso.
5. Operador cuelga durante el timbrado: la pata del cliente termina.
6. Grabación: aparece una sola entrada `outbound` en la ficha correcta.
7. Entrante en horario: continúa llegando al departamento.
8. Entrante fuera de horario: continúa grabándose en el buzón existente.

