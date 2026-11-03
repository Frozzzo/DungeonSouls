# DungeonSouls

RPG de mazmorras **cooperativo online** para navegador: progresión tipo ARPG (niveles, atributos, habilidades, botín) y combate exigente de inspiración soulslike. Construido con Next.js, TypeScript, Tailwind, Prisma y PostgreSQL, desplegable en Vercel.

## Estado

**Fase 1 (fundación) completada:** cuentas con sesiones seguras, tres clases (Guardián, Segador, Oráculo), creación y gestión de personajes, sistema de estadísticas con fórmulas centralizadas y asignación de puntos con vista previa.

**Fase 2 (prototipo de combate) completada:** combate de acción en canvas (teclado/ratón y táctil) sobre una simulación determinista por ticks; pisos generados con semilla; tres enemigos con comportamientos distintos; Varkhul, el primer jefe (piso 5, dos fases y telegráficos); XP y botín concedidos solo por el servidor tras **repetir la partida** a partir de las intenciones del jugador; inventario v1 con 6 rarezas y filtros.

Siguiente: **Fase 3, progresión.** Hoja de ruta completa en [docs/arquitectura.md](docs/arquitectura.md#8-orden-de-implementación-y-criterios-de-aceptación).

## Empezar

```bash
npm install
cp .env.example .env      # configura DATABASE_URL
npm run db:migrate
npm run dev
```

Más detalle, pruebas y despliegue en Vercel: [docs/despliegue.md](docs/despliegue.md).

## Documentación

- [Arquitectura y plan](docs/arquitectura.md): análisis de requisitos, capas, carpetas, multijugador, servicios y costes, alcance y fases.
- [Modelo de datos](docs/modelo-datos.md)
- [Desarrollo local y despliegue](docs/despliegue.md)

## Dónde está cada cosa

| Qué | Dónde |
| --- | --- |
| Parámetros de balance | `src/game/balance.ts` |
| Clases | `src/game/classes/definitions.ts` |
| Fórmulas de estadísticas | `src/game/stats/compute.ts` |
| Curva de experiencia | `src/game/progression/experience.ts` |
| Dificultades | `src/game/difficulty/definitions.ts` |
| Simulación de combate (`step`, repetición) | `src/game/simulation/` |
| Enemigos y jefes | `src/game/enemies/`, `src/game/bosses/` |
| Generación de pisos | `src/game/dungeon/` |
| Objetos, rarezas y botín | `src/game/items/` |
| Validación de pisos y recompensas | `src/server/dungeon/service.ts` |
| Pantalla de combate (canvas) | `src/components/game/` |
| Servicios (solo servidor) | `src/server/**` |
| Nombre del juego | `src/config/site.ts` |
