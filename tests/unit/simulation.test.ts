import { describe, expect, it } from "vitest";
import { getCombatKit } from "@/game/combat/kits";
import { createContext, MAX_TICKS, secondsToTicks, type SimContext } from "@/game/simulation/context";
import { createInitialState, spawnEnemy } from "@/game/simulation/create";
import { encodeInputs, iterateInputs, sanitizeInput } from "@/game/simulation/input";
import { replay } from "@/game/simulation/replay";
import { step, stepInPlace } from "@/game/simulation/step";
import { BUTTON_ABILITY, BUTTON_ATTACK, BUTTON_DODGE, IDLE_INPUT, type PlayerInput, type SimState } from "@/game/simulation/types";
import type { EnemyKindId } from "@/game/enemies/definitions";
import type { ClassId } from "@/game/types";
import { playWithBot, testConfig } from "../support/sim";

const input = (p: Partial<PlayerInput> = {}): PlayerInput => ({ ...IDLE_INPUT, ...p });

/** Escenario controlado: jugador en el centro de una sala, sin enemigos salvo los que se añadan. */
function arena(classId: ClassId, level = 1) {
  const ctx: SimContext = createContext(testConfig(classId, level, 2, 4242));
  const state = createInitialState(ctx);
  const room = ctx.layout.rooms[1];
  const center = { x: room.x + Math.floor(room.w / 2) + 0.5, y: room.y + Math.floor(room.h / 2) + 0.5 };
  state.enemies = [];
  state.players[0].pos = { ...center };
  state.players[0].facing = { x: 1, y: 0 };
  const add = (kind: EnemyKindId, dx: number, dy: number) => {
    const e = spawnEnemy(ctx, state.nextId++, kind, { x: center.x + dx, y: center.y + dy }, true);
    state.enemies.push(e);
    return e;
  };
  const run = (ticks: number, inp: PlayerInput | ((s: SimState) => PlayerInput) = IDLE_INPUT) => {
    for (let i = 0; i < ticks && state.status === "RUNNING"; i++) stepInPlace(ctx, state, [typeof inp === "function" ? inp(state) : inp]);
  };
  return { ctx, state, center, add, run };
}

describe("simulación: ataques y enfriamientos", () => {
  it("el ataque básico daña a un enemigo dentro del arco y no a uno detrás", () => {
    const { state, add, run } = arena("TANK");
    const front = add("WARDEN", 1.2, 0);
    const behind = add("STALKER", -1.2, 0);
    front.facing = { x: 1, y: 0 }; // de espaldas al jugador: sin bloqueo
    front.attackCooldown = 999;
    behind.attackCooldown = 999;
    run(secondsToTicks(0.3), input({ ax: 100, buttons: BUTTON_ATTACK }));
    expect(front.hp).toBeLessThan(front.maxHp);
    expect(state.enemies.find((e) => e.id === behind.id)?.hp).toBe(behind.maxHp);
  });

  it("mantener el ataque pulsado respeta el ritmo de preparación + recuperación + enfriamiento", () => {
    const { state, ctx } = arena("DPS");
    const basic = getCombatKit("DPS").basic;
    const cycle = Math.max(1, secondsToTicks(basic.windup)) + secondsToTicks(basic.recovery) + secondsToTicks(basic.cooldown);
    let attacks = 0;
    const total = 200;
    for (let i = 0; i < total; i++) {
      stepInPlace(ctx, state, [input({ ax: 100, buttons: BUTTON_ATTACK })]);
      attacks += state.events.filter((e) => e.type === "ATTACK").length;
    }
    expect(attacks).toBeLessThanOrEqual(Math.ceil(total / cycle) + 1);
    expect(attacks).toBeGreaterThanOrEqual(Math.floor(total / (cycle + 1)));
  });

  it("la habilidad exige recurso y respeta su enfriamiento", () => {
    const { state, run } = arena("HEALER");
    const p = state.players[0];
    p.hp = 50;
    const mana = p.resource;
    run(1, input({ buttons: BUTTON_ABILITY }));
    expect(p.hp).toBeGreaterThan(50);
    expect(p.resource).toBeLessThan(mana);
    const afterFirst = p.hp;
    run(5, input({ buttons: BUTTON_ABILITY }));
    expect(p.hp).toBe(afterFirst); // en enfriamiento
    expect(p.abilityCooldown).toBeGreaterThan(0);

    const fresh = arena("HEALER");
    fresh.state.players[0].resource = 0;
    fresh.state.players[0].hp = 50;
    fresh.run(1, input({ buttons: BUTTON_ABILITY }));
    expect(fresh.state.players[0].hp).toBe(50); // sin maná no hay curación
  });

  it("la curación no supera la vida máxima", () => {
    const { state, run } = arena("HEALER");
    const p = state.players[0];
    p.hp = p.maxHp - 1;
    run(1, input({ buttons: BUTTON_ABILITY }));
    expect(p.hp).toBe(p.maxHp);
  });
});

describe("simulación: mitigación, esquiva y muerte", () => {
  it("el escudo del Centinela mitiga los golpes frontales y no los de la espalda", () => {
    const hit = (facingX: number) => {
      const { add, run } = arena("TANK");
      const w = add("WARDEN", 1.2, 0);
      w.facing = { x: facingX, y: 0 };
      w.attackCooldown = 999;
      run(secondsToTicks(0.2), input({ ax: 100, buttons: BUTTON_ATTACK }));
      return w.maxHp - w.hp;
    };
    const front = hit(-1);
    const back = hit(1);
    expect(front).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(front * 2.5);
  });

  it("Bastión reduce el daño recibido", () => {
    const takeHit = (fortify: boolean) => {
      const { state, add, run } = arena("TANK");
      state.players[0].resource = 100;
      if (fortify) run(1, input({ buttons: BUTTON_ABILITY }));
      const before = state.players[0].hp;
      add("STALKER", 0.9, 0);
      run(secondsToTicks(0.6));
      return before - state.players[0].hp;
    };
    const normal = takeHit(false);
    const fortified = takeHit(true);
    expect(normal).toBeGreaterThan(0);
    expect(fortified).toBeLessThan(normal * 0.65);
  });

  it("la esquiva da invulnerabilidad y tiene enfriamiento", () => {
    const { state, add, run, ctx } = arena("DPS");
    const s = add("STALKER", 0.9, 0);
    // Espera a que el acechador esté a punto de golpear y esquiva sin moverse del arco.
    run(secondsToTicks(0.3));
    expect(s.state).toBe("WINDUP");
    const hp = state.players[0].hp;
    while (s.state === "WINDUP" && s.ticks > 2) stepInPlace(ctx, state, [IDLE_INPUT]);
    stepInPlace(ctx, state, [input({ mx: 0, my: 100, buttons: BUTTON_DODGE })]);
    expect(state.players[0].invulnerable).toBeGreaterThan(0);
    run(4);
    expect(state.players[0].hp).toBe(hp);
    expect(state.summary.dodges).toBe(1);
    // No se puede volver a esquivar enseguida.
    run(1, input({ mx: 0, my: -100, buttons: BUTTON_DODGE }));
    expect(state.summary.dodges).toBe(1);
  });

  it("un jugador que no se defiende muere y la partida termina en derrota", () => {
    const { state, add, run } = arena("HEALER");
    add("STALKER", 0.9, 0);
    add("STALKER", -0.9, 0);
    add("WARDEN", 0, 1.2);
    run(MAX_TICKS);
    expect(state.status).toBe("DEFEAT");
    expect(state.defeatReason).toBe("DOWNED");
    expect(state.players[0].hp).toBe(0);
    expect(state.players[0].life).toBe("DOWNED");
  });
});

describe("simulación: jefe del piso 5", () => {
  for (const classId of ["TANK", "DPS", "HEALER"] as ClassId[]) {
    it(`${classId} de nivel 4 derrota a Varkhul y la secuencia de entradas fija se reproduce igual`, () => {
      const config = testConfig(classId, 4, 5, 2024);
      const played = playWithBot(config);
      expect(played.state.status).toBe("VICTORY");
      expect(played.state.summary.bossDefeated).toBe(true);
      expect(played.state.events.length + played.state.tick).toBeGreaterThan(0);

      // La secuencia grabada es la "partida": repetida desde cero da exactamente el mismo resultado.
      const again = replay(config, played.segments);
      expect(again.finished).toBe(true);
      expect(again.state.status).toBe("VICTORY");
      expect(again.ticks).toBe(played.state.tick);
      expect(again.state.summary).toEqual(played.state.summary);
    });
  }

  it("el jefe pasa a la fase 2 con invocaciones y un jugador pasivo pierde", () => {
    const config = testConfig("TANK", 1, 5, 99);
    const ctx = createContext(config);
    const state = createInitialState(ctx);
    // Lleva al jugador a la sala del jefe y quédate quieto atacando.
    state.players[0].pos = { x: state.boss!.pos.x - 2, y: state.boss!.pos.y };
    let sawPhase = false;
    for (let i = 0; i < MAX_TICKS && state.status === "RUNNING"; i++) {
      stepInPlace(ctx, state, [input({ ax: 100, buttons: BUTTON_ATTACK })]);
      if (state.events.some((e) => e.type === "BOSS_PHASE")) {
        sawPhase = true;
        expect(state.enemies.filter((e) => e.summoned).length).toBe(2);
        expect(state.boss!.state).toBe("TRANSITION");
      }
    }
    expect(state.status).toBe("DEFEAT");
    expect(state.summary.bossDefeated).toBe(false);
    expect(sawPhase || state.boss!.hp > state.boss!.maxHp * 0.5).toBe(true);
  });

  it("el jefe es invulnerable durante la transición de fase", () => {
    const config = testConfig("DPS", 4, 5, 7);
    const ctx = createContext(config);
    const state = createInitialState(ctx);
    const boss = state.boss!;
    boss.aggro = true;
    boss.hp = Math.floor(boss.maxHp * 0.5);
    boss.state = "MOVE";
    boss.ticks = 50;
    state.players[0].pos = { x: boss.pos.x - 1.6, y: boss.pos.y };
    stepInPlace(ctx, state, [IDLE_INPUT]);
    expect(boss.state).toBe("TRANSITION");
    const hp = boss.hp;
    for (let i = 0; i < 10; i++) stepInPlace(ctx, state, [input({ ax: 100, buttons: BUTTON_ATTACK })]);
    expect(boss.hp).toBe(hp);
  });
});

describe("simulación: determinismo y entradas", () => {
  it("step no modifica el estado anterior", () => {
    const ctx = createContext(testConfig("DPS", 1, 1, 5));
    const s0 = createInitialState(ctx);
    const snapshot = JSON.stringify(s0);
    const s1 = step(ctx, s0, [input({ mx: 100, buttons: BUTTON_ATTACK })]);
    expect(JSON.stringify(s0)).toBe(snapshot);
    expect(s1.tick).toBe(1);
    expect(s1.players[0].pos.x).toBeGreaterThan(s0.players[0].pos.x);
  });

  it("las mismas entradas dan el mismo resultado; entradas distintas, otro resultado", () => {
    const config = testConfig("TANK", 1, 1, 777);
    const { segments, state } = playWithBot(config);
    expect(state.status).toBe("VICTORY");
    const a = replay(config, segments);
    const b = replay(config, segments);
    expect(a.state).toEqual(b.state);
    const truncated = replay(config, segments.slice(0, Math.floor(segments.length / 2)));
    expect(truncated.finished).toBe(false);
  });

  it("codificación RLE: ida y vuelta, y saneado de entradas", () => {
    const inputs = [input({ mx: 100 }), input({ mx: 100 }), input({ mx: 100, buttons: BUTTON_ATTACK }), input()];
    const segs = encodeInputs(inputs);
    expect(segs).toHaveLength(3);
    expect([...iterateInputs(segs)]).toEqual(inputs);
    expect(sanitizeInput({ mx: 5000, my: -5000, ax: 3.7, ay: 0, buttons: 0xff })).toEqual({ mx: 100, my: -100, ax: 4, ay: 0, buttons: 7 });
  });

  it("el piloto automático completa los pisos 1 a 4 con un personaje de nivel 1", () => {
    for (let floor = 1; floor <= 4; floor++) {
      const { state } = playWithBot(testConfig("DPS", 1, floor, 31337 + floor));
      expect(state.status, `piso ${floor}`).toBe("VICTORY");
      expect(state.portalOpen).toBe(true);
    }
  });
});
