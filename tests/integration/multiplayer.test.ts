import { beforeEach, describe, expect, it } from "vitest";
import { registerSchema } from "@/lib/validation/auth";
import { createCharacterSchema } from "@/lib/validation/character";
import { botInput } from "@/game/simulation/bot";
import { BALANCE } from "@/game/balance";
import { GET as configRoute } from "@/app/api/internal/expeditions/[id]/config/route";
import { POST as resultsRoute } from "@/app/api/internal/expeditions/[id]/results/route";
import type { ExpeditionResult, ExpeditionRoomConfig } from "@/realtime/protocol";
import { ExpeditionRoom, type RoomConnection, TICK_MS } from "@/realtime/room";
import { signRequest, verifyTicket } from "@/realtime/signing";
import { registerUser } from "@/server/auth/service";
import { createCharacter } from "@/server/characters/service";
import { db } from "@/server/db";
import { startRun, submitRun } from "@/server/dungeon/service";
import { DomainError } from "@/server/errors";
import { cancelExpedition, getExpeditionForPlay, issueTicket, leaveExpedition, startExpedition } from "@/server/expeditions/service";
import { createParty, getMyParty, joinParty, kickMember, leaveParty, setReady } from "@/server/parties/service";
import { resetDatabase, uniqueUser } from "./helpers";

const SECRET = "integration-secret-".padEnd(48, "x");
process.env.REALTIME_SECRET = SECRET;
process.env.REALTIME_URL = "ws://localhost:8787";

let ip = 0;
async function player(name: string, classId: "TANK" | "DPS" | "HEALER" = "DPS") {
  ip += 1;
  const userId = (await registerUser(registerSchema.parse(uniqueUser("mp")), `9.9.${Math.floor(ip / 250)}.${ip % 250}`)).userId;
  const character = await createCharacter(userId, createCharacterSchema.parse({ name, classId }));
  return { userId, characterId: character.id };
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (e) {
    return e instanceof DomainError ? e.code : String(e);
  }
};

async function signed(method: "GET" | "POST", path: string, body = "") {
  const headers = await signRequest(SECRET, method, path, body);
  return new Request(`http://localhost${path}`, { method, headers: { ...headers, "content-type": "application/json" }, body: method === "POST" ? body : undefined });
}

async function postResult(result: ExpeditionResult) {
  const path = `/api/internal/expeditions/${result.expeditionId}/results`;
  const res = await resultsRoute(await signed("POST", path, JSON.stringify(result)), { params: Promise.resolve({ id: result.expeditionId }) });
  return { status: res.status, body: (await res.json()) as { status?: string; error?: string } };
}

async function fetchRoomConfig(expeditionId: string) {
  const path = `/api/internal/expeditions/${expeditionId}/config`;
  const res = await configRoute(await signed("GET", path), { params: Promise.resolve({ id: expeditionId }) });
  return { status: res.status, body: (await res.json()) as ExpeditionRoomConfig };
}

/** Juega la sala entera con el piloto automático para cada jugador (como harían los clientes). */
function playRoom(roomConfig: ExpeditionRoomConfig): ExpeditionResult {
  let now = 5_000_000;
  const room = new ExpeditionRoom({ ...roomConfig, now }, { waitForPlayersMs: 1000 });
  const conns: RoomConnection[] = roomConfig.config.players.map((p) => ({ id: `c-${p.id}`, send: () => undefined, close: () => undefined }));
  roomConfig.config.players.forEach((p, i) => room.connect(conns[i], p.id, now));
  let seq = 0;
  while (room.currentPhase !== "FINISHED" && room.tick < 20 * 60 * 20) {
    const state = room.snapshot();
    seq++;
    state.players.forEach((_p, i) => room.receive(conns[i].id, JSON.stringify({ t: "in", s: seq, i: botInput(room.ctx, state, i) }), now));
    now += TICK_MS;
    room.advance(now);
  }
  return room.result!;
}

beforeEach(resetDatabase);

describe("grupos", () => {
  it("crear, unirse con código, máximo 4, salir y relevo del líder", async () => {
    const a = await player("Lider");
    const b = await player("Segundo");
    const c = await player("Tercero");
    const d = await player("Cuarto");
    const e = await player("Quinto");
    const { code: partyCode } = await createParty(a.userId, { characterId: a.characterId });
    expect(partyCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(await code(createParty(a.userId, { characterId: a.characterId }))).toBe("ALREADY_IN_PARTY");
    expect(await code(joinParty(b.userId, { code: "ZZZZZZ", characterId: b.characterId }))).toBe("NOT_FOUND");
    expect(await code(joinParty(b.userId, { code: partyCode, characterId: a.characterId }))).toBe("NOT_FOUND");

    await joinParty(b.userId, { code: partyCode, characterId: b.characterId });
    await joinParty(c.userId, { code: partyCode, characterId: c.characterId });
    await joinParty(d.userId, { code: partyCode, characterId: d.characterId });
    expect(await code(joinParty(e.userId, { code: partyCode, characterId: e.characterId }))).toBe("PARTY_FULL");
    expect(await code(joinParty(b.userId, { code: partyCode, characterId: b.characterId }))).toBe("ALREADY_IN_PARTY");

    const view = await getMyParty(c.userId);
    expect(view?.members.map((m) => m.characterName)).toEqual(["Lider", "Segundo", "Tercero", "Cuarto"]);
    expect(view?.isLeader).toBe(false);

    await leaveParty(a.userId);
    expect(await getMyParty(a.userId)).toBeNull();
    const after = await getMyParty(b.userId);
    expect(after?.isLeader).toBe(true);
    expect(after?.members).toHaveLength(3);

    expect(await code(kickMember(c.userId, d.userId))).toBe("NOT_LEADER");
    await kickMember(b.userId, d.userId);
    await joinParty(e.userId, { code: partyCode, characterId: e.characterId });
    expect((await getMyParty(e.userId))?.members).toHaveLength(3);

    for (const u of [b, c, e]) await leaveParty(u.userId);
    const party = await db.party.findUniqueOrThrow({ where: { code: partyCode } });
    expect(party.status).toBe("CLOSED");
    expect(await code(joinParty(a.userId, { code: partyCode, characterId: a.characterId }))).toBe("NOT_FOUND");
  });

  it("solo el líder empieza, con todos listos y un piso que todos tienen", async () => {
    const a = await player("Guia", "TANK");
    const b = await player("Apoyo", "HEALER");
    const { code: partyCode } = await createParty(a.userId, { characterId: a.characterId });
    await joinParty(b.userId, { code: partyCode, characterId: b.characterId });
    expect(await code(startExpedition(b.userId, { floor: 1 }))).toBe("NOT_LEADER");
    expect(await code(startExpedition(a.userId, { floor: 1 }))).toBe("NOT_READY");
    await setReady(b.userId, true);
    await db.character.update({ where: { id: a.characterId }, data: { highestFloorCleared: 3 } });
    expect(await code(startExpedition(a.userId, { floor: 2 }))).toBe("FLOOR_LOCKED");
    const { expeditionId } = await startExpedition(a.userId, { floor: 1 });
    expect(await code(startExpedition(a.userId, { floor: 1 }))).toBe("IN_EXPEDITION");
    expect(await code(joinParty((await player("Tarde")).userId, { code: partyCode, characterId: "x" }))).not.toBe("OK");

    const runs = await db.dungeonRun.findMany({ where: { expeditionId }, orderBy: { partySlot: "asc" } });
    expect(runs.map((r) => r.characterId)).toEqual([a.characterId, b.characterId]);
    expect(new Set(runs.map((r) => r.seed)).size).toBe(1);
    // Un intento de expedición no se puede validar por repetición en solitario.
    expect(await code(submitRun(a.userId, { runId: runs[0].id, segments: [[1, 0, 0, 0, 0, 0]] }))).toBe("EXPEDITION_RUN");
  });
});

describe("expedición en línea", () => {
  async function startedDuo() {
    const a = await player("Escudo", "TANK");
    const b = await player("Saeta", "DPS");
    for (const p of [a, b]) await db.character.update({ where: { id: p.characterId }, data: { level: 6, statPoints: 0, allocatedStrength: 10, allocatedDexterity: 10, allocatedVitality: 10 } });
    const { code: partyCode } = await createParty(a.userId, { characterId: a.characterId });
    await joinParty(b.userId, { code: partyCode, characterId: b.characterId });
    await setReady(b.userId, true);
    const { expeditionId } = await startExpedition(a.userId, { floor: 1 });
    return { a, b, expeditionId };
  }

  it("tickets: solo para participantes activos y firmados para esa expedición", async () => {
    const { a, b, expeditionId } = await startedDuo();
    const outsider = await player("Ajeno");
    const t = await issueTicket(a.userId, expeditionId);
    expect(t.url).toBe(`ws://localhost:8787/expeditions/${expeditionId}`);
    const check = await verifyTicket(SECRET, t.ticket, expeditionId);
    expect(check.ok && check.payload.c).toBe(a.characterId);
    expect(await code(issueTicket(outsider.userId, expeditionId))).toBe("NOT_FOUND");
    await leaveExpedition(b.userId, expeditionId);
    expect(await code(issueTicket(b.userId, expeditionId))).toBe("NOT_FOUND");
    expect(await getExpeditionForPlay(a.userId, expeditionId)).not.toBeNull();
  });

  it("las rutas internas exigen firma válida", async () => {
    const { expeditionId } = await startedDuo();
    const path = `/api/internal/expeditions/${expeditionId}/config`;
    const unsigned = await configRoute(new Request(`http://localhost${path}`), { params: Promise.resolve({ id: expeditionId }) });
    expect(unsigned.status).toBe(401);
    // Firma de otra ruta reutilizada en esta.
    const otherHeaders = await signRequest(SECRET, "GET", "/api/internal/expeditions/otra/config");
    const otherPath = await configRoute(new Request(`http://localhost${path}`, { headers: otherHeaders }), { params: Promise.resolve({ id: expeditionId }) });
    expect(otherPath.status).toBe(401);
    const ok = await fetchRoomConfig(expeditionId);
    expect(ok.status).toBe(200);
    expect(ok.body.config.players).toHaveLength(2);
    expect(ok.body.config.players[0].stats.maxHealth).toBeGreaterThan(0);
  });

  it("partida completa en la sala: recompensas una sola vez aunque el resultado llegue repetido", async () => {
    const { a, b, expeditionId } = await startedDuo();
    const { body: roomConfig } = await fetchRoomConfig(expeditionId);
    const result = playRoom(roomConfig);
    expect(result.status).toBe("VICTORY");

    const [first, second] = await Promise.all([postResult(result), postResult(result)]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const third = await postResult(result);
    expect(third.body.status).toBe("ALREADY_APPLIED");

    for (const p of [a, b]) {
      const grants = await db.rewardGrant.findMany({ where: { characterId: p.characterId } });
      expect(grants).toHaveLength(1);
      expect(grants[0].idempotencyKey).toBe(`exp:${expeditionId}:${p.characterId}`);
      const run = await db.dungeonRun.findFirstOrThrow({ where: { expeditionId, characterId: p.characterId } });
      expect(run.status).toBe("COMPLETED");
      const character = await db.character.findUniqueOrThrow({ where: { id: p.characterId } });
      expect(character.highestFloorCleared).toBe(1);
    }
    const expedition = await db.expedition.findUniqueOrThrow({ where: { id: expeditionId }, include: { party: true } });
    expect(expedition.status).toBe("COMPLETED");
    expect(expedition.party.status).toBe("OPEN");
    // Botín propio para cada uno.
    const items = await db.itemInstance.findMany({ where: { characterId: { in: [a.characterId, b.characterId] } } });
    expect(items.length).toBeGreaterThan(0);
  });

  it("quien abandona no recibe nada; el resultado inválido o de otra expedición se rechaza", async () => {
    const { a, b, expeditionId } = await startedDuo();
    const { body: roomConfig } = await fetchRoomConfig(expeditionId);
    const result = playRoom(roomConfig);
    const bad = await postResult({ ...result, players: result.players.map((p) => ({ ...p, potionsLeft: -1 })) });
    expect(bad.status).toBe(400);
    const tampered = { ...result, expeditionId: "otra" };
    const res = await resultsRoute(await signed("POST", `/api/internal/expeditions/${expeditionId}/results`, JSON.stringify(tampered)), { params: Promise.resolve({ id: expeditionId }) });
    expect(res.status).toBe(400);

    const withLeaver = { ...result, players: result.players.map((p) => (p.id === b.characterId ? { ...p, left: true } : p)) };
    expect((await postResult(withLeaver)).status).toBe(200);
    expect(await db.rewardGrant.count({ where: { characterId: a.characterId } })).toBe(1);
    expect(await db.rewardGrant.count({ where: { characterId: b.characterId } })).toBe(0);
    expect((await db.dungeonRun.findFirstOrThrow({ where: { expeditionId, characterId: b.characterId } })).status).toBe("ABANDONED");
  });

  it("derrota: sin XP, pociones descontadas; cancelar deja el grupo abierto e ignora resultados tardíos", async () => {
    const { a, expeditionId } = await startedDuo();
    const run = await db.dungeonRun.findFirstOrThrow({ where: { expeditionId, characterId: a.characterId } });
    const { body: roomConfig } = await fetchRoomConfig(expeditionId);
    const result = playRoom(roomConfig);
    const defeat: ExpeditionResult = { ...result, status: "DEFEAT", defeatReason: "DOWNED", players: result.players.map((p) => ({ ...p, potionsLeft: 0 })) };
    await postResult(defeat);
    expect(await db.rewardGrant.count()).toBe(0);
    const potions = await db.consumableStack.findFirst({ where: { characterId: a.characterId } });
    expect(potions?.quantity).toBe(BALANCE.consumables.startingPotions - run.potionsAtStart);

    // Segunda expedición, cancelada por el líder.
    const b2 = await getMyParty(a.userId);
    const other = b2!.members.find((m) => !m.isLeader)!;
    await setReady(other.userId, true);
    const second = await startExpedition(a.userId, { floor: 1 });
    await cancelExpedition(a.userId);
    expect((await getMyParty(a.userId))?.status).toBe("OPEN");
    const late = await postResult({ ...result, expeditionId: second.expeditionId });
    expect(late.body.status).toBe("ALREADY_APPLIED");
    expect(await db.rewardGrant.count()).toBe(0);
  });

  it("empezar un piso en solitario abandona la participación en la expedición", async () => {
    const { a, expeditionId } = await startedDuo();
    await startRun(a.userId, { characterId: a.characterId, floor: 1 });
    expect(await getExpeditionForPlay(a.userId, expeditionId)).toBeNull();
  });
});
