import Link from "next/link";
import { ENEMY_DEFINITIONS, ENEMY_KIND_IDS } from "@/game/enemies/definitions";
import { buttonStyles } from "@/components/ui/button";
import { ItemCard } from "@/components/inventory/item-card";
import type { RunResultView } from "@/server/dungeon/service";
import { StartRunButton } from "./start-run-button";

/** Pantalla de recompensas (victoria) o de derrota. Todos los datos vienen del servidor. */
export function RunResult({ result }: { result: RunResultView }) {
  const { outcome } = result;
  const victory = result.status === "COMPLETED";
  const leveledUp = outcome.levelAfter > outcome.levelBefore;
  const seconds = Math.round(outcome.ticks / 20);
  const kills = ENEMY_KIND_IDS.filter((k) => outcome.kills[k] > 0);

  return (
    <div className="space-y-5" data-testid="run-result">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-bone-500">Piso {result.floor}</p>
        <h2 className={`font-display text-4xl ${victory ? "ember-glow text-ember-400" : "text-blood-400"}`} data-testid="run-result-title">
          {victory ? (outcome.bossDefeated ? "Jefe derrotado" : "Piso completado") : "Has caído"}
        </h2>
        <p className="mt-1 text-sm text-bone-300">
          {victory
            ? "El servidor ha validado tu partida."
            : outcome.defeatReason === "TIMEOUT"
              ? "El tiempo se agotó. Tu progreso permanente no se pierde."
              : "La oscuridad te reclama, pero tu progreso permanente no se pierde."}
        </p>
      </div>

      {leveledUp ? (
        <div className="level-up rounded-lg border border-gold-400/60 bg-gold-400/10 p-4 text-center" role="status" data-testid="level-up">
          <p className="font-display text-2xl text-gold-400">¡Nivel {outcome.levelAfter}!</p>
          <p className="text-sm text-bone-300">Tienes nuevos puntos de atributo y de habilidad.</p>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Stat label="Experiencia" value={outcome.xp ? `+${outcome.xp.total}` : "0"} testId="run-xp" />
        <Stat label="Tiempo" value={`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`} />
        <Stat label="Daño infligido" value={String(outcome.damageDealt)} />
        <Stat label="Esquivas" value={String(outcome.dodges)} />
      </dl>

      {outcome.xp ? (
        <p className="text-center text-xs text-bone-500">
          Enemigos {outcome.xp.enemies} · Jefe {outcome.xp.boss} · Piso {outcome.xp.clear}
          {outcome.xp.levelFactor < 1 ? ` · ×${outcome.xp.levelFactor.toFixed(2)} por diferencia de nivel` : ""}
        </p>
      ) : null}

      {outcome.potionsUsed > 0 || outcome.potionsFound > 0 ? (
        <p className="text-center text-xs text-bone-300" data-testid="run-potions">
          Pociones bebidas: {outcome.potionsUsed}
          {outcome.potionsFound > 0 ? ` · encontradas: ${outcome.potionsFound}` : ""}
        </p>
      ) : null}

      {kills.length > 0 ? (
        <p className="text-center text-xs text-bone-300">
          {kills.map((k) => `${ENEMY_DEFINITIONS[k].name} ×${outcome.kills[k]}`).join(" · ")}
        </p>
      ) : null}

      {victory ? (
        <section>
          <h3 className="mb-2 font-display text-lg">Botín</h3>
          {result.items.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {result.items.map((item) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-bone-500">Nada esta vez.</p>
          )}
          {outcome.itemsLost > 0 ? <p className="mt-2 text-xs text-blood-400">Inventario lleno: se perdieron {outcome.itemsLost} objetos.</p> : null}
        </section>
      ) : null}

      <div className="flex flex-wrap justify-center gap-2">
        {victory && result.nextFloor ? (
          <StartRunButton characterId={result.characterId} floor={result.nextFloor} label={`Descender al piso ${result.nextFloor}`} />
        ) : null}
        <StartRunButton characterId={result.characterId} floor={result.floor} label={victory ? "Repetir piso" : "Reintentar"} variant="secondary" />
        <Link href={`/characters/${result.characterId}`} className={buttonStyles("ghost")}>
          Volver al personaje
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-md border border-abyss-600 bg-abyss-950/60 p-3 text-center">
      <dt className="text-xs text-bone-500">{label}</dt>
      <dd className="font-display text-xl text-bone-100" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}
