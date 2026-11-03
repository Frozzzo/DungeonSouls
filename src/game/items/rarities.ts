/** Rarezas de los objetos. Afectan a la probabilidad, al número de afijos y a su potencia. */
export const RARITY_IDS = ["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"] as const;
export type RarityId = (typeof RARITY_IDS)[number];

export interface RarityDefinition {
  id: RarityId;
  name: string;
  /** Peso base de aparición. */
  weight: number;
  /** ¿Se multiplica su peso por la bonificación de botín raro de la dificultad? */
  boostedByDifficulty: boolean;
  affixes: number;
  /** Multiplicador de los valores de afijos e implícitos. */
  power: number;
  color: string;
}

export const RARITIES: Record<RarityId, RarityDefinition> = {
  COMMON: { id: "COMMON", name: "Común", weight: 600, boostedByDifficulty: false, affixes: 0, power: 1, color: "#c8bea8" },
  UNCOMMON: { id: "UNCOMMON", name: "Poco común", weight: 260, boostedByDifficulty: false, affixes: 1, power: 1.1, color: "#5fbf5f" },
  RARE: { id: "RARE", name: "Raro", weight: 100, boostedByDifficulty: true, affixes: 2, power: 1.2, color: "#4f8fd9" },
  EPIC: { id: "EPIC", name: "Épico", weight: 32, boostedByDifficulty: true, affixes: 3, power: 1.35, color: "#a35fd9" },
  LEGENDARY: { id: "LEGENDARY", name: "Legendario", weight: 7, boostedByDifficulty: true, affixes: 4, power: 1.5, color: "#e08a2b" },
  MYTHIC: { id: "MYTHIC", name: "Mítico", weight: 1, boostedByDifficulty: true, affixes: 4, power: 1.7, color: "#e0443a" },
};

export const rarityRank = (id: RarityId) => RARITY_IDS.indexOf(id);
