# Desarrollo local y despliegue

## Requisitos

- Node.js 22 o superior.
- PostgreSQL 16 (local, Docker o un servicio gestionado como Neon).

## Desarrollo local

```bash
npm install                 # instala dependencias y genera el cliente de Prisma (postinstall)
cp .env.example .env        # y rellena DATABASE_URL
npm run db:migrate          # aplica las migraciones a tu base de datos
npm run dev                 # http://localhost:3000
```

Postgres rápido con Docker:

```bash
docker run --name dungeonsouls-db -e POSTGRES_USER=dungeon -e POSTGRES_PASSWORD=dungeon \
  -e POSTGRES_DB=dungeonsouls -p 5432:5432 -d postgres:16
```

### Scripts

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Compilación y servidor de producción |
| `npm run lint` | ESLint |
| `npm run typecheck` | Genera tipos de rutas y ejecuta `tsc --noEmit` |
| `npm test` | Pruebas unitarias (Vitest, sin base de datos) |
| `npm run test:integration` | Pruebas de servicios contra Postgres real |
| `npm run test:e2e` | Playwright (escritorio y móvil); requiere `npm run build` antes |
| `npm run db:migrate` | Crea/aplica migraciones en desarrollo |
| `npm run db:deploy` | Aplica migraciones pendientes (producción/CI) |
| `npm run db:studio` | Explorador de datos de Prisma |

### Pruebas de integración y E2E

Usan una base de datos **desechable**: las de integración vacían las tablas antes de cada prueba. Por seguridad, la URL debe contener `test`.

```bash
createdb dungeonsouls_test
export DATABASE_URL="postgresql://dungeon:dungeon@localhost:5432/dungeonsouls_test?schema=public"
npm run test:integration
npm run build && npm run test:e2e
```

Las pruebas E2E envían una cabecera `x-real-ip` distinta en cada prueba para no chocar con el límite de registros por IP.

La prueba E2E que completa un piso usa el piloto automático, que solo existe si se compila con `NEXT_PUBLIC_E2E_AUTOPILOT=1`:

```bash
NEXT_PUBLIC_E2E_AUTOPILOT=1 npm run build && npm run test:e2e
```

No definas esa variable en Vercel: en producción el piloto no se incluye y `?autopilot=1` no hace nada.

## Despliegue en Vercel

1. **Importar el repositorio** en Vercel (framework detectado: Next.js).
2. **Base de datos:** en el proyecto de Vercel, *Storage → Marketplace → Neon* (u otro Postgres). Vercel añade las variables de conexión al proyecto.
3. **Variables de entorno** (Production y Preview):
   - `DATABASE_URL`: cadena **con pooling** (host con `-pooler`), con `sslmode=require`.
   - `DIRECT_URL` (recomendado con Neon): cadena directa sin pooling, usada solo por las migraciones.
4. **Build Command:** `npm run vercel-build` (genera el cliente, aplica migraciones con `prisma migrate deploy` y compila). Si prefieres no migrar en cada build, deja `npm run build` y ejecuta `npm run db:deploy` manualmente antes de cada despliegue.
5. **Comprobar** tras desplegar:
   - `GET https://<tu-dominio>/api/health` → `{"status":"ok","database":"ok"}`. Si devuelve 503, la base de datos no es accesible (revisa `DATABASE_URL` y SSL).
   - Registro → crear personaje → asignar puntos → cerrar sesión → iniciar sesión.
   - Entrar al piso 1, completarlo y comprobar que aparecen la XP, el botín en el inventario y el piso 2 desbloqueado.

> En las Preview Deployments, apunta `DATABASE_URL` a una rama o base de datos distinta de producción (Neon crea ramas por despliegue de vista previa si activas la integración), para que las migraciones de una rama no afecten a producción.

### Seguridad en producción

- Las cookies de sesión son `Secure` automáticamente cuando `NODE_ENV=production`.
- Ningún secreto usa el prefijo `NEXT_PUBLIC_`.
- Cabeceras de seguridad básicas en `next.config.ts`.
- La IP para el límite de intentos se lee de `x-real-ip`, que Vercel fija. Si se despliega fuera de Vercel, hay que asegurarse de que el proxy de delante sobrescribe esa cabecera.

## Servicio de tiempo real (Fase 4)

El juego en grupo usa un **Cloudflare Worker con Durable Objects** (`realtime/`). Vercel sigue siendo la aplicación: emite los tickets de conexión y aplica las recompensas. Sin este servicio todo lo demás funciona; la pantalla de grupo avisa de que no está configurado y no deja empezar expediciones.

### Qué necesitas de Cloudflare

- Una **cuenta de Cloudflare** (gratis). Los Durable Objects con almacenamiento SQLite entran en el plan **Free**; el plan Workers Paid (5 $/mes) solo hace falta si se supera el cupo diario (ver costes en `docs/arquitectura.md`, sección 6).
- Para desplegar desde tu ordenador basta con `npx wrangler login` (abre el navegador). Para desplegar desde CI hace falta un **API token** con la plantilla *Edit Cloudflare Workers* y el **Account ID** (no se usan en este repositorio todavía).
- Un **secreto compartido** largo (mín. 32 caracteres), el mismo en Cloudflare y en Vercel. Genera uno con `openssl rand -base64 48`.

### Pasos

```bash
cd realtime
npm install
npx wrangler login                       # una vez
# Edita wrangler.jsonc: APP_URL y ALLOWED_ORIGINS = https://<tu-dominio-de-vercel>
npx wrangler secret put REALTIME_SECRET  # pega el secreto
npx wrangler deploy                      # imprime la URL: https://dungeonsouls-realtime.<subdominio>.workers.dev
```

En Vercel (Production y Preview), añade:

| Variable | Valor |
| --- | --- |
| `REALTIME_SECRET` | El mismo secreto (solo servidor; nunca con prefijo `NEXT_PUBLIC_`) |
| `REALTIME_URL` | `wss://dungeonsouls-realtime.<subdominio>.workers.dev` |

Vuelve a desplegar en Vercel para que lea las variables. Comprueba `https://dungeonsouls-realtime.<subdominio>.workers.dev/health` → `{"status":"ok"}`, crea un grupo en `/party` con dos cuentas y completa el piso 1.

> Las Preview Deployments tienen otra URL: si quieres probar grupos en ellas, añade su origen a `ALLOWED_ORIGINS` (separado por comas) o despliega un segundo Worker (`npx wrangler deploy --name dungeonsouls-realtime-preview`) con su propio `APP_URL`.

### En local

```bash
cp realtime/.dev.vars.example realtime/.dev.vars   # mismo REALTIME_SECRET que en .env
npm --prefix realtime run dev                       # ws://localhost:8787
# en .env: REALTIME_SECRET=… y REALTIME_URL=ws://localhost:8787
npm run dev
```

La prueba E2E del juego en grupo arranca `wrangler dev` sola si se define `E2E_REALTIME=1` (junto con `REALTIME_SECRET` y `REALTIME_URL=ws://localhost:8788`), como hace la CI.

## Integración continua

`.github/workflows/ci.yml` levanta Postgres 16 y ejecuta lint, typecheck (también del Worker), pruebas unitarias, de integración, build (con el piloto automático de pruebas) y E2E en cada PR y en `main`. La E2E del juego en grupo usa un servidor de partida local (`wrangler dev`) con un secreto que solo existe en la CI.
