import type { Metadata } from "next";
import Link from "next/link";
import { ClassEmblem } from "@/components/character/class-emblem";
import { AutoRefresh, CreatePartyForm, JoinPartyForm } from "@/components/party/party-forms";
import { StartExpeditionForm } from "@/components/party/party-forms";
import { ActionButton } from "@/components/ui/action-button";
import { buttonStyles } from "@/components/ui/button";
import { getClassDefinition } from "@/game/classes/definitions";
import { partyCodeSchema } from "@/lib/validation/expedition";
import { requireUser } from "@/server/auth/current-user";
import { listCharacters } from "@/server/characters/service";
import { getMyParty } from "@/server/parties/service";
import { isRealtimeConfigured } from "@/server/realtime/config";
import { cancelExpeditionAction, kickMemberAction, leavePartyAction, setReadyAction } from "./actions";

export const metadata: Metadata = { title: "Grupo" };

export default async function PartyPage({ searchParams }: PageProps<"/party">) {
  const user = await requireUser();
  const query = await searchParams;
  const [party, characters] = await Promise.all([getMyParty(user.id), listCharacters(user.id)]);
  const realtime = isRealtimeConfigured();
  const codeParam = partyCodeSchema.safeParse(typeof query.code === "string" ? query.code : "");

  if (!party) {
    const options = characters.map((c) => ({ id: c.id, label: `${c.name} · ${getClassDefinition(c.classId).name} Nv ${c.level}` }));
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-3xl">Jugar en grupo</h1>
          <p className="text-sm text-bone-300">Hasta 4 jugadores. Cada uno lleva su propio personaje y recibe sus propias recompensas.</p>
        </div>
        {!realtime ? (
          <p className="panel rounded-lg p-4 text-sm text-ember-400" role="status">
            El servidor de partida aún no está configurado: puedes formar un grupo, pero no empezar una expedición.
          </p>
        ) : null}
        {options.length === 0 ? (
          <div className="panel rounded-lg p-6 text-center">
            <p className="text-sm text-bone-300">Necesitas un personaje para jugar en grupo.</p>
            <Link href="/characters/new" className={buttonStyles("primary", "mt-3")}>
              Crear personaje
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <section className="panel rounded-lg p-5">
              <h2 className="mb-3 font-display text-xl">Crear un grupo</h2>
              <CreatePartyForm characters={options} />
            </section>
            <section className="panel rounded-lg p-5">
              <h2 className="mb-3 font-display text-xl">Unirse con un código</h2>
              <JoinPartyForm characters={options} defaultCode={codeParam.success ? codeParam.data : undefined} />
            </section>
          </div>
        )}
      </div>
    );
  }

  const me = party.members.find((m) => m.userId === user.id)!;
  const others = party.members.filter((m) => m.userId !== user.id);
  const allReady = others.every((m) => m.ready);
  const expedition = party.activeExpedition;

  return (
    <div className="space-y-6">
      <AutoRefresh redirectTo={expedition?.participating ? `/expeditions/${expedition.id}` : null} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Tu grupo</h1>
          <p className="text-sm text-bone-300">
            Comparte el código:{" "}
            <span className="rounded bg-abyss-800 px-2 py-0.5 font-mono text-lg tracking-[0.3em] text-ember-400" data-testid="party-code">
              {party.code}
            </span>
          </p>
        </div>
        <ActionButton action={leavePartyAction} fields={{}} variant="ghost" testId="leave-party" confirmText={expedition ? "Si sales ahora abandonas la expedición sin recompensas. ¿Salir?" : undefined}>
          Salir del grupo
        </ActionButton>
      </div>

      {expedition ? (
        <section className="panel rounded-lg p-5" role="status">
          <h2 className="font-display text-xl">Expedición en curso · Piso {expedition.floor}</h2>
          {expedition.participating ? (
            <Link href={`/expeditions/${expedition.id}`} className={buttonStyles("primary", "mt-3")}>
              Volver a la expedición
            </Link>
          ) : (
            <p className="mt-2 text-sm text-bone-300">Ya no participas en esta expedición. Espera a que termine.</p>
          )}
          {party.isLeader ? (
            <div className="mt-3">
              <ActionButton action={cancelExpeditionAction} fields={{}} variant="danger" confirmText="Terminar la expedición para todos, sin recompensas. ¿Seguro?">
                Terminar la expedición
              </ActionButton>
            </div>
          ) : null}
        </section>
      ) : null}

      <ul className="grid gap-3 sm:grid-cols-2" data-testid="party-members">
        {party.members.map((m) => {
          const def = getClassDefinition(m.classId);
          return (
            <li key={m.userId} className="panel flex items-center gap-3 rounded-lg p-4" data-testid="party-member">
              <span style={{ color: def.accent }}>
                <ClassEmblem classId={m.classId} className="h-10 w-10" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-lg">
                  {m.characterName} {m.isLeader ? <span className="text-xs text-gold-400">(líder)</span> : null}
                </p>
                <p className="text-xs text-bone-300">
                  {def.name} · Nivel {m.level} · {m.username}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${m.ready || m.isLeader ? "bg-verdigris-400/15 text-verdigris-400" : "bg-abyss-800 text-bone-500"}`}>
                {m.isLeader ? "Líder" : m.ready ? "Listo" : "Esperando"}
              </span>
              {party.isLeader && !m.isLeader && party.status === "OPEN" ? (
                <ActionButton action={kickMemberAction} fields={{ userId: m.userId }} variant="ghost" confirmText={`¿Expulsar a ${m.characterName}?`}>
                  Expulsar
                </ActionButton>
              ) : null}
            </li>
          );
        })}
        {Array.from({ length: party.maxMembers - party.members.length }, (_, i) => (
          <li key={`empty-${i}`} className="rounded-lg border border-dashed border-abyss-700 p-4 text-center text-sm text-bone-500">
            Hueco libre
          </li>
        ))}
      </ul>

      {party.status === "OPEN" ? (
        <section className="panel space-y-3 rounded-lg p-5">
          {party.isLeader ? (
            <>
              <p className="text-sm text-bone-300">
                {allReady ? "Todos están listos." : "Esperando a que todos marquen «Listo»."} Los enemigos se vuelven más resistentes con cada jugador.
              </p>
              <StartExpeditionForm floors={party.floors} disabled={!allReady || !realtime} />
              {!realtime ? <p className="text-xs text-ember-400">El servidor de partida aún no está configurado.</p> : null}
            </>
          ) : (
            <ActionButton action={setReadyAction} fields={{ ready: me.ready ? "0" : "1" }} variant={me.ready ? "ghost" : "primary"} testId="toggle-ready" className="px-5 py-2.5 text-sm">
              {me.ready ? "Ya no estoy listo" : "Estoy listo"}
            </ActionButton>
          )}
        </section>
      ) : null}
    </div>
  );
}
