"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { allocateStatsSchema, characterIdSchema, createCharacterSchema } from "@/lib/validation/character";
import { type FormState, fieldErrorsFrom } from "@/lib/validation/form";
import { requireUser } from "@/server/auth/current-user";
import { allocateStats, createCharacter, deleteCharacter } from "@/server/characters/service";
import { DomainError, logServerError } from "@/server/errors";

const GENERIC_ERROR = "Algo salió mal. Inténtalo de nuevo.";

export async function createCharacterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const raw = { name: String(formData.get("name") ?? ""), classId: String(formData.get("classId") ?? "") };
  const parsed = createCharacterSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error), values: raw };

  let id: string;
  try {
    id = (await createCharacter(user.id, parsed.data)).id;
  } catch (error) {
    if (error instanceof DomainError) return { message: error.message, values: raw };
    logServerError("createCharacter", error);
    return { message: GENERIC_ERROR, values: raw };
  }
  revalidatePath("/characters");
  redirect(`/characters/${id}`);
}

export async function allocateStatsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = allocateStatsSchema.safeParse({
    characterId: formData.get("characterId"),
    strength: formData.get("strength") ?? 0,
    dexterity: formData.get("dexterity") ?? 0,
    intelligence: formData.get("intelligence") ?? 0,
    vitality: formData.get("vitality") ?? 0,
  });
  if (!parsed.success) return { message: "Asignación no válida." };

  try {
    await allocateStats(user.id, parsed.data);
  } catch (error) {
    if (error instanceof DomainError) return { message: error.message };
    logServerError("allocateStats", error);
    return { message: GENERIC_ERROR };
  }
  revalidatePath(`/characters/${parsed.data.characterId}`);
  return { ok: true, message: "Puntos asignados." };
}

export async function deleteCharacterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = characterIdSchema.safeParse(formData.get("characterId"));
  const confirmName = String(formData.get("confirmName") ?? "").slice(0, 64);
  if (!id.success) return { message: "Personaje no válido." };

  try {
    await deleteCharacter(user.id, id.data, confirmName);
  } catch (error) {
    if (error instanceof DomainError) return { message: error.message };
    logServerError("deleteCharacter", error);
    return { message: GENERIC_ERROR };
  }
  revalidatePath("/characters");
  redirect("/characters");
}
