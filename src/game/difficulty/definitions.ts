/**
 * Configuración inicial de dificultades. Se usará a partir de la fase 2 (combate) y se
 * balanceará en la fase 5. Se define ya para que la partida pueda registrar su dificultad.
 *
 * La dificultad no es solo vida: también cambia agresividad, telegráficos y composición.
 */
export const DIFFICULTY_IDS = ["NORMAL", "HARD", "NIGHTMARE", "ABYSS"] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

export interface DifficultyDefinition {
  id: DifficultyId;
  name: string;
  description: string;
  enemyHealth: number;
  enemyDamage: number;
  /** Multiplica la frecuencia de ataques (menos tiempo entre acciones). */
  enemyAggression: number;
  /** Multiplica la duración de los telegráficos (menor = menos tiempo de reacción). */
  telegraphTime: number;
  /** Enemigos adicionales por grupo y probabilidad de élites. */
  extraEnemiesPerPack: number;
  eliteChance: number;
  bossHealth: number;
  bossDamage: number;
  /** Fases adicionales o mecánicas extra que los jefes desbloquean. */
  bossExtraMechanics: boolean;
  lootQuantity: number;
  rareLootChance: number;
  xp: number;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyDefinition> = {
  NORMAL: {
    id: "NORMAL",
    name: "Normal",
    description: "Aprende los controles y los patrones.",
    enemyHealth: 1,
    enemyDamage: 1,
    enemyAggression: 1,
    telegraphTime: 1,
    extraEnemiesPerPack: 0,
    eliteChance: 0.05,
    bossHealth: 1,
    bossDamage: 1,
    bossExtraMechanics: false,
    lootQuantity: 1,
    rareLootChance: 1,
    xp: 1,
  },
  HARD: {
    id: "HARD",
    name: "Difícil",
    description: "Enemigos más resistentes y agresivos.",
    enemyHealth: 1.4,
    enemyDamage: 1.3,
    enemyAggression: 1.2,
    telegraphTime: 0.9,
    extraEnemiesPerPack: 1,
    eliteChance: 0.1,
    bossHealth: 1.5,
    bossDamage: 1.3,
    bossExtraMechanics: false,
    lootQuantity: 1.15,
    rareLootChance: 1.3,
    xp: 1.25,
  },
  NIGHTMARE: {
    id: "NIGHTMARE",
    name: "Pesadilla",
    description: "Más presión, errores más costosos y jefes más complejos.",
    enemyHealth: 1.9,
    enemyDamage: 1.65,
    enemyAggression: 1.4,
    telegraphTime: 0.8,
    extraEnemiesPerPack: 2,
    eliteChance: 0.18,
    bossHealth: 2.2,
    bossDamage: 1.7,
    bossExtraMechanics: true,
    lootQuantity: 1.3,
    rareLootChance: 1.7,
    xp: 1.6,
  },
  ABYSS: {
    id: "ABYSS",
    name: "Abismo",
    description: "Dificultad extrema para quien domina las mecánicas.",
    enemyHealth: 2.6,
    enemyDamage: 2.1,
    enemyAggression: 1.6,
    telegraphTime: 0.7,
    extraEnemiesPerPack: 3,
    eliteChance: 0.28,
    bossHealth: 3.2,
    bossDamage: 2.2,
    bossExtraMechanics: true,
    lootQuantity: 1.5,
    rareLootChance: 2.2,
    xp: 2,
  },
};
