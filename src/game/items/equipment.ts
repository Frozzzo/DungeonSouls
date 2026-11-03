import { addAttributes } from "../attributes";
import type { ClassId } from "../types";
import { ATTRIBUTE_KEYS, type Attributes, zeroAttributes } from "../types";
import { AFFIXES, type RolledAffix } from "./affixes";
import { type BaseItem, getBaseItem, type ItemCategory, type UniqueEffectId } from "./bases";
import { canClassUse, implicitValue } from "./loot";
import type { RarityId } from "./rarities";

/** Huecos de equipo del personaje. Los accesorios ocupan dos huecos. */
export const EQUIPMENT_SLOTS = ["WEAPON", "HELMET", "CHEST", "GLOVES", "LEGS", "BOOTS", "ACCESSORY_1", "ACCESSORY_2"] as const;
export type EquipmentSlotId = (typeof EQUIPMENT_SLOTS)[number];

/** Huecos válidos para cada categoría de objeto. */
export function slotsForCategory(category: ItemCategory): readonly EquipmentSlotId[] {
  return category === "ACCESSORY" ? ["ACCESSORY_1", "ACCESSORY_2"] : [category];
}

/** Bonificación total del equipo; se suma en computeCharacterStats. */
export interface GearBonus {
  attributes: Attributes;
  armor: number;
  /** Daño de arma plano (se suma al daño físico y mágico según el escalado de la clase). */
  weaponDamage: number;
  /** Probabilidad de crítico extra, en proporción (0.03 = +3 %). */
  critChance: number;
}

export const emptyGear = (): GearBonus => ({ attributes: zeroAttributes(), armor: 0, weaponDamage: 0, critChance: 0 });

/** Datos mínimos de un objeto concreto para calcular lo que aporta. */
export interface ItemStatsInput {
  baseItemId: string;
  rarity: RarityId;
  itemLevel: number;
  affixes: readonly RolledAffix[];
}

/** Lo que aporta un único objeto. */
export function itemBonus(item: ItemStatsInput): GearBonus {
  const out = emptyGear();
  const base = getBaseItem(item.baseItemId);
  if (!base) return out;
  const implicit = implicitValue(base, item.rarity, item.itemLevel);
  if (implicit !== null && base.implicit) {
    if (base.implicit.kind === "DAMAGE") out.weaponDamage += implicit;
    else out.armor += implicit;
  }
  for (const a of item.affixes) {
    const def = AFFIXES[a.id];
    if (!def) continue;
    if (def.attribute) out.attributes[def.attribute] += a.value;
    else if (a.id === "ARMOR") out.armor += a.value;
    else if (a.id === "CRIT_CHANCE") out.critChance += a.value / 100;
  }
  return out;
}

export function sumGear(parts: readonly GearBonus[]): GearBonus {
  const out = emptyGear();
  for (const p of parts) {
    out.attributes = addAttributes(out.attributes, p.attributes);
    out.armor += p.armor;
    out.weaponDamage += p.weaponDamage;
    out.critChance = Math.round((out.critChance + p.critChance) * 10000) / 10000;
  }
  return out;
}

/** Bonificación de un conjunto de objetos equipados. */
export function gearBonus(items: readonly ItemStatsInput[]): GearBonus {
  return sumGear(items.map(itemBonus));
}

/** Efectos únicos activos del equipo (sin repetir). */
export function gearUniqueEffects(items: readonly ItemStatsInput[]): UniqueEffectId[] {
  const out = new Set<UniqueEffectId>();
  for (const i of items) {
    const effect = getBaseItem(i.baseItemId)?.uniqueEffectId;
    if (effect) out.add(effect);
  }
  return [...out].sort();
}

export type EquipError = "UNKNOWN_ITEM" | "WRONG_CLASS" | "LEVEL_TOO_LOW" | "WRONG_SLOT";

/** ¿Puede el personaje equipar este objeto en este hueco? (reglas compartidas por cliente y servidor) */
export function checkEquipItem(input: { classId: ClassId; level: number }, base: BaseItem | undefined, slot: EquipmentSlotId): { ok: true } | { ok: false; error: EquipError } {
  if (!base) return { ok: false, error: "UNKNOWN_ITEM" };
  if (!slotsForCategory(base.category).includes(slot)) return { ok: false, error: "WRONG_SLOT" };
  if (!canClassUse(input.classId, base)) return { ok: false, error: "WRONG_CLASS" };
  if (input.level < base.requiredLevel) return { ok: false, error: "LEVEL_TOO_LOW" };
  return { ok: true };
}

export function describeEquipError(error: EquipError): string {
  switch (error) {
    case "UNKNOWN_ITEM":
      return "Ese objeto ya no existe.";
    case "WRONG_CLASS":
      return "Tu clase no puede usar ese objeto.";
    case "LEVEL_TOO_LOW":
      return "Tu nivel es demasiado bajo para ese objeto.";
    case "WRONG_SLOT":
      return "Ese objeto no va en ese hueco.";
  }
}

/** Atributos de una bonificación, para mostrarlos en la interfaz. */
export function gearAttributeTotal(g: GearBonus): number {
  return ATTRIBUTE_KEYS.reduce((acc, k) => acc + g.attributes[k], 0);
}
