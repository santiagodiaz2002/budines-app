# AGENTS.md

## Arquitectura

- App PWA estática en `public/`.
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
- No inventar gramos, usuario ni fecha comercial de los saldos iniciales.
- No borrar físicamente registros desde la interfaz ni desde la API.

## Seguridad

- No versionar `.dev.vars`, secretos reales, tokens ni credenciales.
- No registrar códigos de activación ni tokens en logs.
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
