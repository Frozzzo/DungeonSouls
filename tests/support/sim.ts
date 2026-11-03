import { computeCharacterStats } from "@/game/stats/compute";
import { botInput } from "@/game/simulation/bot";
import { createContext, type SimContext } from "@/game/simulation/context";
import { createInitialState } from "@/game/simulation/create";
import { InputRecorder, type InputSegment } from "@/game/simulation/input";
import { stepInPlace } from "@/game/simulation/step";
import { BUTTON_POTION, SIM_VERSION, type SimConfig, type SimState } from "@/game/simulation/types";
import type { ClassId } from "@/game/types";
import { STARTER_SKILLS } from "@/game/skills/definitions";
import type { EquippedSkill } from "@/game/skills/rules";
import type { GearBonus } from "@/game/items/equipment";
import type { UniqueEffectId } from "@/game/items/bases";

export interface TestConfigOptions {
  /** Habilidades por hueco (por defecto, la inicial de la clase en el primero). */
  loadout?: (EquippedSkill | null)[];
  potions?: number;
  gear?: GearBonus;
  uniqueEffects?: UniqueEffectId[];
}

/** Configuración de prueba: nivel dado con los puntos repartidos entre el atributo principal y Vitalidad. */
export function testConfig(classId: ClassId, level: number, floor: number, seed: number, options: TestConfigOptions = {}): SimConfig {
  const points = 5 + (level - 1) * 3;
  const main = classId === "TANK" ? "strength" : classId === "DPS" ? "dexterity" : "intelligence";
  const allocated = { strength: 0, dexterity: 0, intelligence: 0, vitality: Math.floor(points / 2) };
  allocated[main] += Math.ceil(points / 2);
  const stats = computeCharacterStats({ classId, level, allocated, gear: options.gear });
  const loadout = options.loadout ?? [{ skillId: STARTER_SKILLS[classId], rank: 1 }, null, null, null];
  return {
    version: SIM_VERSION,
    seed,
    floor,
    difficulty: "NORMAL",
    players: [{ id: "p1", name: "Prueba", classId, level, stats: stats.derived, loadout, potions: options.potions ?? 0, uniqueEffects: options.uniqueEffects ?? [] }],
  };
}

/** Juega una partida con el piloto automático y devuelve las entradas grabadas y el estado final. */
export function playWithBot(
  config: SimConfig,
  maxTicks = Infinity,
  options: { drinkWhenHurt?: boolean } = {},
): { segments: InputSegment[]; state: SimState; ctx: SimContext } {
  const ctx = createContext(config);
  const state = createInitialState(ctx);
  const rec = new InputRecorder();
  while (state.status === "RUNNING" && state.tick < maxTicks) {
    const raw = botInput(ctx, state);
    const p = state.players[0];
    // Variante de prueba: pulsa la poción en cuanto pierde vida (para ejercitar su descuento).
    const drink = options.drinkWhenHurt && p.hp < p.maxHp ? BUTTON_POTION : 0;
    const input = rec.push({ ...raw, buttons: raw.buttons | drink });
    stepInPlace(ctx, state, [input]);
  }
  return { segments: rec.segments, state, ctx };
}
