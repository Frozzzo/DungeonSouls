/**
 * Sala de una expedición: la simulación autoritativa del cooperativo (Fase 4).
 *
 * Es lógica pura (sin Cloudflare, sin red, sin temporizadores propios): el Durable Object le pasa
 * conexiones, mensajes y la hora, y ella decide. Así se prueba en Node con relojes falsos.
 *
 * - Ejecuta el mismo `stepInPlace` que la partida de un jugador, a 20 ticks/s.
 * - Aplica la última intención de cada jugador; los botones pulsados entre dos ticks se acumulan
 *   para no perder una esquiva o una habilidad si llegan dos mensajes en el mismo tick.
 * - Difunde el estado a 10 Hz; quien se conecta (o reconecta) recibe una instantánea completa.
 * - Desconexión: el personaje queda quieto e intocable; si no vuelve en el periodo de gracia,
 *   abandona (sin recompensas). Si nadie está conectado, la simulación se detiene.
 */
import { createContext, type SimContext, TICK_RATE } from "../game/simulation/context";
import { createInitialState } from "../game/simulation/create";
import { sanitizeInput } from "../game/simulation/input";
import { setPresence, stepInPlace } from "../game/simulation/step";
import { IDLE_INPUT, type PlayerInput, type SimConfig, type SimEvent, type SimState } from "../game/simulation/types";
import {
  encodeServerMessage,
  type ExpeditionEndStatus,
  type ExpeditionResult,
  parseClientMessage,
  PROTOCOL_VERSION,
  type RoomPhase,
  type ServerMessage,
  toNetState,
} from "./protocol";

export const TICK_MS = 1000 / TICK_RATE;

export interface RoomOptions {
  /** Espera a que entren todos (desde la primera conexión) antes de empezar. */
  waitForPlayersMs: number;
  /** Tiempo para reconectar antes de contar como abandono. */
  disconnectGraceMs: number;
  /** Duración máxima de la sala en tiempo real (incluye pausas). */
  maxWallClockMs: number;
  /** Cada cuántos ticks se envía una instantánea (2 = 10 Hz). */
  broadcastEveryTicks: number;
  /** Ticks que se recuperan como máximo si el bucle se retrasa (el resto se descarta). */
  maxCatchUpTicks: number;
  /** Límite de mensajes por conexión: ritmo sostenido y ráfaga. */
  messagesPerSecond: number;
  messageBurst: number;
  /** Mensajes rechazados (inválidos o por encima del límite) antes de cerrar la conexión. */
  maxViolations: number;
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  waitForPlayersMs: 20_000,
  disconnectGraceMs: 90_000,
  maxWallClockMs: 30 * 60_000,
  broadcastEveryTicks: 2,
  maxCatchUpTicks: 10,
  messagesPerSecond: 30,
  messageBurst: 60,
  maxViolations: 200,
};

/** Códigos de cierre de WebSocket que usa la sala. */
export const CLOSE = {
  NORMAL: 1000,
  POLICY: 1008,
  REPLACED: 4000,
  FINISHED: 4001,
  LEFT: 4002,
  UNKNOWN_PLAYER: 4003,
} as const;

export interface RoomConnection {
  id: string;
  send(data: string): void;
  close(code: number, reason: string): void;
}

interface PlayerSlot {
  id: string;
  index: number;
  connId: string | null;
  /** Momento de la desconexión (ms) mientras está desconectado durante la partida. */
  disconnectedAt: number | null;
  latest: PlayerInput;
  /** Botones pulsados desde el último tick. */
  latched: number;
  /** Último número de secuencia aplicado. */
  ack: number;
}

interface ConnectionInfo {
  conn: RoomConnection;
  playerId: string;
  tokens: number;
  refilledAt: number;
  violations: number;
}

export interface SavedRoom {
  v: 1;
  expeditionId: string;
  config: SimConfig;
  state: SimState;
  phase: RoomPhase;
  createdAt: number;
  firstJoinAt: number | null;
  lastTickAt: number;
  players: Array<{ id: string; disconnectedAt: number | null; ack: number }>;
  usedNonces: Array<[string, number]>;
  result: ExpeditionResult | null;
  resultReported: boolean;
}

export interface RoomInit {
  expeditionId: string;
  config: SimConfig;
  /** Participantes que ya no están activos (abandonaron antes de conectarse). */
  inactivePlayerIds?: readonly string[];
  now: number;
}

export class ExpeditionRoom {
  readonly expeditionId: string;
  readonly config: SimConfig;
  readonly ctx: SimContext;
  private state: SimState;
  private phase: RoomPhase = "WAITING";
  private readonly createdAt: number;
  private firstJoinAt: number | null = null;
  private lastTickAt: number;
  private lastWaitingBroadcast = 0;
  private readonly slots: PlayerSlot[];
  private readonly connections = new Map<string, ConnectionInfo>();
  private pendingEvents: SimEvent[] = [];
  private usedNonces = new Map<string, number>();
  private resultValue: ExpeditionResult | null = null;
  private resultReported = false;
  private readonly options: RoomOptions;

  constructor(init: RoomInit, options: Partial<RoomOptions> = {}, saved?: SavedRoom) {
    this.options = { ...DEFAULT_ROOM_OPTIONS, ...options };
    this.expeditionId = init.expeditionId;
    this.config = init.config;
    this.ctx = createContext(init.config);
    this.createdAt = init.now;
    this.lastTickAt = init.now;
    this.state = createInitialState(this.ctx);
    this.slots = this.state.players.map((p, index) => ({ id: p.id, index, connId: null, disconnectedAt: null, latest: IDLE_INPUT, latched: 0, ack: 0 }));
    // Nadie está conectado al crear la sala; quien no esté activo ya no puede entrar.
    for (const p of this.state.players) setPresence(this.state, p.id, "DISCONNECTED");
    for (const id of init.inactivePlayerIds ?? []) setPresence(this.state, id, "LEFT");

    if (saved) {
      this.state = saved.state;
      this.phase = saved.phase;
      this.createdAt = saved.createdAt;
      this.firstJoinAt = saved.firstJoinAt;
      // Tras reiniciar la instancia no se recuperan los ticks perdidos: se continúa desde ahora.
      this.lastTickAt = init.now;
      for (const s of saved.players) {
        const slot = this.slots.find((x) => x.id === s.id);
        if (!slot) continue;
        slot.ack = s.ack;
        slot.disconnectedAt = s.disconnectedAt;
      }
      // Las conexiones no sobreviven a un reinicio: todos cuentan como desconectados desde ahora.
      for (const slot of this.slots) {
        if (setPresence(this.state, slot.id, "DISCONNECTED") || slot.disconnectedAt === null) slot.disconnectedAt = this.phase === "RUNNING" ? init.now : null;
      }
      this.usedNonces = new Map(saved.usedNonces);
      this.resultValue = saved.result;
      this.resultReported = saved.resultReported;
    }
  }

  static restore(saved: SavedRoom, now: number, options: Partial<RoomOptions> = {}): ExpeditionRoom {
    return new ExpeditionRoom({ expeditionId: saved.expeditionId, config: saved.config, now }, options, saved);
  }

  serialize(): SavedRoom {
    return {
      v: 1,
      expeditionId: this.expeditionId,
      config: this.config,
      state: this.state,
      phase: this.phase,
      createdAt: this.createdAt,
      firstJoinAt: this.firstJoinAt,
      lastTickAt: this.lastTickAt,
      players: this.slots.map((s) => ({ id: s.id, disconnectedAt: s.disconnectedAt, ack: s.ack })),
      usedNonces: [...this.usedNonces],
      result: this.resultValue,
      resultReported: this.resultReported,
    };
  }

  // ---------------------------------------------------------------- Consultas

  get currentPhase(): RoomPhase {
    return this.phase;
  }

  get tick(): number {
    return this.state.tick;
  }

  /** Copia del estado actual (para pruebas y depuración). */
  snapshot(): SimState {
    return structuredClone(this.state);
  }

  hasPlayer(playerId: string): boolean {
    return this.slots.some((s) => s.id === playerId);
  }

  connectedCount(): number {
    return this.slots.filter((s) => s.connId !== null).length;
  }

  /** Resultado pendiente de entregar a Vercel (null si no ha terminado o ya se entregó). */
  get pendingResult(): ExpeditionResult | null {
    return this.resultReported ? null : this.resultValue;
  }

  get result(): ExpeditionResult | null {
    return this.resultValue;
  }

  markResultReported(): void {
    this.resultReported = true;
  }

  /** Registra el nonce de un ticket. Devuelve false si ya se usó (ticket repetido). */
  acceptNonce(nonce: string, expiresAtSeconds: number, now: number): boolean {
    const nowSeconds = Math.floor(now / 1000);
    for (const [n, exp] of this.usedNonces) if (exp < nowSeconds) this.usedNonces.delete(n);
    if (this.usedNonces.has(nonce)) return false;
    this.usedNonces.set(nonce, expiresAtSeconds);
    return true;
  }

  // ---------------------------------------------------------------- Conexiones

  connect(conn: RoomConnection, playerId: string, now: number): boolean {
    if (this.phase === "FINISHED") {
      this.sendTo(conn, { t: "end", status: this.resultValue?.status ?? "ABANDONED" });
      conn.close(CLOSE.FINISHED, "La expedición ha terminado.");
      return false;
    }
    const slot = this.slots.find((s) => s.id === playerId);
    if (!slot) {
      this.sendTo(conn, { t: "error", code: "UNKNOWN_PLAYER", message: "No participas en esta expedición." });
      conn.close(CLOSE.UNKNOWN_PLAYER, "Jugador desconocido.");
      return false;
    }
    const entity = this.state.players[slot.index];
    if (entity.presence === "LEFT") {
      this.sendTo(conn, { t: "error", code: "LEFT", message: "Abandonaste esta expedición." });
      conn.close(CLOSE.LEFT, "Abandonaste la expedición.");
      return false;
    }
    // Una sola conexión por jugador: la nueva (p. ej. otra pestaña o una reconexión) sustituye a la anterior.
    if (slot.connId !== null) {
      const old = this.connections.get(slot.connId);
      this.connections.delete(slot.connId);
      old?.conn.close(CLOSE.REPLACED, "Sesión abierta en otra conexión.");
    }
    slot.connId = conn.id;
    slot.disconnectedAt = null;
    slot.latest = IDLE_INPUT;
    slot.latched = 0;
    this.connections.set(conn.id, { conn, playerId, tokens: this.options.messageBurst, refilledAt: now, violations: 0 });
    setPresence(this.state, playerId, "CONNECTED");
    this.firstJoinAt ??= now;
    this.sendTo(conn, {
      t: "welcome",
      v: PROTOCOL_VERSION,
      you: playerId,
      phase: this.phase,
      startsInMs: this.startsInMs(now),
      config: this.config,
      state: { ...this.state, events: [] },
      ack: slot.ack,
    });
    return true;
  }

  disconnect(connId: string, now: number): void {
    const info = this.connections.get(connId);
    if (!info) return;
    this.connections.delete(connId);
    const slot = this.slots.find((s) => s.id === info.playerId);
    if (!slot || slot.connId !== connId) return;
    slot.connId = null;
    slot.latest = IDLE_INPUT;
    slot.latched = 0;
    if (this.phase === "FINISHED") return;
    if (setPresence(this.state, slot.id, "DISCONNECTED")) slot.disconnectedAt = this.phase === "RUNNING" ? now : null;
  }

  receive(connId: string, data: unknown, now: number): void {
    const info = this.connections.get(connId);
    if (!info) return;
    // Cubo de fichas: ritmo sostenido + ráfaga.
    info.tokens = Math.min(this.options.messageBurst, info.tokens + ((now - info.refilledAt) / 1000) * this.options.messagesPerSecond);
    info.refilledAt = now;
    if (info.tokens < 1) {
      this.violation(info, "RATE_LIMIT", "Demasiados mensajes.");
      return;
    }
    info.tokens -= 1;

    const parsed = parseClientMessage(data);
    if (!parsed.ok) {
      this.violation(info, "INVALID", `Mensaje rechazado (${parsed.reason}).`);
      return;
    }
    const slot = this.slots.find((s) => s.id === info.playerId)!;
    const msg = parsed.message;
    switch (msg.t) {
      case "in":
        // Mensajes viejos o repetidos (desordenados) se ignoran.
        if (msg.s <= slot.ack) return;
        slot.ack = msg.s;
        slot.latest = sanitizeInput(msg.i);
        slot.latched |= slot.latest.buttons;
        return;
      case "leave":
        this.connections.delete(connId);
        slot.connId = null;
        slot.latest = IDLE_INPUT;
        if (this.phase !== "FINISHED") setPresence(this.state, slot.id, "LEFT");
        info.conn.close(CLOSE.LEFT, "Has abandonado la expedición.");
        return;
      case "ping":
        this.sendTo(info.conn, { t: "pong", c: msg.c });
        return;
    }
  }

  private violation(info: ConnectionInfo, code: string, message: string) {
    info.violations++;
    // Solo se avisa de los primeros para no amplificar un abuso.
    if (info.violations <= 5) this.sendTo(info.conn, { t: "error", code, message });
    if (info.violations > this.options.maxViolations) {
      this.disconnect(info.conn.id, info.refilledAt);
      info.conn.close(CLOSE.POLICY, "Demasiados mensajes inválidos.");
    }
  }

  // ---------------------------------------------------------------- Bucle

  /** Avanza la sala hasta `now`. Devuelve los ticks simulados. */
  advance(now: number): number {
    if (this.phase === "FINISHED") return 0;
    if (now - this.createdAt >= this.options.maxWallClockMs) {
      this.finish("ABANDONED", now);
      return 0;
    }

    if (this.phase === "RUNNING") {
      for (const slot of this.slots) {
        const entity = this.state.players[slot.index];
        if (entity.presence === "DISCONNECTED" && slot.disconnectedAt !== null && now - slot.disconnectedAt >= this.options.disconnectGraceMs) {
          setPresence(this.state, slot.id, "LEFT");
        }
      }
    }
    if (this.state.players.every((p) => p.presence === "LEFT")) {
      this.finish("ABANDONED", now);
      return 0;
    }

    if (this.phase === "WAITING") {
      if (this.firstJoinAt === null) return 0;
      const everyone = this.state.players.every((p) => p.presence !== "DISCONNECTED");
      if (!everyone && now - this.firstJoinAt < this.options.waitForPlayersMs) {
        if (now - this.lastWaitingBroadcast >= 1000) {
          this.lastWaitingBroadcast = now;
          this.broadcast(now);
        }
        return 0;
      }
      this.phase = "RUNNING";
      this.lastTickAt = now;
      // El periodo de gracia de quien aún no ha entrado empieza ahora.
      for (const slot of this.slots) if (this.state.players[slot.index].presence === "DISCONNECTED") slot.disconnectedAt = now;
      this.broadcast(now);
      return 0;
    }

    // Sin nadie conectado la partida se detiene (y el reloj de la simulación no avanza).
    if (this.connections.size === 0) {
      this.lastTickAt = now;
      return 0;
    }

    let due = Math.floor((now - this.lastTickAt) / TICK_MS);
    if (due > this.options.maxCatchUpTicks) {
      due = this.options.maxCatchUpTicks;
      this.lastTickAt = now - due * TICK_MS;
    }
    const inputs: PlayerInput[] = this.slots.map(() => IDLE_INPUT);
    for (let k = 0; k < due; k++) {
      for (const slot of this.slots) {
        inputs[slot.index] = slot.latched ? { ...slot.latest, buttons: slot.latest.buttons | slot.latched } : slot.latest;
        slot.latched = 0;
      }
      stepInPlace(this.ctx, this.state, inputs);
      this.lastTickAt += TICK_MS;
      if (this.state.events.length > 0) this.pendingEvents.push(...this.state.events);
      if (this.state.status !== "RUNNING") {
        this.finish(this.state.status, now);
        return k + 1;
      }
      if (this.state.tick % this.options.broadcastEveryTicks === 0) this.broadcast(now);
    }
    return due;
  }

  private startsInMs(now: number): number | null {
    if (this.phase !== "WAITING") return null;
    if (this.firstJoinAt === null) return this.options.waitForPlayersMs;
    return Math.max(0, this.firstJoinAt + this.options.waitForPlayersMs - now);
  }

  private finish(status: ExpeditionEndStatus, now: number) {
    this.phase = "FINISHED";
    this.resultValue = {
      expeditionId: this.expeditionId,
      status,
      defeatReason: status === "DEFEAT" ? this.state.defeatReason : null,
      ticks: this.state.tick,
      summary: this.state.summary,
      players: this.state.players.map((p) => ({ id: p.id, left: p.presence === "LEFT", potionsLeft: p.potions, downs: p.downs, revivesGiven: p.revivesGiven })),
    };
    this.broadcast(now);
    for (const info of this.connections.values()) this.sendTo(info.conn, { t: "end", status });
  }

  private broadcast(now: number) {
    const net = toNetState(this.state);
    const events = this.pendingEvents;
    this.pendingEvents = [];
    const startsInMs = this.startsInMs(now);
    for (const info of this.connections.values()) {
      const slot = this.slots.find((s) => s.id === info.playerId)!;
      this.sendTo(info.conn, { t: "state", phase: this.phase, startsInMs, state: net, events, ack: slot.ack });
    }
  }

  private sendTo(conn: RoomConnection, msg: ServerMessage) {
    try {
      conn.send(encodeServerMessage(msg));
    } catch {
      // Conexión ya cerrada: el cierre llegará por su lado.
    }
  }

  /** Cierra todas las conexiones (al terminar y entregar el resultado). */
  closeAll(reason: string) {
    for (const info of this.connections.values()) info.conn.close(CLOSE.FINISHED, reason);
    this.connections.clear();
    for (const slot of this.slots) slot.connId = null;
  }
}
