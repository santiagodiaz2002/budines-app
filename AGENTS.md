# AGENTS.md

## Arquitectura

- App PWA estática en `public/`.
- La interfaz tiene cuatro pestañas inferiores: Budines, Truco, Metrónomo y Afinador.
- Las herramientas locales viven en módulos separados de `public/js`: navegación, Truco, metrónomo, afinador y núcleos testeables.
- Cloudflare Pages Functions en `functions/api`.
- Binding D1 obligatorio: `DB`.
- Migraciones SQL versionadas en `migrations/`.
- La lógica crítica de validación, resumen, autenticación, idempotencia y anulación vive en módulos importables y está cubierta por Vitest.

## Reglas del Dominio

- La app se llama Budines y usa español de Argentina.
- Usuarios permitidos: Santi y Leandro.
- La identidad confiable se deriva únicamente de la sesión del servidor.
- La inversión inicial persistente es ARS 120000.
- El saldo inicial activo correcto es ARS 3000.
- La fila histórica `saldo-inicial-ars-62000` existe, pero está dada de baja lógica por la migración `0002_remove_incorrect_62000_record.sql`.
- El total acumulado se calcula solo con registros activos.
- Los registros anulados no cuentan en el resumen.
- Ventas y saldos iniciales activos pueden eliminarse desde la interfaz mediante baja lógica confirmada.
- Truco, Metrónomo y Afinador son herramientas exclusivamente locales del dispositivo y no usan D1.
- Truco es un anotador argentino a 30 puntos para Nosotros y Ellos; representa puntos con instancias de `public/media/joint.jpg`.
- El metrónomo funciona en 4/4 con modo normal y configuración por bloques que se repite hasta Stop.
- El afinador es cromático, usa referencia A4 = 440 Hz y no depende de una afinación fija.
- No inventar gramos, usuario ni fecha comercial de los saldos iniciales.
- No borrar físicamente registros desde la interfaz ni desde la API.

## Seguridad

- No versionar `.dev.vars`, secretos reales, tokens ni credenciales.
- No registrar códigos de activación ni tokens en logs.
- No enviar, grabar ni almacenar audio del afinador; el micrófono se pide solo al iniciar el afinador y se liberan los tracks al detener.
- No permitir que metrónomo y afinador queden ejecutándose simultáneamente.
- Usar consultas parametrizadas para todo dato de usuario.
- Renderizar en frontend con `textContent` o creación segura de nodos; no insertar HTML de la API.
- Las respuestas privadas deben usar `Cache-Control: no-store`.

## Comandos

- `npm run dev`: servidor local con Wrangler Pages.
- `npm run db:migrate:local`: aplica migraciones D1 locales.
- `npm run test`: pruebas determinísticas.
- `npm run lint`: chequeos de sintaxis y auditoría local.
- `npm run validate`: lint + pruebas.

## Convenciones

- JavaScript modular ESM.
- Dinero y gramos son enteros, nunca `REAL`.
- Los límites máximos de longitud son defensivos, no reglas comerciales.
- Ejecutar `npm run validate` antes de entregar cambios.
- Si se modifica el esquema, agregar una migración nueva; no editar una migración ya aplicada en producción.
- La eliminación usa `record_deletions` para excluir registros del resumen/listado sin `DELETE SQL`.
- La persistencia con `localStorage` solo está permitida para estado local de Truco y Metrónomo; Budines comercial sigue usando servidor/D1.
