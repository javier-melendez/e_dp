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

2. Define la contrasena en variable de entorno:

```bash
export APP_PASSWORD="tu_password_privada"
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
4. Agrega variable de entorno en Render:
   - `APP_PASSWORD` con tu contrasena privada

Tambien puedes configurar manualmente esos comandos si prefieres no usar Blueprint.

## Seguridad

- La contrasena ya no se guarda en el frontend.
- El login se valida en backend con cookie `HttpOnly`.
- Hay limite de intentos de login para reducir fuerza bruta.
