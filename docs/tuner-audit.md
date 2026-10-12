# Reparación del afinador — 12 de octubre de 2026

## Proyecto y alcance

Repositorio `santiagodiaz2002/budines-app`, rama `master`, inicialmente limpio y sincronizado con `origin/master`, HEAD `d230e2b6c213453a67e67fc7905b591d55a1a3ab`. Producción sirvió los mismos bytes de HTML, tuner.js, tuner-core.js y sw.js antes de intervenir. Pages existente `budines`, producción `budines.pages.dev`, rama `master`, despliegue directo `7849fbf0-7ea6-486a-9b31-bcaf9aa62d91` del mismo commit.

La reparación se aplica al afinador cromático existente. No cambia motores de metrónomo, aceleración, cancionero, auth, chat, Truco, esquema, migraciones, Functions ni datos de D1. No se aplican migraciones, no se restauran funciones comerciales retiradas y no se opera sobre cuentas reales.

## Diagnóstico reproducido antes de reparar

Las 169 pruebas previas pasaban, pero sólo una comprobaba detección de seno de 110 Hz y otra la cancelación programática de un permiso. No cubrían cambios de octava, armónicos dominantes, agudos ni interrupciones.

- YIN calculaba diferencias y suma acumulativa desde `minTau`, omitiendo retardos anteriores. La normalización quedaba sesgada en agudos: 1174,659 Hz se estimó como 587,359 Hz a 48 kHz/4096 muestras, un error de −1199,91 cents.
- Aceptaba el primer valle bajo el umbral, incluso con una fundamental presente pero débil: 110 Hz con amplitudes 0,08/0,7/0,02 para fundamental/segundo/tercer armónico produjo 220,086 Hz, +1200,68 cents.
- El estabilizador corregía todos los saltos de octava respecto de la nota anterior. Bloqueaba A2→A3 indefinidamente, incluso después de silencio porque conservaba `lastMidi`.
- El umbral RMS 0,012 rechazaba un seno limpio de amplitud 0,01 (RMS 0,0071), sin evaluar su periodicidad.
- El contexto se creaba después de esperar permisos y nunca se llamaba `resume()`. No existía manejo de suspensión/interrupción ni liberación por `visibilitychange`/`pagehide`.
- El botón Detener seguía deshabilitado durante el permiso, aunque la función stop podía invalidarlo desde código. `close()` no manejaba rechazos. La captura y el análisis continuaban al navegar fuera del afinador.
- Silencio y detención mostraban A4 y objetivo 440 Hz como una lectura aparente. El display completo tenía `aria-live` con valores actualizados en cada frame.
- Se analizaba en cada `requestAnimationFrame` (~60 Hz o más según pantalla). El core costaba aproximadamente 5,2 ms por señal en el host de diagnóstico.

El navegador Chrome 154.0.8037.99 reprodujo los defectos de producción mediante `getUserMedia` real con dispositivo falso y un WAV generado localmente. Cuatro de siete fases fueron incorrectas: A2→A3 siguió mostrando A2/110 Hz; D6 mostró D5/587,4 Hz; A2 +19 cents con armónicos mostró A3/222,5 Hz; A4 posterior quedó en A3/220 Hz. Stop cerró el contexto y la pista, pero reiniciar y navegar a Truco dejó la segunda pista `live` y su contexto `running`.

## Verificación reproducible

`npm run validate` es la validación oficial. `node scripts/measure-tuner.mjs` mide el detector con señales determinísticas. `scripts/check-tuner-browser.mjs` comprueba captura Web Audio, presentación, octavas, armónicos, silencio, Stop/reinicio, navegación e interrupción de contexto con un micrófono sintético, además de anchos 320/390/768 px.

El script de navegador usa Playwright instalado en el host (no incorpora una dependencia a la app). `PLAYWRIGHT_MODULE` permite indicar el módulo ESM de Playwright y `CHROME_PATH` un ejecutable Chrome. Ejecutar con `node scripts/check-tuner-browser.mjs http://127.0.0.1:8788/` sobre `npm run dev`; la URL también puede ser producción. `--baseline` informa resultados sin exigir que la implementación anterior pase. `TUNER_SCREENSHOT` permite guardar una captura de la interfaz.

El WAV contiene únicamente señales generadas; se guarda temporalmente y se elimina al terminar. No captura, graba ni transmite micrófonos reales. El navegador usa un contexto aislado sin cuentas, entra en herramientas locales y no escribe APIs. Los tiempos de cambio del script son aproximados: se comparan con el inicio de la captura falsa, no con un reloj físico de entrada.

## Reparaciones y archivos

- `public/js/tuner-core.js`: YIN con retardos completos y comparaciones de longitud constante; elimina DC, filtra antes de reducir muestreo y refina la frecuencia con muestras originales. Compara periodicidad y evidencia de parciales para recuperar una fundamental con segundo/tercer armónico dominante. Reutiliza buffers por captura. Conserva el rango 35–1200 Hz y A4 = 440 Hz.
- El estabilizador de ese módulo confirma tres lecturas durante al menos 60 ms (80 ms a intervalos de 40 ms), admite cambios reales de octava, suaviza cents con constante breve y reinicia completamente al perder señal. Una histéresis de 3 cents en el límite entre semitonos evita parpadeo del nombre de nota; la desviación siempre se calcula contra la nota mostrada.
- `public/js/tuner.js`: crea y reanuda AudioContext dentro del gesto; sesiones con propietario explícito, Stop disponible durante permiso, descarte y liberación de streams tardíos, cierre con errores manejados, listeners de pistas/contexto/página. Ventana de al menos 85 ms, máximo 25 análisis por segundo. Interrupciones liberan micrófono y requieren reinicio explícito. Sin lectura válida muestra guiones, con aguja oculta; evita `-0.0 cents` y anuncios repetidos de decimales.
- `public/js/app.js`: detener exclusivamente el afinador al navegar fuera de él.
- `public/index.html`, `public/styles.css`: cents destacados junto a la nota, encabezado adaptable, aguja oculta sin señal y zona verde coherente con ±5 cents. Se conserva la identidad visual y el resto de los paneles.
- `public/sw.js`, `public/_headers` y URLs de app/estilos/módulos: shell `budines-shell-v40-tuner` para entregar la reparación a instalaciones PWA. La instalación solicita assets con cache: reload y la raíz HTML exige revalidación. APIs continúan sin cache.
- `tests/tuner.test.js`, `tests/tuner-ui.test.js`, `tests/fixtures/tuner-signals.js`, `tests/app-ui.test.js`: precisión, estabilización, notas/cents, captura, errores, interrupciones, concurrencia y navegación. `tests/truco.test.js` cambia únicamente las expectativas de versión del shell; no cambia comportamiento de Truco.
- `scripts/measure-tuner.mjs`, `scripts/check-tuner-browser.mjs`, este informe: evidencia cuantitativa y reproducción de navegador.

## Resultados cuantitativos finales

Tolerancias de banco: ≤2 cents con señales determinísticas de frecuencia conocida; ≤3 cents para los casos de ruido moderado especificados. Se eligen por ser inferiores a la zona visual de afinación ±5 cents y detectan errores musicales relevantes, sin afirmar precisión acústica profesional. Desafinaciones −35/−12/0/+12/+35 cents, seis notas adicionales entre 35 y 1200 Hz, siete timbres, tres fases y cuatro tasas de muestreo.

| Tasa | Casos | Fallos >2 cents | Error máximo | Percentil 95 |
|---|---:|---:|---:|---:|
| 16 kHz | 945 | 0 | 1,67649 c | 0,30236 c |
| 44,1 kHz | 945 | 0 | 0,01512 c | 0,00128 c |
| 48 kHz | 945 | 0 | 0,00730 c | 0,00091 c |
| 96 kHz | 945 | 0 | 0,00050 c | 0,000051 c |

Total: 3.780 señales. Las referencias E2/A2/D3/G3/B3/E4/A4 a 48 kHz se midieron como 82,406889/110,000000/146,832384/195,997718/246,941651/329,627557/440,000000 Hz. Sus nombres y octavas fueron correctos; los errores del seno limpio son menores que 0,000002 cents y sólo describen ese banco sintético.

Un barrido adicional de 2.400 casos (100 frecuencias × 4 tasas × 6 condiciones) no presentó octavas falsas. El máximo con ruido moderado fue 0,74127 cents, sin fallos >3 cents. Se corrigió y agregó la regresión de 110 Hz con fundamental 0,01 y segundo armónico 0,7, sin otros parciales: ahora estima 110 Hz. El ruido fuerte tuvo dos rechazos de señal; no se le exige precisión ≤3 cents ni se presenta como un caso acústico aprobado.

100 ruidos blancos: cero falsas detecciones; 100 señales débiles (amplitud 0,006, ruido 0,0005): 100 aceptadas. 100 señales con armónicos, ruido 0,02 y caída de amplitud de 0,3 s: máximo 0,24470 cents. También pasan silencio, DC constante, ruido coloreado y señales insuficientes.

Confirmación inicial y cambios de octava: 80 ms; ajuste de 12 cents hasta error ≤2 cents: 120 ms. Presupuesto comprobado del estabilizador: ≤120 ms para confirmar y ≤160 ms para corregir. La ventana de 4096/48 kHz aporta 85,33 ms; ventana + intervalo + confirmación = 205,33 ms es una estimación teórica que excluye latencia de hardware/captura, CPU y programación del navegador.

Benchmark serial del host: tonos aproximadamente 0,73–0,79 ms por análisis; silencio 0,08 ms; ruido 0,73 ms. El análisis a 25 Hz reduce el trabajo frente a cada frame de pantalla. Esto no mide batería ni CPU de teléfonos.

## Validación y conservación

`npm run validate`: 17 archivos de pruebas, 240 pruebas aprobadas; sintaxis, auditoría y branding aprobados. Incluye 38 pruebas de core y 39 de UI del afinador. Pasan regresiones de metrónomo, integración matemática de aceleración progresiva, cancionero/API/importación/carpetas, auth/chat/Truco, almacenamiento y service worker. No quedan pruebas críticas fallidas en la versión final. Una expectativa antigua de versión del shell en Truco se actualizó al nuevo identificador.

Chrome 154 con micrófono sintético: siete fases con frecuencia, nota, octava y cents correctos (A2, A3, D6, silencio, E2 −17c, A2 +19c con armónicos y A4). Stop, reinicio, navegación a Truco y suspensión real del AudioContext dejan todas las pistas `ended` y contextos `closed`. La denegación del permiso del navegador muestra un error comprensible, cierra el contexto y permite reintentar tras restablecer permiso. No se registraron errores de página. Anchos 320/390/768 px sin desbordamiento horizontal, botones de al menos 44 px.

La publicación se realiza únicamente en el proyecto Pages existente después de esta validación. El commit, despliegue y comprobaciones finales de producción se informan junto con la entrega; este documento contiene la evidencia previa al despliegue.

## Límites de la verificación

Estas pruebas son sintéticas y de navegador de escritorio, incluyendo emulación de viewport y entrada táctil. No demuestran afinación acústica de una guitarra, latencia de un micrófono físico, consumo en un teléfono ni compatibilidad comprobada con Safari/iOS o Android físicos.

Una señal estrictamente periódica de ruido eléctrico puede parecer una nota: no es posible distinguir su fuente sólo por periodicidad. Una fundamental completamente ausente con sólo armónicos pares tampoco permite decidir inequívocamente su octava. El afinador debe usarse con una sola nota sostenida; mezclas de notas y ataques ruidosos pueden producir estado sin señal identificable.

Los navegadores exigen HTTPS, permiso y gesto del usuario para iniciar audio. Una solicitud de permiso ignorada puede quedar pendiente; la API no ofrece cancelación del diálogo. Detener invalida su resultado y libera los recursos locales; no se abre una segunda captura mientras no termine esa solicitud. Después de ocultar la página o una interrupción se requiere pulsar Iniciar nuevamente. Referencias: [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [AudioContext.resume](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume).

La prueba de actualización de una instalación previa conservó HTML antiguo en la primera publicación. Se agregó descarga explícita del shell sin reutilizar respuestas HTTP anteriores y Cache-Control: no-cache en la raíz; una regresión verifica esta política de instalación. Los detalles de verificación de actualización/offline se informan en la entrega final.
