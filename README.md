# Restoration A R — IVR

Sistema de telefonía de **Restoration A R**: el cliente llama, elige idioma y departamento, y la conversación se graba. La empresa o un departamento también puede llamar a un cliente por Twilio (con aviso de grabación). El panel `ivr-admin` lista clientes y audios.

Son **dos proyectos**:

| Carpeta | Qué es |
|---|---|
| `ivr-pasquale` | Backend (Twilio, Express, DynamoDB, S3, CloudFront, JWT) |
| `ivr-admin` | Panel admin (Vite + React) |

No hay `package.json` en la raíz. Cada uno se corre por separado.

---

## Cómo encajan las piezas

```
Cliente ──marca──► COMPANY_PHONE ──desvío──► Twilio ──► ivr-pasquale
                                                      │
Empresa / depto ──marca Twilio──► idioma + nº cliente ┤
                                                      ▼
                                              DynamoDB + S3
                                                      ▲
ivr-admin ──login JWT──► API /admin ──URL firmada──► CloudFront
```

- **Entrada:** el cliente marca el celular de la empresa (`COMPANY_PHONE`). Esa línea se desvía al número de Twilio.
- **Salida:** la empresa o un departamento marca **Twilio**. Si marcan el celular del cliente en directo, Twilio no entra: es una llamada normal y no se graba.
- **Twilio** pide TwiML a `{PUBLIC_BASE_URL}/voice/incoming` (POST). La URL del webhook tiene que coincidir con `PUBLIC_BASE_URL` o falla la firma.

**Importante:** ningún teléfono de departamento (`ES_*` / `EN_*`) puede ser el mismo que `COMPANY_PHONE`. Si lo es, la llamada vuelve al IVR en bucle.

---

## Llamada de entrada (el cliente llama)

1. Saludo en inglés: Restoration A R. Para español, **marque 2**. Si no marca, sigue en inglés.
2. Aviso de grabación (calidad, seguridad y mejora del servicio). Permanecer en la línea es el acuse.
3. Menú de departamento:
   - **0** administrativo
   - **1** técnico
   - **2** operador
4. Desvío al número de ese departamento en ese idioma (`ES_*` o `EN_*`).
5. El personal oye un *whisper* **solo con el departamento** (sin el número del cliente).
6. Si nadie atiende, se dice que devolverán la llamada y se cuelga.
7. Se graba en dual-channel desde el inicio. El audio se liga al teléfono **del cliente**. Si no existe, se crea.

```
Cliente → COMPANY_PHONE → Twilio
  POST /voice/incoming            usuario + recording
  POST /voice/language            aviso + menú
  POST /voice/department          Dial al depto
  POST /voice/whisper             “Llamada para el departamento de …”
  POST /voice/dial-status
  POST /voice/recording-complete  S3 + DynamoDB
```

---

## Llamada de salida (la empresa llama al cliente)

Pueden activarla **`COMPANY_PHONE`** y los teléfonos de departamento (`ES_*` / `EN_*`), **siempre marcando Twilio**.

1. A la empresa se le pregunta el idioma: **1 inglés**, **2 español**.
2. Marca el número del cliente y **numeral** (`#`). 10 dígitos se toman como EE.UU. (`+1`).
3. Si el cliente no existe, se crea. Si existe, el audio se le asigna a ese número.
4. El cliente oye: saludo, que la llamada es de parte de Restoration A R, y el mismo aviso de grabación.
5. Si permanece en la línea, quedan conectadas ambas partes y se graba la conversación (dual-channel, desde que el cliente ya contestó).

```
Empresa/depto → Twilio
  POST /voice/incoming
  POST /voice/outbound/language   1 = EN, 2 = ES
  POST /voice/outbound/connect    dígitos del cliente
  POST /voice/outbound/client     saludo + aviso al cliente
  POST /voice/dial-status
  POST /voice/recording-complete?client=+1…   audio ligado al cliente
```

---

## Qué se guarda

**DynamoDB** (`DDB_TABLE`, por defecto `ivr-business`):

| Item | Claves | Contenido |
|---|---|---|
| Usuario | `PK = USER#{id}`, `SK = METADATA` | teléfono, nombre, email, rol, estado |
| Índice teléfono | GSI1 `PHONE#{número}` | buscar cliente por número |
| Índice nombre | GSI2 `ENTITY#USER` + apellido#nombre | listar / buscar por nombre |
| Audio | `SK = AUDIO#{fecha}#{callSid}` | duración, `Direction` (`inbound` cliente / `outbound` empresa), bucket y key de S3 |
| Sesión | refresh hasheado | logout / rotación (se revoca con Update, no Delete) |

**DynamoDB logs** (`DDB_LOG_TABLE`, por defecto `ivr-log`): tabla aparte.

| Item | Claves | Contenido |
|---|---|---|
| Log | `PK = ENTITY#LOG`, `SK = {ISO}#{logId}` | acción (`LOGIN`, `LOGOUT`, `CREATE`, `UPDATE`, `PLAY`, `DOWNLOAD`), actor, objetivo, cambios old → new |

**S3** (`S3_BUCKET`):

```
clients/{userId}/audios/inbound/{callSid}.mp3
clients/{userId}/audios/outbound/{callSid}.mp3
```

El panel no descarga de S3 a pelo: pide una **URL firmada de CloudFront** (5 minutos).

El usuario IAM de DynamoDB necesita `GetItem`, `PutItem`, `UpdateItem`, `Query` y `DeleteItem` en `ivr-business` (DeleteItem para cambiar teléfono o email). En `ivr-log` necesita `PutItem` y `Query`.

---

## Panel admin (`ivr-admin`)

Entran `admin` y `operator` con status `active`. Los clientes de teléfono son `role: user` y no pueden loguearse.

- Login con email/password. Access JWT **1 h** (memoria). Refresh **7 días** en cookie httpOnly `rt`, path `/auth`, SameSite Lax (en producción: None + Secure).
- Lista de usuarios, 50 por página, cursor de DynamoDB. Búsqueda por nombre, teléfono o email.
- Ficha: editar nombre, teléfono (solo admin), email, rol, permisos y estado; reproducir y descargar audios.
- Al desactivar o bajar de rol de panel se revocan las sesiones.
- Auditoría (solo admin): login, logout, altas, cambios de usuario (valor anterior y nuevo), play y download de audios.
- Al logout se limpia el contexto.

El admin se crea al arrancar si no existe, con `ADMIN_EMAIL` y `ADMIN_PASSWORD` (≥ 12 caracteres). Si ya existe, no se pisa la contraseña.

---

## API

Los webhooks de voz validan `X-Twilio-Signature`. El admin usa `Authorization: Bearer` y cookie de refresh.

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/health` | liveness |
| `POST` | `/voice/incoming` | entra la llamada (cliente o empresa) |
| `POST` | `/voice/language` | idioma de entrada + aviso |
| `POST` | `/voice/department` | menú y Dial al departamento |
| `POST` | `/voice/whisper` | anuncio al operador (solo departamento) |
| `POST` | `/voice/outbound/language` | idioma de la llamada saliente |
| `POST` | `/voice/outbound/connect` | número del cliente y Dial |
| `POST` | `/voice/outbound/client` | saludo y aviso al cliente |
| `POST` | `/voice/dial-status` | resultado del Dial |
| `POST` | `/voice/recording-complete` | guardar grabación |
| `POST` | `/voice/status` | log de estado |
| `POST` | `/operator/name` | nombre del cliente (JSON + PIN) |
| `POST` | `/auth/login` | login del panel (admin u operator) |
| `POST` | `/auth/refresh` | rota el refresh |
| `POST` | `/auth/logout` | cierra sesión |
| `GET` | `/auth/me` | usuario del panel actual |
| `POST` | `/admin/users` | crear usuario |
| `GET` | `/admin/users` | listar / buscar (cursor, 50) |
| `GET` | `/admin/users/:id` | detalle |
| `PATCH` | `/admin/users/:id` | perfil, rol, permisos, estado, contraseña |
| `GET` | `/admin/users/:id/audios` | grabaciones (cursor, 50) |
| `GET` | `/admin/users/:id/audios/:sid/url` | URL firmada CloudFront |
| `GET` | `/admin/logs` | auditoría (solo admin, cursor, 50) |

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

---

## Estructura del backend

```
index.js                 arranque (env + listen)
src/app.js               Express y montaje de rutas
src/config.js            variables de entorno
src/infra/               DynamoDB, S3/CloudFront, Twilio, HTTP
src/shared/              validación y DTOs
src/modules/voice/       IVR (entrada y salida)
src/modules/auth/        login JWT
src/modules/users/       clientes y admin
src/modules/audio/       grabaciones
```

Stack: Node.js + Express, Twilio (voz, TwiML, grabación dual-channel), DynamoDB, S3, CloudFront. La tabla y el bucket se crean a mano en AWS.

---

## Configuración

Copia `.env.example` a `.env` (no se commitea).

En **Railway** hay que pegar las mismas variables en el servicio. Si cambias un teléfono solo en el Mac, el deploy sigue usando el viejo.

Twilio → Voice webhook del número:

```
{PUBLIC_BASE_URL}/voice/incoming
```

Método **POST**.

| Variable | Para qué |
|---|---|
| `TWILIO_ACCOUNT_SID` | cuenta Twilio |
| `TWILIO_AUTH_TOKEN` | token y firma de webhooks |
| `TWILIO_PHONE_NUMBER` | Caller ID al marcar (operador o cliente) |
| `PUBLIC_BASE_URL` | URL pública HTTPS de este servidor |
| `COMPANY_PHONE` | celular de la empresa (entrada + puede activar salida) |
| `ES_OPERATOR_PHONE` | operador, llamada en español |
| `ES_TECHNICAL_PHONE` | técnico, español |
| `ES_ADMINISTRATIVE_PHONE` | administrativo, español |
| `EN_OPERATOR_PHONE` | operador, inglés |
| `EN_TECHNICAL_PHONE` | técnico, inglés |
| `EN_ADMINISTRATIVE_PHONE` | administrativo, inglés |
| `OPERATOR_PIN` | PIN de `POST /operator/name` |
| `AWS_REGION` | región AWS |
| `AWS_ACCESS_KEY_ID` | credenciales AWS |
| `AWS_SECRET_ACCESS_KEY` | credenciales AWS |
| `DDB_TABLE` | tabla DynamoDB de usuarios y audios |
| `DDB_LOG_TABLE` | tabla DynamoDB de auditoría (`ivr-log`) |
| `S3_BUCKET` | bucket de grabaciones |
| `CLOUDFRONT_DOMAIN` | dominio de la distribución (sin `https://`) |
| `CLOUDFRONT_KEY_PAIR_ID` | key pair para firmar URLs |
| `CLOUDFRONT_PRIVATE_KEY` | PEM (una línea con `\n`) |
| `JWT_ACCESS_SECRET` | HMAC access token (≥ 32 chars) |
| `JWT_REFRESH_SECRET` | HMAC refresh, distinto al access (≥ 32 chars) |
| `ADMIN_EMAIL` | email del admin (seed al arrancar) |
| `ADMIN_PASSWORD` | password del admin (≥ 12 chars) |
| `ADMIN_ORIGIN` | origen(es) del panel, separados por coma (CORS y cookies) |

Panel (`ivr-admin/.env`):

```
VITE_API_URL=http://localhost:3000
```

---

## Cómo correrlo

Backend:

```bash
cd ivr-pasquale
npm install
npm start
```

`PUBLIC_BASE_URL` tiene que ser alcanzable por Twilio (túnel o deploy). Sin eso no validan las firmas.

Panel:

```bash
cd ivr-admin
npm install
npm run dev
```

Abre Vite (por defecto `http://localhost:5173`) e inicia sesión con `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
