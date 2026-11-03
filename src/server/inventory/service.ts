import "server-only";
import type { Character, ItemInstance } from "@/generated/prisma/client";
import { CONSUMABLES, dismantleYield, MATERIALS } from "@/game/items/consumables";
import { checkEquipItem, EQUIPMENT_SLOTS, type EquipmentSlotId, slotsForCategory } from "@/game/items/equipment";
import { computeCharacterStats } from "@/game/stats/compute";
import type { DerivedStats } from "@/game/types";
import { allocatedFrom, gearFrom, itemStatsFrom } from "@/server/characters/service";
import { formatAffix } from "@/game/items/affixes";
import { getBaseItem, ITEM_CATEGORIES, type ItemCategory } from "@/game/items/bases";
import { canClassUse, implicitValue } from "@/game/items/loot";
import { RARITIES, type RarityId, rarityRank } from "@/game/items/rarities";
import type { ClassId } from "@/game/types";
import { affixesSchema } from "@/lib/validation/items";
import { db } from "@/server/db";
import { DomainError, logServerError } from "@/server/errors";

/** Vista de un objeto para la interfaz: definición base + valores concretos de la instancia. */
export interface ItemView {
  id: string;
  baseItemId: string;
  name: string;
  description: string;
  category: ItemCategory;
  rarity: RarityId;
  rarityName: string;
  rarityColor: string;
  itemLevel: number;
  requiredLevel: number;
  implicit: string | null;
  affixes: string[];
  uniqueEffect: string | null;
  usableByClass: boolean;
  obtainedAt: Date;
  /** Hueco en el que está equipado (null si está en la mochila). */
  equippedSlot: EquipmentSlotId | null;
  /** Polvo abisal que daría al desmontarlo. */
  dismantleValue: number;
}

/** Diferencia de estadísticas si se equipa el objeto (calculada en el servidor con las fórmulas únicas). */
export interface ItemComparison {
  slot: EquipmentSlotId;
  /** Nombre del objeto que sustituiría (null si el hueco está vacío). */
  replaces: string | null;
  /** Solo las estadísticas que cambian: [antes, después]. */
  changes: Partial<Record<keyof DerivedStats, [number, number]>>;
  /** Motivo por el que no se puede equipar (null si se puede). */
  blocker: string | null;
}

export interface InventoryItemView extends ItemView {
  comparison: ItemComparison | null;
}

export interface EquipmentSlotView {
  slot: EquipmentSlotId;
  item: ItemView | null;
}

export interface InventoryOverview {
  items: InventoryItemView[];
  total: number;
  equipment: EquipmentSlotView[];
  potions: { quantity: number; max: number; perRun: number };
  materials: { id: string; name: string; quantity: number }[];
  craft: { cost: number; materialName: string; canCraft: boolean };
}

export function toItemView(row: ItemInstance, classId: ClassId, equippedSlot: EquipmentSlotId | null = null): ItemView | null {
  const base = getBaseItem(row.baseItemId);
  if (!base) {
    // Un objeto cuya definición ya no existe no se muestra (y se registra para revisarlo).
    logServerError("inventory", new Error(`Objeto ${row.id} con base desconocida ${row.baseItemId}`));
    return null;
  }
  const parsed = affixesSchema.safeParse(row.affixes);
  const affixes = parsed.success ? parsed.data : [];
  if (!parsed.success) logServerError("inventory", new Error(`Afijos no válidos en el objeto ${row.id}`));
  const rarity = RARITIES[row.rarity];
  const implicit = implicitValue(base, row.rarity, row.itemLevel);
  return {
    id: row.id,
    baseItemId: base.id,
    name: base.name,
    description: base.description,
    category: base.category,
    rarity: row.rarity,
    rarityName: rarity.name,
    rarityColor: rarity.color,
    itemLevel: row.itemLevel,
    requiredLevel: base.requiredLevel,
    implicit: implicit === null || !base.implicit ? null : base.implicit.kind === "DAMAGE" ? `${implicit} daño de arma` : `${implicit} armadura`,
    affixes: affixes.map(formatAffix),
    uniqueEffect: base.uniqueEffect ?? null,
    usableByClass: canClassUse(classId, base),
    obtainedAt: row.createdAt,
    equippedSlot,
    dismantleValue: dismantleYield(row.rarity, row.itemLevel),
  };
}

export type InventorySort = "recent" | "rarity";

export interface InventoryFilter {
  category?: ItemCategory;
  minRarity?: RarityId;
  sort?: InventorySort;
}

export const isItemCategory = (v: unknown): v is ItemCategory => typeof v === "string" && (ITEM_CATEGORIES as readonly string[]).includes(v);

/** Hueco que ocuparía el objeto al equiparlo sin elegir (el mismo que usa el servicio de equipo). */
function targetSlot(category: ItemCategory, equipped: Map<EquipmentSlotId, ItemInstance>): EquipmentSlotId {
  const options = slotsForCategory(category);
  return options.find((o) => !equipped.has(o)) ?? options[0];
}

function compare(character: Character, row: ItemInstance, equipped: Map<EquipmentSlotId, ItemInstance>): ItemComparison | null {
  const base = getBaseItem(row.baseItemId);
  if (!base) return null;
  const slot = targetSlot(base.category, equipped);
  const check = checkEquipItem({ classId: character.class, level: character.level }, base, slot);
  const current = [...equipped.values()];
  const replaced = equipped.get(slot) ?? null;
  const swapped = [...current.filter((i) => i !== replaced), row];
  const allocated = allocatedFrom(character);
  const before = computeCharacterStats({ classId: character.class, level: character.level, allocated, gear: gearFrom(current.map(itemStatsFrom)).bonus }).derived;
  const after = computeCharacterStats({ classId: character.class, level: character.level, allocated, gear: gearFrom(swapped.map(itemStatsFrom)).bonus }).derived;
  const changes: ItemComparison["changes"] = {};
  for (const key of Object.keys(before) as (keyof DerivedStats)[]) {
    if (before[key] !== after[key]) changes[key] = [before[key], after[key]];
  }
  return {
    slot,
    replaces: replaced ? (getBaseItem(replaced.baseItemId)?.name ?? null) : null,
    changes,
    blocker: check.ok ? null : check.error === "WRONG_CLASS" ? "Tu clase no puede usarlo" : check.error === "LEVEL_TOO_LOW" ? `Requiere nivel ${base.requiredLevel}` : "No se puede equipar",
  };
}

/**
 * Inventario de un personaje propio: objetos con filtros por categoría y rareza mínima, la
 * comparación con lo equipado, el equipo puesto, pociones y materiales.
 */
export async function listInventory(userId: string, characterId: string, filter: InventoryFilter = {}): Promise<InventoryOverview> {
  const character = await db.character.findFirst({ where: { id: characterId, userId } });
  if (!character) throw new DomainError("NOT_FOUND", "Personaje no encontrado.");
  const [rows, slots, consumables, materials] = await Promise.all([
    db.itemInstance.findMany({ where: { characterId }, orderBy: { createdAt: "desc" } }),
    db.equipmentSlot.findMany({ where: { characterId } }),
    db.consumableStack.findMany({ where: { characterId } }),
    db.materialStack.findMany({ where: { characterId } }),
  ]);
  const slotOf = new Map(slots.map((s) => [s.itemInstanceId, s.slot]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const equipped = new Map<EquipmentSlotId, ItemInstance>();
  for (const s of slots) {
    const row = byId.get(s.itemInstanceId);
    if (row) equipped.set(s.slot, row);
  }

  const all: InventoryItemView[] = [];
  for (const r of rows) {
    const view = toItemView(r, character.class, slotOf.get(r.id) ?? null);
    if (!view) continue;
    all.push({ ...view, comparison: view.equippedSlot ? null : compare(character, r, equipped) });
  }
  let items = all;
  if (filter.category) items = items.filter((i) => i.category === filter.category);
  if (filter.minRarity) {
    const min = rarityRank(filter.minRarity);
    items = items.filter((i) => rarityRank(i.rarity) >= min);
  }
  if (filter.sort === "rarity") items = [...items].sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || b.obtainedAt.getTime() - a.obtainedAt.getTime());

  const potion = CONSUMABLES.HEALTH_POTION;
  const potions = consumables.find((c) => c.consumableId === potion.id)?.quantity ?? 0;
  const dust = materials.find((m) => m.materialId === potion.craftCost.materialId)?.quantity ?? 0;
  return {
    items,
    total: all.length,
    equipment: EQUIPMENT_SLOTS.map((slot) => ({ slot, item: all.find((i) => i.equippedSlot === slot) ?? null })),
    potions: { quantity: potions, max: potion.maxStack, perRun: potion.perRun },
    materials: Object.values(MATERIALS).map((m) => ({ id: m.id, name: m.name, quantity: materials.find((x) => x.materialId === m.id)?.quantity ?? 0 })),
    craft: { cost: potion.craftCost.quantity, materialName: MATERIALS[potion.craftCost.materialId].name, canCraft: dust >= potion.craftCost.quantity && potions < potion.maxStack },
  };
}

/** Pociones que tiene un personaje propio (0 si no es suyo o no tiene). */
export async function getPotionCount(userId: string, characterId: string): Promise<number> {
  const stack = await db.consumableStack.findFirst({
    where: { characterId, consumableId: CONSUMABLES.HEALTH_POTION.id, character: { userId } },
    select: { quantity: true },
  });
  return stack?.quantity ?? 0;
}
