import { BALANCE } from "../balance";
import { BOSS_DEFINITIONS, type BossId } from "../bosses/definitions";
import { DIFFICULTIES, type DifficultyId } from "../difficulty/definitions";
import { ENEMY_DEFINITIONS, ENEMY_KIND_IDS, type EnemyKindId } from "../enemies/definitions";

export interface FloorXpInput {
  floor: number;
  difficulty: DifficultyId;
  /** Nivel del personaje al empezar el piso. */
  level: number;
  kills: Record<EnemyKindId, number>;
  boss: BossId | null;
  bossDefeated: boolean;
}

export interface FloorXpBreakdown {
  enemies: number;
  boss: number;
  clear: number;
  /** Factor por diferencia de nivel (1 = sin penalización). */
  levelFactor: number;
  total: number;
}

/** Factor de XP por diferencia de nivel: el contenido muy inferior a tu nivel apenas da experiencia. */
export function levelGapFactor(level: number, floor: number): number {
  const r = BALANCE.rewards;
  const over = level - (floor + r.levelGapGrace);
  if (over <= 0) return 1;
  return Math.max(r.minXpFactor, 1 - over * r.levelGapPenalty);
}

/**
 * XP de un piso completado. La calcula SOLO el servidor, a partir del resultado de volver a
 * ejecutar la simulación (enemigos derrotados y jefe), nunca a partir de datos del cliente.
 */
export function computeFloorXp(input: FloorXpInput): FloorXpBreakdown {
  const r = BALANCE.rewards;
  const depth = 1 + Math.max(0, input.floor - 1) * r.xpPerFloor;
  const diff = DIFFICULTIES[input.difficulty].xp;
  let enemies = 0;
  for (const kind of ENEMY_KIND_IDS) enemies += (input.kills[kind] ?? 0) * ENEMY_DEFINITIONS[kind].xp;
  enemies *= depth * diff;
  const boss = input.boss && input.bossDefeated ? BOSS_DEFINITIONS[input.boss].xp * diff : 0;
  const clear = r.floorClearXpPerFloor * input.floor * diff;
  const levelFactor = levelGapFactor(input.level, input.floor);
  const total = Math.max(0, Math.round((enemies + boss + clear) * levelFactor));
  return { enemies: Math.round(enemies), boss: Math.round(boss), clear: Math.round(clear), levelFactor, total };
}
