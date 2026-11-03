/**
 * Parámetros de balance centralizados.
 *
 * Todo número que afecte al equilibrio del juego vive aquí para poder ajustarlo
 * sin tocar la lógica. El cliente y el servidor importan este mismo módulo, de
 * modo que nunca calculan resultados contradictorios.
 */
export const BALANCE = {
  progression: {
    maxLevel: 60,
    /** XP necesaria para pasar del nivel N al N+1 = round(base * N^exponent) */
    xpCurve: { base: 100, exponent: 1.6 },
    /** Puntos de atributo libres al crear un personaje. */
    startingStatPoints: 5,
    statPointsPerLevel: 3,
    skillPointsPerLevel: 1,
  },

  attributes: {
    /** Máximo de puntos asignados manualmente a un mismo atributo. */
    maxAllocatedPerAttribute: 250,
    /** Máximo total de un atributo (base + crecimiento + asignado + equipo). */
    maxTotalPerAttribute: 600,
  },

  derived: {
    health: { base: 80, perVitality: 12, perLevel: 6 },
    physicalDamage: { base: 4, perStrength: 1.2, perDexterity: 0.4 },
    magicDamage: { base: 2, perIntelligence: 1.3 },
    armor: { perStrength: 0.6, perVitality: 0.4, perLevel: 1 },
    /** Reducción = armor / (armor + constant + level * perLevel), con techo. */
    damageReduction: { constant: 120, perLevel: 12, cap: 0.75 },
    crit: {
      baseChance: 0.05,
      chancePerDexterity: 0.0015,
      chanceCap: 0.5,
      baseMultiplier: 1.5,
      multiplierPerDexterity: 0.004,
      multiplierCap: 3,
    },
    moveSpeed: { perDexterity: 0.0015, maxBonus: 0.25 },
    healingPower: { base: 1, perIntelligence: 0.012, cap: 3 },
  },

  characters: {
    maxPerUser: 6,
    nameMinLength: 3,
    nameMaxLength: 16,
  },
} as const;

export type Balance = typeof BALANCE;
