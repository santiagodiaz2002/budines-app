# Budines

Budines es una PWA privada para dos usuarios, Santi y Leandro, destinada a registrar operaciones compartidas desde iPhone. La app usa frontend estático, Cloudflare Pages Functions como backend y Cloudflare D1 como base persistente. Además incluye herramientas locales de uso diario: Truco, Metrónomo y Afinador.

## Arquitectura

- `public/`: HTML, CSS, JavaScript modular, manifest, service worker e iconos.
- `public/js/navigation.js`: navegación inferior entre las cuatro pestañas.
- `public/js/truco.js`: anotador local de Truco a 30.
- `public/js/metronome-core-v2.js`, `public/js/metronome-editor.js`, `public/js/metronome-core.js` y `public/js/metronome.js`: modelo testeable, editor, biblioteca, voz y audio del metrónomo.
- `public/js/tuner-core.js` y `public/js/tuner.js`: detección cromática, estabilización y UI del afinador.
- `functions/api/`: API JSON bajo `/api`.
- `functions/_shared/`: validación, autenticación, sesiones, repositorio D1, resumen e idempotencia.
- `migrations/`: migraciones SQL versionadas para D1.
- `tests/`: pruebas determinísticas con Vitest.
- Binding D1 obligatorio: `DB`.

La sesión se activa con un código privado de entorno y se mantiene con una cookie opaca `HttpOnly`. El token completo solo vive en la cookie; D1 guarda el hash SHA-256.

## Pestañas de la app

La pantalla principal tiene una barra inferior fija con cuatro pestañas:

1. `Budines`: activación, carga de ventas, resumen, registros y baja lógica.
2. `Truco`: anotador argentino a 30 puntos para `Nosotros` y `Ellos`.
3. `Metrónomo`: metrónomo 4/4 normal y canciones locales por partes.
4. `Afinador`: afinador cromático para guitarra, bajo y afinaciones alternativas.

Cambiar de pestaña no recarga la página. Budines conserva autenticación, D1, registros, resumen y eliminación lógica. Las otras tres herramientas son locales al dispositivo y no escriben en D1.

## Herramientas locales

### Truco

- Partida exclusivamente a 30 puntos.
- Equipos iniciales: `Nosotros` y `Ellos`.
- Botones `+` y `−` con límites 0 y 30.
- Ganador visible al llegar a 30, con posibilidad de restar después.
- Deshacer revierte el último cambio.
- Nueva partida requiere confirmación en modal.
- Puntajes e historial se guardan en `localStorage`; datos corruptos se descartan.
- Cada punto se representa con una instancia decorativa de `public/media/joint.jpg`, generada desde el archivo fuente `Joint.jpg` de 630x360 px. Los bloques de cinco usan cuatro imágenes verticales y una diagonal.

### Metrónomo

- Compás fijo 4/4.
- BPM manual entero entre 30 y 300.
- Iniciar, Pausar/Reanudar, Stop, Tap Tempo y volumen.
- El audio se programa con Web Audio API usando anticipación sobre `AudioContext.currentTime`.
- El primer pulso del compás está acentuado.
- `Configurar` permite nombrar la canción y agregar, editar, eliminar y reordenar hasta 32 partes con `Nombre de la parte`, `Compases` y `BPM`.
- Cada parte nueva nace con nombre correlativo `Parte 1` a `Parte 32`; tocar el nombre lo convierte en input inline y Escape cancela la edición.
- Las canciones se guardan como biblioteca local `Mis canciones`, con identificador estable, nombre, bloques ordenados, fecha técnica de creación/modificación y versión de esquema.
- Cada bloque guarda identificador estable, nombre escrito por el usuario, compases, BPM y orden dentro de la canción.
- `Guardar canción` actualiza la canción abierta sin duplicarla; `Guardar como nueva` crea una copia deliberada con otro identificador.
- Al iniciar una canción se ejecuta un count-in inicial de cuatro pulsos al BPM de la primera parte: nombre, `Tres`, `Dos`, `Uno`.
- Entre partes no se agregan pausas ni compases: el último compás real de la parte saliente anuncia la próxima parte con nombre, `Tres`, `Dos`, `Uno`, y el BPM cambia en el primer pulso real de la parte entrante.
- La secuencia por bloques cambia BPM solo en el límite de bloque, vuelve al primer bloque al terminar y se repite hasta Stop.
- BPM, volumen, anuncios, voz seleccionada, secuencia actual y canciones se guardan exclusivamente en `localStorage`; no usan D1 ni la base comercial.
- La voz prefiere `es-AR`, cae a otra voz en español y finalmente a cualquier voz disponible. Si `speechSynthesis` no existe o el navegador demora voces, el metrónomo sigue con clicks y cuenta visual.
- La Web Speech API depende del navegador y del dispositivo: la voz puede variar o tener pequeñas latencias, pero la precisión temporal depende de Web Audio.
- El modelo local queda preparado para una futura migración a cuentas o backend, pero esta versión no sincroniza canciones entre dispositivos.

### Afinador

- Afinador cromático con referencia `A4 = 440 Hz`.
- Detecta nota, octava, frecuencia, frecuencia objetivo y desviación en cents.
- Usa `getUserMedia`, Web Audio API y detección YIN/autocorrelación normalizada; no depende del pico FFT.
- Prioriza estabilidad en graves de bajo, ignora señales débiles y modera saltos de octava.
- El permiso de micrófono se pide solo al pulsar `Iniciar afinador`.
- Al detener, se cierran nodos y se liberan todos los `MediaStreamTrack`.
- No graba, no envía y no almacena audio.

### Coordinación de audio

Al iniciar el metrónomo se detiene el afinador. Al iniciar el afinador se detiene el metrónomo. No deben quedar ambas herramientas de audio ejecutándose simultáneamente.

## Requisitos

- Node.js 22 o compatible.
- npm.
- Wrangler, instalado como dependencia de desarrollo.
- Cuenta de Cloudflare solo para crear D1, configurar secretos y desplegar.

## Instalación local

```bash
npm install
```

En Windows PowerShell con ejecución de scripts restringida, usar `npm.cmd` y `npx.cmd`:

```powershell
npm.cmd install
```

## Comandos disponibles

```bash
npm run dev
npm run test
npm run test:watch
npm run lint
npm run check
npm run validate
npm run db:migrate:local
npm run db:migrate:remote
npm run icons
npm run deploy
```

`npm run validate` ejecuta chequeos de sintaxis, auditoría local y pruebas.

## Configuración de `.dev.vars`

Copiar el ejemplo:

```bash
cp .dev.vars.example .dev.vars
```

En Windows:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Editar `.dev.vars` y reemplazar los placeholders:

```text
SANTI_ACTIVATION_CODE="codigo-privado-real-de-santi"
LEANDRO_ACTIVATION_CODE="codigo-privado-real-de-leandro"
SESSION_DURATION_DAYS="30"
```

No commitear `.dev.vars`. Está ignorado por Git.

## Creación de la base D1

No crear recursos remotos sin autorización. Cuando corresponda:

```bash
npx wrangler d1 create budines
```

Wrangler devuelve un bloque de configuración con `database_id`.

## Obtención del `database_id`

Si ya existe la base:

```bash
npx wrangler d1 info budines
```

Copiar el UUID informado por Cloudflare.

## Configuración del binding `DB`

Editar `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "budines",
    "database_id": "UUID_REAL_DE_CLOUDFLARE_D1"
  }
]
```

El binding debe llamarse exactamente `DB`.

## Aplicación de migraciones local

```bash
npm run db:migrate:local
```

Esto crea tablas, índices, usuarios permitidos, inversión inicial de ARS 120000 y los saldos iniciales históricos. La migración `0002_remove_incorrect_62000_record.sql` da de baja lógica el saldo incorrecto de ARS 62000, por lo que el saldo inicial activo correcto queda en ARS 3000.

## Aplicación de migraciones remota

Requiere cuenta Cloudflare, D1 creado y `database_id` real:

```bash
npm run db:migrate:remote
```

## Desarrollo con Wrangler

```bash
npm run dev
```

Abrir:

```text
http://localhost:8788
```

Health check:

```bash
curl http://localhost:8788/api/health
```

## Ejecución de pruebas

```bash
npm run test
```

Validación completa:

```bash
npm run validate
```

Las pruebas cubren regresión de Budines, navegación de las cuatro pestañas, reglas de Truco, representación con Joint, canciones guardadas del metrónomo, bloques nombrados, cuenta previa, máquina de reproducción, selección de voz, conversión/detección del afinador y liberación de pistas. La calidad acústica final del metrónomo, la voz hablada y el afinador debe comprobarse en un dispositivo físico con parlante y micrófono.

## Despliegue en Cloudflare Pages

Crear el proyecto Pages una sola vez:

```bash
npx wrangler pages project create budines
```

Desplegar cuando D1, binding y secretos estén configurados:

```bash
npm run deploy
```

No ejecutar deploy remoto desde automatizaciones sin autorización.

## Configuración de secretos en producción

Ejecutar y pegar cada valor cuando Wrangler lo pida:

```bash
npx wrangler pages secret put SANTI_ACTIVATION_CODE --project-name budines
npx wrangler pages secret put LEANDRO_ACTIVATION_CODE --project-name budines
npx wrangler pages secret put SESSION_DURATION_DAYS --project-name budines
```

Usar códigos privados distintos para Santi y Leandro.

## Activación del iPhone de Santi

1. Abrir la URL de producción de Pages en Safari.
2. Elegir usuario `Santi`.
3. Ingresar el código privado configurado en `SANTI_ACTIVATION_CODE`.
4. Confirmar que aparece la pantalla principal con la identidad `Santi`.

## Activación del iPhone de Leandro

1. Abrir la URL de producción de Pages en Safari.
2. Elegir usuario `Leandro`.
3. Ingresar el código privado configurado en `LEANDRO_ACTIVATION_CODE`.
4. Confirmar que aparece la pantalla principal con la identidad `Leandro`.

## Instalación mediante Safari

En cada iPhone:

1. Abrir la URL de producción.
2. Tocar compartir.
3. Elegir `Agregar a pantalla de inicio`.
4. Confirmar el nombre `Budines`.
5. Abrir desde el icono instalado y verificar modo standalone.

## Verificación del saldo inicial activo de ARS 3000

Después de aplicar todas las migraciones:

```bash
npx wrangler d1 execute budines --local --command "SELECT r.id, r.amount_ars, r.type, r.grams, r.user_id, r.commercial_date, r.status, rd.deleted_at FROM records r LEFT JOIN record_deletions rd ON rd.record_id = r.id ORDER BY r.id;"
```

Resultado esperado:

- La fila `saldo-inicial-ars-3000` sigue activa, sin gramos, sin usuario, sin fecha comercial y sin baja lógica.
- La fila `saldo-inicial-ars-62000` sigue existiendo, pero aparece en `record_deletions`.
- Resumen inicial correcto: total ARS 3000, inversión ARS 120000, falta recuperar ARS 117000.

## Consulta de registros

Desde la app, abrir `Registros`. Desde API local con sesión activa:

```bash
curl -i http://localhost:8788/api/records
```

Sin sesión debe devolver `401`.

## Anulación de una venta

Desde la app, abrir `Registros`, tocar una tarjeta activa, revisar el panel y escribir `ELIMINAR`. La API conserva la fila, registra una baja lógica, guarda fecha y usuario cuando corresponde, y excluye el importe del resumen.

La eliminación está disponible para ventas activas y saldos iniciales activos. No existe eliminación física ni restauración en esta versión.

## Rotación de credenciales

1. Cambiar `SANTI_ACTIVATION_CODE` o `LEANDRO_ACTIVATION_CODE` con `wrangler pages secret put`.
2. Cerrar sesión en el dispositivo afectado.
3. Activar de nuevo con el código nuevo.

Las sesiones existentes no dependen del código de activación anterior. Para invalidarlas, usar revocación.

## Revocación de sesiones

Revocar todas las sesiones de un usuario en D1:

```bash
npx wrangler d1 execute budines --remote --command "UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = 'santi' AND revoked_at IS NULL;"
```

Cambiar `santi` por `leandro` si corresponde.

## Copia o exportación de D1

Exportar la base remota:

```bash
npx wrangler d1 export budines --remote --output=budines-backup.sql
```

Exportar la base local:

```bash
npx wrangler d1 export budines --local --output=budines-local-backup.sql
```

## Recuperación ante errores

- Si `npm run dev` falla por secretos faltantes, revisar `.dev.vars`.
- Si `/api/summary` devuelve `401`, activar el dispositivo.
- Si D1 remoto falla, verificar `database_id`, binding `DB` y migraciones remotas.
- Si un registro se envió dos veces con la misma clave de idempotencia, la API devuelve la operación existente y no duplica filas.
- Si se eliminó un registro por error, no hay restauración en esta versión; conservar la fila y corregir mediante una migración o herramienta administrativa diseñada aparte.

## Elementos no verificados hasta desplegar

- Cuenta Cloudflare autenticada.
- Base D1 remota real.
- Binding `DB` configurado en el proyecto Pages remoto.
- Secretos productivos.
- Dominio o URL final de Pages.
- Safari real en iPhone.
- Instalación desde `Agregar a pantalla de inicio`.
- Prueba física del micrófono, parlante, latencia de audio y estabilidad del afinador en un iPhone real.

## Lista final de comprobaciones de producción

1. `wrangler.jsonc` contiene `database_id` real.
2. `npm run validate` pasa localmente.
3. `npm run db:migrate:remote` termina correctamente.
4. Los secretos productivos existen en Pages.
5. El proyecto Pages tiene binding D1 `DB`.
6. `/api/health` responde en producción.
7. Activación de Santi funciona.
8. Activación de Leandro funciona.
9. Resumen inicial muestra ARS 3000, ARS 120000 y ARS 117000.
10. Una venta nueva actualiza resumen y registros.
11. Repetir una petición con la misma clave no duplica.
12. Eliminar una venta excluye el importe del resumen.
13. Eliminar un saldo inicial activo excluye el importe del resumen sin borrar la fila.
14. La barra inferior muestra Budines, Truco, Metrónomo y Afinador.
15. `public/media/joint.jpg`, módulos JS nuevos, manifest y service worker responden sin 404.
16. La app se instala y abre en modo standalone en ambos iPhone.

## Información todavía no identificada

- Gramos del registro inicial de ARS 3000.
- Usuario del registro inicial de ARS 3000.
- Fecha comercial del registro inicial de ARS 3000.
- El registro histórico de ARS 62000 fue confirmado como incorrecto y queda dado de baja lógica; no se deben inventar gramos, usuario ni fecha comercial para esa fila.
