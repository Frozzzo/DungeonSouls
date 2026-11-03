"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runIdSchema, startRunSchema, submitRunSchema } from "@/lib/validation/run";
import type { FormState } from "@/lib/validation/form";
import { requireUser } from "@/server/auth/current-user";
import { abandonRun, type RunResultView, startRun, submitRun } from "@/server/dungeon/service";
import { DomainError, logServerError } from "@/server/errors";

const GENERIC_ERROR = "Algo salió mal. Inténtalo de nuevo.";

export async function startRunAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = startRunSchema.safeParse({ characterId: formData.get("characterId"), floor: formData.get("floor") });
  if (!parsed.success) return { message: "Piso no válido." };
  let runId: string;
  try {
    runId = (await startRun(user.id, parsed.data)).runId;
  } catch (error) {
    if (error instanceof DomainError) return { message: error.message };
    logServerError("startRun", error);
    return { message: GENERIC_ERROR };
  }
  redirect(`/characters/${parsed.data.characterId}/runs/${runId}`);
}

export type SubmitRunResponse = { ok: true; result: RunResultView } | { ok: false; code: string; message: string; retryable: boolean };

/**
 * Recibe SOLO las intenciones del jugador. El servidor repite la partida y decide el resultado.
 * Es seguro reintentarla: si el piso ya se validó, devuelve el mismo resultado sin duplicar nada.
 */
export async function submitRunAction(payload: unknown): Promise<SubmitRunResponse> {
  const user = await requireUser();
  const parsed = submitRunSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, code: "INVALID", message: "Datos de partida no válidos.", retryable: false };
  try {
    const result = await submitRun(user.id, parsed.data);
    revalidatePath(`/characters/${result.characterId}`);
    return { ok: true, result };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, code: error.code, message: error.message, retryable: error.code === "CONFLICT" };
    logServerError("submitRun", error);
    return { ok: false, code: "SERVER", message: GENERIC_ERROR, retryable: true };
  }
}

export async function abandonRunAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const runId = runIdSchema.safeParse(formData.get("runId"));
  const characterId = String(formData.get("characterId") ?? "").slice(0, 64);
  if (runId.success) await abandonRun(user.id, runId.data);
  redirect(characterId ? `/characters/${characterId}` : "/characters");
}
