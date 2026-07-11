# Budines

Budines es una PWA privada para dos usuarios, Santi y Leandro, destinada a registrar operaciones compartidas desde iPhone. La app usa frontend estático, Cloudflare Pages Functions como backend y Cloudflare D1 como base persistente.

## Arquitectura

- `public/`: HTML, CSS, JavaScript modular, manifest, service worker e iconos.
- `functions/api/`: API JSON bajo `/api`.
- `functions/_shared/`: validación, autenticación, sesiones, repositorio D1, resumen e idempotencia.
- `migrations/`: migraciones SQL versionadas para D1.
- `tests/`: pruebas determinísticas con Vitest.
- Binding D1 obligatorio: `DB`.

La sesión se activa con un código privado de entorno y se mantiene con una cookie opaca `HttpOnly`. El token completo solo vive en la cookie; D1 guarda el hash SHA-256.

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

Esto crea tablas, índices, usuarios permitidos, inversión inicial de ARS 120000 y los dos saldos iniciales reales de ARS 3000 y ARS 62000.

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

## Verificación de los ARS 65000 iniciales

Después de aplicar migraciones:

```bash
npx wrangler d1 execute budines --local --command "SELECT amount_ars, type, grams, user_id, commercial_date, status FROM records ORDER BY id;"
```

Resultado esperado:

- Una fila `saldo_inicial` por ARS 3000, activa, sin gramos, sin usuario, sin fecha comercial.
- Una fila `saldo_inicial` por ARS 62000, activa, sin gramos, sin usuario, sin fecha comercial.
- Resumen inicial: total ARS 65000, inversión ARS 120000, falta recuperar ARS 55000.

## Consulta de registros

Desde la app, abrir `Registros`. Desde API local con sesión activa:

```bash
curl -i http://localhost:8788/api/records
```

Sin sesión debe devolver `401`.

## Anulación de una venta

Desde la app, tocar `Anular` en una venta activa y escribir `ANULAR`. La API conserva la fila, cambia estado a `anulado`, guarda fecha y usuario, y excluye el importe del resumen.

Los registros `saldo_inicial` no muestran acción de anulación y la API también lo impide.

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
- Si se anuló una venta por error, no hay restauración en esta versión; conservar la fila y corregir mediante una migración o herramienta administrativa diseñada aparte.

## Elementos no verificados hasta desplegar

- Cuenta Cloudflare autenticada.
- Base D1 remota real.
- Binding `DB` configurado en el proyecto Pages remoto.
- Secretos productivos.
- Dominio o URL final de Pages.
- Safari real en iPhone.
- Instalación desde `Agregar a pantalla de inicio`.

## Lista final de comprobaciones de producción

1. `wrangler.jsonc` contiene `database_id` real.
2. `npm run validate` pasa localmente.
3. `npm run db:migrate:remote` termina correctamente.
4. Los secretos productivos existen en Pages.
5. El proyecto Pages tiene binding D1 `DB`.
6. `/api/health` responde en producción.
7. Activación de Santi funciona.
8. Activación de Leandro funciona.
9. Resumen inicial muestra ARS 65000, ARS 120000 y ARS 55000.
10. Una venta nueva actualiza resumen y registros.
11. Repetir una petición con la misma clave no duplica.
12. Anular una venta excluye el importe del resumen.
13. Los saldos iniciales no se pueden anular.
14. La app se instala y abre en modo standalone en ambos iPhone.

## Información todavía no identificada

- Gramos del registro inicial de ARS 3000.
- Usuario del registro inicial de ARS 3000.
- Fecha comercial del registro inicial de ARS 3000.
- Gramos del registro inicial de ARS 62000.
- Usuario del registro inicial de ARS 62000.
- Fecha comercial del registro inicial de ARS 62000.
