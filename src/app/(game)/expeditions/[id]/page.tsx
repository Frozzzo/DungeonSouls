import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RunResult } from "@/components/dungeon/run-result";
import { OnlineGameClient } from "@/components/game/online-game-client";
import { buttonStyles } from "@/components/ui/button";
import { expeditionIdSchema } from "@/lib/validation/expedition";
import { requireUser } from "@/server/auth/current-user";
import { getRunResult } from "@/server/dungeon/service";
import { getExpeditionForPlay, getMyExpeditionRun } from "@/server/expeditions/service";
import { isRealtimeConfigured } from "@/server/realtime/config";

export const metadata: Metadata = { title: "Expedición en grupo" };

/** El piloto automático solo existe en compilaciones de pruebas (variable fijada al compilar). */
const AUTOPILOT_BUILD = process.env.NEXT_PUBLIC_E2E_AUTOPILOT === "1";

export default async function ExpeditionPage({ params, searchParams }: PageProps<"/expeditions/[id]">) {
  const user = await requireUser();
  const id = expeditionIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const query = await searchParams;

  const play = isRealtimeConfigured() ? await getExpeditionForPlay(user.id, id.data) : null;
  if (play) {
    return <OnlineGameClient expeditionId={play.expeditionId} characterId={play.characterId} config={play.config} autopilot={AUTOPILOT_BUILD && query.autopilot === "1"} />;
  }

  // Expedición terminada (o abandonada): su resultado para este usuario.
  const run = await getMyExpeditionRun(user.id, id.data);
  if (!run) notFound();
  const result = await getRunResult(user.id, run.id);
  return (
    <div className="panel mx-auto max-w-2xl space-y-4 rounded-xl p-6">
      {result ? (
        <RunResult result={result} />
      ) : (
        <p className="text-center text-sm text-bone-300">
          {run.status === "ACTIVE" ? "La expedición sigue en curso, pero el servidor de partida no está disponible." : "No completaste esta expedición."}
        </p>
      )}
      <div className="text-center">
        <Link href="/party" className={buttonStyles("secondary")}>
          Volver al grupo
        </Link>
      </div>
    </div>
  );
}
