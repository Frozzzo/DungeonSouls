import { BALANCE } from "../balance";
import type { RarityId } from "./rarities";

/**
 * Consumibles y materiales (Fase 3).
 *
 * Las pociones son limitadas: el personaje guarda un número con tope, entra en cada piso con
 * como mucho `perRun` y la simulación controla su enfriamiento. Las usadas se descuentan en el
 * servidor a partir de la repetición de la partida, nunca de lo que diga el cliente.
 */
export const CONSUMABLE_IDS = ["HEALTH_POTION"] as const;
export type ConsumableId = (typeof CONSUMABLE_IDS)[number];

export interface ConsumableDefinition {
  id: ConsumableId;
  name: string;
  description: string;
  /** Máximo que puede guardar un personaje. */
  maxStack: number;
  /** Máximo que se lleva a un piso. */
  perRun: number;
  /** Proporción de la vida máxima que restaura. */
  healRatio: number;
  /** Enfriamiento entre usos (s); siempre > 0. */
  cooldown: number;
  /** Materiales para fabricar una. */
  craftCost: { materialId: MaterialId; quantity: number };
}

export const MATERIAL_IDS = ["ABYSSAL_DUST"] as const;
export type MaterialId = (typeof MATERIAL_IDS)[number];

export interface MaterialDefinition {
  id: MaterialId;
  name: string;
  description: string;
  maxStack: number;
}

export const MATERIALS: Record<MaterialId, MaterialDefinition> = {
  ABYSSAL_DUST: {
    id: "ABYSSAL_DUST",
    name: "Polvo abisal",
    description: "Lo que queda de un objeto desmontado. Sirve para fabricar pociones.",
    maxStack: 9999,
  },
};

export const CONSUMABLES: Record<ConsumableId, ConsumableDefinition> = {
  HEALTH_POTION: {
    id: "HEALTH_POTION",
    name: "Poción de vida",
    description: "Restaura el 40 % de tu vida máxima. Solo llevas unas pocas a cada piso: úsalas bien.",
    maxStack: BALANCE.consumables.potionMaxStack,
    perRun: BALANCE.consumables.potionsPerRun,
    healRatio: 0.4,
    cooldown: 10,
    craftCost: { materialId: "ABYSSAL_DUST", quantity: BALANCE.consumables.potionCraftCost },
  },
};

/** Pociones que el personaje se lleva a un piso. */
export function potionsForRun(owned: number): number {
  return Math.max(0, Math.min(CONSUMABLES.HEALTH_POTION.perRun, Math.floor(owned)));
}

/** Polvo abisal que da desmontar un objeto, según su rareza y nivel. */
export function dismantleYield(rarity: RarityId, itemLevel: number): number {
  const base = BALANCE.consumables.dismantleYield[rarity];
  return Math.max(1, Math.round(base * (1 + (Math.max(1, itemLevel) - 1) * 0.1)));
}

/** Pociones encontradas al completar un piso. */
export function potionsFoundOnFloor(boss: boolean): number {
  return BALANCE.consumables.potionsPerFloorClear + (boss ? BALANCE.consumables.bonusBossPotions : 0);
}
