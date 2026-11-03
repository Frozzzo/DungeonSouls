import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AttributeAllocator } from "@/components/character/attribute-allocator";
import { ClassEmblem } from "@/components/character/class-emblem";
import { DeleteCharacterForm } from "@/components/character/delete-character-form";
import { StatsPanel } from "@/components/character/stats-panel";
import { Bar } from "@/components/ui/bar";
import { getClassDefinition } from "@/game/classes/definitions";
import { characterIdSchema } from "@/lib/validation/character";
import { requireUser } from "@/server/auth/current-user";
import { getOwnedCharacter } from "@/server/characters/service";
import { getActiveRunId, listRecentRuns, unlockedFloors } from "@/server/dungeon/service";
import { StartRunButton } from "@/components/dungeon/start-run-button";
import { buttonStyles } from "@/components/ui/button";
import { isBossFloor, MAX_FLOOR } from "@/game/dungeon/floors";

export const metadata: Metadata = { title: "Personaje" };

const RUN_STATUS_LABELS = { ACTIVE: "En curso", COMPLETED: "Completado", FAILED: "Derrota", ABANDONED: "Abandonado" } as const;

export default async function CharacterPage({ params }: PageProps<"/characters/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const parsed = characterIdSchema.safeParse(id);
  if (!parsed.success) notFound();
  const character = await getOwnedCharacter(user.id, parsed.data);
  if (!character) notFound();

  const def = getClassDefinition(character.classId);
  const { derived } = character.stats;
  const [activeRunId, history] = await Promise.all([getActiveRunId(user.id, character.id), listRecentRuns(user.id, character.id)]);
  const floors = unlockedFloors(character.highestFloorCleared);
  const nextFloor = floors[floors.length - 1];

  return (
    <div className="space-y-6">
      <Link href="/characters" className="text-sm text-bone-300 hover:text-bone-100">
        ← Volver a personajes
      </Link>

      <section className="panel rounded-xl p-6">
        <div className="flex flex-wrap items-center gap-4">
          <span style={{ color: def.accent }}>
            <ClassEmblem classId={character.classId} className="h-16 w-16" />
          </span>
          <div className="flex-1">
            <h1 className="font-display text-3xl" data-testid="character-name">
              {character.name}
            </h1>
            <p className="text-sm text-bone-300">
              {def.name} ({def.role}) · <span data-testid="character-level">Nivel {character.level}</span>
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Bar label="Vida" value={derived.maxHealth} max={derived.maxHealth} color="linear-gradient(90deg,#8c1c15,#d9443a)" />
          <Bar label={def.resource.name} value={derived.maxResource} max={derived.maxResource} color="linear-gradient(90deg,#1f5f8b,#4fa3d9)" />
          <Bar
            label="Experiencia"
            value={character.experience}
            max={character.experienceToNext}
            color="linear-gradient(90deg,#8a6d1c,#d9b44a)"
          />
        </div>
      </section>

      <section className="panel rounded-xl p-6" aria-labelledby="descent-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="descent-title" className="font-display text-xl">
              Descenso
            </h2>
            <p className="text-sm text-bone-300" data-testid="highest-floor">
              {character.highestFloorCleared > 0 ? `Piso más profundo completado: ${character.highestFloorCleared}` : "Aún no has completado ningún piso."}
            </p>
            <p className="text-xs text-bone-500">El piso {MAX_FLOOR} guarda al primer jefe. Dificultad: Normal (las demás llegan en la Fase 5).</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeRunId ? (
              <Link href={`/characters/${character.id}/runs/${activeRunId}`} className={buttonStyles("secondary")}>
                Continuar partida
              </Link>
            ) : null}
            <StartRunButton characterId={character.id} floor={nextFloor} label={`Entrar al piso ${nextFloor}`} />
            <Link href={`/characters/${character.id}/inventory`} className={buttonStyles("ghost")}>
              Inventario
            </Link>
          </div>
        </div>
        {floors.length > 1 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-bone-500">Repetir:</span>
            {floors.slice(0, -1).map((f) => (
              <StartRunButton key={f} characterId={character.id} floor={f} label={isBossFloor(f) ? `Piso ${f} (jefe)` : `Piso ${f}`} variant="ghost" className="px-3 py-1.5" />
            ))}
          </div>
        ) : null}
        {history.length > 0 ? (
          <div className="mt-5">
            <h3 className="mb-2 text-xs uppercase tracking-[0.2em] text-ember-400">Historial reciente</h3>
            <ul className="divide-y divide-abyss-700 text-sm" data-testid="run-history">
              {history.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span>Piso {r.floor}</span>
                  <span className={r.status === "COMPLETED" ? "text-verdigris-400" : r.status === "FAILED" ? "text-blood-400" : "text-bone-500"}>
                    {RUN_STATUS_LABELS[r.status]}
                  </span>
                  <span className="tabular-nums text-xs text-bone-500">
                    {r.xp !== null ? `+${r.xp} XP` : "—"}
                    {r.seconds !== null ? ` · ${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, "0")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="panel rounded-xl p-6 lg:col-span-2">
          <h2 className="mb-4 font-display text-xl">Estadísticas</h2>
          {character.statPoints > 0 ? (
            <AttributeAllocator
              characterId={character.id}
              classId={character.classId}
              level={character.level}
              allocated={character.allocated}
              availablePoints={character.statPoints}
              stats={character.stats}
            />
          ) : (
            <StatsPanel stats={character.stats} />
          )}
        </section>

        <aside className="space-y-6">
          <section className="panel rounded-xl p-6">
            <h2 className="mb-3 font-display text-xl">Ramas de habilidad</h2>
            <p className="mb-3 text-xs text-bone-500">
              Puntos de habilidad: <span className="text-gold-400">{character.skillPoints}</span>. El árbol completo llega en la fase 3.
            </p>
            <ul className="space-y-3">
              {def.skillBranches.map((b) => (
                <li key={b.id}>
                  <p className="text-sm font-semibold">{b.name}</p>
                  <p className="text-xs text-bone-300">{b.description}</p>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel rounded-xl p-6">
            <h2 className="mb-3 font-display text-xl">Zona de peligro</h2>
            <DeleteCharacterForm characterId={character.id} name={character.name} />
          </section>
        </aside>
      </div>
    </div>
  );
}
