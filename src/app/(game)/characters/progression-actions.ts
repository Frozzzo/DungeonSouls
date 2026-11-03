"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/validation/form";
import {
  craftPotionSchema,
  dismantleItemSchema,
  equipItemSchema,
  equipSkillSchema,
  learnSkillSchema,
  unequipItemSchema,
} from "@/lib/validation/progression";
import { requireUser } from "@/server/auth/current-user";
import { craftPotion, dismantleItem, equipItem, unequipItem } from "@/server/equipment/service";
import { DomainError, logServerError } from "@/server/errors";
import { equipSkill, learnSkill } from "@/server/skills/service";
import { getSkill } from "@/game/skills/definitions";
import { MATERIALS } from "@/game/items/consumables";

const GENERIC_ERROR = "Algo salió mal. Inténtalo de nuevo.";

/** Lee solo los campos conocidos del formulario (los demás se ignoran) y valida con Zod estricto. */
function fields(formData: FormData, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = formData.get(k);
    if (typeof v === "string" && (v !== "" || k === "skillId")) out[k] = v;
  }
  return out;
}

async function perform(context: string, characterId: string, fn: () => Promise<string>): Promise<FormState> {
  try {
    const message = await fn();
    revalidatePath(`/characters/${characterId}`, "layout");
    return { ok: true, message };
  } catch (error) {
    if (error instanceof DomainError) return { message: error.message };
    logServerError(context, error);
    return { message: GENERIC_ERROR };
  }
}

export async function learnSkillAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = learnSkillSchema.safeParse(fields(formData, ["characterId", "skillId"]));
  if (!parsed.success) return { message: "Habilidad no válida." };
  return perform("learnSkill", parsed.data.characterId, async () => {
    const { rank } = await learnSkill(user.id, parsed.data);
    const name = getSkill(parsed.data.skillId)?.name ?? "Habilidad";
    return rank === 1 ? `Has aprendido ${name}.` : `${name} sube a rango ${rank}.`;
  });
}

export async function equipSkillAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = equipSkillSchema.safeParse(fields(formData, ["characterId", "slot", "skillId"]));
  if (!parsed.success) return { message: "Hueco no válido." };
  return perform("equipSkill", parsed.data.characterId, async () => {
    await equipSkill(user.id, parsed.data);
    return parsed.data.skillId ? "Habilidad equipada." : "Hueco liberado.";
  });
}

export async function equipItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = equipItemSchema.safeParse(fields(formData, ["characterId", "itemId", "slot"]));
  if (!parsed.success) return { message: "Objeto no válido." };
  return perform("equipItem", parsed.data.characterId, async () => {
    await equipItem(user.id, parsed.data);
    return "Objeto equipado.";
  });
}

export async function unequipItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = unequipItemSchema.safeParse(fields(formData, ["characterId", "slot"]));
  if (!parsed.success) return { message: "Hueco no válido." };
  return perform("unequipItem", parsed.data.characterId, async () => {
    await unequipItem(user.id, parsed.data);
    return "Objeto guardado en la mochila.";
  });
}

export async function dismantleItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = dismantleItemSchema.safeParse(fields(formData, ["characterId", "itemId"]));
  if (!parsed.success) return { message: "Objeto no válido." };
  return perform("dismantleItem", parsed.data.characterId, async () => {
    const r = await dismantleItem(user.id, parsed.data);
    return `+${r.gained} ${MATERIALS.ABYSSAL_DUST.name} (tienes ${r.total}).`;
  });
}

export async function craftPotionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = craftPotionSchema.safeParse(fields(formData, ["characterId"]));
  if (!parsed.success) return { message: "Personaje no válido." };
  return perform("craftPotion", parsed.data.characterId, async () => {
    const r = await craftPotion(user.id, parsed.data);
    return `Poción fabricada. Llevas ${r.potions}.`;
  });
}
