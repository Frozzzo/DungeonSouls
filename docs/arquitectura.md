# DungeonSouls: análisis y arquitectura

Este documento responde a la sección 25 de la especificación ("Primera tarea"): análisis de requisitos, arquitectura, estructura de carpetas, modelo de datos, multijugador en Vercel, servicios externos y costes, alcance del primer prototipo y orden de implementación con criterios de aceptación.

Documentos relacionados:

- [Modelo de datos](./modelo-datos.md): tablas de la Fase 1 y diseño completo de las siguientes.
- [Desarrollo local y despliegue](./despliegue.md).

> Nombre: la especificación propone "Abyssal Dungeon" como nombre provisional. Se usa **DungeonSouls**, que es el nombre del repositorio. Se cambia en un único sitio: `src/config/site.ts`.

---

## 1. Análisis de requisitos

### 1.1 Qué es el producto

Un ARPG de mazmorras **cooperativo online** (hasta 4 jugadores) con progresión tipo Diablo (niveles, atributos, árbol de habilidades, botín con rarezas) y combate de acción con exigencia soulslike (telegráficos, patrones, ventanas de castigo, esquiva). Se juega en el navegador, se despliega en Vercel y el estado importante es persistente y autoritativo en el servidor.

### 1.2 Requisitos funcionales agrupados

| Área | Requisitos clave | Fase |
| --- | --- | --- |
| Cuentas | Registro, inicio y cierre de sesión, rutas privadas, sesiones seguras | 1 |
| Personajes | Crear, listar, borrar; 3 clases; nivel 1; estadísticas base y derivadas | 1 |
| Progresión | Curva de XP configurable, subida de nivel, puntos de atributo y de habilidad | 1 (lógica) / 3 (uso) |
| Combate | Movimiento, ataque básico, habilidades, impactos, estados, esquiva, muerte y reanimación | 2 |
| Enemigos y jefes | Comportamientos diferenciados, élites, jefe cada 5 pisos con fases y telegráficos | 2 y 5 |
| Habilidades | Árbol por clase con ramas, rangos con tope, 3 básicas + 1 ultimate equipadas | 3 |
| Objetos | Inventario persistente, 6 rarezas, restricciones por clase, comparar, equipar, desmontar | 2 y 3 |
| Consumibles | Pociones limitadas con enfriamiento validado en servidor | 3 |
| Mazmorras | Pisos generados con semilla registrada, sin rutas imposibles | 2 y 5 |
| Multijugador | Grupos con código, preparación, sincronización, reconexión, recompensas individuales | 4 |
| Dificultad | 4 niveles que cambian presión táctica, no solo vida | 5 (config ya en Fase 1) |

### 1.3 Requisitos no funcionales que condicionan la arquitectura

1. **Autoridad del servidor.** Daño, XP, botín, enfriamientos y estadísticas los calcula el servidor. El cliente solo envía intenciones ("me muevo", "uso la habilidad X sobre este punto") y representa el resultado.
2. **Sin memoria compartida entre instancias.** En Vercel cada petición puede ir a una instancia distinta. No puede haber estado de partida en variables globales.
3. **Idempotencia.** Repetir una petición por un fallo de red no puede entregar dos veces la misma recompensa.
4. **Fórmulas únicas.** El cliente (vista previa) y el servidor (verdad) usan exactamente el mismo código de reglas.
5. **Contenido por configuración.** Clases, habilidades, enemigos, jefes, objetos y dificultades se definen como datos tipados, no dentro de componentes.
6. **Siempre desplegable.** Cada fase termina con una aplicación que compila, pasa sus pruebas y funciona.

### 1.4 Riesgos principales

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Combate en tiempo real sobre funciones serverless | Alto: un bucle de simulación no encaja en funciones efímeras | Servidor de partida con estado (sección 5) |
| Alcance muy amplio | Alto | Fases cortas con criterios de aceptación verificables |
| Trampas desde el cliente | Alto | Validación de toda acción en servidor; el cliente nunca envía resultados |
| Balance | Medio | Todos los números en `src/game/balance.ts` y en las definiciones de contenido, con pruebas de límites |
| Costes del tiempo real | Medio | Estimación en la sección 6; mensajes de entrada limitados a 10–20 Hz |

---

## 2. Arquitectura propuesta

```
                          ┌───────────────────────────── Vercel ─────────────────────────────┐
 Navegador                │  Next.js 16 (App Router)                                         │
 ┌──────────────┐  HTTPS  │  ┌──────────────┐  ┌──────────────────┐  ┌─────────────────────┐ │
 │ React UI     │────────▶│  │ Páginas RSC  │─▶│ Servicios (src/  │─▶│ Prisma 7 + pg       │─┼──▶ PostgreSQL
 │ Canvas (F2+) │         │  │ Server       │  │ server/*)        │  │ (src/server/db.ts)  │ │    (Neon)
 │              │         │  │ Actions      │  └────────┬─────────┘  └─────────────────────┘ │
 │              │         │  └──────────────┘           │ usa                                │
 │              │         │                    ┌────────▼─────────┐                          │
 │              │         │                    │ Núcleo de reglas │  (src/game: TS puro,     │
 │              │         │                    │ src/game         │   sin React ni BD)       │
 │              │         │                    └──────────────────┘                          │
 │              │         │  /api/internal/*  ◀── resultados firmados + clave idempotente ───┼──┐
 │              │         └──────────────────────────────────────────────────────────────────┘  │
 │              │  WebSocket (Fase 4)                                                            │
 │              │────────────────────────▶ Cloudflare Worker + Durable Object por expedición ───┘
 └──────────────┘   ticket firmado         (simulación autoritativa a 20 Hz, mismo src/game)
```

### Capas (sección 2 de la especificación)

| Capa | Dónde | Regla |
| --- | --- | --- |
| Interfaz y componentes | `src/app/**/page.tsx`, `src/components/**` | Solo presentan datos y envían intenciones |
| Reglas y lógica del juego | `src/game/**` | TypeScript puro, determinista, sin I/O. Lo usan el servidor web, el servidor de partida y la vista previa del cliente |
| Servicios de aplicación | `src/server/<dominio>/service.ts` | Casos de uso: validan propiedad, aplican reglas, escriben en transacción |
| Persistencia | `prisma/schema.prisma`, `src/server/db.ts` | Solo los servicios acceden a la base de datos |
| Autenticación y autorización | `src/server/auth/**`, `src/proxy.ts` | Sesión verificada en cada página y Server Action, no solo en el proxy |
| Tiempo real | `realtime/` (Fase 4) | Servidor de partida separado; habla con Next.js mediante mensajes firmados |
| Configuración e infraestructura | `src/config`, `src/game/balance.ts`, `prisma.config.ts`, `.github/workflows` | Sin secretos en el cliente |

### Decisiones técnicas (ADR resumidos)

- **ADR-01. Next.js 16 con App Router y Server Actions.** Las mutaciones de la Fase 1 son formularios; las Server Actions validan con Zod y llaman a servicios. Los Route Handlers se reservan para la salud (`/api/health`) y, en la Fase 4, para endpoints internos.
- **ADR-02. Prisma 7 con `@prisma/adapter-pg`.** Prisma 7 usa adaptadores de controlador; `pg` funciona con cualquier Postgres (Neon, Supabase, local). El cliente se genera en `src/generated/prisma` (no se versiona).
- **ADR-03. Sesiones propias en base de datos en lugar de una librería de autenticación.** Solo se necesita correo y contraseña. Una sesión es un token aleatorio de 256 bits en una cookie `httpOnly`, `SameSite=Lax`, `Secure` en producción; en la base de datos se guarda solo su hash SHA-256, así que una filtración de la tabla no permite suplantar sesiones. Las sesiones se pueden revocar borrando filas. Contraseñas con `scrypt` (N=2^15) de Node, sin dependencias nativas. Así se evitan dependencias en beta y se mantiene control total. Si más adelante se quieren OAuth o passkeys, se puede migrar a una librería sin cambiar los servicios del juego.
- **ADR-04. Límite de intentos en Postgres.** Funciona igual con una o muchas instancias. Claves con hash (no se guardan correos ni IPs en claro). Login: 5 fallos por correo y 20 por IP cada 15 min; registro: 5 por IP cada hora. La IP se toma de `x-real-ip`, que en Vercel fija la plataforma.
- **ADR-05. Núcleo de reglas puro y compartido.** `src/game` no importa React, Next ni Prisma. En la Fase 4 se moverá a un paquete (`packages/game-core`) que importen tanto Next.js como el servidor de partida.
- **ADR-06. Tiempo real en Cloudflare Durable Objects** (justificación en la sección 5).
- **ADR-07. Cache Components desactivado en la Fase 1.** Casi todas las pantallas dependen de la sesión y son dinámicas; activarlo exige límites `<Suspense>` y directivas de caché en cada lectura de sesión sin beneficio real ahora. Se puede activar más adelante para páginas públicas.
- **ADR-08. Se guardan los puntos asignados, no las estadísticas finales.** La tabla `Character` guarda nivel, XP, puntos libres y puntos asignados por atributo. Atributos totales y estadísticas derivadas se calculan siempre con `computeCharacterStats`, así no pueden desincronizarse ni manipularse.
- **ADR-09. Cinco puntos de atributo iniciales.** Así el sistema de estadísticas se puede usar desde la Fase 1, antes de que exista XP por combate. Valor configurable en `BALANCE.progression.startingStatPoints`.

---

## 3. Estructura de carpetas

Estado actual (Fase 1) y lo previsto para las siguientes fases, en cursiva.

```
.
├── docs/                         Documentación (este archivo, modelo de datos, despliegue)
├── prisma/
│   ├── schema.prisma             Modelos de la base de datos
│   └── migrations/               Migraciones SQL versionadas
├── prisma.config.ts              Configuración del CLI de Prisma 7
├── src/
│   ├── app/                      Rutas (App Router)
│   │   ├── (auth)/               login, register y sus Server Actions
│   │   ├── (game)/               zona privada: layout con sesión obligatoria
│   │   │   └── characters/       lista, creación, ficha y Server Actions
│   │   ├── api/health/           comprobación de salud
│   │   ├── layout.tsx, page.tsx, not-found.tsx, globals.css
│   ├── components/
│   │   ├── ui/                   botones, campos, barras, alertas
│   │   ├── auth/                 formularios de acceso
│   │   ├── character/            selector de clase, panel de estadísticas, asignación
│   │   └── layout/
│   ├── config/site.ts            nombre e identidad del juego
│   ├── game/                     NÚCLEO DE REGLAS (puro)
│   │   ├── balance.ts            todos los parámetros de balance
│   │   ├── types.ts, attributes.ts
│   │   ├── classes/definitions.ts
│   │   ├── stats/                compute.ts (fórmulas), allocation.ts
│   │   ├── progression/          experience.ts (curva y subida de nivel)
│   │   ├── difficulty/           definiciones de las 4 dificultades
│   │   ├── skills/               (F3) definiciones, árbol, rangos, equipables
│   │   ├── items/                (F2–3) bases, rarezas, afijos, restricciones
│   │   ├── combat/               (F2) daño, mitigación, estados, enfriamientos
│   │   ├── enemies/, bosses/     (F2, F5) definiciones y patrones
│   │   ├── dungeon/              (F2) generación con semilla y validación de mapas
│   │   └── simulation/           (F2) bucle de simulación determinista por ticks
│   ├── lib/validation/           esquemas Zod compartidos
│   ├── server/                   SOLO servidor ("server-only")
│   │   ├── db.ts, errors.ts
│   │   ├── auth/                 contraseñas, sesiones, límites, usuario actual
│   │   ├── characters/service.ts
│   │   ├── inventory/, skills/   (F3)
│   │   ├── parties/, expeditions/, rewards/  (F4)
│   │   └── realtime/             (F4) emisión y verificación de tickets
│   ├── generated/prisma/         cliente generado (ignorado por git)
│   └── proxy.ts                  redirección optimista sin cookie
├── realtime/                     (F4) Worker de Cloudflare con el Durable Object de partida
└── tests/
    ├── unit/                     Vitest: reglas puras
    ├── integration/              Vitest + Postgres real: servicios
    └── e2e/                      Playwright: flujos completos (escritorio y móvil)
```

---

## 4. Modelo de datos

Ver [modelo-datos.md](./modelo-datos.md). Resumen de principios:

- **El contenido vive en código, el estado del jugador en la base de datos.** Definiciones de habilidades, objetos base, enemigos y jefes son módulos tipados versionados con el código; la base de datos guarda qué tiene cada personaje (rangos, objetos concretos, equipamiento).
- **Progreso permanente separado del temporal.** `Character`, `CharacterSkill`, `ItemInstance` y similares son permanentes. `Expedition`, `ExpeditionParticipant` y `Encounter` guardan el progreso temporal de una expedición.
- **Recompensas idempotentes** mediante `RewardGrant.idempotencyKey` único (`<expedición>:<encuentro>:<personaje>`).
- **Transacciones** en toda operación que toque varias entidades.

---

## 5. Multijugador en Vercel

### 5.1 Qué necesita el combate

El combate cooperativo autoritativo necesita un **proceso que mantenga el estado de la partida en memoria y avance la simulación a ritmo fijo** (≈20 ticks/s): mover enemigos, resolver impactos, aplicar enfriamientos y difundir instantáneas a todos los jugadores de la sala. Además, **todos los jugadores de una misma partida deben llegar a ese mismo proceso**.

### 5.2 Opciones evaluadas (verificado en noviembre de 2026)

| Opción | Encaje | Problemas |
| --- | --- | --- |
| **WebSockets en Vercel Functions** (GA desde el 20-10-2026, con Fluid Compute) | Bueno para lobby, presencia y notificaciones | Cada conexión queda fijada a la instancia que la aceptó, sin garantía de que los 4 jugadores coincidan; las conexiones se cortan al llegar a `maxDuration` (≈300 s por defecto; en pruebas públicas se cortaron sin trama de cierre, código 1006); no hay memoria compartida, así que haría falta Redis pub/sub y elegir qué instancia ejecuta la simulación. Un bucle de 20 Hz repartido entre instancias efímeras es frágil |
| **Pub/sub gestionado** (Ably, Pusher, Upstash Redis) | Bueno como transporte | Solo reenvía mensajes; la simulación autoritativa seguiría sin un sitio donde ejecutarse |
| **Cloudflare Durable Objects** (Worker + un objeto por expedición) | **Muy bueno** | Un objeto con id único por partida: todas las conexiones de esa partida llegan a la misma instancia, monohilo, con estado en memoria, almacenamiento SQLite propio, alarmas y API de hibernación de WebSockets. Es un segundo proveedor que hay que desplegar |
| **Servidor Node dedicado** (p. ej. Colyseus en Fly.io o Railway) | Bueno | Coste fijo y operación de servidores; escalar a varias salas requiere matchmaking/afinidad. Queda como **alternativa** si se quiere evitar Cloudflare |

**Decisión:** la aplicación web, la autenticación, la persistencia y los servicios siguen en **Vercel + Postgres**; la simulación en tiempo real de cada expedición se ejecuta en un **Durable Object de Cloudflare**. Los WebSockets de Vercel se pueden usar en el futuro para presencia del lobby si resulta útil, pero no para el combate.

### 5.3 Flujo de una partida (Fase 4)

1. **Grupo.** El líder crea un grupo (Server Action, Postgres) y comparte un código o enlace. Hasta 4 miembros, cada uno con un personaje propio. Marcan "listo".
2. **Inicio.** El líder inicia la expedición: el servicio crea `Expedition` (dificultad y semilla fijadas, no modificables después) y sus participantes en una transacción.
3. **Ticket.** Cada cliente pide a Next.js un ticket de conexión: un token firmado con HMAC, válido 60 s, con `userId`, `characterId`, `expeditionId` y las estadísticas calculadas por el servidor. El secreto se comparte entre Vercel y Cloudflare (variable de entorno que se añadirá en la Fase 4).
4. **Conexión.** El cliente abre `wss://realtime.../expeditions/<id>?ticket=...`. El Worker verifica el ticket y lo dirige al Durable Object `idFromName(expeditionId)`.
5. **Simulación.** El objeto ejecuta el núcleo `src/game/simulation` a 20 Hz. Los clientes envían **intenciones** con número de secuencia (dirección de movimiento, habilidad + objetivo, esquiva, poción) a un máximo de 20/s. El servidor valida alcance, enfriamientos, recurso, estado (vivo/derribado) y difunde instantáneas delta a 10–20 Hz. El cliente predice su propio movimiento e interpola el resto.
6. **Desconexión y reconexión.** Si un jugador se desconecta, su personaje pasa a `DISCONNECTED` (los enemigos dejan de priorizarlo y no puede ser derribado durante una gracia configurable). Puede reconectar con un ticket nuevo y recibe una instantánea completa. El estado se guarda en el SQLite del objeto cada pocos segundos para recuperarse si la instancia se reinicia.
7. **Resultados.** Al terminar un encuentro, el objeto envía a `POST /api/internal/expeditions/<id>/results` un resultado firmado con clave idempotente por personaje. Next.js lo aplica en una transacción (XP con `applyExperience`, objetos, `RewardGrant` único). Si la petición se repite, la restricción única evita duplicados y se devuelve el mismo resultado.

### 5.4 Por qué cumple los requisitos de la especificación

- No depende de memoria global de Vercel: el estado de partida vive en un objeto con identidad única y almacenamiento propio.
- Tolera reconexiones y múltiples instancias de Vercel: Vercel solo emite tickets y aplica resultados, ambos sin estado.
- El cliente nunca informa daño, XP ni botín.
- Las recompensas son idempotentes en Postgres.

---

## 6. Servicios externos y costes

Precios consultados en noviembre de 2026; conviene revisarlos antes de lanzar.

| Servicio | Uso | Plan inicial | Coste |
| --- | --- | --- | --- |
| **Vercel** | Next.js, Server Actions, salud | Hobby (uso personal, no comercial) | 0 €. Para uso comercial o equipo: Pro, de pago por miembro |
| **Neon Postgres** (vía Vercel Marketplace) | Base de datos principal | Plan gratuito | 0 € con límites de almacenamiento y cómputo; plan de pago al crecer. Alternativas compatibles: Supabase, Prisma Postgres |
| **Cloudflare Workers + Durable Objects** (Fase 4) | Servidor de partida | Free (solo Durable Objects con SQLite) | Free: 100 000 peticiones/día, 13 000 GB·s/día, 5 GB. Paid: 5 $/mes con 1 M peticiones y 400 000 GB·s incluidos; luego 0,15 $/M peticiones y 12,50 $/M GB·s |
| GitHub Actions | CI | Repositorio privado: minutos gratuitos mensuales | 0 € dentro del cupo |
| Upstash Redis | No necesario con este diseño | — | Solo si se usan WebSockets de Vercel para el lobby |

**Estimación de Durable Objects por sala activa (4 jugadores):**

- Duración: un objeto ocupa 128 MB; 1 hora activa = 3 600 s × 0,125 GB = **450 GB·s**. Free ≈ 28 horas de sala al día; Paid incluye ≈ 888 horas de sala al mes y después ≈ 0,006 $ por hora de sala.
- Mensajes: los mensajes entrantes se facturan a razón de 20:1 y los salientes son gratis. 4 jugadores × 20 entradas/s = 288 000 mensajes/h ≈ **14 400 peticiones facturables por hora**. Este es el límite que más aprieta: el plan Free da ≈ 7 horas de sala al día. Con entradas a 10 Hz o enviadas solo cuando cambian, el margen se duplica. En Paid, 1 M peticiones incluidas ≈ 70 horas de sala al mes y después ≈ 0,002 $ por hora de sala.

Conclusión: el desarrollo y las pruebas caben en los planes gratuitos. Con jugadores reales, el plan de pago de Cloudflare (5 $/mes) cubre cientos de horas de juego cooperativo.

---

## 7. Alcance exacto del primer prototipo

### Fase 1 (este PR): fundación desplegable

Incluido:

- Next.js 16 (App Router), TypeScript estricto, Tailwind 4, ESLint.
- Prisma 7 + Postgres con migración inicial: `User`, `Session`, `AuthAttempt`, `Character`.
- Registro, inicio y cierre de sesión con sesiones en servidor, contraseñas con scrypt, límite de intentos y rutas privadas.
- Tres clases (Guardián/Tanque, Segador/DPS, Oráculo/Healer) con atributos base, crecimiento, recurso, modificadores, ramas de habilidad y restricciones de equipo configurables.
- Sistema de estadísticas: 4 atributos, 10 estadísticas derivadas con topes, fórmulas centralizadas compartidas por cliente y servidor.
- Curva de XP y subida de nivel (lógica pura probada; se conectará al combate en la Fase 2).
- Configuración de las 4 dificultades.
- Pantallas: inicio, registro, login, lista de personajes, creación con selector de clase, ficha con barras, estadísticas, asignación de puntos con vista previa y borrado con confirmación.
- `/api/health`, `.env.example`, CI, pruebas unitarias, de integración y E2E.

No incluido (fases posteriores): combate, mazmorras, objetos, árbol de habilidades jugable, grupos y tiempo real.

### Primer prototipo jugable (Fase 2)

Una sala de mazmorra en canvas 2D, un jugador, movimiento WASD/joystick táctil, ataque básico, esquiva con invulnerabilidad breve, 3 tipos de enemigo (perseguidor rápido, a distancia, bloqueador), XP validada en servidor, piso 5 con el primer jefe (2 fases, telegráficos) e inventario básico. La simulación se escribe ya en `src/game/simulation` como función pura `step(state, inputs, dt)`, para ejecutarla después dentro del Durable Object sin reescribirla.

---

## 8. Orden de implementación y criterios de aceptación

| Fase | Contenido | Se considera terminada cuando… |
| --- | --- | --- |
| **1. Fundación** | Ver sección 7 | `lint`, `typecheck`, pruebas unitarias, de integración y E2E en verde; `next build` correcto; `/api/health` devuelve `ok` con la BD de producción; registro → personaje → asignación → logout → login funciona en el despliegue |
| **2. Prototipo de combate** | Simulación pura por ticks, escenario, movimiento, ataque, 3 enemigos, muerte, XP, jefe piso 5, inventario v1 | Pruebas de la simulación (daño, mitigación, enfriamientos, muerte, derrota del jefe con una secuencia de entradas fija); la XP solo se concede desde el servidor; E2E que completa un piso |
| **3. Progresión** | Subida de nivel conectada, árbol de habilidades, 3+1 equipables, equipo y pociones persistentes | Pruebas de desbloqueo y mejora con tope, límite de 4 equipadas, enfriamiento nunca 0, restricciones de clase, inventario guardado y recuperado, pociones limitadas |
| **4. Multijugador** | Grupos, Durable Object, tickets, sincronización, escalado por jugadores, recompensas idempotentes, reconexión | Pruebas de entrada/salida de grupo, 2+ clientes viendo el mismo estado, reconexión con instantánea, acciones inválidas rechazadas, recompensa repetida sin duplicar |
| **5. Contenido** | 4 dificultades activas, más enemigos, jefe cada 5 pisos, botín con rarezas, eventos, balance | Cada jefe con al menos una estrategia ganadora probada por simulación; distribución de rarezas dentro de rangos; dificultad registrada y no modificable durante la expedición |
| **6. Calidad y despliegue** | Revisión de seguridad, rendimiento, documentación final | Flujo completo crear personaje → completar expedición en E2E contra el despliegue; checklist de seguridad cerrada |

Al cerrar cada fase: compila, las pruebas anteriores siguen en verde y no se elimina nada ya implementado.
