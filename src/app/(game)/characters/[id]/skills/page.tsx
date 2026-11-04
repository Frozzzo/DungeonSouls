import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { equipSkillAction, learnSkillAction } from "@/app/(game)/characters/progression-actions";
import { ActionButton } from "@/components/ui/action-button";
import { cn } from "@/components/ui/cn";
import { getClassDefinition } from "@/game/classes/definitions";
import { LOADOUT_SLOTS, type LoadoutSlot } from "@/game/skills/rules";
import { characterIdSchema } from "@/lib/validation/character";
import { requireUser } from "@/server/auth/current-user";
import { getSkillTree, type SkillNodeView } from "@/server/skills/service";

export const metadata: Metadata = { title: "Habilidades" };

const SLOT_LABELS: Record<LoadoutSlot, string> = { BASIC_1: "Hueco 1 (Q)", BASIC_2: "Hueco 2 (E)", BASIC_3: "Hueco 3 (R)", ULTIMATE: "Definitiva (F)" };
const SLOT_SHORT: Record<LoadoutSlot, string> = { BASIC_1: "1", BASIC_2: "2", BASIC_3: "3", ULTIMATE: "D" };

export default async function SkillsPage({ params }: PageProps<"/characters/[id]/skills">) {
  const user = await requireUser();
  const { id } = await params;
  const parsed = characterIdSchema.safeParse(id);
  if (!parsed.success) notFound();
  const tree = await getSkillTree(user.id, parsed.data);
  if (!tree) notFound();
  const def = getClassDefinition(tree.classId);

  return (
    <div className="space-y-6">
      <Link href={`/characters/${tree.characterId}`} className="text-sm text-bone-300 hover:text-bone-100">
        ← Volver a {tree.characterName}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Habilidades</h1>
          <p className="text-sm text-bone-300">
            {def.name} · Nivel {tree.level}. Ganas 1 punto por nivel. Equipa hasta 3 básicas y 1 definitiva; el ataque básico no ocupa hueco.
          </p>
        </div>
        <p className="panel rounded-md px-3 py-2 text-sm">
          Puntos de habilidad:{" "}
          <span className="font-display text-lg text-gold-400" data-testid="skill-points">
            {tree.skillPoints}
          </span>
        </p>
      </div>

      <section className="panel rounded-xl p-4 sm:p-6" aria-labelledby="loadout-title">
        <h2 id="loadout-title" className="mb-3 font-display text-xl">
          Equipadas
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="skill-loadout">
          {tree.loadout.map(({ slot, skill }) => (
            <li key={slot} className={cn("rounded-lg border p-3", slot === "ULTIMATE" ? "border-ember-600/70" : "border-abyss-600")} data-testid={`loadout-${slot}`}>
              <p className="text-xs uppercase tracking-[0.2em] text-bone-500">{SLOT_LABELS[slot]}</p>
              {skill ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {skill.name} <span className="text-xs text-bone-500">R{skill.rank}</span>
                  </p>
                  <ActionButton action={equipSkillAction} fields={{ characterId: tree.characterId, slot, skillId: "" }} variant="ghost">
                    Quitar
                  </ActionButton>
                </div>
              ) : (
                <p className="mt-1 text-sm text-bone-500">Vacío</p>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-bone-500">Los cambios se aplican al empezar el siguiente piso; una partida en curso conserva lo que llevabas al entrar.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {tree.branches.map((branch) => (
          <section key={branch.id} className="panel rounded-xl p-4 sm:p-5" aria-labelledby={`branch-${branch.id}`}>
            <h2 id={`branch-${branch.id}`} className="font-display text-xl" style={{ color: def.accent }}>
              {branch.name}
            </h2>
            <p className="mb-4 text-xs text-bone-300">{branch.description}</p>
            <ul className="space-y-3">
              {branch.skills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} characterId={tree.characterId} resourceName={tree.resourceName} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function SkillCard({ skill, characterId, resourceName }: { skill: SkillNodeView; characterId: string; resourceName: string }) {
  const learned = skill.rank > 0;
  const ultimate = skill.kind === "ULTIMATE";
  const slots = LOADOUT_SLOTS.filter((s) => (s === "ULTIMATE") === ultimate);
  return (
    <li
      className={cn("rounded-lg border p-3 text-sm", learned ? "border-abyss-500 bg-abyss-900/40" : "border-abyss-700 opacity-90", ultimate && "border-ember-600/60")}
      data-testid={`skill-${skill.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            {skill.name}
            {ultimate ? <span className="ml-2 rounded bg-ember-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ember-400">Definitiva</span> : null}
          </p>
          <p className="text-xs text-bone-500" data-testid="skill-rank">
            Rango {skill.rank}/{skill.maxRank} · {skill.resourceCost} {resourceName.toLowerCase()} · {skill.cooldown} s
            {skill.nextCooldown !== null && skill.nextCooldown !== skill.cooldown ? ` → ${skill.nextCooldown} s` : ""}
          </p>
        </div>
        {skill.equippedSlot ? (
          <span className="rounded-full border border-verdigris-400/50 px-2 py-0.5 text-[10px] text-verdigris-400">Equipada</span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-bone-300">{skill.description}</p>
      <ul className="mt-2 space-y-0.5 text-xs text-bone-100">
        {skill.effects.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      {skill.nextEffects ? (
        <div className="mt-1 text-xs text-verdigris-400">
          <p className="text-[10px] uppercase tracking-wider">Rango {skill.rank + 1}</p>
          <ul className="space-y-0.5">
            {skill.nextEffects.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {skill.requires.length > 0 || skill.requiredLevel > 1 ? (
        <p className="mt-2 text-[11px] text-bone-500">
          Requiere: nivel {skill.requiredLevel}
          {skill.requires.map((r) => (
            <span key={r.name} className={r.met ? "text-bone-500" : "text-blood-400"}>
              {" "}
              · {r.name} R{r.rank}
            </span>
          ))}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {skill.rank < skill.maxRank ? (
          <ActionButton action={learnSkillAction} fields={{ characterId, skillId: skill.id }} variant={skill.canLearn ? "primary" : "secondary"} disabled={!skill.canLearn} testId="learn-skill">
            {learned ? "Mejorar (1 punto)" : "Aprender (1 punto)"}
          </ActionButton>
        ) : (
          <span className="text-xs text-gold-400">Rango máximo</span>
        )}
        {learned
          ? slots.map((slot) =>
              skill.equippedSlot === slot ? null : (
                <ActionButton key={slot} action={equipSkillAction} fields={{ characterId, slot, skillId: skill.id }} variant="ghost" testId={`equip-skill-${slot}`}>
                  {ultimate ? "Equipar" : `Al hueco ${SLOT_SHORT[slot]}`}
                </ActionButton>
              ),
            )
          : null}
      </div>
      {!skill.canLearn && skill.blocker && skill.rank < skill.maxRank ? <p className="mt-1 text-[11px] text-bone-500">{skill.blocker}</p> : null}
    </li>
  );
}
