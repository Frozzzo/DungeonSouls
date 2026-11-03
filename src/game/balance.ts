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
    /** Puntos de habilidad al crear un personaje (además de la habilidad inicial de su clase). */
    startingSkillPoints: 1,
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

  simulation: {
    /** Ticks por segundo de la simulación (paso fijo: el cliente y el servidor avanzan igual). */
    tickRate: 20,
    /** Duración máxima de un piso (s). Pasado este tiempo la partida termina en derrota. */
    maxDurationSeconds: 20 * 60,
  },

  combat: {
    /** Variación aleatoria del daño saliente (±). */
    variance: 0.1,
    /** Mitigación total máxima sumando armadura, bloqueos y estados. */
    maxTotalMitigation: 0.85,
    /** Velocidad de movimiento mientras se ataca (fracción). */
    moveWhileAttacking: 0.35,
    dodge: { speed: 12, duration: 0.25, invulnerability: 0.3, cooldown: 0.85, inputBuffer: 0.2 },
    /** Radio de los personajes jugadores (casillas). */
    playerRadius: 0.38,
    /** Distancia al portal para completar el piso. */
    portalRadius: 0.9,
  },

  rewards: {
    /** XP extra por completar un piso = floorClearXpPerFloor × piso. */
    floorClearXpPerFloor: 20,
    /** Escalado de la XP de los enemigos con la profundidad. */
    xpPerFloor: 0.15,
    /**
     * Penalización por nivel: por encima de (piso + levelGapGrace) cada nivel resta levelGapPenalty
     * a la XP, hasta un mínimo de minXpFactor. Evita que el contenido inicial sea trivial y rentable.
     */
    levelGapGrace: 2,
    levelGapPenalty: 0.15,
    minXpFactor: 0.25,
    /** Objetos por piso completado [mín, máx]; los jefes dan bonusBossItems más. */
    itemsPerFloor: [1, 2] as const,
    bonusBossItems: 1,
    /** Capacidad del inventario. Si está lleno, el botín sobrante se pierde (se avisa). */
    inventoryCapacity: 60,
  },

  consumables: {
    potionMaxStack: 5,
    potionsPerRun: 3,
    startingPotions: 3,
    potionCraftCost: 12,
    potionsPerFloorClear: 1,
    bonusBossPotions: 1,
    /** Polvo abisal al desmontar, por rareza (a nivel de objeto 1). */
    dismantleYield: { COMMON: 2, UNCOMMON: 4, RARE: 8, EPIC: 15, LEGENDARY: 30, MYTHIC: 60 },
  },

  characters: {
    maxPerUser: 6,
    nameMinLength: 3,
    nameMaxLength: 16,
  },
} as const;

export type Balance = typeof BALANCE;
