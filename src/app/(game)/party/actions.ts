"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { characterIdSchema, createPartySchema, expeditionIdSchema, joinPartySchema, startExpeditionSchema } from "@/lib/validation/expedition";
import type { FormState } from "@/lib/validation/form";
import { requireUser } from "@/server/auth/current-user";
import { getRunResult, type RunResultView } from "@/server/dungeon/service";
import { DomainError, logServerError } from "@/server/errors";
import { cancelExpedition, getMyExpeditionRun, leaveExpedition, startExpedition } from "@/server/expeditions/service";
import { createParty, joinParty, kickMember, leaveParty, setReady } from "@/server/parties/service";

const GENERIC_ERROR = "Algo salió mal. Inténtalo de nuevo.";

async function run(context: string, fn: () => Promise<void>): Promise<FormState> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof DomainError) return { message: error.message };
    logServerError(context, error);
    return { message: GENERIC_ERROR };
  }
  revalidatePath("/party");
  return { ok: true };
}

export async function createPartyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = createPartySchema.safeParse({ characterId: formData.get("characterId") });
  if (!parsed.success) return { message: "Elige un personaje." };
  return run("createParty", async () => void (await createParty(user.id, parsed.data)));
}

export async function joinPartyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = joinPartySchema.safeParse({ code: formData.get("code"), characterId: formData.get("characterId") });
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Datos no válidos.", values: { code: String(formData.get("code") ?? "").slice(0, 12) } };
  return run("joinParty", () => joinParty(user.id, parsed.data));
}

export async function leavePartyAction(): Promise<FormState> {
  const user = await requireUser();
  return run("leaveParty", () => leaveParty(user.id));
}

export async function setReadyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  return run("setReady", () => setReady(user.id, formData.get("ready") === "1"));
}

export async function kickMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const target = characterIdSchema.safeParse(formData.get("userId"));
  if (!target.success) return { message: "Jugador no válido." };
  return run("kickMember", () => kickMember(user.id, target.data));
}

export async function startExpeditionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = startExpeditionSchema.safeParse({ floor: formData.get("floor") });
  if (!parsed.success) return { message: "Piso no válido." };
  let expeditionId: string;
  try {
    expeditionId = (await startExpedition(user.id, parsed.data)).expeditionId;
  } catch (error) {
    if (error instanceof DomainError) return { message: error.message };
    logServerError("startExpedition", error);
    return { message: GENERIC_ERROR };
  }
  redirect(`/expeditions/${expeditionId}`);
}

export async function cancelExpeditionAction(): Promise<FormState> {
  const user = await requireUser();
  return run("cancelExpedition", () => cancelExpedition(user.id));
}

/** Abandona la expedición (sin recompensas) y vuelve al grupo. */
export async function leaveExpeditionAction(expeditionId: string): Promise<void> {
  const user = await requireUser();
  const id = expeditionIdSchema.safeParse(expeditionId);
  if (id.success) await leaveExpedition(user.id, id.data);
  revalidatePath("/party");
}

export type ExpeditionResultResponse = { state: "PENDING" } | { state: "DONE"; result: RunResultView } | { state: "ABANDONED" } | { state: "NOT_FOUND" };

/** El cliente lo consulta al terminar: el resultado lo aplica el servidor de partida (puede tardar unos segundos). */
export async function getExpeditionResultAction(expeditionId: string): Promise<ExpeditionResultResponse> {
  const user = await requireUser();
  const id = expeditionIdSchema.safeParse(expeditionId);
  if (!id.success) return { state: "NOT_FOUND" };
  const run = await getMyExpeditionRun(user.id, id.data);
  if (!run) return { state: "NOT_FOUND" };
  if (run.status === "ACTIVE") return { state: "PENDING" };
  if (run.status === "ABANDONED") return { state: "ABANDONED" };
  const result = await getRunResult(user.id, run.id);
  return result ? { state: "DONE", result } : { state: "PENDING" };
}
