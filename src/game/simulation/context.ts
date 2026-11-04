import { BALANCE } from "../balance";
import { DIFFICULTIES, type DifficultyDefinition } from "../difficulty/definitions";
import { generateFloor } from "../dungeon/generate";
import type { FloorLayout } from "../dungeon/types";
import { nextRandom } from "../random/rng";
import type { SimConfig, SimState } from "./types";

export const TICK_RATE = BALANCE.simulation.tickRate;
/** Duración de un tick en segundos (paso fijo). */
export const DT = 1 / TICK_RATE;
export const MAX_TICKS = BALANCE.simulation.maxDurationSeconds * TICK_RATE;

export const secondsToTicks = (seconds: number) => Math.max(0, Math.round(seconds * TICK_RATE));

/** Datos inmutables de una partida: configuración, mapa y dificultad. */
export interface SimContext {
  config: SimConfig;
  layout: FloorLayout;
  difficulty: DifficultyDefinition;
  /** Multiplicadores por tamaño del grupo (fijo al empezar: los que abandonan no lo cambian). */
  party: PartyScaling;
}

export interface PartyScaling {
  enemyHealth: number;
  enemyDamage: number;
  bossHealth: number;
  bossDamage: number;
}

/** Escalado de enemigos y jefes según el número de jugadores (1 jugador = sin cambios). */
export function partyScaling(players: number): PartyScaling {
  const m = BALANCE.multiplayer;
  const extra = Math.max(0, Math.min(m.maxPartySize, Math.floor(players)) - 1);
  return {
    enemyHealth: 1 + m.enemyHealthPerExtraPlayer * extra,
    enemyDamage: 1 + m.enemyDamagePerExtraPlayer * extra,
    bossHealth: 1 + m.bossHealthPerExtraPlayer * extra,
    bossDamage: 1 + m.bossDamagePerExtraPlayer * extra,
  };
}

export function createContext(config: SimConfig): SimContext {
  return {
    config,
    layout: generateFloor(config.seed, config.floor),
    difficulty: DIFFICULTIES[config.difficulty],
    party: partyScaling(config.players.length),
  };
}

/** Número aleatorio [0,1) usando (y avanzando) el generador guardado en el estado. */
export function rand(state: SimState): number {
  const r = nextRandom(state.rng);
  state.rng = r.state;
  return r.value;
}
