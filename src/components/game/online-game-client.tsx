"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getExpeditionResultAction, leaveExpeditionAction } from "@/app/(game)/party/actions";
import { RunResult } from "@/components/dungeon/run-result";
import { Button, buttonStyles } from "@/components/ui/button";
import { BALANCE } from "@/game/balance";
import { BOSS_DEFINITIONS } from "@/game/bosses/definitions";
import { CLASS_DEFINITIONS } from "@/game/classes/definitions";
import { getCombatKit } from "@/game/combat/kits";
import { CONSUMABLES } from "@/game/items/consumables";
import { botInput } from "@/game/simulation/bot";
import { createContext } from "@/game/simulation/context";
import { createInitialState } from "@/game/simulation/create";
import type { PlayerInput, SimConfig, SimState } from "@/game/simulation/types";
import { type ExpeditionEndStatus, fromNetState, type RoomPhase, type ServerMessage } from "@/realtime/protocol";
import type { RunResultView } from "@/server/dungeon/service";
import { InputController, POTION_KEY, REVIVE_KEY, SKILL_KEYS } from "./controls";
import { Cooldown, HudBar, type HudSnapshot, nearestEnemyDir, snapshot, subscribeNoop } from "./hud";
import { GameRenderer } from "./renderer";
import { TouchControls } from "./touch-controls";

type Phase = "connecting" | "waiting" | "playing" | "ended" | "result" | "left" | "error";

const INPUT_MS = 50;
const KEEPALIVE_MS = 1000;
/** Intervalo esperado entre instantáneas (10 Hz): se dibuja interpolando entre las dos últimas. */
const SNAPSHOT_MS = 100;
const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000];

/** Cierres de la sala que no se reintentan (ver CLOSE en src/realtime/room.ts). */
const CLOSE_FINISHED = 4001;
const CLOSE_LEFT = 4002;
const CLOSE_UNKNOWN = 4003;
const CLOSE_REPLACED = 4000;

const sameInput = (a: PlayerInput, b: PlayerInput) => a.mx === b.mx && a.my === b.my && a.ax === b.ax && a.ay === b.ay && a.buttons === b.buttons;

/**
 * Partida en grupo. La simulación corre en el servidor de partida: aquí solo se envían intenciones
 * (20/s como máximo, y solo cuando cambian) y se dibuja el estado recibido, interpolado.
 */
export function OnlineGameClient({
  expeditionId,
  characterId,
  config,
  autopilot,
}: {
  expeditionId: string;
  characterId: string;
  config: SimConfig;
  autopilot: boolean;
}) {
  const router = useRouter();
  const ctx = useMemo(() => createContext(config), [config]);
  const playerIndex = Math.max(0, config.players.findIndex((p) => p.id === characterId));
  const player = config.players[playerIndex];
  const classDef = CLASS_DEFINITIONS[player.classId];
  const kit = getCombatKit(player.classId);
  const skills = useMemo(() => createInitialState(ctx).players[playerIndex].skills, [ctx, playerIndex]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controller = useMemo(() => new InputController(), []);
  const [phase, setPhase] = useState<Phase>("connecting");
  const phaseRef = useRef<Phase>("connecting");
  const [reconnecting, setReconnecting] = useState(false);
  const [startsIn, setStartsIn] = useState<number | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [allies, setAllies] = useState<{ id: string; name: string; hp: number; maxHp: number; life: string; presence: string }[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [endStatus, setEndStatus] = useState<ExpeditionEndStatus | null>(null);
  const [result, setResult] = useState<RunResultView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const isTouch = useSyncExternalStore(subscribeNoop, () => window.matchMedia("(pointer: coarse)").matches, () => false);

  const wsRef = useRef<WebSocket | null>(null);
  const frames = useRef<{ prev: SimState | null; curr: SimState | null; at: number }>({ prev: null, curr: null, at: 0 });
  const skillsById = useRef(new Map<string, SimState["players"][number]["skills"]>());
  const rendererRef = useRef<GameRenderer | null>(null);
  const [myLife, setMyLife] = useState<"ALIVE" | "DOWNED">("ALIVE");

  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  // Resultado: lo aplica Vercel cuando el servidor de partida lo entrega (puede tardar unos segundos).
  const polling = useRef(false);
  const pollResult = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    go("ended");
    for (let i = 0; i < 40; i++) {
      try {
        const r = await getExpeditionResultAction(expeditionId);
        if (r.state === "DONE") {
          setResult(r.result);
          go("result");
          return;
        }
        if (r.state === "ABANDONED" || r.state === "NOT_FOUND") {
          go("left");
          return;
        }
      } catch {
        // Error de red: se reintenta.
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
    setError("El resultado está tardando más de lo normal. Lo verás en el historial del personaje.");
    go("error");
  }, [expeditionId, go]);

  // Conexión con reconexión automática (cada intento pide un ticket nuevo).
  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let timer: number | undefined;

    const scheduleReconnect = () => {
      if (disposed) return;
      setReconnecting(true);
      timer = window.setTimeout(connect, RECONNECT_DELAYS[Math.min(attempt++, RECONNECT_DELAYS.length - 1)]);
    };

    const onMessage = (msg: ServerMessage) => {
      switch (msg.t) {
        case "welcome": {
          attempt = 0;
          setReconnecting(false);
          skillsById.current = new Map(msg.state.players.map((p) => [p.id, p.skills]));
          frames.current = { prev: msg.state, curr: msg.state, at: performance.now() };
          applyPhase(msg.phase, msg.startsInMs);
          return;
        }
        case "state": {
          const state = fromNetState(msg.state, skillsById.current, msg.events);
          frames.current = { prev: frames.current.curr ?? state, curr: state, at: performance.now() };
          rendererRef.current?.pushEvents(msg.events);
          for (const ev of msg.events) {
            if (ev.type === "BOSS_PHASE") setBanner(`Fase ${ev.phase + 1}: ${ev.name}`);
            if (ev.type === "PORTAL_OPEN") setBanner("El portal se ha abierto");
            if (ev.type === "PLAYER_DOWNED") setBanner(ev.playerId === characterId ? "Has caído. Un aliado puede reanimarte" : `${nameOf(ev.playerId)} ha caído`);
            if (ev.type === "PLAYER_REVIVED") setBanner(`${nameOf(ev.playerId)} vuelve a la lucha`);
          }
          applyPhase(msg.phase, msg.startsInMs);
          return;
        }
        case "end":
          setEndStatus(msg.status);
          void pollResult();
          return;
        case "error":
          // Avisos de mensajes rechazados: no interrumpen la partida.
          if (msg.code === "UNKNOWN_PLAYER" || msg.code === "LEFT") setError(msg.message);
          return;
        default:
          return;
      }
    };

    const applyPhase = (roomPhase: RoomPhase, startsInMs: number | null) => {
      setStartsIn(startsInMs);
      if (phaseRef.current === "ended" || phaseRef.current === "result" || phaseRef.current === "left") return;
      if (roomPhase === "WAITING") go("waiting");
      else if (roomPhase === "RUNNING") go("playing");
    };

    async function connect() {
      if (disposed) return;
      let ticket: { url: string; ticket: string };
      try {
        const res = await fetch(`/api/expeditions/${encodeURIComponent(expeditionId)}/ticket`, { method: "POST" });
        if (res.status === 404) return void pollResult();
        if (!res.ok) throw new Error(String(res.status));
        ticket = await res.json();
      } catch {
        return scheduleReconnect();
      }
      if (disposed) return;
      const ws = new WebSocket(`${ticket.url}?ticket=${encodeURIComponent(ticket.ticket)}`);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        if (typeof e.data !== "string") return;
        try {
          onMessage(JSON.parse(e.data) as ServerMessage);
        } catch {
          // Mensaje ilegible: se ignora.
        }
      };
      ws.onclose = (e) => {
        if (wsRef.current === ws) wsRef.current = null;
        if (disposed || phaseRef.current === "left") return;
        if (e.code === CLOSE_FINISHED) return void pollResult();
        if (e.code === CLOSE_LEFT || e.code === CLOSE_UNKNOWN) {
          go("left");
          return;
        }
        if (e.code === CLOSE_REPLACED) {
          setError("Has abierto esta expedición en otra pestaña o dispositivo.");
          go("error");
          return;
        }
        if (phaseRef.current !== "ended" && phaseRef.current !== "result") scheduleReconnect();
      };
    }

    const nameOf = (id: string) => config.players.find((p) => p.id === id)?.name ?? "Un aliado";
    void connect();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      wsRef.current?.close(1000, "Saliendo");
      wsRef.current = null;
    };
  }, [expeditionId, characterId, config.players, go, pollResult]);

  // Dibujo + envío de intenciones.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new GameRenderer(canvas, ctx.layout, characterId);
    rendererRef.current = renderer;
    renderer.resize();
    controller.attach(canvas);
    const onResize = () => renderer.resize();
    window.addEventListener("resize", onResize);

    let seq = 0;
    let lastSent: PlayerInput | null = null;
    let lastSentAt = 0;
    const sendTimer = window.setInterval(() => {
      const ws = wsRef.current;
      const curr = frames.current.curr;
      if (!ws || ws.readyState !== WebSocket.OPEN || !curr || phaseRef.current !== "playing") return;
      const me = curr.players[playerIndex];
      const raw = autopilot ? botInput(ctx, curr, playerIndex) : controller.sample(renderer.worldToScreen(me.pos), nearestEnemyDir(curr, playerIndex));
      const now = performance.now();
      if (lastSent && sameInput(lastSent, raw) && now - lastSentAt < KEEPALIVE_MS) return;
      seq++;
      ws.send(JSON.stringify({ t: "in", s: seq, i: raw }));
      lastSent = raw;
      lastSentAt = now;
    }, INPUT_MS);

    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    const frame = (now: number) => {
      const elapsed = Math.min(250, now - last);
      last = now;
      const { prev, curr, at } = frames.current;
      if (prev && curr) {
        renderer.render(prev, curr, Math.min(1, (now - at) / SNAPSHOT_MS), elapsed / 1000);
        if (now - lastHud > 100) {
          lastHud = now;
          setHud(snapshot(curr, kit, skills, playerIndex));
          setMyLife(curr.players[playerIndex].life);
          setAllies(curr.players.filter((p) => p.id !== characterId).map((p) => ({ id: p.id, name: p.name, hp: p.hp, maxHp: p.maxHp, life: p.life, presence: p.presence })));
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(sendTimer);
      controller.detach();
      window.removeEventListener("resize", onResize);
      rendererRef.current = null;
    };
  }, [ctx, controller, characterId, playerIndex, autopilot, kit, skills]);

  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 2600);
    return () => window.clearTimeout(t);
  }, [banner]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu((m) => !m);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const leave = async () => {
    wsRef.current?.send(JSON.stringify({ t: "leave" }));
    go("left");
    await leaveExpeditionAction(expeditionId);
    router.push("/party");
  };

  const overlay = phase !== "playing" || menu;

  return (
    <div className="game-surface fixed inset-0 z-40 bg-abyss-950" data-testid="game-screen" data-online-phase={phase} data-end-status={endStatus ?? ""}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Escenario de combate" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto space-y-2">
          <div className="panel w-56 max-w-[45vw] rounded-lg p-2.5 text-xs sm:w-64">
            <p className="truncate font-display text-sm" style={{ color: classDef.accent }}>
              {player.name} · Nv {player.level}
            </p>
            <HudBar label="Vida" value={hud?.hp ?? player.stats.maxHealth} max={hud?.maxHp ?? player.stats.maxHealth} color="#d9443a" testId="hud-hp" />
            <HudBar label={classDef.resource.name} value={Math.floor(hud?.resource ?? 0)} max={hud?.maxResource ?? player.stats.maxResource} color="#4fa3d9" />
            {hud && hud.statuses.length > 0 ? <p className="mt-1 text-[11px] text-ember-400">{hud.statuses.join(" · ")}</p> : null}
          </div>
          {allies.length > 0 ? (
            <ul className="panel w-44 space-y-1 rounded-lg p-2 text-[11px]" data-testid="hud-allies">
              {allies.map((a) => (
                <li key={a.id}>
                  <div className="flex justify-between">
                    <span className="truncate">{a.name}</span>
                    <span className={a.life === "DOWNED" ? "text-blood-400" : a.presence !== "CONNECTED" ? "text-bone-500" : "text-bone-300"}>
                      {a.presence === "LEFT" ? "fuera" : a.life === "DOWNED" ? "caído" : a.presence === "DISCONNECTED" ? "sin conexión" : `${a.hp}`}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-abyss-950">
                    <div className="h-full bg-blood-500" style={{ width: `${a.maxHp > 0 ? (a.hp / a.maxHp) * 100 : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-2 text-right text-xs">
          <span className="panel rounded-md px-3 py-1.5 font-display text-sm" data-testid="hud-floor">
            Piso {config.floor} · Grupo de {config.players.length}
          </span>
          <span className="panel rounded-md px-3 py-1.5" data-testid="hud-objective">
            {hud?.portalOpen ? "Entrad en el portal" : hud?.boss ? "Derrotad al jefe" : `Enemigos: ${hud?.enemies ?? ctx.layout.enemies.length}`}
          </span>
          {reconnecting ? (
            <span className="panel rounded-md px-3 py-1.5 text-ember-400" role="status">
              Reconectando…
            </span>
          ) : null}
          <Button variant="ghost" className="px-3 py-1.5" onClick={() => setMenu(true)}>
            Menú
          </Button>
        </div>
      </div>

      {hud?.boss ? (
        <div className="pointer-events-none absolute inset-x-0 top-28 mx-auto w-[min(90vw,560px)] text-center sm:top-4">
          <p className="font-display text-sm text-ember-400">
            {hud.boss.name} — {hud.boss.phase}
          </p>
          <div className="mt-1 h-3 overflow-hidden rounded-full border border-ember-600/70 bg-abyss-950/80" role="progressbar" aria-label="Vida del jefe" aria-valuenow={hud.boss.hp} aria-valuemax={hud.boss.maxHp}>
            <div className="h-full bg-gradient-to-r from-blood-500 to-ember-500 transition-[width]" style={{ width: `${(hud.boss.hp / hud.boss.maxHp) * 100}%` }} />
          </div>
          {hud.boss.warning ? <p className="mt-1 text-sm font-semibold text-blood-400">¡{hud.boss.warning}!</p> : null}
        </div>
      ) : null}

      {banner ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center">
          <p className="ember-glow font-display text-2xl text-ember-400 sm:text-3xl">{banner}</p>
        </div>
      ) : null}

      {phase === "playing" && myLife === "DOWNED" ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 text-center">
          <p className="text-sm font-semibold text-blood-400">Estás derribado. Un aliado puede reanimarte manteniendo {REVIVE_KEY.toUpperCase()} a tu lado.</p>
        </div>
      ) : null}

      <div className={`pointer-events-none absolute flex gap-2 ${isTouch ? "left-3 top-48 max-w-[62vw] flex-wrap" : "bottom-3 left-1/2 -translate-x-1/2"}`}>
        <Cooldown label={kit.basic.name} hint={isTouch ? "" : "Clic / J"} ratio={hud?.attack ?? 0} />
        <Cooldown label="Esquiva" hint={isTouch ? "" : "Espacio"} ratio={hud?.dodge ?? 0} />
        {skills.map((skill, slot) =>
          skill ? (
            <Cooldown key={slot} label={skill.name} hint={isTouch ? "" : SKILL_KEYS[slot].toUpperCase()} ratio={hud?.skills[slot]?.ratio ?? 0} disabled={hud ? !hud.skills[slot]?.affordable : false} ultimate={slot === 3} />
          ) : null,
        )}
        <Cooldown label={`Poción ×${hud?.potions ?? player.potions}`} hint={isTouch ? "" : POTION_KEY} ratio={hud?.potion ?? 0} disabled={(hud?.potions ?? player.potions) === 0} />
        <Cooldown label="Reanimar" hint={isTouch ? "" : `${REVIVE_KEY.toUpperCase()} (mantener)`} ratio={0} />
      </div>

      {isTouch && phase === "playing" ? <TouchControls controller={controller} skills={skills.map((s) => s?.name ?? null)} potions={hud?.potions ?? player.potions} revive /> : null}

      {overlay ? (
        <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-abyss-950/75 p-4 backdrop-blur-sm">
          <div className="panel my-auto w-full max-w-2xl rounded-xl p-6">
            {menu && phase === "playing" ? (
              <div className="space-y-4 text-center">
                <h2 className="font-display text-2xl">Menú</h2>
                <p className="text-sm text-bone-300">La partida sigue mientras el menú está abierto: tus aliados siguen luchando.</p>
                <ul className="mx-auto max-w-md space-y-1 text-left text-xs text-bone-300">
                  <li>Moverse: WASD · Atacar: clic o J · Esquivar: Espacio · Habilidades: Q E R F · Poción: {POTION_KEY}</li>
                  <li>
                    Reanimar: mantén {REVIVE_KEY.toUpperCase()} junto a un aliado caído durante {BALANCE.multiplayer.revive.seconds} s (sin moverte). Vuelve con el{" "}
                    {Math.round(BALANCE.multiplayer.revive.healthRatio * 100)} % de vida.
                  </li>
                  <li>Cada poción cura el {Math.round(CONSUMABLES.HEALTH_POTION.healRatio * 100)} % de tu vida.</li>
                </ul>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => setMenu(false)}>Volver</Button>
                  <Button variant="danger" onClick={() => void leave()} data-testid="leave-expedition">
                    Abandonar la expedición
                  </Button>
                </div>
                <p className="text-xs text-bone-500">Si abandonas no recibes recompensas; el grupo puede seguir sin ti.</p>
              </div>
            ) : null}
            {phase === "connecting" ? (
              <p className="text-center font-display text-xl" role="status">
                Conectando con la expedición…
              </p>
            ) : null}
            {phase === "waiting" ? (
              <div className="space-y-2 text-center" role="status">
                <h1 className="font-display text-3xl">Piso {config.floor}</h1>
                <p className="text-sm text-bone-300">
                  {ctx.layout.boss ? `${BOSS_DEFINITIONS[ctx.layout.boss.id].name} os espera.` : "Eliminad a todos los enemigos y cruzad el portal."}
                </p>
                <p className="text-sm text-ember-400">Esperando al resto del grupo{startsIn !== null ? ` (empieza en ${Math.ceil(startsIn / 1000)} s como máximo)` : ""}…</p>
              </div>
            ) : null}
            {phase === "ended" ? (
              <div className="space-y-2 text-center" role="status">
                <h2 className="font-display text-2xl">
                  {endStatus === "VICTORY" ? "¡Victoria!" : endStatus === "DEFEAT" ? "El grupo ha caído" : "Expedición terminada"}
                </h2>
                <p className="text-sm text-bone-300">Registrando las recompensas…</p>
              </div>
            ) : null}
            {phase === "result" && result ? (
              <div className="space-y-4">
                <RunResult result={result} />
                <div className="text-center">
                  <Link href="/party" className={buttonStyles("secondary")}>
                    Volver al grupo
                  </Link>
                </div>
              </div>
            ) : null}
            {phase === "left" ? (
              <div className="space-y-3 text-center">
                <h2 className="font-display text-2xl">Has salido de la expedición</h2>
                <Link href="/party" className={buttonStyles("secondary")}>
                  Volver al grupo
                </Link>
              </div>
            ) : null}
            {phase === "error" ? (
              <div className="space-y-3 text-center">
                <p className="text-sm text-blood-400" role="alert">
                  {error ?? "Se perdió la conexión con la expedición."}
                </p>
                <Link href="/party" className={buttonStyles("secondary")}>
                  Volver al grupo
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
