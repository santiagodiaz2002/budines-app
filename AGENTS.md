# AGENTS.md

## Arquitectura

- App PWA estática en `public/`, con Chat, Truco, Metrónomo y Afinador.
- La sección comercial Budines fue retirada por pedido explícito del propietario. No recrearla ni restaurar tablas o datos comerciales.
- Herramientas locales en módulos separados de `public/js`; Cloudflare Pages Functions en `functions/api`.
- Binding D1 obligatorio `DB` para cuentas, sesiones, límites de autenticación, chat y el cancionero global autorizado.
- Bootstrap de bases nuevas en `database/schema.sql`; migraciones nuevas versionadas en `migrations/`.
- APIs retiradas devuelven 410 no-store sin acceso a DB.

## Dominio y compatibilidad

- La app conserva el nombre Budines y español de Argentina.
- La identidad confiable proviene de la sesión del servidor.
- Conservar las cuentas y sesiones existentes y el chat; las capacidades históricas se mantienen por compatibilidad de almacenamiento local y visuales de Truco.
- Truco, reproducción del Metrónomo y Afinador son locales. Solo canciones/carpetas compartidas usan D1, protegidas por sesión.
- Truco: 30 puntos para Nosotros/Ellos, visuales `public/media/joint-clean.png` y `public/media/smoke.png`.
- Metrónomo: 4/4, BPM manual, Tap Tempo, volumen y hasta 32 partes que se repiten hasta Stop; aceleración por parte con duración en compases e intervalos Web Audio integrados.
- Web Speech API local: count-in de cuatro pulsos; el último compás real anuncia la siguiente parte sin agregar pausas ni compases.
- Cancionero global y carpetas de un nivel en D1. Importar ambas versiones locales y todos los perfiles de cada dispositivo con identidad+contenido completo e idempotencia del servidor; nunca borrar ni reescribir las bibliotecas originales. Preferencias/borradores locales versionados; sin guardado compartido offline ni cache de APIs.
- Afinador cromático, A4 = 440 Hz, sin afinación fija.
- Preservar claves `budines.truco.*`, `budines.metronome.*`, perfiles y marcadores de migración; nunca limpiar localStorage por prefijo o globalmente.

## Seguridad

- No versionar secretos, tokens, credenciales ni exports de cuentas/sesiones.
- No registrar códigos de activación ni tokens en logs.
- No enviar, grabar ni almacenar audio del afinador. Solicitar micrófono solo al iniciar y liberar tracks al detener.
- No descargar audios externos ni enviar textos/audio de anuncios del metrónomo.
- No permitir ejecución simultánea de metrónomo y afinador.
- Consultas parametrizadas; render seguro con textContent o nodos, nunca HTML de la API.
- Respuestas privadas con `Cache-Control: no-store`; el SW nunca cachea APIs.

## Comandos y convenciones

- `npm run dev`: Wrangler Pages local.
- `npm run db:bootstrap:local`: esquema auth/chat idempotente.
- `npm run db:migrate:local`: migraciones de retiro/actualizaciones.
- `npm run test`: pruebas determinísticas.
- `npm run lint`: sintaxis, auditoría y branding.
- Ejecutar `npm run validate` antes de entregar.
- JavaScript ESM; agregar migraciones nuevas para cambios de esquema, sin editar aplicadas.
- El retiro comercial autoriza DROP físico de sus tablas; las funciones conservadas no deben borrarse.
- No agregar historial comercial, importes históricos ni dumps al informe de limpieza; informar alcance, conteos y verificaciones.
