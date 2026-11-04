import { describe, expect, it } from "vitest";
import { CONSUMABLES } from "@/game/items/consumables";
import { createContext, secondsToTicks, type SimContext } from "@/game/simulation/context";
import { createInitialState, spawnEnemy } from "@/game/simulation/create";
import { replay } from "@/game/simulation/replay";
import { stepInPlace } from "@/game/simulation/step";
import {
  BUTTON_ATTACK,
  BUTTON_DODGE,
  BUTTON_POTION,
  BUTTON_SKILL_1,
  BUTTON_SKILL_2,
  BUTTON_ULTIMATE,
  IDLE_INPUT,
  type PlayerInput,
  type SimConfig,
} from "@/game/simulation/types";
import type { EnemyKindId } from "@/game/enemies/definitions";
import type { EquippedSkill } from "@/game/skills/rules";
import type { ClassId } from "@/game/types";
import { playWithBot, testConfig, type TestConfigOptions } from "../support/sim";

const input = (p: Partial<PlayerInput> = {}): PlayerInput => ({ ...IDLE_INPUT, ...p });
const sk = (skillId: string, rank = 1): EquippedSkill => ({ skillId, rank });

function arena(classId: ClassId, options: TestConfigOptions = {}, level = 5) {
  const ctx: SimContext = createContext(testConfig(classId, level, 2, 4242, options));
  const state = createInitialState(ctx);
  const room = ctx.layout.rooms[1];
  const center = { x: room.x + Math.floor(room.w / 2) + 0.5, y: room.y + Math.floor(room.h / 2) + 0.5 };
  state.enemies = [];
  state.players[0].pos = { ...center };
  state.players[0].facing = { x: 1, y: 0 };
  const add = (kind: EnemyKindId, dx: number, dy: number) => {
    const e = spawnEnemy(ctx, state.nextId++, kind, { x: center.x + dx, y: center.y + dy }, true);
    e.attackCooldown = 9999;
    state.enemies.push(e);
    return e;
  };
  const run = (ticks: number, inp: PlayerInput = IDLE_INPUT) => {
    for (let i = 0; i < ticks && state.status === "RUNNING"; i++) stepInPlace(ctx, state, [inp]);
  };
  return { ctx, state, center, add, run, p: state.players[0] };
}

describe("simulación: habilidades equipadas", () => {
  it("cada hueco usa su botón, con su coste y su enfriamiento", () => {
    const { p, add, run } = arena("DPS", { loadout: [sk("dps-rend"), sk("dps-whirlwind"), null, sk("dps-blade-storm")] });
    const e = add("STALKER", 1.2, 0);
    e.hp = e.maxHp = 100000;
    const energy = p.resource;
    run(1, input({ ax: 100, buttons: BUTTON_SKILL_1 }));
    expect(p.skillCooldowns[0]).toBeGreaterThan(0);
    expect(p.skillCooldowns[1]).toBe(0);
    expect(p.resource).toBeLessThan(energy);
    const afterFirst = e.hp;
    expect(afterFirst).toBeLessThan(100000);
    // En enfriamiento: no vuelve a golpear.
    run(1, input({ ax: 100, buttons: BUTTON_SKILL_1 }));
    expect(e.hp).toBe(afterFirst);
    run(1, input({ buttons: BUTTON_SKILL_2 }));
    expect(e.hp).toBeLessThan(afterFirst);
    expect(p.skillCooldowns[1]).toBeGreaterThan(0);
  });

  it("un hueco vacío o una habilidad no válida para el hueco no hace nada", () => {
    const { p, state, run } = arena("DPS", { loadout: [null, null, sk("dps-blade-storm"), sk("dps-rend")] });
    expect(p.skills).toEqual([null, null, null, null]);
    run(1, input({ buttons: BUTTON_SKILL_1 | BUTTON_SKILL_2 | BUTTON_ULTIMATE }));
    expect(state.summary.skillsUsed).toBe(0);
  });

  it("habilidades de otra clase se descartan aunque lleguen en la configuración", () => {
    const { p } = arena("HEALER", { loadout: [sk("dps-whirlwind"), sk("healer-smite"), sk("healer-smite"), null] });
    expect(p.skills.map((s) => s?.id ?? null)).toEqual([null, "healer-smite", null, null]);
  });

  it("sin recurso suficiente la definitiva no se lanza", () => {
    const { p, state, run } = arena("TANK", { loadout: [null, null, null, sk("tank-earthshatter")] });
    p.resource = 10;
    run(1, input({ buttons: BUTTON_ULTIMATE }));
    expect(state.summary.skillsUsed).toBe(0);
    p.resource = 100;
    run(1, input({ buttons: BUTTON_ULTIMATE }));
    expect(state.summary.skillsUsed).toBe(1);
  });

  it("los rangos aumentan el daño de la habilidad", () => {
    const damage = (rank: number) => {
      const { add, run } = arena("DPS", { loadout: [sk("dps-whirlwind", rank), null, null, null] });
      const e = add("STALKER", 1, 0);
      e.hp = e.maxHp = 100000;
      run(1, input({ buttons: BUTTON_SKILL_1 }));
      return 100000 - e.hp;
    };
    expect(damage(5)).toBeGreaterThan(damage(1));
  });

  it("Embate de escudo aturde cuando hay Furia", () => {
    const { p, add, run } = arena("TANK", { loadout: [sk("tank-shield-bash"), null, null, null] });
    const e = add("STALKER", 1.2, 0);
    e.hp = e.maxHp = 100000;
    p.resource = 10;
    run(1, input({ ax: 100, buttons: BUTTON_SKILL_1 }));
    expect(e.statuses.some((s) => s.id === "STUN")).toBe(false); // sin Furia no se lanza
    p.resource = 100;
    run(1, input({ ax: 100, buttons: BUTTON_SKILL_1 }));
    expect(e.statuses.some((s) => s.id === "STUN")).toBe(true);
  });

  it("la barrera absorbe daño antes que la vida", () => {
    const { p, add, run, ctx, state } = arena("HEALER", { loadout: [sk("healer-veil"), null, null, null] });
    run(1, input({ buttons: BUTTON_SKILL_1 }));
    const barrier = p.statuses.find((s) => s.id === "BARRIER");
    expect(barrier?.value).toBeGreaterThan(0);
    const e = add("STALKER", 0.9, 0);
    e.attackCooldown = 0;
    const hp = p.hp;
    for (let i = 0; i < 40 && !state.events.some((ev) => ev.type === "ABSORBED"); i++) stepInPlace(ctx, state, [IDLE_INPUT]);
    expect(state.events.some((ev) => ev.type === "ABSORBED")).toBe(true);
    expect(p.hp).toBe(hp);
  });

  it("la curación periódica cura varias veces y Paso sombrío desplaza con invulnerabilidad", () => {
    const healer = arena("HEALER", { loadout: [sk("healer-renewal"), null, null, null] });
    healer.p.hp = 20;
    healer.run(1, input({ buttons: BUTTON_SKILL_1 }));
    healer.run(secondsToTicks(8));
    expect(healer.p.hp).toBeGreaterThan(40);

    const dps = arena("DPS", { loadout: [sk("dps-shadow-step"), null, null, null] });
    const x = dps.p.pos.x;
    dps.run(1, input({ ax: 100, buttons: BUTTON_SKILL_1 }));
    expect(dps.p.pos.x).toBeGreaterThan(x + 1);
    expect(dps.p.invulnerable).toBeGreaterThan(0);
  });
});

describe("simulación: pociones limitadas", () => {
  it("cura, respeta el enfriamiento y no pasa de las que lleva", () => {
    const { p, state, run } = arena("DPS", { potions: 2 });
    p.hp = 10;
    run(1, input({ buttons: BUTTON_POTION }));
    expect(p.hp).toBeGreaterThan(10);
    expect(p.potions).toBe(1);
    p.hp = 10;
    run(1, input({ buttons: BUTTON_POTION }));
    expect(p.hp).toBe(10); // en enfriamiento
    run(secondsToTicks(CONSUMABLES.HEALTH_POTION.cooldown));
    run(1, input({ buttons: BUTTON_POTION }));
    expect(p.potions).toBe(0);
    p.hp = 10;
    run(secondsToTicks(CONSUMABLES.HEALTH_POTION.cooldown) + 1);
    run(1, input({ buttons: BUTTON_POTION }));
    expect(p.hp).toBe(10); // sin pociones
    expect(state.summary.potionsUsed).toBe(2);
  });

  it("la configuración no puede dar más pociones de las permitidas por piso", () => {
    const { p } = arena("DPS", { potions: 50 });
    expect(p.potions).toBe(CONSUMABLES.HEALTH_POTION.perRun);
  });

  it("con la vida llena no se gasta", () => {
    const { p, state, run } = arena("DPS", { potions: 1 });
    run(1, input({ buttons: BUTTON_POTION }));
    expect(p.potions).toBe(1);
    expect(state.summary.potionsUsed).toBe(0);
  });
});

describe("simulación: equipo y efectos únicos", () => {
  it("Grillete de Varkhul: tras esquivar, el siguiente golpe hace más daño", () => {
    const hit = (effect: boolean) => {
      const { add, run, p, center } = arena("DPS", { uniqueEffects: effect ? ["DODGE_EMPOWER"] : [], loadout: [null, null, null, null] });
      const e = add("STALKER", 1.2, 0);
      e.hp = e.maxHp = 100000;
      e.facing = { x: 1, y: 0 };
      run(1, input({ mx: -100, buttons: BUTTON_DODGE }));
      run(secondsToTicks(0.4));
      p.pos = { ...center };
      e.pos = { x: center.x + 1.2, y: center.y };
      const before = e.hp;
      run(secondsToTicks(0.15), input({ ax: 100, buttons: BUTTON_ATTACK }));
      return before - e.hp;
    };
    // Mismo generador aleatorio en ambos casos: la diferencia es la bonificación.
    expect(hit(true)).toBeGreaterThan(hit(false));
  });

  it("con habilidades, pociones y equipo la partida sigue siendo reproducible por repetición", () => {
    const config: SimConfig = testConfig("HEALER", 5, 5, 2024, {
      loadout: [sk("healer-mending-light", 2), sk("healer-veil"), sk("healer-smite", 2), sk("healer-judgement")],
      potions: 3,
      uniqueEffects: ["DODGE_EMPOWER"],
    });
    const played = playWithBot(config);
    expect(played.state.status).toBe("VICTORY");
    expect(played.state.summary.skillsUsed).toBeGreaterThan(0);
    const again = replay(config, played.segments);
    expect(again.state.summary).toEqual(played.state.summary);
    expect(again.ticks).toBe(played.state.tick);
  });
});
