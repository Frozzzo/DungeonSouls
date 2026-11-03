import type { BossId } from "../bosses/definitions";
import type { EnemyKindId } from "../enemies/definitions";

/** Reglas de generación de un piso. Se derivan del número de piso; los jefes aparecen cada 5 pisos. */
export interface FloorRules {
  floor: number;
  /** Salas además de la inicial. */
  rooms: number;
  /** Enemigos por sala con enemigos [mín, máx]. */
  enemiesPerRoom: readonly [number, number];
  /** Pesos de aparición por tipo. */
  composition: Partial<Record<EnemyKindId, number>>;
  boss: BossId | null;
}

export const BOSS_EVERY = 5;

/** Piso más profundo disponible en la Fase 2 (el contenido infinito llega en la Fase 5). */
export const MAX_FLOOR = 5;

const BOSS_BY_FLOOR: Record<number, BossId> = { 5: "ASH_JAILER" };

export function isBossFloor(floor: number): boolean {
  return floor % BOSS_EVERY === 0;
}

export function floorRules(floor: number): FloorRules {
  if (isBossFloor(floor)) {
    return { floor, rooms: 1, enemiesPerRoom: [0, 0], composition: {}, boss: BOSS_BY_FLOOR[floor] ?? "ASH_JAILER" };
  }
  switch (floor) {
    case 1:
      return { floor, rooms: 3, enemiesPerRoom: [1, 2], composition: { STALKER: 3, ARCHER: 1 }, boss: null };
    case 2:
      return { floor, rooms: 4, enemiesPerRoom: [2, 2], composition: { STALKER: 3, ARCHER: 2, WARDEN: 1 }, boss: null };
    case 3:
      return { floor, rooms: 4, enemiesPerRoom: [2, 3], composition: { STALKER: 3, ARCHER: 2, WARDEN: 2 }, boss: null };
    default:
      return { floor, rooms: 5, enemiesPerRoom: [2, 3], composition: { STALKER: 3, ARCHER: 3, WARDEN: 2 }, boss: null };
  }
}

/** Escalado de los enemigos con la profundidad (vida y daño). */
export function floorScaling(floor: number): { health: number; damage: number } {
  const depth = Math.max(0, floor - 1);
  return { health: 1 + depth * 0.22, damage: 1 + depth * 0.12 };
}
