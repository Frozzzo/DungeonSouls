/** Tipos compartidos del núcleo del juego. Este módulo no depende de React ni de la base de datos. */

export const CLASS_IDS = ["TANK", "DPS", "HEALER"] as const;
export type ClassId = (typeof CLASS_IDS)[number];

export const ATTRIBUTE_KEYS = ["strength", "dexterity", "intelligence", "vitality"] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

/** Estadísticas principales (Fuerza, Destreza, Inteligencia, Vitalidad). */
export type Attributes = Record<AttributeKey, number>;

export type ResourceKind = "RAGE" | "ENERGY" | "MANA";

/** Estadísticas derivadas, calculadas siempre a partir de las principales. */
export interface DerivedStats {
  maxHealth: number;
  maxResource: number;
  physicalDamage: number;
  magicDamage: number;
  armor: number;
  /** Proporción 0..1 */
  critChance: number;
  /** Multiplicador aplicado al golpe crítico, p. ej. 1.5 */
  critMultiplier: number;
  /** Unidades de mundo por segundo */
  moveSpeed: number;
  /** Multiplicador de curación realizada, p. ej. 1.2 */
  healingPower: number;
  /** Proporción 0..1 de daño mitigado */
  damageReduction: number;
}

export const zeroAttributes = (): Attributes => ({
  strength: 0,
  dexterity: 0,
  intelligence: 0,
  vitality: 0,
});
