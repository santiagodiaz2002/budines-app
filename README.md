# Budines

PWA de Luz en Ruinas con Chat, Truco, Metrónomo/cancionero y Afinador. La sección comercial fue retirada por pedido del propietario.

## Arquitectura y datos

- `public/`: shell PWA, navegación y herramientas locales.
- `functions/api/`: registro, login, sesión, logout, chat y cancionero.
- Binding D1 `DB`: conserva cuentas, sesiones, límites de autenticación, chat y `songbook_songs`, `songbook_folders`, `songbook_imports`, además de metadatos técnicos.
- `database/schema.sql`: bootstrap idempotente de autenticación y chat para bases nuevas. No crea tablas ni datos comerciales.
- `migrations/0011_retire_accounting.sql`: retira tablas del subsistema comercial de una base existente, preservando autenticación y chat.
- Las rutas retiradas responden HTTP 410 con `Cache-Control: no-store`, sin leer ni escribir D1.

## Funciones conservadas

Truco sigue siendo un anotador argentino a 30 puntos, con Nosotros/Ellos, deshacer, nueva partida y modelos Joint/Smoke. El metrónomo conserva 4/4, BPM, Tap Tempo, volumen, canciones locales, hasta 32 partes editables, count-in y anuncios locales con Web Speech API. El afinador conserva detección cromática A4 = 440 Hz, solicita micrófono solo al iniciar y libera tracks al detener. La coordinación evita ejecutar metrónomo y afinador simultáneamente.

Los módulos y claves existentes de Truco y Metrónomo se conservan. Puntajes y preferencias siguen en localStorage. No limpiar localStorage por el prefijo `budines`. Las capacidades históricas de las cuentas se mantienen por compatibilidad con la migración de claves y la selección visual de Truco; no habilitan una sección comercial.

## Cancionero compartido

Cada sesión autenticada puede leer, crear, editar, mover y eliminar las mismas canciones y carpetas. `GET/POST /api/songbook` exige sesión del servidor; las mutaciones verifican Origin y revisiones para rechazar ediciones competidoras con 409. El frontend conserva la edición al recibir un error y permite abrir la versión compartida o guardar una copia explícita. Actualizar y el refresco periódico recuperan cambios de otros dispositivos sin sobrescribir borradores. Eliminar una carpeta requiere confirmación y devuelve sus canciones a la raíz en una transacción.

Al iniciar sesión online o pulsar Actualizar, se importan `budines.metronome.songs.v1/v2` y todas sus variantes `.user.*` en ese navegador. La importación reconoce copias por ID original, fecha de creación y contenido musical completo; conserva títulos iguales y variantes de contenido. El registro de importación sobrevive a una eliminación para que los reintentos no revivan canciones. Los originales nunca se borran ni se reescriben; entradas inválidas se informan y conservan. **Cada dispositivo que tenga canciones anteriores debe abrir Budines con sesión y conexión**: el servidor no puede recuperar un localStorage de otro navegador a distancia.

Sin conexión siguen disponibles la reproducción y las canciones locales originales. El cancionero compartido requiere sesión online; no hay una cola que simule guardados ni cache de APIs. No se sube audio ni texto de anuncios: se comparten únicamente las canciones y sus parámetros.

En cada parte, la aceleración usa su BPM como inicio, un objetivo superior y 1 a N compases (hasta la duración de esa parte). En fase musical x, `BPM(x) = inicial + (objetivo-inicial)*x/(4*compases)`. Los tiempos se obtienen integrando `60/BPM(x)`; al terminar mantiene el objetivo hasta el inicio de la próxima parte. En una canción de una sola parte, las repeticiones mantienen el objetivo; Stop/reinicio comienza nuevamente desde el BPM inicial. Count-in, pausas, anuncios y coordinación de audio siguen en el motor existente.

`migrations/0012_shared_songbook.sql` agrega solo las tres tablas del cancionero. En una base existente, revisar las migraciones pendientes antes de ejecutarlas. Si aparecen migraciones ajenas a este cambio, aplicar exclusivamente este archivo con `wrangler d1 execute budines --remote --file migrations/0012_shared_songbook.sql` y registrar `0012_shared_songbook.sql` en `d1_migrations` después de verificar sus tablas. No ejecutar bootstrap ni migraciones comerciales para actualizar producción.

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
