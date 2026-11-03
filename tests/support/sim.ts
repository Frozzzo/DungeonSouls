import { computeCharacterStats } from "@/game/stats/compute";
import { botInput } from "@/game/simulation/bot";
import { createContext, type SimContext } from "@/game/simulation/context";
import { createInitialState } from "@/game/simulation/create";
import { InputRecorder, type InputSegment } from "@/game/simulation/input";
import { stepInPlace } from "@/game/simulation/step";
import { SIM_VERSION, type SimConfig, type SimState } from "@/game/simulation/types";
import type { ClassId } from "@/game/types";

/** Configuración de prueba: nivel dado con los puntos repartidos entre el atributo principal y Vitalidad. */
export function testConfig(classId: ClassId, level: number, floor: number, seed: number): SimConfig {
  const points = 5 + (level - 1) * 3;
  const main = classId === "TANK" ? "strength" : classId === "DPS" ? "dexterity" : "intelligence";
  const allocated = { strength: 0, dexterity: 0, intelligence: 0, vitality: Math.floor(points / 2) };
  allocated[main] += Math.ceil(points / 2);
  const stats = computeCharacterStats({ classId, level, allocated });
  return { version: SIM_VERSION, seed, floor, difficulty: "NORMAL", players: [{ id: "p1", name: "Prueba", classId, level, stats: stats.derived }] };
}

/** Juega una partida con el piloto automático y devuelve las entradas grabadas y el estado final. */
export function playWithBot(config: SimConfig, maxTicks = Infinity): { segments: InputSegment[]; state: SimState; ctx: SimContext } {
  const ctx = createContext(config);
  const state = createInitialState(ctx);
  const rec = new InputRecorder();
  while (state.status === "RUNNING" && state.tick < maxTicks) {
    const input = rec.push(botInput(ctx, state));
    stepInPlace(ctx, state, [input]);
  }
  return { segments: rec.segments, state, ctx };
}
