import { BALANCE } from "@/game/balance";
import { BOSS_DEFINITIONS } from "@/game/bosses/definitions";
import type { CombatKit } from "@/game/combat/kits";
import { STATUS_DEFINITIONS } from "@/game/combat/status";
import { CONSUMABLES } from "@/game/items/consumables";
import { distance } from "@/game/math/vec";
import { DT, secondsToTicks } from "@/game/simulation/context";
import type { SimState } from "@/game/simulation/types";

/** Datos del HUD (se recalculan ~10 veces por segundo). Compartido por la partida en solitario y en grupo. */
export interface HudSnapshot {
  hp: number;
  maxHp: number;
  resource: number;
  maxResource: number;
  attack: number;
  dodge: number;
  /** Por hueco: proporción de enfriamiento restante y si hay recurso suficiente. */
  skills: ({ ratio: number; affordable: boolean } | null)[];
  potions: number;
  potion: number;
  statuses: string[];
  enemies: number;
  portalOpen: boolean;
  seconds: number;
  boss: { name: string; hp: number; maxHp: number; phase: string; warning: string | null } | null;
  warning: string | null;
}

export function snapshot(state: SimState, kit: CombatKit, skills: SimState["players"][number]["skills"], playerIndex = 0): HudSnapshot {
  const me = state.players[playerIndex];
  const boss = state.boss && state.boss.hp > 0 ? state.boss : null;
  const bossDef = boss ? BOSS_DEFINITIONS[boss.bossId] : null;
  const cdRatio = (ticks: number, total: number) => (total > 0 ? Math.min(1, ticks / total) : 0);
  const attackTotal = secondsToTicks(kit.basic.windup + kit.basic.recovery + kit.basic.cooldown);
  const attackLeft = me.action.kind === "ATTACK" ? me.action.ticks + secondsToTicks(kit.basic.cooldown) : me.attackCooldown;
  const telegraphing = state.enemies.some((e) => e.state === "WINDUP" && distance(e.pos, me.pos) < 5);
  return {
    hp: me.hp,
    maxHp: me.maxHp,
    resource: me.resource,
    maxResource: me.maxResource,
    attack: cdRatio(attackLeft, attackTotal),
    dodge: cdRatio(me.dodgeCooldown, secondsToTicks(BALANCE.combat.dodge.cooldown)),
    skills: skills.map((skill, slot) => (skill ? { ratio: cdRatio(me.skillCooldowns[slot], secondsToTicks(skill.cooldown)), affordable: me.resource >= skill.resourceCost } : null)),
    potions: me.potions,
    potion: cdRatio(me.potionCooldown, secondsToTicks(CONSUMABLES.HEALTH_POTION.cooldown)),
    statuses: me.statuses.map((s) => STATUS_DEFINITIONS[s.id].name),
    enemies: state.enemies.length,
    portalOpen: state.portalOpen,
    seconds: Math.floor(state.tick * DT),
    boss:
      boss && bossDef && boss.aggro
        ? {
            name: bossDef.name,
            hp: boss.hp,
            maxHp: boss.maxHp,
            phase: bossDef.phases[boss.phase].name,
            warning: boss.state === "WINDUP" && boss.current ? bossDef.attacks[boss.current].name : null,
          }
        : null,
    warning: telegraphing ? "Ataque inminente" : null,
  };
}

export const subscribeNoop = () => () => undefined;

export function nearestEnemyDir(state: SimState, playerIndex = 0): { x: number; y: number } | null {
  const me = state.players[playerIndex];
  let best: { x: number; y: number } | null = null;
  let bestD = 9;
  const targets = [...state.enemies.map((e) => e.pos), ...(state.boss && state.boss.hp > 0 ? [state.boss.pos] : [])];
  for (const p of targets) {
    const d = distance(me.pos, p);
    if (d < bestD) {
      bestD = d;
      best = { x: p.x - me.pos.x, y: p.y - me.pos.y };
    }
  }
  return best;
}

export function HudBar({ label, value, max, color, testId }: { label: string; value: number; max: number; color: string; testId?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="mt-1.5">
      <div className="flex justify-between text-[11px] text-bone-300">
        <span>{label}</span>
        <span className="tabular-nums" data-testid={testId}>
          {value} / {max}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full border border-abyss-600 bg-abyss-950">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export function Cooldown({ label, hint, ratio, disabled, ultimate, testId }: { label: string; hint: string; ratio: number; disabled?: boolean; ultimate?: boolean; testId?: string }) {
  return (
    <div
      className={`panel relative w-16 overflow-hidden rounded-md px-1.5 py-1.5 text-center text-[10px] sm:w-20 sm:text-[11px] ${disabled ? "opacity-50" : ""} ${ultimate ? "border-ember-500/70" : ""}`}
      data-testid={testId}
    >
      <div className="absolute inset-x-0 bottom-0 bg-abyss-950/80" style={{ height: `${ratio * 100}%` }} />
      <p className="relative truncate font-semibold">{label}</p>
      {hint ? <p className="relative text-bone-500">{hint}</p> : null}
    </div>
  );
}
