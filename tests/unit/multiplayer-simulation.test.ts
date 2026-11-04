import { describe, expect, it } from "vitest";
import { BALANCE } from "@/game/balance";
import { createContext, partyScaling, secondsToTicks } from "@/game/simulation/context";
import { createInitialState, spawnEnemy } from "@/game/simulation/create";
import { setPresence, stepInPlace } from "@/game/simulation/step";
import { BUTTON_INTERACT, IDLE_INPUT, type PlayerInput } from "@/game/simulation/types";
import { partyConfig, testConfig } from "../support/sim";

const hold = (buttons: number): PlayerInput => ({ ...IDLE_INPUT, buttons });

function duo() {
  const ctx = createContext(partyConfig(["TANK", "HEALER"], 5, 2, 777));
  const state = createInitialState(ctx);
  state.enemies = [];
  state.boss = null;
  const room = ctx.layout.rooms[1];
  const center = { x: room.x + Math.floor(room.w / 2) + 0.5, y: room.y + Math.floor(room.h / 2) + 0.5 };
  state.players[0].pos = { ...center };
  state.players[1].pos = { x: center.x + 1, y: center.y };
  return { ctx, state, center };
}

describe("multijugador: escalado por jugadores", () => {
  it("con 1 jugador no cambia nada y con más sube vida y daño de enemigos y jefes", () => {
    expect(partyScaling(1)).toEqual({ enemyHealth: 1, enemyDamage: 1, bossHealth: 1, bossDamage: 1 });
    const four = partyScaling(4);
    expect(four.enemyHealth).toBeCloseTo(1 + 3 * BALANCE.multiplayer.enemyHealthPerExtraPlayer);
    expect(four.bossHealth).toBeCloseTo(1 + 3 * BALANCE.multiplayer.bossHealthPerExtraPlayer);
    expect(partyScaling(9)).toEqual(four);

    const solo = createInitialState(createContext(testConfig("TANK", 5, 2, 99)));
    const group = createInitialState(createContext(partyConfig(["TANK", "DPS", "HEALER"], 5, 2, 99)));
    expect(group.enemies.length).toBe(solo.enemies.length);
    expect(group.enemies[0].maxHp).toBeGreaterThan(solo.enemies[0].maxHp);
    expect(group.players).toHaveLength(3);
    const soloBoss = createInitialState(createContext(testConfig("TANK", 5, 5, 99)));
    const groupBoss = createInitialState(createContext(partyConfig(["TANK", "DPS", "HEALER"], 5, 5, 99)));
    expect(groupBoss.boss!.maxHp).toBe(Math.round(soloBoss.boss!.maxHp * partyScaling(3).bossHealth));
  });
});

describe("multijugador: reanimación", () => {
  it("mantener pulsado junto al aliado derribado lo reanima; soltar pierde el progreso", () => {
    const { ctx, state } = duo();
    const [tank, healer] = state.players;
    healer.hp = 0;
    healer.life = "DOWNED";
    const ticks = secondsToTicks(BALANCE.multiplayer.revive.seconds);

    for (let i = 0; i < ticks - 5; i++) stepInPlace(ctx, state, [hold(BUTTON_INTERACT), IDLE_INPUT]);
    expect(healer.reviveProgress).toBe(ticks - 5);
    stepInPlace(ctx, state, [IDLE_INPUT, IDLE_INPUT]);
    expect(healer.reviveProgress).toBe(0);
    expect(healer.life).toBe("DOWNED");

    for (let i = 0; i < ticks; i++) stepInPlace(ctx, state, [hold(BUTTON_INTERACT), IDLE_INPUT]);
    expect(healer.life).toBe("ALIVE");
    expect(healer.hp).toBe(Math.round(healer.maxHp * BALANCE.multiplayer.revive.healthRatio));
    expect(tank.revivesGiven).toBe(1);
    expect(state.status).toBe("RUNNING");
  });

  it("no se puede reanimar desde lejos ni a uno mismo, y un derribado no actúa", () => {
    const { ctx, state, center } = duo();
    const [tank, healer] = state.players;
    healer.life = "DOWNED";
    healer.hp = 0;
    tank.pos = { x: center.x + 6, y: center.y };
    const before = { ...healer.pos };
    for (let i = 0; i < 200; i++) stepInPlace(ctx, state, [hold(BUTTON_INTERACT), { ...IDLE_INPUT, mx: 100, buttons: BUTTON_INTERACT }]);
    expect(healer.life).toBe("DOWNED");
    expect(healer.pos).toEqual(before);
  });

  it("derrota solo cuando todos los que siguen en la partida están derribados", () => {
    const { ctx, state } = duo();
    state.enemies = [spawnEnemy(ctx, state.nextId++, "STALKER", { ...state.players[0].pos, x: state.players[0].pos.x - 3 }, true)];
    state.players[0].life = "DOWNED";
    stepInPlace(ctx, state, [IDLE_INPUT, IDLE_INPUT]);
    expect(state.status).toBe("RUNNING");
    setPresence(state, "p2", "LEFT");
    stepInPlace(ctx, state, [IDLE_INPUT, IDLE_INPUT]);
    expect(state.status).toBe("DEFEAT");
    expect(state.defeatReason).toBe("DOWNED");
  });
});

describe("multijugador: desconexión", () => {
  it("un jugador desconectado no es objetivo, no recibe daño ni actúa", () => {
    const { ctx, state } = duo();
    const [tank, healer] = state.players;
    setPresence(state, "p1", "DISCONNECTED");
    const stalker = spawnEnemy(ctx, state.nextId++, "STALKER", { x: tank.pos.x - 0.9, y: tank.pos.y }, true);
    state.enemies = [stalker];
    healer.pos = { x: tank.pos.x + 5, y: tank.pos.y };
    const tankPos = { ...tank.pos };
    for (let i = 0; i < 100; i++) stepInPlace(ctx, state, [{ ...IDLE_INPUT, mx: 100 }, IDLE_INPUT]);
    expect(tank.hp).toBe(tank.maxHp);
    expect(tank.pos).toEqual(tankPos);
    // El enemigo va a por el que sí está conectado.
    expect(healer.hp).toBeLessThan(healer.maxHp);
  });

  it("LEFT es definitivo", () => {
    const { state } = duo();
    expect(setPresence(state, "p1", "LEFT")).toBe(true);
    expect(setPresence(state, "p1", "CONNECTED")).toBe(false);
    expect(state.players[0].presence).toBe("LEFT");
  });
});
