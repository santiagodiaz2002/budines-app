# Auditoría del cancionero — 12 de octubre de 2026

## Proyecto y alcance

Repositorio verificado `santiagodiaz2002/budines-app`, rama `master`, remote HTTPS coincidente, directorio `C:/Users/Santi/Documents/GitHub/budines-app`. Estado inicial limpio, HEAD `4a41f80`. Proyecto Pages existente `budines`, producción `budines.pages.dev`, rama de producción `master`, despliegue directo sin integración Git automática. Binding DB existente: `budines`, UUID `de92c940-dcf7-4ea9-8b3d-f905068db36c`. La inspección remota de esquema fue de solo lectura: cuentas, sesiones, límites de autenticación, chat y metadatos; ninguna tabla de canciones.

No se recrearon aplicación, repositorio, proyecto Cloudflare ni datos comerciales. Auth, chat, Truco y afinador mantienen sus módulos. `app.js` solo conecta el cancionero con la sesión y descarta respuestas pendientes al cerrarla. El test de Truco cambia únicamente expectativas de versiones del shell. AGENTS/README/auditoría de esquema se actualizan porque el pedido autoriza expresamente almacenamiento compartido.

## Diagnóstico reproducido

- El cancionero real estaba en `metronome-editor.js` y `metronome-core-v2.js`, importado por `app.js`. Persistía exclusivamente en bibliotecas v1/v2 de localStorage por usuario/dispositivo. No había API ni D1 musical: otro usuario o dispositivo no podía recuperar canciones.
- Guardar desde el panel principal después de abrir Beta podía reemplazar su nombre y bloques por Alpha. Reproducción happy-dom con Alpha a 80 BPM y Beta a 140. Causa: lectura de los campos viejos del diálogo cerrado.
- Modificar BPM manual en una canción de dos partes sustituía toda la canción por Manual/999 compases y desvinculaba su ID, sin confirmación. Reproducción con happy-dom y prueba de regresión.
- Renombrar marcaba bloques pendientes como guardados. La base de comparación se construía desde el borrador en vez del contenido persistido.
- Lectura v2 ignoraba v1 coexistente; sanitización y escritura automática podían descartar entradas inválidas. La migración nueva inspecciona ambas y no reescribe originales.
- El guardado local no capturaba fallos de almacenamiento; no había revisión ni refresco para cambios de otra pestaña. El cancionero compartido confirma el servidor y aplica CAS.
- Las pruebas de la implementación detectaron y cubrieron recarga con ID global, borradores con números como texto, respuesta atrasada después de cerrar sesión, respuesta perdida de una creación y carreras con una eliminación de carpeta. Ningún caso se declaró resuelto sin ejecutar su regresión.

## Archivos y cambios

- `functions/api/songbook.js`, `functions/_shared/songbook.js`: GET/POST protegido por sesión, Origin, JSON limitado a 64 KiB, consultas parametrizadas, no-store, revisiones y operaciones transaccionales. Todas las cuentas autenticadas tienen acceso al mismo conjunto.
- `migrations/0012_shared_songbook.sql`, `database/schema.sql`: canciones, carpetas de un nivel y registro idempotente de importaciones. Eliminar carpeta mueve canciones a raíz e incrementa sus revisiones. La migración anterior no se edita.
- `public/js/songbook-client.js`: lectura de todas las bibliotecas anteriores, variantes y aliases, envío por canción, reporte de inválidas y mapa a IDs globales. Ninguna escritura sobre bibliotecas originales. Registro servidor evita reimportar o revivir eliminaciones.
- `public/js/metronome-editor.js`, `public/index.html`, `public/styles.css`: editor existente conectado al servidor, carpetas/raíz/movimientos, controles bloqueados durante guardado, errores visibles, borradores y UUID de creación conservados, refresco explícito/periódico sin sobrescribir ediciones.
- `public/js/metronome-core-v2.js`: aceleración integrada al scheduler Web Audio existente, parámetros por parte, intervalos obtenidos por integración exacta. Una sola parte conserva el objetivo incluso al repetir; reiniciar restablece el inicio.
- `public/js/app.js`, `public/sw.js`: sesión del cancionero y dependencias/versiones del shell. APIs siguen excluidas del cache.
- `scripts/audit-project.mjs`, `AGENTS.md`, `README.md`, este informe y pruebas: reglas/documentación actualizadas al alcance autorizado.
- Pruebas nuevas: `songbook-api.test.js`, `songbook-client.test.js`, `metronome-tempo.test.js`. Pruebas ampliadas: `metronome-ui.test.js`, `app-ui.test.js`, `database-schema.test.js`. SW/Truco actualizan expectativas del shell.

## Conservación y migración

No existen canciones de producción en D1 antes de este cambio: estaban distribuidas en navegadores. Cada dispositivo con canciones anteriores debe abrir el mismo origen de Budines, iniciar sesión con conexión y completar la importación. No es posible inspeccionar o recuperar remotamente el localStorage de dispositivos que no visitaron la nueva versión.

La identificación usa ID anterior, fecha de creación y contenido musical completo; títulos iguales no se consideran duplicados por su nombre. Si un ID anterior tiene variantes, se conservan separadas. Alias idénticos del viejo sistema y reintentos comparten registro de importación. Entradas inválidas se informan y quedan intactas; no se declara completada la importación de esos datos. La reproducción local original permanece disponible offline; el cancionero compartido no simula guardado sin conexión.

## Evidencia de validación

- Baseline anterior: `npm run validate`, 115/115 pruebas.
- Implementación: `npm run validate` terminó con exit 0: 169/169 pruebas en 17 archivos; sintaxis, auditoría y branding. Pages Functions compiló con Wrangler antes del commit.
- Backend: sesiones distintas Santi/Leandro y cuenta común con el mecanismo real de servidor, CRUD compartido en ambos sentidos, logout/nueva sesión, cada operación sin sesión 401, Origin ajeno 403, no-store, conflictos CAS, rollback de importación y borrado de carpeta, 32 partes, validación musical e importación repetida sin duplicados.
- Migración: aplicación doble sobre una base anterior con datos ficticios de auth/chat; filas previas iguales y sin violaciones de claves foráneas. No se exportaron cuentas/sesiones reales.
- UI: diálogo cerrado no sustituye canción abierta, BPM manual conserva partes/ID, rename no marca borrador guardado, carpetas y raíz, errores/409, guardado lento, respuesta vieja, recarga de borrador, respuesta perdida de creación de canción o carpeta seguida de recarga sin copia adicional, sesión invalidada en vuelo.
- Wrangler local + navegador Chromium: dos cuentas de prueba en contextos aislados crean/editan en ambos sentidos; datos recuperados al recargar y cerrar/reabrir sesión. Logout 200, lectura anónima 401, login 200. Eliminación real desde UI pidió confirmación; conservó dos canciones y sus bloques, ambas en raíz.
- Responsive inspeccionado en 390×844 y 1366×900: scrollWidth igual al viewport, diálogo de escritorio de 720 px. Emulación móvil, no hardware iOS/Android.
- Web Audio real de Chromium instrumentado sin sustituir el reloj: cuatro pulsos iniciales a 0,6 s; aceleración 100→140 en un compás con intervalos 0,571861 / 0,522068 / 0,480256 / 0,444648 s; siguiente intervalo 0,428571 s. Stop dejó transporte detenido. Pruebas automatizadas cubren Stop/reinicio, inicio simultáneo, pausa/reanudación, fondo y errores de audio.
- Offline: pruebas de UI y SW ejecutadas; canciones globales no se cachean y guardado compartido queda bloqueado sin sesión online. La emulación de red del navegador local no cambió navigator.onLine: no se cuenta como prueba de desconexión física superada.

## Publicación y límites de verificación

La publicación usa exclusivamente el proyecto existente y la rama master. Antes de aplicar esquema se inspecciona el UUID y el registro de migraciones. Como aparece pendiente `0011_retire_accounting.sql`, la actualización ejecuta solo el archivo 0012 y registra únicamente esa migración; no corre bootstrap remoto ni migrations apply sobre todo el directorio.

Commit, push, despliegue y verificaciones finales se informan con sus resultados reales en la entrega. La verificación autenticada equivalente se ejecutó en tests y Wrangler local; no se modifican cuentas/sesiones de producción para crear evidencia. No se probó audio audible en teléfonos físicos.
