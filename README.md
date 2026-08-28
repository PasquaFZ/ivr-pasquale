# IVR Pasquale

Backend de telefonía del proyecto **Pasquale** (`ivr-pasquale`). Recibe llamadas por Twilio, las desvía a un operador y guarda el historial del cliente y la grabación en AWS.

No incluye frontend: solo webhooks TwiML y una API JSON.

## Qué hace

1. El cliente marca el celular de la empresa (`COMPANY_PHONE`). Esa línea se desvía al número de Twilio.
2. Twilio llama a `POST /voice/incoming`. El servidor registra al llamante en DynamoDB (por teléfono) y arranca la grabación.
3. El IVR habla en inglés y ofrece español (`2`). Si no marca, sigue en inglés.
4. Avisa que la llamada puede grabarse (en el idioma elegido).
5. Pregunta el departamento: administrativos (`0`), técnico (`1`) u operador (`2`).
6. Desvía al número de ese departamento en ese idioma (`ES_*` o `EN_*`).
7. Antes de que el personal conteste, oye un *whisper* con el departamento y el número de quien llama.
8. Si nadie atiende, el IVR dice que devolverán la llamada y cuelga.
9. Al terminar la grabación, descarga el MP3 de Twilio, lo sube a S3 y guarda el registro en DynamoDB.

**Importante:** ningún teléfono de departamento puede ser el mismo que `COMPANY_PHONE`. Si lo es, la llamada vuelve a entrar al IVR en bucle.

## Stack

- Node.js + Express
- Twilio (voz, TwiML, grabación dual-channel)
- DynamoDB (clientes y metadatos de audio)
- S3 (archivos MP3)

La tabla y el bucket se crean a mano en la consola de AWS. Este repo solo se conecta a ellos.

## Estructura

Monolito modular (sin capas de más):

```
index.js                 arranque (env + listen)
src/app.js               Express y montaje de rutas
src/config.js            variables de entorno
src/infra/               DynamoDB, S3/CloudFront, Twilio, HTTP
src/shared/              validación y DTOs
src/modules/voice/       IVR
src/modules/auth/        login JWT
src/modules/users/       clientes y admin
src/modules/audio/       grabaciones
```

Cada módulo tiene rutas, casos de uso (`service`) y persistencia (`repository`). Infra no conoce HTTP.

## Flujo de una llamada

```
Cliente → COMPANY_PHONE → Twilio
                         → POST /voice/incoming     (usuario + recording)
                         → POST /voice/language     (aviso de grabación + menú)
                         → POST /voice/department   (Dial al depto ES_* / EN_*)
                         → POST /voice/whisper      (departamento + número)
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
| `POST` | `/voice/language` | idioma y aviso de grabación |
| `POST` | `/voice/department` | menú y conexión al departamento |
| `POST` | `/voice/whisper` | anuncio al operador |
| `POST` | `/voice/dial-status` | resultado del Dial |
| `POST` | `/voice/recording-complete` | guardar grabación |
| `POST` | `/voice/status` | log de estado de llamada |
| `POST` | `/operator/name` | actualizar nombre del cliente (JSON + PIN) |
| `POST` | `/auth/login` | login admin (cookie httpOnly + access JWT 1h) |
| `POST` | `/auth/refresh` | rota el refresh token (7 días) |
| `POST` | `/auth/logout` | cierra sesión |
| `GET` | `/auth/me` | admin actual |
| `GET` | `/admin/users` | listar/buscar usuarios (cursor DynamoDB, 50) |
| `GET` | `/admin/users/:id` | detalle de usuario |
| `PATCH` | `/admin/users/:id` | editar nombre, teléfono, email |
| `GET` | `/admin/users/:id/audios` | grabaciones (cursor, 50) |
| `GET` | `/admin/users/:id/audios/:sid/url` | URL firmada de CloudFront (play/download) |

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

En local, copia `.env.example` a `.env` (no se commitea).

En **Railway** el `.env` no se sube. Hay que pegar las mismas variables en **Variables** del servicio. Si cambias un teléfono de departamento solo en tu Mac, el deploy sigue usando el número viejo.

En Twilio, el webhook de voz del número debe apuntar a:

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
| `ES_OPERATOR_PHONE` | operador (llamada en español) |
| `ES_TECHNICAL_PHONE` | técnico (español) |
| `ES_ADMINISTRATIVE_PHONE` | administrativo (español) |
| `EN_OPERATOR_PHONE` | operador (llamada en inglés) |
| `EN_TECHNICAL_PHONE` | técnico (inglés) |
| `EN_ADMINISTRATIVE_PHONE` | administrativo (inglés) |
| `OPERATOR_PIN` | PIN de `POST /operator/name` |
| `AWS_REGION` | región AWS |
| `AWS_ACCESS_KEY_ID` | credenciales AWS |
| `AWS_SECRET_ACCESS_KEY` | credenciales AWS |
| `DDB_TABLE` | tabla DynamoDB |
| `S3_BUCKET` | bucket de grabaciones |
| `CLOUDFRONT_DOMAIN` | dominio de la distribución (sin `https://`) |
| `CLOUDFRONT_KEY_PAIR_ID` | key pair para firmar URLs |
| `CLOUDFRONT_PRIVATE_KEY` | PEM de la key (usa `\n` en una sola línea) |
| `JWT_ACCESS_SECRET` | secreto HMAC del access token (≥32 chars) |
| `JWT_REFRESH_SECRET` | secreto distinto del refresh token (≥32 chars) |
| `ADMIN_EMAIL` | email del admin (se crea al arrancar si no existe) |
| `ADMIN_PASSWORD` | password del admin (≥12 chars; no se pisa si ya existe) |
| `ADMIN_ORIGIN` | origen del panel `ivr-admin` (CORS y cookies) |

El usuario IAM de DynamoDB necesita `GetItem`, `PutItem`, `UpdateItem`, `Query` y `DeleteItem` (este último para cambiar teléfono o email).

## Cómo correrlo

```bash
npm install
npm start
```

`PUBLIC_BASE_URL` tiene que ser alcanzable por Twilio (túnel o deploy). Sin eso no validan las firmas de los webhooks.
