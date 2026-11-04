/**
 * Protocolo de la partida en línea (Fase 4), compartido por el navegador y el servidor de partida
 * (Durable Object de Cloudflare). Sin dependencias de plataforma: solo tipos y validación manual,
 * para que el Worker no necesite librerías.
 *
 * El cliente solo envía intenciones (las mismas `PlayerInput` de la simulación) con un número de
 * secuencia. El servidor responde con instantáneas del estado autoritativo.
 */
import { AXIS_MAX, BUTTON_MASK, type PlayerInput, type SimConfig, type SimEvent, type SimState, type SimSummary } from "../game/simulation/types";

export const PROTOCOL_VERSION = 1;

/** Tamaño máximo de un mensaje del cliente (bytes). Una entrada ocupa ~60. */
export const MAX_CLIENT_MESSAGE_BYTES = 512;

// ---------------------------------------------------------------- Cliente → servidor

export type ClientMessage =
  /** Intención del jugador. `s` crece con cada mensaje (el servidor devuelve el último aplicado). */
  | { t: "in"; s: number; i: PlayerInput }
  /** Abandona la expedición (definitivo: sin recompensas). */
  | { t: "leave" }
  /** Medición de latencia: el servidor devuelve `c` tal cual. */
  | { t: "ping"; c: number };

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; reason: string };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isAxis = (v: unknown): v is number => isInt(v) && v >= -AXIS_MAX && v <= AXIS_MAX;

/**
 * Valida un mensaje del cliente. Cualquier campo de más, fuera de rango o con otro tipo se
 * rechaza (no se "arregla"): el cliente oficial nunca los envía.
 */
export function parseClientMessage(raw: unknown): ParseResult {
  if (typeof raw !== "string") return { ok: false, reason: "BINARY" };
  if (raw.length > MAX_CLIENT_MESSAGE_BYTES) return { ok: false, reason: "TOO_LARGE" };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "JSON" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ok: false, reason: "SHAPE" };
  const msg = data as Record<string, unknown>;
  const keys = Object.keys(msg);
  switch (msg.t) {
    case "in": {
      if (keys.length !== 3 || !isInt(msg.s) || msg.s < 0 || msg.s > Number.MAX_SAFE_INTEGER) return { ok: false, reason: "SHAPE" };
      const i = msg.i;
      if (typeof i !== "object" || i === null || Array.isArray(i)) return { ok: false, reason: "SHAPE" };
      const input = i as Record<string, unknown>;
      if (Object.keys(input).length !== 5) return { ok: false, reason: "SHAPE" };
      if (!isAxis(input.mx) || !isAxis(input.my) || !isAxis(input.ax) || !isAxis(input.ay)) return { ok: false, reason: "RANGE" };
      if (!isInt(input.buttons) || input.buttons < 0 || (input.buttons & ~BUTTON_MASK) !== 0) return { ok: false, reason: "RANGE" };
      return { ok: true, message: { t: "in", s: msg.s, i: { mx: input.mx, my: input.my, ax: input.ax, ay: input.ay, buttons: input.buttons } } };
    }
    case "leave":
      return keys.length === 1 ? { ok: true, message: { t: "leave" } } : { ok: false, reason: "SHAPE" };
    case "ping":
      return keys.length === 2 && typeof msg.c === "number" && Number.isFinite(msg.c) ? { ok: true, message: { t: "ping", c: msg.c } } : { ok: false, reason: "SHAPE" };
    default:
      return { ok: false, reason: "TYPE" };
  }
}

// ---------------------------------------------------------------- Servidor → cliente

export type RoomPhase = "WAITING" | "RUNNING" | "FINISHED";
export type ExpeditionEndStatus = "VICTORY" | "DEFEAT" | "ABANDONED";

/**
 * Estado que viaja por la red: el de la simulación sin las habilidades resueltas de cada jugador
 * (no cambian durante la partida; llegan una vez en `welcome`).
 */
export type NetPlayer = Omit<SimState["players"][number], "skills">;
export type NetState = Omit<SimState, "players" | "events"> & { players: NetPlayer[] };

export type ServerMessage =
  /** Primera instantánea (y la de cada reconexión): configuración y estado completo. */
  | { t: "welcome"; v: number; you: string; phase: RoomPhase; startsInMs: number | null; config: SimConfig; state: SimState; ack: number }
  /** Instantánea periódica (10 Hz) con los eventos ocurridos desde la anterior. */
  | { t: "state"; phase: RoomPhase; startsInMs: number | null; state: NetState; events: SimEvent[]; ack: number }
  | { t: "end"; status: ExpeditionEndStatus }
  | { t: "pong"; c: number }
  | { t: "error"; code: string; message: string };

export function toNetState(state: SimState): NetState {
  const { events: _events, players, ...rest } = state;
  void _events;
  return { ...rest, players: players.map(({ skills: _skills, ...p }) => (void _skills, p)) };
}

/** Vuelve a poner las habilidades (de `welcome`) en un estado recibido por la red. */
export function fromNetState(net: NetState, skillsById: ReadonlyMap<string, SimState["players"][number]["skills"]>, events: SimEvent[] = []): SimState {
  return { ...net, events, players: net.players.map((p) => ({ ...p, skills: skillsById.get(p.id) ?? [] })) };
}

/** Serializa redondeando los decimales (posiciones, recursos) a milésimas: ~40 % menos bytes. */
export function encodeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v));
}

// ---------------------------------------------------------------- Servidor de partida → Vercel

export interface ExpeditionPlayerResult {
  /** Id del jugador en la simulación (= id del personaje). */
  id: string;
  /** Abandonó o no volvió a conectarse a tiempo: no recibe recompensas. */
  left: boolean;
  /** Pociones que le quedan (Vercel descuenta las bebidas a partir de las que llevaba). */
  potionsLeft: number;
  downs: number;
  revivesGiven: number;
}

/** Resultado que el servidor de partida envía firmado a Vercel al terminar la expedición. */
export interface ExpeditionResult {
  expeditionId: string;
  status: ExpeditionEndStatus;
  defeatReason: SimState["defeatReason"];
  ticks: number;
  summary: SimSummary;
  players: ExpeditionPlayerResult[];
}

/** Lo que Vercel devuelve al servidor de partida para montar la sala. */
export interface ExpeditionRoomConfig {
  expeditionId: string;
  config: SimConfig;
  /** Jugadores cuya participación ya no está activa (abandonaron antes de conectarse). */
  inactivePlayerIds: string[];
}
