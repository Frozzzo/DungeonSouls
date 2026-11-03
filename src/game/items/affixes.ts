import type { AttributeKey } from "../types";

/** Afijos: bonificaciones aleatorias de los objetos. Se aplicarán a las estadísticas con el equipo (Fase 3). */
export const AFFIX_IDS = ["STRENGTH", "DEXTERITY", "INTELLIGENCE", "VITALITY", "ARMOR", "CRIT_CHANCE"] as const;
export type AffixId = (typeof AFFIX_IDS)[number];

export interface AffixDefinition {
  id: AffixId;
  name: string;
  /** Plantilla: {v} se sustituye por el valor. */
  format: string;
  /** Valor base [mín, máx] a nivel de objeto 1; se escala con nivel y rareza. */
  base: readonly [number, number];
  perItemLevel: number;
  /** Tope absoluto del valor (evita valores extremos). */
  max: number;
  attribute?: AttributeKey;
}

export const AFFIXES: Record<AffixId, AffixDefinition> = {
  STRENGTH: { id: "STRENGTH", name: "Fuerza", format: "+{v} Fuerza", base: [1, 3], perItemLevel: 0.5, max: 60, attribute: "strength" },
  DEXTERITY: { id: "DEXTERITY", name: "Destreza", format: "+{v} Destreza", base: [1, 3], perItemLevel: 0.5, max: 60, attribute: "dexterity" },
  INTELLIGENCE: { id: "INTELLIGENCE", name: "Inteligencia", format: "+{v} Inteligencia", base: [1, 3], perItemLevel: 0.5, max: 60, attribute: "intelligence" },
  VITALITY: { id: "VITALITY", name: "Vitalidad", format: "+{v} Vitalidad", base: [1, 3], perItemLevel: 0.5, max: 60, attribute: "vitality" },
  ARMOR: { id: "ARMOR", name: "Armadura", format: "+{v} Armadura", base: [2, 6], perItemLevel: 1, max: 120 },
  CRIT_CHANCE: { id: "CRIT_CHANCE", name: "Crítico", format: "+{v} % probabilidad de crítico", base: [1, 2], perItemLevel: 0.1, max: 10 },
};

export interface RolledAffix {
  id: AffixId;
  value: number;
}

export function formatAffix(a: RolledAffix): string {
  return AFFIXES[a.id].format.replace("{v}", String(a.value));
}
