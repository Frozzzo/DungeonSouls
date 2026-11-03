"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { abandonRunAction, submitRunAction, type SubmitRunResponse } from "@/app/(game)/characters/[id]/runs/actions";
import { RunResult } from "@/components/dungeon/run-result";
import { Button, buttonStyles } from "@/components/ui/button";
import { BALANCE } from "@/game/balance";
import { BOSS_DEFINITIONS } from "@/game/bosses/definitions";
import { CLASS_DEFINITIONS } from "@/game/classes/definitions";
import { getCombatKit } from "@/game/combat/kits";
import { STATUS_DEFINITIONS } from "@/game/combat/status";
import { distance } from "@/game/math/vec";
import { botInput } from "@/game/simulation/bot";
import { createContext, DT, secondsToTicks } from "@/game/simulation/context";
import { createInitialState } from "@/game/simulation/create";
import { InputRecorder } from "@/game/simulation/input";
import { step } from "@/game/simulation/step";
import type { SimConfig, SimState, SimStatus } from "@/game/simulation/types";
import type { CombatKit } from "@/game/combat/kits";
import type { RunResultView } from "@/server/dungeon/service";
import { CONSUMABLES } from "@/game/items/consumables";
import { InputController, POTION_KEY, SKILL_KEYS } from "./controls";
import { GameRenderer } from "./renderer";
import { TouchControls } from "./touch-controls";

type Phase = "intro" | "playing" | "paused" | "submitting" | "result" | "error";

interface HudSnapshot {
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

const STEP_MS = DT * 1000;

/**
 * Pantalla de combate. Ejecuta la misma simulación que el servidor a paso fijo (20 ticks/s),
 * registra las intenciones del jugador y, al terminar, las envía para que el servidor repita la
 * partida y conceda las recompensas. Lo que se ve aquí es una predicción: manda el servidor.
 */
export function GameClient({
  runId,
  characterId,
  config,
  autopilot,
}: {
  runId: string;
  characterId: string;
  config: SimConfig;
  /** Solo en compilaciones de pruebas E2E: juega el piloto automático. */
  autopilot: boolean;
}) {
  const ctx = useMemo(() => createContext(config), [config]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controller = useMemo(() => new InputController(), []);
  const recorder = useRef<InputRecorder | null>(null);
  const [phase, setPhase] = useState<Phase>(autopilot ? "playing" : "intro");
  const phaseRef = useRef(phase);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [endStatus, setEndStatus] = useState<SimStatus>("RUNNING");
  const [result, setResult] = useState<RunResultView | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const isTouch = useSyncExternalStore(subscribeNoop, () => window.matchMedia("(pointer: coarse)").matches, () => false);
  const [banner, setBanner] = useState<string | null>(null);

  const player = config.players[0];
  const classDef = CLASS_DEFINITIONS[player.classId];
  const kit = getCombatKit(player.classId);
  // Habilidades tal como las resuelve la simulación (mismo código): nombre, coste y enfriamiento por hueco.
  const skills = useMemo(() => createInitialState(ctx).players[0].skills, [ctx]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const submit = useCallback(async () => {
    setPhase("submitting");
    setError(null);
    let response: SubmitRunResponse;
    try {
      response = await submitRunAction({ runId, segments: recorder.current?.segments ?? [] });
    } catch {
      response = { ok: false, code: "NETWORK", message: "No se pudo contactar con el servidor.", retryable: true };
    }
    if (response.ok) {
      setResult(response.result);
      setPhase("result");
    } else {
      setError({ message: response.message, retryable: response.retryable });
      setPhase("error");
    }
  }, [runId]);

  // Bucle principal: paso fijo con acumulador + interpolación al dibujar.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new GameRenderer(canvas, ctx.layout, player.id);
    const rec = new InputRecorder();
    recorder.current = rec;
    let state = createInitialState(ctx);
    let prev = state;
    renderer.resize();
    controller.attach(canvas);
    const onResize = () => renderer.resize();
    window.addEventListener("resize", onResize);
    const onVisibility = () => {
      if (document.hidden && phaseRef.current === "playing" && !autopilot) setPhase("paused");
    };
    document.addEventListener("visibilitychange", onVisibility);

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let lastHud = 0;
    let finished = false;
    const speed = autopilot ? 4 : 1;

    const frame = (now: number) => {
      const elapsed = Math.min(250, now - last);
      last = now;
      if (phaseRef.current === "playing" && !finished) {
        acc += elapsed * speed;
        let steps = 0;
        while (acc >= STEP_MS && steps < 8 * speed) {
          const me = state.players[0];
          const screen = renderer.worldToScreen(me.pos);
          const raw = autopilot ? botInput(ctx, state) : controller.sample(screen, nearestEnemyDir(state));
          const input = rec.push(raw);
          prev = state;
          state = step(ctx, state, [input]);
          renderer.pushEvents(state.events);
          for (const ev of state.events) {
            if (ev.type === "BOSS_PHASE") setBanner(`Fase ${ev.phase + 1}: ${ev.name}`);
            if (ev.type === "PORTAL_OPEN") setBanner("El portal se ha abierto");
          }
          acc -= STEP_MS;
          steps++;
          if (state.status !== "RUNNING") {
            finished = true;
            acc = 0;
            setEndStatus(state.status);
            window.setTimeout(() => void submit(), autopilot ? 50 : 900);
            break;
          }
        }
      } else {
        acc = 0;
      }
      renderer.render(prev, state, Math.min(1, acc / STEP_MS), elapsed / 1000);
      if (now - lastHud > 100) {
        lastHud = now;
        setHud(snapshot(state, kit, skills));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      controller.detach();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ctx, controller, player.id, autopilot, submit, kit, skills]);

  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 2600);
    return () => window.clearTimeout(t);
  }, [banner]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPhase((p) => (p === "playing" ? "paused" : p === "paused" ? "playing" : p));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="game-surface fixed inset-0 z-40 bg-abyss-950" data-testid="game-screen" data-sim-status={endStatus}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Escenario de combate" />

      {/* HUD superior */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto panel w-56 max-w-[45vw] rounded-lg p-2.5 text-xs sm:w-64">
          <p className="truncate font-display text-sm" style={{ color: classDef.accent }}>
            {player.name} · Nv {player.level}
          </p>
          <HudBar label="Vida" value={hud?.hp ?? player.stats.maxHealth} max={hud?.maxHp ?? player.stats.maxHealth} color="#d9443a" testId="hud-hp" />
          <HudBar label={classDef.resource.name} value={Math.floor(hud?.resource ?? 0)} max={hud?.maxResource ?? player.stats.maxResource} color="#4fa3d9" />
          {hud && hud.statuses.length > 0 ? <p className="mt-1 text-[11px] text-ember-400">{hud.statuses.join(" · ")}</p> : null}
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-2 text-right text-xs">
          <span className="panel rounded-md px-3 py-1.5 font-display text-sm" data-testid="hud-floor">
            Piso {config.floor}
          </span>
          <span className="panel rounded-md px-3 py-1.5" data-testid="hud-objective">
            {hud?.portalOpen ? "Entra en el portal" : hud?.boss ? "Derrota al jefe" : `Enemigos: ${hud?.enemies ?? ctx.layout.enemies.length}`}
          </span>
          {phase === "playing" ? (
            <Button variant="ghost" className="px-3 py-1.5" onClick={() => setPhase("paused")}>
              Pausa
            </Button>
          ) : null}
        </div>
      </div>

      {/* Barra del jefe */}
      {hud?.boss ? (
        <div className="pointer-events-none absolute inset-x-0 top-24 mx-auto w-[min(90vw,560px)] text-center sm:top-4">
          <p className="font-display text-sm text-ember-400">
            {hud.boss.name} — {hud.boss.phase}
          </p>
          <div className="mt-1 h-3 overflow-hidden rounded-full border border-ember-600/70 bg-abyss-950/80" role="progressbar" aria-label="Vida del jefe" aria-valuenow={hud.boss.hp} aria-valuemax={hud.boss.maxHp}>
            <div className="h-full bg-gradient-to-r from-blood-500 to-ember-500 transition-[width]" style={{ width: `${(hud.boss.hp / hud.boss.maxHp) * 100}%` }} />
          </div>
          {hud.boss.warning ? <p className="mt-1 text-sm font-semibold text-blood-400">¡{hud.boss.warning}!</p> : null}
        </div>
      ) : null}

      {hud?.warning && !hud.boss ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 text-center">
          <p className="text-sm font-semibold text-blood-400">¡{hud.warning}!</p>
        </div>
      ) : null}

      {banner ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center">
          <p className="ember-glow font-display text-2xl text-ember-400 sm:text-3xl">{banner}</p>
        </div>
      ) : null}

      {/* Enfriamientos */}
      <div className={`pointer-events-none absolute flex gap-2 ${isTouch ? "left-3 top-32 max-w-[62vw] flex-wrap" : "bottom-3 left-1/2 -translate-x-1/2"}`}>
        <Cooldown label={kit.basic.name} hint={isTouch ? "" : "Clic / J"} ratio={hud?.attack ?? 0} />
        <Cooldown label="Esquiva" hint={isTouch ? "" : "Espacio"} ratio={hud?.dodge ?? 0} />
        {skills.map((skill, slot) =>
          skill ? (
            <Cooldown
              key={slot}
              label={skill.name}
              hint={isTouch ? "" : SKILL_KEYS[slot].toUpperCase()}
              ratio={hud?.skills[slot]?.ratio ?? 0}
              disabled={hud ? !hud.skills[slot]?.affordable : false}
              ultimate={slot === 3}
              testId={`hud-skill-${slot}`}
            />
          ) : null,
        )}
        <Cooldown label={`Poción ×${hud?.potions ?? player.potions}`} hint={isTouch ? "" : POTION_KEY} ratio={hud?.potion ?? 0} disabled={(hud?.potions ?? player.potions) === 0} testId="hud-potions" />
      </div>

      {isTouch && phase === "playing" ? <TouchControls controller={controller} skills={skills.map((s) => s?.name ?? null)} potions={hud?.potions ?? player.potions} /> : null}

      {phase !== "playing" ? (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-abyss-950/75 p-4 backdrop-blur-sm">
          <div className="panel my-auto w-full max-w-2xl rounded-xl p-6">
            {phase === "intro" ? (
              <div className="space-y-4 text-center">
                <h1 className="font-display text-3xl">Piso {config.floor}</h1>
                <p className="text-sm text-bone-300">
                  {ctx.layout.boss
                    ? `${BOSS_DEFINITIONS[ctx.layout.boss.id].name}, ${BOSS_DEFINITIONS[ctx.layout.boss.id].title}, te espera. ${BOSS_DEFINITIONS[ctx.layout.boss.id].lore}`
                    : "Elimina a todos los enemigos y cruza el portal para completar el piso."}
                </p>
                <ul className="mx-auto max-w-md space-y-1 text-left text-xs text-bone-300">
                  <li>
                    <strong className="text-bone-100">Moverse:</strong> WASD o flechas (joystick en móvil)
                  </li>
                  <li>
                    <strong className="text-bone-100">Atacar:</strong> clic izquierdo o J, apuntando con el ratón
                  </li>
                  <li>
                    <strong className="text-bone-100">Esquivar:</strong> Espacio. Eres invulnerable durante la esquiva
                  </li>
                  {skills.map((skill, slot) =>
                    skill ? (
                      <li key={slot}>
                        <strong className="text-bone-100">
                          {skill.name}
                          {slot === 3 ? " (definitiva)" : ""}:
                        </strong>{" "}
                        {SKILL_KEYS[slot].toUpperCase()}
                        {slot === 0 ? " o clic derecho" : ""}. Cuesta {skill.resourceCost} de {classDef.resource.name.toLowerCase()} · {skill.cooldown} s de enfriamiento
                      </li>
                    ) : null,
                  )}
                  <li>
                    <strong className="text-bone-100">Poción:</strong> {POTION_KEY}. Llevas {player.potions}; cada una cura el{" "}
                    {Math.round(CONSUMABLES.HEALTH_POTION.healRatio * 100)} % de tu vida.
                  </li>
                  <li>Las zonas rojas avisan de un ataque. Los enemigos con borde verde están recuperándose: es tu momento.</li>
                </ul>
                <Button onClick={() => setPhase("playing")} data-testid="start-floor">
                  Comenzar
                </Button>
              </div>
            ) : null}
            {phase === "paused" ? (
              <div className="space-y-4 text-center">
                <h2 className="font-display text-2xl">En pausa</h2>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => setPhase("playing")}>Reanudar</Button>
                  <form action={abandonRunAction}>
                    <input type="hidden" name="runId" value={runId} />
                    <input type="hidden" name="characterId" value={characterId} />
                    <Button type="submit" variant="danger">
                      Abandonar el piso
                    </Button>
                  </form>
                </div>
                <p className="text-xs text-bone-500">Abandonar no da recompensas, pero tampoco hay penalización.</p>
              </div>
            ) : null}
            {phase === "submitting" ? (
              <div className="space-y-2 text-center" role="status">
                <h2 className="font-display text-2xl">{endStatus === "VICTORY" ? "Validando tu victoria…" : "Registrando la derrota…"}</h2>
                <p className="text-sm text-bone-300">El servidor está repitiendo la partida para calcular las recompensas.</p>
              </div>
            ) : null}
            {phase === "error" && error ? (
              <div className="space-y-4 text-center">
                <h2 className="font-display text-2xl text-blood-400">No se pudo validar la partida</h2>
                <p className="text-sm text-bone-300" role="alert">
                  {error.message}
                </p>
                <div className="flex justify-center gap-2">
                  {error.retryable ? <Button onClick={() => void submit()}>Reintentar envío</Button> : null}
                  <Link href={`/characters/${characterId}`} className={buttonStyles("ghost")}>
                    Volver al personaje
                  </Link>
                </div>
              </div>
            ) : null}
            {phase === "result" && result ? <RunResult result={result} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function snapshot(state: SimState, kit: CombatKit, skills: SimState["players"][number]["skills"]): HudSnapshot {
  const me = state.players[0];
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

const subscribeNoop = () => () => undefined;

function nearestEnemyDir(state: SimState): { x: number; y: number } | null {
  const me = state.players[0];
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

function HudBar({ label, value, max, color, testId }: { label: string; value: number; max: number; color: string; testId?: string }) {
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

function Cooldown({ label, hint, ratio, disabled, ultimate, testId }: { label: string; hint: string; ratio: number; disabled?: boolean; ultimate?: boolean; testId?: string }) {
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
