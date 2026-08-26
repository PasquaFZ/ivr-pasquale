# IVR Pasquale

Backend de telefonía del proyecto **Pasquale** (`ivr-pasquale`). Recibe llamadas por Twilio, las desvía a un operador y guarda el historial del cliente y la grabación en AWS.

No incluye frontend: solo webhooks TwiML y una API JSON.

## Qué hace

1. El cliente marca el celular de la empresa (`COMPANY_PHONE`). Esa línea se desvía al número de Twilio.
2. Twilio llama a `POST /voice/incoming`. El servidor registra al llamante en DynamoDB (por teléfono) y arranca la grabación.
3. El IVR saluda *“Pasquale. Good day.”* y ofrece español (`2`).
4. Avisa que la llamada puede grabarse y conecta con el operador (`OPERATOR_PHONE`).
5. Antes de que el operador conteste, oye un *whisper* con el número de quien llama.
6. Si nadie atiende, el IVR dice que devolverán la llamada y cuelga.
7. Al terminar la grabación, descarga el MP3 de Twilio, lo sube a S3 y guarda el registro en DynamoDB.

**Importante:** `OPERATOR_PHONE` no puede ser el mismo que `COMPANY_PHONE`. Si lo es, la llamada vuelve a entrar al IVR en bucle.

## Stack

- Node.js + Express
- Twilio (voz, TwiML, grabación dual-channel)
- DynamoDB (clientes y metadatos de audio)
- S3 (archivos MP3)

La tabla y el bucket se crean a mano en la consola de AWS. Este repo solo se conecta a ellos.

## Flujo de una llamada

```
Cliente → COMPANY_PHONE → Twilio
                         → POST /voice/incoming   (usuario + recording)
                         → POST /voice/language   (aviso + Dial al operador)
                         → POST /voice/whisper    (número al operador)
                         → POST /voice/dial-status
                         → POST /voice/recording-complete  (S3 + DynamoDB)
```

## Datos que guarda

**DynamoDB** (`DDB_TABLE`, por defecto `ivr-business`):

| Item | Claves | Contenido |
|---|---|---|
| Usuario | `PK = USER#{id}`, `SK = METADATA` | teléfono, nombre, estado |
| Índice teléfono | GSI1 `PHONE#{número}` | buscar cliente por número |
| Índice nombre | GSI2 `ENTITY#USER` + apellido#nombre | buscar por nombre |
| Audio | `SK = AUDIO#{fecha}#{callSid}` | duración, bucket y key de S3 |

**S3** (`S3_BUCKET`):

```
clients/{userId}/audios/{callSid}.mp3
```

## API

Los webhooks de voz validan la firma de Twilio (`X-Twilio-Signature`).

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/health` | liveness |
| `POST` | `/voice/incoming` | entrada de llamada |
| `POST` | `/voice/language` | idioma y conexión al operador |
| `POST` | `/voice/whisper` | anuncio al operador |
| `POST` | `/voice/dial-status` | resultado del Dial |
| `POST` | `/voice/recording-complete` | guardar grabación |
| `POST` | `/voice/status` | log de estado de llamada |
| `POST` | `/operator/name` | actualizar nombre del cliente (JSON + PIN) |

Ejemplo para guardar el nombre:

```http
POST /operator/name
Content-Type: application/json

{
  "phone": "+13055550199",
  "firstName": "Ana",
  "lastName": "Pérez",
  "pin": "...."
}
```

## Configuración

Copia las variables a un archivo `.env` (no se commitea). En Twilio, el webhook de voz del número debe apuntar a:

```
{PUBLIC_BASE_URL}/voice/incoming
```

| Variable | Para qué |
|---|---|
| `TWILIO_ACCOUNT_SID` | cuenta Twilio |
| `TWILIO_AUTH_TOKEN` | token y validación de webhooks |
| `TWILIO_PHONE_NUMBER` | Caller ID al marcar al operador |
| `PUBLIC_BASE_URL` | URL pública HTTPS de este servidor |
| `COMPANY_PHONE` | celular que marcan los clientes |
| `OPERATOR_PHONE` | celular que atiende |
| `OPERATOR_PIN` | PIN de `POST /operator/name` |
| `AWS_REGION` | región AWS |
| `AWS_ACCESS_KEY_ID` | credenciales AWS |
| `AWS_SECRET_ACCESS_KEY` | credenciales AWS |
| `DDB_TABLE` | tabla DynamoDB |
| `S3_BUCKET` | bucket de grabaciones |

## Cómo correrlo

```bash
npm install
npm start
```

`PUBLIC_BASE_URL` tiene que ser alcanzable por Twilio (túnel o deploy). Sin eso no validan las firmas de los webhooks.
