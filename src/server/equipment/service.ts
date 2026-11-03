import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getBaseItem } from "@/game/items/bases";
import { CONSUMABLES, dismantleYield, MATERIALS } from "@/game/items/consumables";
import { checkEquipItem, describeEquipError, type EquipmentSlotId, slotsForCategory } from "@/game/items/equipment";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { withSerializableRetry } from "@/server/transactions";

const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

function mapConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034" || error.code === "P2002") throw new DomainError("CONFLICT", "El inventario cambió mientras tanto. Vuelve a intentarlo.");
    // Clave foránea: se intentó borrar un objeto que otra petición acababa de equipar.
    if (error.code === "P2003") throw new DomainError("ITEM_EQUIPPED", "Quítate el objeto antes de desmontarlo.");
  }
  throw error;
}

async function run<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await withSerializableRetry(() => db.$transaction(fn, serializable));
  } catch (error) {
    return mapConflict(error);
  }
}

async function ownedCharacter(tx: Prisma.TransactionClient, userId: string, characterId: string) {
  const character = await tx.character.findFirst({ where: { id: characterId, userId }, select: { id: true, class: true, level: true } });
  if (!character) throw new DomainError("NOT_FOUND", "Personaje no encontrado.");
  return character;
}

/**
 * Equipa un objeto propio. Comprueba clase, nivel y hueco con las reglas compartidas; si el hueco
 * estaba ocupado, el objeto anterior vuelve al inventario. Un intento ya empezado no cambia.
 */
export async function equipItem(userId: string, input: { characterId: string; itemId: string; slot?: EquipmentSlotId }): Promise<{ slot: EquipmentSlotId }> {
  return run(async (tx) => {
    const character = await ownedCharacter(tx, userId, input.characterId);
    const item = await tx.itemInstance.findFirst({ where: { id: input.itemId, characterId: character.id }, include: { equippedIn: true } });
    if (!item) throw new DomainError("NOT_FOUND", "Objeto no encontrado.");
    const base = getBaseItem(item.baseItemId);
    if (!base) throw new DomainError("UNKNOWN_ITEM", describeEquipError("UNKNOWN_ITEM"));

    let slot = input.slot;
    if (!slot) {
      const options = slotsForCategory(base.category);
      if (item.equippedIn && options.includes(item.equippedIn.slot)) return { slot: item.equippedIn.slot };
      const taken = await tx.equipmentSlot.findMany({ where: { characterId: character.id, slot: { in: [...options] } }, select: { slot: true } });
      slot = options.find((o) => !taken.some((t) => t.slot === o)) ?? options[0];
    }
    const check = checkEquipItem({ classId: character.class, level: character.level }, base, slot);
    if (!check.ok) throw new DomainError(check.error, describeEquipError(check.error));

    await tx.equipmentSlot.deleteMany({ where: { characterId: character.id, OR: [{ slot }, { itemInstanceId: item.id }] } });
    await tx.equipmentSlot.create({ data: { characterId: character.id, slot, itemInstanceId: item.id } });
    return { slot };
  });
}

export async function unequipItem(userId: string, input: { characterId: string; slot: EquipmentSlotId }): Promise<void> {
  await run(async (tx) => {
    const character = await ownedCharacter(tx, userId, input.characterId);
    await tx.equipmentSlot.deleteMany({ where: { characterId: character.id, slot: input.slot } });
  });
}

/**
 * Desmonta un objeto: lo borra y suma Polvo abisal en la misma transacción. Un objeto equipado no
 * se puede desmontar (lo impiden el servicio y la clave foránea de la base de datos).
 */
export async function dismantleItem(userId: string, input: { characterId: string; itemId: string }): Promise<{ materialId: string; gained: number; total: number }> {
  return run(async (tx) => {
    const character = await ownedCharacter(tx, userId, input.characterId);
    const item = await tx.itemInstance.findFirst({ where: { id: input.itemId, characterId: character.id }, include: { equippedIn: true } });
    if (!item) throw new DomainError("NOT_FOUND", "Objeto no encontrado.");
    if (item.equippedIn) throw new DomainError("ITEM_EQUIPPED", "Quítate el objeto antes de desmontarlo.");

    const deleted = await tx.itemInstance.deleteMany({ where: { id: item.id, characterId: character.id } });
    if (deleted.count !== 1) throw new DomainError("NOT_FOUND", "Objeto no encontrado.");

    const gained = dismantleYield(item.rarity, item.itemLevel);
    const material = MATERIALS.ABYSSAL_DUST;
    const stack = await tx.materialStack.upsert({
      where: { characterId_materialId: { characterId: character.id, materialId: material.id } },
      create: { characterId: character.id, materialId: material.id, quantity: Math.min(material.maxStack, gained) },
      update: { quantity: { increment: gained } },
    });
    if (stack.quantity > material.maxStack) await tx.materialStack.update({ where: { id: stack.id }, data: { quantity: material.maxStack } });
    return { materialId: material.id, gained, total: Math.min(material.maxStack, stack.quantity) };
  });
}

/** Fabrica una poción con materiales. Ambas escrituras son condicionales: nunca se pasa del tope ni se gasta lo que no hay. */
export async function craftPotion(userId: string, input: { characterId: string }): Promise<{ potions: number }> {
  return run(async (tx) => {
    const character = await ownedCharacter(tx, userId, input.characterId);
    const potion = CONSUMABLES.HEALTH_POTION;
    const key = { characterId_consumableId: { characterId: character.id, consumableId: potion.id } };
    await tx.consumableStack.upsert({ where: key, create: { characterId: character.id, consumableId: potion.id, quantity: 0 }, update: {} });
    const added = await tx.consumableStack.updateMany({
      where: { characterId: character.id, consumableId: potion.id, quantity: { lt: potion.maxStack } },
      data: { quantity: { increment: 1 } },
    });
    if (added.count !== 1) throw new DomainError("POTIONS_FULL", `Ya llevas el máximo de ${potion.maxStack} pociones.`);
    const paid = await tx.materialStack.updateMany({
      where: { characterId: character.id, materialId: potion.craftCost.materialId, quantity: { gte: potion.craftCost.quantity } },
      data: { quantity: { decrement: potion.craftCost.quantity } },
    });
    if (paid.count !== 1) throw new DomainError("NOT_ENOUGH_MATERIALS", `Necesitas ${potion.craftCost.quantity} de ${MATERIALS[potion.craftCost.materialId].name}.`);
    const stack = await tx.consumableStack.findUniqueOrThrow({ where: key });
    return { potions: stack.quantity };
  });
}
