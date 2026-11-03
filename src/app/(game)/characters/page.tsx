import type { Metadata } from "next";
import Link from "next/link";
import { ClassEmblem } from "@/components/character/class-emblem";
import { buttonStyles } from "@/components/ui/button";
import { BALANCE } from "@/game/balance";
import { getClassDefinition } from "@/game/classes/definitions";
import { requireUser } from "@/server/auth/current-user";
import { listCharacters } from "@/server/characters/service";

export const metadata: Metadata = { title: "Personajes" };

export default async function CharactersPage() {
  const user = await requireUser();
  const characters = await listCharacters(user.id);
  const canCreate = characters.length < BALANCE.characters.maxPerUser;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Tus personajes</h1>
          <p className="text-sm text-bone-300">
            {characters.length} / {BALANCE.characters.maxPerUser} espacios usados
          </p>
        </div>
        {canCreate ? (
          <Link href="/characters/new" className={buttonStyles("primary")}>
            Crear personaje
          </Link>
        ) : null}
      </div>

      {characters.length === 0 ? (
        <div className="panel rounded-lg p-10 text-center">
          <p className="font-display text-xl">El abismo espera a su primer héroe.</p>
          <p className="mt-2 text-sm text-bone-300">Crea un personaje para empezar tu descenso.</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((c) => {
            const def = getClassDefinition(c.classId);
            return (
              <li key={c.id}>
                <Link
                  href={`/characters/${c.id}`}
                  className="panel flex items-center gap-4 rounded-lg p-4 transition hover:border-ember-600"
                  data-testid="character-card"
                >
                  <span style={{ color: def.accent }}>
                    <ClassEmblem classId={c.classId} className="h-12 w-12" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg">{c.name}</p>
                    <p className="text-xs text-bone-300">
                      {def.name} · Nivel {c.level}
                    </p>
                  </div>
                  {c.statPoints > 0 ? (
                    <span className="rounded-full bg-gold-400/15 px-2 py-0.5 text-xs text-gold-400" title="Puntos sin asignar">
                      +{c.statPoints}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
