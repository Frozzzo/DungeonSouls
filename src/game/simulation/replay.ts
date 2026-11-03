import { createContext, type SimContext } from "./context";
import { createInitialState } from "./create";
import { type InputSegment, iterateInputs } from "./input";
import { stepInPlace } from "./step";
import { IDLE_INPUT, type PlayerInput, type SimConfig, type SimState } from "./types";

export interface ReplayResult {
  state: SimState;
  /** Ticks ejecutados hasta terminar (o hasta agotar las entradas). */
  ticks: number;
  /** true si la partida terminó (victoria o derrota) dentro de las entradas recibidas. */
  finished: boolean;
}

/**
 * Vuelve a ejecutar una partida completa a partir de su configuración (generada por el servidor)
 * y de las intenciones del jugador. Es lo que hace el servidor para validar un piso: el resultado
 * (victoria, enemigos derrotados, jefe) sale de esta ejecución, nunca de lo que diga el cliente.
 */
export function replay(config: SimConfig, segments: readonly InputSegment[], ctx: SimContext = createContext(config)): ReplayResult {
  const state = createInitialState(ctx);
  // Fase 2: un jugador. En la Fase 4 cada jugador tendrá su propio registro de entradas.
  const inputs: PlayerInput[] = [IDLE_INPUT];
  for (const input of iterateInputs(segments)) {
    inputs[0] = input;
    stepInPlace(ctx, state, inputs);
    if (state.status !== "RUNNING") break;
  }
  return { state, ticks: state.tick, finished: state.status !== "RUNNING" };
}
