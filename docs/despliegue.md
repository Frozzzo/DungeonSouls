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

> En las Preview Deployments, apunta `DATABASE_URL` a una rama o base de datos distinta de producción (Neon crea ramas por despliegue de vista previa si activas la integración), para que las migraciones de una rama no afecten a producción.

### Seguridad en producción

- Las cookies de sesión son `Secure` automáticamente cuando `NODE_ENV=production`.
- Ningún secreto usa el prefijo `NEXT_PUBLIC_`.
- Cabeceras de seguridad básicas en `next.config.ts`.
- La IP para el límite de intentos se lee de `x-real-ip`, que Vercel fija. Si se despliega fuera de Vercel, hay que asegurarse de que el proxy de delante sobrescribe esa cabecera.

## Servicio de tiempo real (Fase 4)

Aún no forma parte del despliegue. Se documentará aquí cuando exista: Worker de Cloudflare con Durable Objects (`realtime/`), secreto compartido para tickets y URL pública del WebSocket. Ver [arquitectura.md, sección 5](./arquitectura.md#5-multijugador-en-vercel).

## Integración continua

`.github/workflows/ci.yml` levanta Postgres 16 y ejecuta lint, typecheck, pruebas unitarias, de integración, build y E2E en cada PR y en `main`.
