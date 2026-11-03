# DungeonSouls

RPG de mazmorras **cooperativo online** para navegador: progresión tipo ARPG (niveles, atributos, habilidades, botín) y combate exigente de inspiración soulslike. Construido con Next.js, TypeScript, Tailwind, Prisma y PostgreSQL, desplegable en Vercel.

## Estado

**Fase 1 (fundación) completada:** cuentas con sesiones seguras, tres clases (Guardián, Segador, Oráculo), creación y gestión de personajes, sistema de estadísticas con fórmulas centralizadas y asignación de puntos con vista previa.

Siguiente: **Fase 2, prototipo de combate.** Hoja de ruta completa en [docs/arquitectura.md](docs/arquitectura.md#8-orden-de-implementación-y-criterios-de-aceptación).

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
| Servicios (solo servidor) | `src/server/**` |
| Nombre del juego | `src/config/site.ts` |
