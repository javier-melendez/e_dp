# E-Bandeja Inteligente (Render Web Service)

Proyecto listo para desplegar en Render como **Web Service** con Node.js.

## Estructura

```text
.
|-- index.html
|-- public/
|   |-- styles.css
|   `-- app.js
|-- server.js
|-- package.json
|-- render.yaml
|-- .env.example
`-- .gitignore
```

## Ejecucion local

1. Instala dependencias:

```bash
npm install
```

2. Define variables de entorno (puedes copiar `.env.example`):

```bash
export APP_PASSWORD="dp12345"
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="tu_service_role_key"
export SUPABASE_BUCKET="e_bandeja_docs"
```

3. Inicia el servidor:

```bash
npm start
```

4. Abre:

```text
http://localhost:3000
```

## Despliegue en Render

1. Sube este repositorio a GitHub.
2. En Render, crea un nuevo servicio con ese repo.
3. Render detectara `render.yaml` y usara:
   - `buildCommand`: `npm install`
   - `startCommand`: `npm start`
4. Agrega variables de entorno en Render:
   - `APP_PASSWORD` (ejemplo: `dp12345`)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_BUCKET` (opcional, default: `e_bandeja_docs`)

Tambien puedes configurar manualmente esos comandos si prefieres no usar Blueprint.

## Seguridad

- La contrasena ya no se guarda en el frontend.
- El login se valida en backend con cookie `HttpOnly`.
- Hay limite de intentos de login para reducir fuerza bruta.
- Los archivos se guardan en Supabase Storage (persisten entre sesiones y redeploys).

## Supabase

1. En tu proyecto de Supabase, crea (o deja que la app cree) un bucket llamado `e_bandeja_docs`.
2. Usa `SUPABASE_SERVICE_ROLE_KEY` solo en el backend (nunca en frontend).
3. Recomendada configuracion del bucket:
   - Bucket privado.
   - Limite de tamano acorde a tu uso (la app limita a 20MB por archivo).
