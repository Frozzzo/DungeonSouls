import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunResult } from "@/components/dungeon/run-result";
import { GameClient } from "@/components/game/game-client";
import { runIdSchema } from "@/lib/validation/run";
import { requireUser } from "@/server/auth/current-user";
import { getRunForPlay, getRunResult } from "@/server/dungeon/service";

export const metadata: Metadata = { title: "Mazmorra" };

/** El piloto automático solo existe en compilaciones de pruebas (variable fijada al compilar). */
const AUTOPILOT_BUILD = process.env.NEXT_PUBLIC_E2E_AUTOPILOT === "1";

export default async function RunPage({ params, searchParams }: PageProps<"/characters/[id]/runs/[runId]">) {
  const user = await requireUser();
  const { id, runId } = await params;
  const query = await searchParams;
  const parsed = runIdSchema.safeParse(runId);
  if (!parsed.success) notFound();

  const run = await getRunForPlay(user.id, parsed.data);
  if (run && run.characterId === id) {
    return <GameClient runId={run.id} characterId={run.characterId} config={run.config} autopilot={AUTOPILOT_BUILD && query.autopilot === "1"} />;
  }

  // Intento cerrado: muestra su resultado (útil tras recargar o perder la conexión).
  const result = await getRunResult(user.id, parsed.data);
  if (!result || result.characterId !== id) notFound();
  return (
    <div className="panel mx-auto max-w-2xl rounded-xl p-6">
      <RunResult result={result} />
    </div>
  );
}
