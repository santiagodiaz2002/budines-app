# Budines

PWA de Luz en Ruinas con Chat, Truco, Metrónomo/cancionero y Afinador. La sección comercial fue retirada por pedido del propietario.

## Arquitectura y datos

- `public/`: shell PWA, navegación y herramientas locales.
- `functions/api/`: registro, login, sesión, logout y chat.
- Binding D1 `DB`: conserva exclusivamente `app_users`, `app_sessions`, `auth_rate_limits` y `chat_messages`, además de metadatos técnicos.
- `database/schema.sql`: bootstrap idempotente de autenticación y chat para bases nuevas. No crea tablas ni datos comerciales.
- `migrations/0011_retire_accounting.sql`: retira tablas del subsistema comercial de una base existente, preservando autenticación y chat.
- Las rutas retiradas responden HTTP 410 con `Cache-Control: no-store`, sin leer ni escribir D1.

## Funciones conservadas

Truco sigue siendo un anotador argentino a 30 puntos, con Nosotros/Ellos, deshacer, nueva partida y modelos Joint/Smoke. El metrónomo conserva 4/4, BPM, Tap Tempo, volumen, canciones locales, hasta 32 partes editables, count-in y anuncios locales con Web Speech API. El afinador conserva detección cromática A4 = 440 Hz, solicita micrófono solo al iniciar y libera tracks al detener. La coordinación evita ejecutar metrónomo y afinador simultáneamente.

Los módulos y claves existentes de Truco y Metrónomo se conservan. Sus puntajes, canciones y preferencias viven en localStorage y no se sincronizan con D1. No limpiar localStorage por el prefijo `budines`, porque identifica estas herramientas y sus datos. Las capacidades históricas de las cuentas se mantienen solo por compatibilidad con la migración de claves y la selección visual de Truco; no habilitan una sección comercial.

Chat conserva sesión autenticada, historial paginado, actualizaciones mientras está visible y claves de reintento. Las respuestas privadas nunca se cachean. Tras una visita online, el shell y las herramientas locales pueden abrir offline. La actualización del service worker limpia caches anteriores del shell sin borrar canciones, puntajes ni preferencias.

## Desarrollo

Node.js 22 o compatible y npm. En PowerShell con scripts restringidos, usar `npm.cmd`.

```sh
npm install
npm run db:bootstrap:local
npm run db:migrate:local
npm run dev
npm run validate
```

Servidor local: http://localhost:8788. La validación incluye sintaxis, auditoría, branding y pruebas determinísticas de autenticación/chat, navegación, almacenamiento local y herramientas.

Para una base remota nueva usar `npm run db:bootstrap:remote`; para retirar las tablas comerciales de una existente, `npm run db:migrate:remote`. Confirmar la cuenta y el UUID de destino antes de operar. Configurar el binding `DB` en `wrangler.jsonc`. No aplicar migraciones comerciales históricas ni restaurar una copia anterior al retiro.

`npm run seed:owners:local` y `npm run seed:owners:remote` crean o actualizan las cuentas de Santi/Leandro solo cuando se solicita expresamente; no son pasos de la limpieza y no deben usarse para cambiar sus contraseñas durante ella.

`npm run deploy` publica en Cloudflare Pages el proyecto existente. Conservar su origen para que las herramientas sigan encontrando localStorage. No versionar `.dev.vars`, credenciales ni exports de cuentas/sesiones. El branding, nombre de instalación y recursos de Luz en Ruinas se conservan.
