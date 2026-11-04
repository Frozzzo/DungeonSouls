import { describe, expect, it } from "vitest";
import { BUTTON_ATTACK, BUTTON_DODGE, IDLE_INPUT } from "@/game/simulation/types";
import { parseClientMessage, type ServerMessage } from "@/realtime/protocol";
import { CLOSE, ExpeditionRoom, type RoomConnection, TICK_MS } from "@/realtime/room";
import { createTicket, signRequest, verifyRequest, verifyTicket } from "@/realtime/signing";
import { partyConfig } from "../support/sim";

const SECRET = "s".repeat(40);

class FakeConn implements RoomConnection {
  messages: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  constructor(readonly id: string) {}
  send(data: string) {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
  }
  last<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    return [...this.messages].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  }
  count(t: ServerMessage["t"]) {
    return this.messages.filter((m) => m.t === t).length;
  }
}

const input = (s: number, i: Partial<typeof IDLE_INPUT> = {}) => JSON.stringify({ t: "in", s, i: { ...IDLE_INPUT, ...i } });

function setup(players = 2, options = {}) {
  const classes = (["TANK", "HEALER", "DPS", "TANK"] as const).slice(0, players);
  let now = 1_000_000;
  const room = new ExpeditionRoom({ expeditionId: "exp1", config: partyConfig([...classes], 5, 2, 31337), now }, { waitForPlayersMs: 5_000, disconnectGraceMs: 10_000, ...options });
  const clock = {
    get now() {
      return now;
    },
    /** Avanza el reloj llamando a la sala cada 50 ms, como el Durable Object. */
    run(ms: number) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + TICK_MS);
        room.advance(now);
      }
    },
  };
  return { room, clock };
}

describe("protocolo: mensajes del cliente", () => {
  it("acepta solo intenciones bien formadas", () => {
    expect(parseClientMessage(input(1, { mx: 100, buttons: BUTTON_ATTACK })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ t: "leave" })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ t: "ping", c: 5 })).ok).toBe(true);
  });

  it.each([
    ["no es JSON", "{oops"],
    ["tipo desconocido", JSON.stringify({ t: "damage", amount: 999 })],
    ["eje fuera de rango", input(1, { mx: 101 })],
    ["eje no entero", input(1, { ax: 0.5 })],
    ["bits desconocidos", input(1, { buttons: 1024 })],
    ["campo de más (daño)", JSON.stringify({ t: "in", s: 1, i: { ...IDLE_INPUT, damage: 9999 } })],
    ["campo de más en el mensaje", JSON.stringify({ t: "in", s: 1, i: IDLE_INPUT, hp: 1 })],
    ["secuencia negativa", input(-1)],
    ["demasiado grande", JSON.stringify({ t: "ping", c: 1, pad: "x".repeat(600) })],
  ])("rechaza: %s", (_label, raw) => {
    expect(parseClientMessage(raw).ok).toBe(false);
  });

  it("rechaza mensajes binarios", () => {
    expect(parseClientMessage(new ArrayBuffer(4)).ok).toBe(false);
  });
});

describe("firmas: tickets y peticiones internas", () => {
  it("un ticket válido se verifica; manipulado, caducado o de otra expedición no", async () => {
    const now = 1_700_000_000;
    const ticket = await createTicket(SECRET, { expeditionId: "exp1", userId: "u1", characterId: "c1" }, now);
    const ok = await verifyTicket(SECRET, ticket, "exp1", now + 10);
    expect(ok.ok && ok.payload.c).toBe("c1");
    expect((await verifyTicket(SECRET, ticket, "exp2", now)).ok).toBe(false);
    expect((await verifyTicket(SECRET, ticket, "exp1", now + 61)).ok).toBe(false);
    expect((await verifyTicket("x".repeat(40), ticket, "exp1", now)).ok).toBe(false);
    const [body, sig] = ticket.split(".");
    const forged = btoa(JSON.stringify({ v: 1, e: "exp1", u: "u1", c: "otro", n: "n", iat: now, exp: now + 60 })).replace(/=+$/, "");
    expect((await verifyTicket(SECRET, `${forged}.${sig}`, "exp1", now)).ok).toBe(false);
    expect((await verifyTicket(SECRET, `${body}.AAAA`, "exp1", now)).ok).toBe(false);
    expect((await verifyTicket(SECRET, "basura", "exp1", now)).ok).toBe(false);
  });

  it("una petición firmada solo vale para su método, ruta, cuerpo y momento", async () => {
    const now = 1_700_000_000;
    const body = JSON.stringify({ a: 1 });
    const h = await signRequest(SECRET, "POST", "/api/internal/expeditions/e1/results", body, now);
    const base = { method: "POST", path: "/api/internal/expeditions/e1/results", body, timestamp: h["x-ds-timestamp"], signature: h["x-ds-signature"] };
    expect(await verifyRequest(SECRET, base, now)).toBe(true);
    expect(await verifyRequest(SECRET, { ...base, body: JSON.stringify({ a: 2 }) }, now)).toBe(false);
    expect(await verifyRequest(SECRET, { ...base, path: "/api/internal/expeditions/e2/results" }, now)).toBe(false);
    expect(await verifyRequest(SECRET, { ...base, method: "GET" }, now)).toBe(false);
    expect(await verifyRequest(SECRET, base, now + 120)).toBe(false);
    expect(await verifyRequest(SECRET, { ...base, signature: null }, now)).toBe(false);
  });
});

describe("sala de expedición", () => {
  it("espera a todos, y luego dos clientes ven exactamente el mismo estado", () => {
    const { room, clock } = setup(2);
    const a = new FakeConn("a");
    const b = new FakeConn("b");
    room.connect(a, "p1", clock.now);
    expect(a.last("welcome")?.phase).toBe("WAITING");
    clock.run(1000);
    expect(room.tick).toBe(0);
    room.connect(b, "p2", clock.now);
    clock.run(TICK_MS);
    expect(room.currentPhase).toBe("RUNNING");

    room.receive("a", input(1, { mx: 100 }), clock.now);
    clock.run(2000);
    expect(room.tick).toBeGreaterThanOrEqual(39);
    const sa = a.last("state")!;
    const sb = b.last("state")!;
    expect(sa.state.tick).toBe(sb.state.tick);
    expect(sa.state).toEqual(sb.state);
    expect(sa.ack).toBe(1);
    expect(sb.ack).toBe(0);
    // 10 instantáneas por segundo.
    expect(a.count("state")).toBeGreaterThanOrEqual(19);
    // El jugador 1 se ha movido según su intención; el 2 no.
    const welcome = a.last("welcome")!;
    expect(sa.state.players[0].pos.x).toBeGreaterThan(welcome.state.players[0].pos.x);
  });

  it("empieza sin quien no llega a tiempo", () => {
    const { room, clock } = setup(2);
    room.connect(new FakeConn("a"), "p1", clock.now);
    clock.run(5_100);
    expect(room.currentPhase).toBe("RUNNING");
    expect(room.snapshot().players[1].presence).toBe("DISCONNECTED");
  });

  it("reconexión: el jugador recibe una instantánea completa del estado actual", () => {
    const { room, clock } = setup(2);
    room.connect(new FakeConn("a"), "p1", clock.now);
    room.connect(new FakeConn("b"), "p2", clock.now);
    clock.run(1000);
    room.disconnect("b", clock.now);
    expect(room.snapshot().players[1].presence).toBe("DISCONNECTED");
    clock.run(2000);
    const tickBefore = room.tick;
    const b2 = new FakeConn("b2");
    room.connect(b2, "p2", clock.now);
    const welcome = b2.last("welcome")!;
    expect(welcome.state.tick).toBe(tickBefore);
    expect(welcome.state.players[1].presence).toBe("CONNECTED");
    expect(welcome.state.players[1].skills.length).toBe(4);
    expect(welcome.config.players).toHaveLength(2);
  });

  it("una conexión nueva del mismo jugador sustituye a la anterior", () => {
    const { room, clock } = setup(1);
    const first = new FakeConn("a");
    room.connect(first, "p1", clock.now);
    room.connect(new FakeConn("a2"), "p1", clock.now);
    expect(first.closed?.code).toBe(CLOSE.REPLACED);
    expect(room.connectedCount()).toBe(1);
  });

  it("si no vuelve dentro del periodo de gracia, abandona; si todos abandonan, termina sin recompensas", () => {
    const { room, clock } = setup(2);
    room.connect(new FakeConn("a"), "p1", clock.now);
    room.connect(new FakeConn("b"), "p2", clock.now);
    clock.run(500);
    room.disconnect("b", clock.now);
    clock.run(10_100);
    expect(room.snapshot().players[1].presence).toBe("LEFT");
    const late = new FakeConn("b3");
    room.connect(late, "p2", clock.now);
    expect(late.closed?.code).toBe(CLOSE.LEFT);

    room.receive("a", JSON.stringify({ t: "leave" }), clock.now);
    clock.run(100);
    expect(room.currentPhase).toBe("FINISHED");
    expect(room.pendingResult?.status).toBe("ABANDONED");
    expect(room.pendingResult?.players.every((p) => p.left)).toBe(true);
  });

  it("sin nadie conectado la simulación se detiene", () => {
    const { room, clock } = setup(1);
    room.connect(new FakeConn("a"), "p1", clock.now);
    clock.run(500);
    room.disconnect("a", clock.now);
    const t = room.tick;
    clock.run(3000);
    expect(room.tick).toBe(t);
  });

  it("acciones inválidas se rechazan y no alteran la partida", () => {
    const { room, clock } = setup(1);
    const a = new FakeConn("a");
    room.connect(a, "p1", clock.now);
    clock.run(100);
    const before = room.snapshot().players[0];
    room.receive("a", JSON.stringify({ t: "in", s: 1, i: { ...IDLE_INPUT, hp: 99999 } }), clock.now);
    room.receive("a", JSON.stringify({ t: "setHp", hp: 99999 }), clock.now);
    clock.run(500);
    expect(a.messages.filter((m) => m.t === "error")).toHaveLength(2);
    const after = room.snapshot().players[0];
    expect(after.hp).toBe(before.hp);
    expect(after.pos).toEqual(before.pos);
  });

  it("mensajes viejos se ignoran y los botones pulsados entre ticks no se pierden", () => {
    const { room, clock } = setup(1);
    const a = new FakeConn("a");
    room.connect(a, "p1", clock.now);
    clock.run(100);
    // Pulsa y suelta la esquiva dentro del mismo tick.
    room.receive("a", input(5, { mx: 100, buttons: BUTTON_DODGE }), clock.now);
    room.receive("a", input(6, { mx: 100 }), clock.now);
    room.receive("a", input(4, { mx: -100 }), clock.now);
    clock.run(TICK_MS);
    const me = room.snapshot().players[0];
    expect(me.action.kind).toBe("DODGE");
    expect(a.last("state")?.ack ?? 6).toBe(6);
  });

  it("limita la frecuencia de mensajes y cierra a quien abusa", () => {
    const { room, clock } = setup(1, { maxViolations: 20 });
    const a = new FakeConn("a");
    room.connect(a, "p1", clock.now);
    for (let i = 1; i <= 200; i++) room.receive("a", input(i), clock.now);
    expect(a.messages.some((m) => m.t === "error" && m.code === "RATE_LIMIT")).toBe(true);
    expect(a.closed?.code).toBe(CLOSE.POLICY);
  });

  it("los tickets no se pueden reutilizar", () => {
    const { room, clock } = setup(1);
    expect(room.acceptNonce("n1", 2_000_000, clock.now)).toBe(true);
    expect(room.acceptNonce("n1", 2_000_000, clock.now)).toBe(false);
  });

  it("se puede guardar y restaurar a mitad de partida", () => {
    const { room, clock } = setup(2);
    room.connect(new FakeConn("a"), "p1", clock.now);
    room.connect(new FakeConn("b"), "p2", clock.now);
    room.receive("a", input(1, { mx: 100 }), clock.now);
    clock.run(1500);
    const saved = JSON.parse(JSON.stringify(room.serialize()));
    const restored = ExpeditionRoom.restore(saved, clock.now + 5000);
    expect(restored.tick).toBe(room.tick);
    expect(restored.currentPhase).toBe("RUNNING");
    expect(restored.snapshot().players.every((p) => p.presence === "DISCONNECTED")).toBe(true);
    const c = new FakeConn("c");
    restored.connect(c, "p1", clock.now + 5000);
    // Las posiciones viajan redondeadas a milésimas.
    expect(c.last("welcome")!.state.players[0].pos.x).toBeCloseTo(room.snapshot().players[0].pos.x, 3);
  });

  it("el cooperativo llega a un resultado y lo entrega una vez", () => {
    const { room, clock } = setup(1);
    room.connect(new FakeConn("a"), "p1", clock.now);
    clock.run(100);
    // Sin defenderse: los enemigos acaban derribando al jugador (o el tiempo se agota).
    for (let i = 0; i < 60 && room.currentPhase !== "FINISHED"; i++) {
      room.receive("a", input(i + 1, { mx: 100 }), clock.now);
      clock.run(5_000);
    }
    expect(room.currentPhase).toBe("FINISHED");
    const result = room.pendingResult!;
    expect(["DEFEAT", "VICTORY"]).toContain(result.status);
    expect(result.players[0]).toMatchObject({ id: "p1", left: false });
    room.markResultReported();
    expect(room.pendingResult).toBeNull();
    expect(room.result).not.toBeNull();
  });
});
