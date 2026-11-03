import "server-only";
import type { ItemInstance } from "@/generated/prisma/client";
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
}

export function toItemView(row: ItemInstance, classId: ClassId): ItemView | null {
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
  };
}

export type InventorySort = "recent" | "rarity";

export interface InventoryFilter {
  category?: ItemCategory;
  minRarity?: RarityId;
  sort?: InventorySort;
}

export const isItemCategory = (v: unknown): v is ItemCategory => typeof v === "string" && (ITEM_CATEGORIES as readonly string[]).includes(v);

/** Inventario de un personaje propio, con filtros por categoría y rareza mínima. */
export async function listInventory(userId: string, characterId: string, filter: InventoryFilter = {}): Promise<{ items: ItemView[]; total: number }> {
  const character = await db.character.findFirst({ where: { id: characterId, userId }, select: { class: true } });
  if (!character) throw new DomainError("NOT_FOUND", "Personaje no encontrado.");
  const rows = await db.itemInstance.findMany({ where: { characterId }, orderBy: { createdAt: "desc" } });
  const all = rows.map((r) => toItemView(r, character.class)).filter((v): v is ItemView => v !== null);
  let items = all;
  if (filter.category) items = items.filter((i) => i.category === filter.category);
  if (filter.minRarity) {
    const min = rarityRank(filter.minRarity);
    items = items.filter((i) => rarityRank(i.rarity) >= min);
  }
  if (filter.sort === "rarity") items = [...items].sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || b.obtainedAt.getTime() - a.obtainedAt.getTime());
  return { items, total: all.length };
}
