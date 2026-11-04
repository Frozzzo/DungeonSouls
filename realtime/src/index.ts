/**
 * Servidor de partida de DungeonSouls (Fase 4): Cloudflare Worker + un Durable Object por expedición.
 *
 * - El Worker solo verifica el ticket firmado por Vercel y dirige la conexión al objeto
 *   `idFromName(expeditionId)`: todas las conexiones de una expedición llegan a la misma instancia.
 * - El objeto ejecuta `ExpeditionRoom` (src/realtime/room.ts), que usa la misma simulación que el
 *   juego en solitario, a 20 ticks/s. Guarda la sala cada pocos segundos para sobrevivir a un reinicio.
 * - Al terminar envía el resultado firmado a Vercel y lo reintenta hasta que Vercel lo confirma.
 */
import { DurableObject } from "cloudflare:workers";
import type { ExpeditionResult, ExpeditionRoomConfig } from "../../src/realtime/protocol";
import { ExpeditionRoom, type RoomConnection, type SavedRoom } from "../../src/realtime/room";
import { assertSecret, signRequest, verifyTicket } from "../../src/realtime/signing";

export interface Env {
  EXPEDITIONS: DurableObjectNamespace<ExpeditionDurableObject>;
  /** Secreto compartido con Vercel (wrangler secret put REALTIME_SECRET). */
  REALTIME_SECRET: string;
  /** URL de la aplicación en Vercel, sin barra final (https://….vercel.app). */
  APP_URL: string;
  /** Orígenes del navegador admitidos, separados por comas. Vacío = cualquiera (solo en local). */
  ALLOWED_ORIGINS?: string;
}

const EXPEDITION_PATH = /^\/expeditions\/([A-Za-z0-9_-]{1,64})$/;
const LOOP_MS = 50;
const PERSIST_EVERY_MS = 3_000;
/** Tras terminar y entregar el resultado, la sala se borra pasado este tiempo. */
const CLEANUP_AFTER_MS = 60 * 60_000;
const REPORT_RETRY_MS = [2_000, 5_000, 15_000, 60_000, 300_000];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ status: "ok" });

    const match = EXPEDITION_PATH.exec(url.pathname);
    if (!match) return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });

    // Evita que otra web abra conexiones en nombre del jugador (además del ticket).
    const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
    const origin = request.headers.get("Origin");
    if (allowed.length > 0 && (!origin || !allowed.includes(origin))) return new Response("Origin not allowed", { status: 403 });

    const expeditionId = match[1];
    const check = await verifyTicket(assertSecret(env.REALTIME_SECRET), url.searchParams.get("ticket") ?? "", expeditionId);
    if (!check.ok) return new Response(`Invalid ticket (${check.reason})`, { status: 401 });

    // El objeto confía en estas cabeceras: solo el Worker puede llamarlo.
    const headers = new Headers({ Upgrade: "websocket", "x-ds-expedition": expeditionId, "x-ds-player": check.payload.c, "x-ds-nonce": check.payload.n, "x-ds-exp": String(check.payload.exp) });
    const stub = env.EXPEDITIONS.get(env.EXPEDITIONS.idFromName(expeditionId));
    return stub.fetch(new Request("https://room/connect", { headers }));
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  connId: string;
  playerId: string;
}

export class ExpeditionDurableObject extends DurableObject<Env> {
  private room: ExpeditionRoom | null = null;
  private loop: ReturnType<typeof setInterval> | null = null;
  private lastPersist = 0;
  private reporting = false;
  private reportAttempts = 0;
  private loading: Promise<ExpeditionRoom | null> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<SavedRoom>("room");
      if (!saved) return;
      this.room = ExpeditionRoom.restore(saved, Date.now());
      // Conexiones que sobrevivieron a la hibernación: vuelven a entrar y reciben una instantánea.
      for (const ws of ctx.getWebSockets()) {
        const att = ws.deserializeAttachment() as Attachment | null;
        if (att) this.room.connect(this.adapter(ws, att.connId), att.playerId, Date.now());
      }
      if (this.room.currentPhase !== "FINISHED" || this.room.pendingResult) this.startLoop();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const expeditionId = request.headers.get("x-ds-expedition") ?? "";
    const playerId = request.headers.get("x-ds-player") ?? "";
    const nonce = request.headers.get("x-ds-nonce") ?? "";
    const exp = Number(request.headers.get("x-ds-exp") ?? "0");

    const room = this.room ?? (await this.loadRoom(expeditionId));
    if (!room) return new Response("Expedition not active", { status: 410 });
    if (room.expeditionId !== expeditionId || !room.hasPlayer(playerId)) return new Response("Unknown player", { status: 403 });
    if (!room.acceptNonce(nonce, exp, Date.now())) return new Response("Ticket already used", { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const connId = crypto.randomUUID();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connId, playerId } satisfies Attachment);
    room.connect(this.adapter(server, connId), playerId, Date.now());
    this.startLoop();
    await this.persist(true);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att && this.room) this.room.receive(att.connId, message, Date.now());
  }

  async webSocketClose(ws: WebSocket) {
    this.dropSocket(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.dropSocket(ws);
  }

  async alarm() {
    const room = this.room;
    if (!room) return;
    if (room.pendingResult) {
      await this.report(room.pendingResult);
      if (!room.pendingResult) {
        room.closeAll("La expedición ha terminado.");
        await this.ctx.storage.setAlarm(Date.now() + CLEANUP_AFTER_MS);
      }
      return;
    }
    if (room.currentPhase === "FINISHED") {
      // Sala terminada y resultado entregado: se libera el almacenamiento.
      await this.ctx.storage.deleteAll();
      this.room = null;
    }
  }

  private dropSocket(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (att && this.room) this.room.disconnect(att.connId, Date.now());
  }

  private adapter(ws: WebSocket, connId: string): RoomConnection {
    return {
      id: connId,
      send: (data) => ws.send(data),
      close: (code, reason) => {
        try {
          ws.close(code, reason);
        } catch {
          // Ya cerrada.
        }
      },
    };
  }

  /** Pide a Vercel la configuración de la sala (una vez por expedición). */
  private loadRoom(expeditionId: string): Promise<ExpeditionRoom | null> {
    this.loading ??= (async () => {
      const path = `/api/internal/expeditions/${encodeURIComponent(expeditionId)}/config`;
      const headers = await signRequest(assertSecret(this.env.REALTIME_SECRET), "GET", path);
      const res = await fetch(`${this.env.APP_URL}${path}`, { headers });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`config ${res.status}`);
      const body = (await res.json()) as ExpeditionRoomConfig;
      if (body.expeditionId !== expeditionId) return null;
      this.room ??= new ExpeditionRoom({ expeditionId, config: body.config, inactivePlayerIds: body.inactivePlayerIds, now: Date.now() });
      return this.room;
    })().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private startLoop() {
    if (this.loop) return;
    this.loop = setInterval(() => void this.tick(), LOOP_MS);
  }

  private stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  private async tick() {
    const room = this.room;
    if (!room) return this.stopLoop();
    const now = Date.now();
    room.advance(now);
    if (room.pendingResult && !this.reporting) await this.report(room.pendingResult);
    if (room.currentPhase === "FINISHED" && !room.pendingResult) {
      this.stopLoop();
      room.closeAll("La expedición ha terminado.");
      await this.persist(true);
      await this.ctx.storage.setAlarm(now + CLEANUP_AFTER_MS);
      return;
    }
    await this.persist(false);
  }

  private async persist(force: boolean) {
    if (!this.room) return;
    const now = Date.now();
    if (!force && now - this.lastPersist < PERSIST_EVERY_MS) return;
    this.lastPersist = now;
    await this.ctx.storage.put("room", this.room.serialize());
  }

  /** Envía el resultado firmado a Vercel. Si falla, se reintenta con una alarma (con espera creciente). */
  private async report(result: ExpeditionResult) {
    if (this.reporting || !this.room) return;
    this.reporting = true;
    try {
      const path = `/api/internal/expeditions/${encodeURIComponent(result.expeditionId)}/results`;
      const body = JSON.stringify(result);
      const headers = await signRequest(assertSecret(this.env.REALTIME_SECRET), "POST", path, body);
      const res = await fetch(`${this.env.APP_URL}${path}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body });
      // 400 = resultado rechazado por validación: reintentar no lo arreglaría.
      if (res.ok || res.status === 400) {
        this.room.markResultReported();
        await this.persist(true);
        return;
      }
      throw new Error(`results ${res.status}`);
    } catch (error) {
      console.error("No se pudo entregar el resultado", String(error));
      const wait = REPORT_RETRY_MS[Math.min(this.reportAttempts, REPORT_RETRY_MS.length - 1)];
      this.reportAttempts++;
      this.stopLoop();
      await this.persist(true);
      await this.ctx.storage.setAlarm(Date.now() + wait);
    } finally {
      this.reporting = false;
    }
  }
}
