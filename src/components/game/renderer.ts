import { BALANCE } from "@/game/balance";
import { BOSS_DEFINITIONS } from "@/game/bosses/definitions";
import { secondsToTicks } from "@/game/simulation/context";
import { CLASS_DEFINITIONS } from "@/game/classes/definitions";
import { getCombatKit } from "@/game/combat/kits";
import { hasStatus } from "@/game/combat/status";
import { TILE_FLOOR, type FloorLayout } from "@/game/dungeon/types";
import { ENEMY_DEFINITIONS } from "@/game/enemies/definitions";
import type { Vec } from "@/game/math/vec";
import type { SimEvent, SimState, Telegraph } from "@/game/simulation/types";

/** Partícula de presentación (números de daño, destellos). No afecta a la simulación. */
interface Floater {
  text: string;
  color: string;
  pos: Vec;
  age: number;
  life: number;
  size: number;
}

interface Burst {
  pos: Vec;
  color: string;
  age: number;
  life: number;
  radius: number;
}

const TEXTURE_TILE = 32;

/**
 * Dibuja el estado de la simulación en un canvas 2D. Interpola posiciones entre el tick anterior
 * y el actual para que el movimiento sea fluido a cualquier tasa de refresco.
 */
export class GameRenderer {
  private ctx: CanvasRenderingContext2D;
  private mapTexture: HTMLCanvasElement;
  private floaters: Floater[] = [];
  private bursts: Burst[] = [];
  private shake = 0;
  width = 0;
  height = 0;
  scale = 40;
  camera: Vec = { x: 0, y: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    private layout: FloorLayout,
    private localPlayerId: string,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D no disponible");
    this.ctx = ctx;
    this.mapTexture = buildMapTexture(layout);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Siempre se ven unas 15 casillas en el lado corto.
    this.scale = Math.max(24, Math.min(60, Math.min(rect.width, rect.height) / 15));
  }

  worldToScreen(p: Vec): Vec {
    return { x: (p.x - this.camera.x) * this.scale + this.width / 2, y: (p.y - this.camera.y) * this.scale + this.height / 2 };
  }

  /** Registra los efectos visuales de los eventos de un tick. */
  pushEvents(events: readonly SimEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case "DAMAGE": {
          const toPlayer = e.target === "PLAYER";
          const color = toPlayer ? "#ff5a4f" : e.blocked ? "#9aa5b1" : e.crit ? "#ffd166" : "#ede6d6";
          const text = e.amount === 0 ? "inmune" : e.blocked ? `${e.amount} 🛡` : String(e.amount);
          this.floaters.push({ text: e.crit ? `${text}!` : text, color, pos: { x: e.pos.x, y: e.pos.y - 0.6 }, age: 0, life: 0.9, size: e.crit ? 20 : 15 });
          this.bursts.push({ pos: e.pos, color: toPlayer ? "rgba(255,80,60," : "rgba(255,220,160,", age: 0, life: 0.25, radius: 0.5 });
          if (toPlayer) this.shake = Math.min(10, this.shake + 4 + e.amount / 10);
          break;
        }
        case "HEAL":
          this.floaters.push({ text: `+${e.amount}`, color: "#6fe3a1", pos: { x: e.pos.x, y: e.pos.y - 0.6 }, age: 0, life: 1.1, size: 17 });
          this.bursts.push({ pos: e.pos, color: "rgba(111,227,161,", age: 0, life: 0.6, radius: 1.4 });
          break;
        case "DODGED":
          this.floaters.push({ text: "esquiva", color: "#9ad1ff", pos: { x: e.pos.x, y: e.pos.y - 0.7 }, age: 0, life: 0.7, size: 13 });
          break;
        case "ABILITY":
          this.bursts.push({ pos: e.pos, color: e.slot === 3 ? "rgba(224,68,58," : "rgba(240,160,75,", age: 0, life: e.slot === 3 ? 0.7 : 0.45, radius: e.slot === 3 ? 3.6 : 2.4 });
          break;
        case "POTION":
          this.floaters.push({ text: `+${e.amount}`, color: "#6fe3a1", pos: { x: e.pos.x, y: e.pos.y - 0.6 }, age: 0, life: 1.1, size: 17 });
          this.bursts.push({ pos: e.pos, color: "rgba(217,68,58,", age: 0, life: 0.5, radius: 1 });
          break;
        case "ABSORBED":
          this.floaters.push({ text: `${e.amount} absorbido`, color: "#78beff", pos: { x: e.pos.x, y: e.pos.y - 0.7 }, age: 0, life: 0.8, size: 13 });
          break;
        case "ENEMY_DIED":
          this.bursts.push({ pos: e.pos, color: "rgba(180,160,220,", age: 0, life: 0.5, radius: 1.2 });
          break;
        case "BOSS_DIED":
          this.bursts.push({ pos: e.pos, color: "rgba(224,96,43,", age: 0, life: 1.4, radius: 5 });
          this.shake = 14;
          break;
        case "BOSS_PHASE":
          this.bursts.push({ pos: this.camera, color: "rgba(224,96,43,", age: 0, life: 1.2, radius: 7 });
          this.shake = 10;
          break;
        case "PLAYER_DOWNED":
          this.shake = 12;
          break;
        default:
          break;
      }
    }
  }

  render(prev: SimState, curr: SimState, alpha: number, frameSeconds: number) {
    const ctx = this.ctx;
    const s = this.scale;
    const lerp = (a: Vec, b: Vec): Vec => ({ x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha });
    const prevPlayers = new Map(prev.players.map((p) => [p.id, p]));
    const prevEnemies = new Map(prev.enemies.map((e) => [e.id, e]));

    const me = curr.players.find((p) => p.id === this.localPlayerId) ?? curr.players[0];
    const mePrev = prevPlayers.get(me.id) ?? me;
    this.camera = lerp(mePrev.pos, me.pos);

    this.shake = Math.max(0, this.shake - frameSeconds * 30);
    const shakeX = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const shakeY = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;

    ctx.save();
    ctx.fillStyle = "#050408";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.translate(shakeX, shakeY);

    // Mapa
    const origin = this.worldToScreen({ x: 0, y: 0 });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mapTexture, origin.x, origin.y, this.layout.width * s, this.layout.height * s);

    // Portal
    this.drawPortal(curr.portalOpen, curr.tick + alpha);

    // Telegráficos (debajo de las entidades)
    for (const e of curr.enemies) if (e.telegraph) this.drawTelegraph(e.telegraph);
    if (curr.boss?.telegraph) this.drawTelegraph(curr.boss.telegraph);

    // Ondas
    for (const h of curr.hazards) {
      const c = this.worldToScreen(h.center);
      ctx.beginPath();
      ctx.arc(c.x, c.y, (h.radius + h.growth * alpha) * s, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,140,50,0.9)";
      ctx.lineWidth = h.thickness * s;
      ctx.shadowColor = "#ff7a2b";
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Enemigos
    for (const e of curr.enemies) {
      const p = this.worldToScreen(lerp(prevEnemies.get(e.id)?.pos ?? e.pos, e.pos));
      const def = ENEMY_DEFINITIONS[e.kind];
      const hurt = curr.tick - e.lastHurtTick < 3;
      this.drawShadow(p, e.radius);
      ctx.beginPath();
      ctx.arc(p.x, p.y, e.radius * s, 0, Math.PI * 2);
      ctx.fillStyle = hurt ? "#ffffff" : def.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = e.state === "WINDUP" ? "#ff4d3d" : e.state === "RECOVERY" ? "#6fe3a1" : "rgba(0,0,0,0.6)";
      ctx.stroke();
      // Escudo frontal
      if (def.frontalBlock) {
        ctx.beginPath();
        const ang = Math.atan2(e.facing.y, e.facing.x);
        ctx.arc(p.x, p.y, (e.radius + 0.12) * s, ang - 1.05, ang + 1.05);
        ctx.strokeStyle = e.state === "RECOVERY" ? "rgba(160,170,180,0.4)" : "#cfd8dc";
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      this.drawFacing(p, e.facing, e.radius, "rgba(0,0,0,0.7)");
      if (e.hp < e.maxHp) this.drawBar(p, e.radius, e.hp / e.maxHp, "#d9443a");
      if (hasStatus(e.statuses, "STUN")) this.drawTag(p, e.radius, "aturdido", "#ffd166");
      else if (hasStatus(e.statuses, "SLOW")) this.drawTag(p, e.radius, "ralentizado", "#9ad1ff");
    }

    // Jefe
    const boss = curr.boss;
    if (boss && boss.hp > 0) {
      const def = BOSS_DEFINITIONS[boss.bossId];
      const p = this.worldToScreen(boss.pos);
      const hurt = curr.tick - boss.lastHurtTick < 3;
      this.drawShadow(p, boss.radius * 1.1);
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, boss.radius * s * 2.2);
      glow.addColorStop(0, boss.phase > 0 ? "rgba(255,110,40,0.45)" : "rgba(224,96,43,0.25)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(p.x - boss.radius * s * 2.2, p.y - boss.radius * s * 2.2, boss.radius * s * 4.4, boss.radius * s * 4.4);
      ctx.beginPath();
      ctx.arc(p.x, p.y, boss.radius * s, 0, Math.PI * 2);
      ctx.fillStyle = hurt ? "#fff3e0" : boss.state === "TRANSITION" ? "#ffb347" : def.color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = boss.state === "WINDUP" ? "#ff2d1a" : boss.state === "RECOVERY" ? "#6fe3a1" : "#2a1208";
      ctx.stroke();
      this.drawFacing(p, boss.facing, boss.radius, "#2a1208");
    }

    // Proyectiles
    for (const pr of curr.projectiles) {
      const p = this.worldToScreen({ x: pr.pos.x + pr.vel.x * alpha, y: pr.pos.y + pr.vel.y * alpha });
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3, pr.radius * s), 0, Math.PI * 2);
      ctx.fillStyle = pr.team === "PLAYER" ? "#9ff5ee" : "#e8d18a";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Jugadores
    for (const pl of curr.players) {
      const p = this.worldToScreen(lerp(prevPlayers.get(pl.id)?.pos ?? pl.pos, pl.pos));
      const accent = CLASS_DEFINITIONS[pl.classId].accent;
      const hurt = curr.tick - pl.lastHurtTick < 3;
      this.drawShadow(p, pl.radius);
      if (hasStatus(pl.statuses, "FORTIFIED")) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, (pl.radius + 0.25) * s, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(217,180,74,0.8)";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      if (hasStatus(pl.statuses, "BARRIER")) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, (pl.radius + 0.38) * s, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(120,190,255,0.85)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (hasStatus(pl.statuses, "EMPOWERED")) {
        ctx.shadowColor = "rgba(224,68,58,0.9)";
        ctx.shadowBlur = 14;
      }
      ctx.globalAlpha = pl.invulnerable > 0 ? 0.55 : pl.life === "ALIVE" ? 1 : 0.35;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pl.radius * s, 0, Math.PI * 2);
      ctx.fillStyle = hurt ? "#ffffff" : accent;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#ede6d6";
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      this.drawFacing(p, pl.facing, pl.radius, "#07060a");
      // En grupo: nombre de los aliados, derribados con su reanimación y desconectados.
      if (curr.players.length > 1) {
        if (pl.id !== this.localPlayerId) this.drawLabel(p, pl.radius, pl.name, "#ede6d6");
        if (pl.life === "DOWNED") {
          const total = secondsToTicks(BALANCE.multiplayer.revive.seconds);
          ctx.beginPath();
          ctx.arc(p.x, p.y, BALANCE.multiplayer.revive.radius * s, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(95,201,167,0.35)";
          ctx.setLineDash([6, 6]);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.setLineDash([]);
          if (pl.reviveProgress > 0) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, (pl.radius + 0.3) * s, -Math.PI / 2, -Math.PI / 2 + (Math.min(1, pl.reviveProgress / total) * Math.PI * 2));
            ctx.strokeStyle = "#5fc9a7";
            ctx.lineWidth = 4;
            ctx.stroke();
          }
          this.drawTag(p, pl.radius, pl.presence === "LEFT" ? "abandonó" : "derribado · mantén G", "#5fc9a7");
        } else if (pl.presence === "DISCONNECTED") {
          this.drawTag(p, pl.radius, "desconectado", "#9a96a8");
        }
      }
      if (hasStatus(pl.statuses, "SLOW")) this.drawTag(p, pl.radius, "ralentizado", "#9ad1ff");
      if (hasStatus(pl.statuses, "STUN")) this.drawTag(p, pl.radius, "aturdido", "#ffd166");
      // Arco del ataque cuerpo a cuerpo
      if (pl.action.kind === "ATTACK") {
        const basic = getCombatKit(pl.classId).basic;
        if (basic.kind === "MELEE_ARC") {
          const ang = Math.atan2(pl.action.dir.y, pl.action.dir.x);
          const half = Math.acos(basic.cosHalfAngle);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.arc(p.x, p.y, basic.range * s, ang - half, ang + half);
          ctx.closePath();
          ctx.fillStyle = pl.action.phase === "WINDUP" ? "rgba(237,230,214,0.12)" : "rgba(237,230,214,0.28)";
          ctx.fill();
        }
      }
    }

    // Destellos y números
    for (const b of this.bursts) {
      b.age += frameSeconds;
      const t = b.age / b.life;
      const p = this.worldToScreen(b.pos);
      ctx.beginPath();
      ctx.arc(p.x, p.y, b.radius * s * (0.4 + t * 0.6), 0, Math.PI * 2);
      ctx.fillStyle = `${b.color}${(0.35 * (1 - t)).toFixed(3)})`;
      ctx.fill();
    }
    this.bursts = this.bursts.filter((b) => b.age < b.life);

    ctx.textAlign = "center";
    for (const f of this.floaters) {
      f.age += frameSeconds;
      const t = f.age / f.life;
      const p = this.worldToScreen({ x: f.pos.x, y: f.pos.y - t * 0.8 });
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      ctx.font = `700 ${f.size}px var(--font-inter), system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(f.text, p.x, p.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    this.floaters = this.floaters.filter((f) => f.age < f.life);

    ctx.restore();

    // Viñeta
    const v = ctx.createRadialGradient(this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.35, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.65)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private drawTelegraph(t: Telegraph) {
    const ctx = this.ctx;
    const s = this.scale;
    const progress = t.total > 0 ? 1 - t.remaining / t.total : 1;
    const urgent = t.remaining <= 4;
    const edge = urgent ? "rgba(255,60,40,0.95)" : "rgba(255,80,60,0.7)";
    const fill = "rgba(255,60,40,0.16)";
    const inner = `rgba(255,70,40,${(0.18 + progress * 0.25).toFixed(3)})`;
    ctx.lineWidth = 2;
    switch (t.shape) {
      case "CIRCLE": {
        const c = this.worldToScreen(t.center);
        ctx.beginPath();
        ctx.arc(c.x, c.y, t.radius * s, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = edge;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(c.x, c.y, t.radius * s * progress, 0, Math.PI * 2);
        ctx.fillStyle = inner;
        ctx.fill();
        break;
      }
      case "CONE": {
        const o = this.worldToScreen(t.origin);
        const ang = Math.atan2(t.dir.y, t.dir.x);
        const half = Math.acos(t.cosHalfAngle);
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.arc(o.x, o.y, t.range * s, ang - half, ang + half);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = edge;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.arc(o.x, o.y, t.range * s * progress, ang - half, ang + half);
        ctx.closePath();
        ctx.fillStyle = inner;
        ctx.fill();
        break;
      }
      case "LINE": {
        const o = this.worldToScreen(t.origin);
        const end = this.worldToScreen({ x: t.origin.x + t.dir.x * t.length, y: t.origin.y + t.dir.y * t.length });
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = `rgba(255,200,120,${(0.25 + progress * 0.5).toFixed(3)})`;
        ctx.lineWidth = Math.max(2, t.width * s);
        ctx.setLineDash([8, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case "RING": {
        const c = this.worldToScreen(t.center);
        ctx.beginPath();
        ctx.arc(c.x, c.y, t.radius * s, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,140,50,0.35)";
        ctx.setLineDash([10, 8]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 1.4 * s * (0.5 + progress), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,140,50,${(0.2 + progress * 0.4).toFixed(3)})`;
        ctx.fill();
        break;
      }
    }
  }

  private drawPortal(open: boolean, time: number) {
    const ctx = this.ctx;
    const c = this.worldToScreen(this.layout.exit);
    const r = 0.8 * this.scale;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    if (open) {
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      g.addColorStop(0, "rgba(160,240,255,0.95)");
      g.addColorStop(0.6, "rgba(79,193,184,0.6)");
      g.addColorStop(1, "rgba(79,193,184,0)");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = `rgba(160,240,255,${(0.5 + 0.4 * Math.sin(time / 4)).toFixed(3)})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(120,110,140,0.5)";
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawShadow(p: Vec, radius: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + radius * this.scale * 0.7, radius * this.scale, radius * this.scale * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill();
  }

  private drawFacing(p: Vec, dir: Vec, radius: number, color: string) {
    const ctx = this.ctx;
    const s = this.scale;
    ctx.beginPath();
    ctx.arc(p.x + dir.x * radius * s * 0.55, p.y + dir.y * radius * s * 0.55, Math.max(2.5, radius * s * 0.22), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  private drawBar(p: Vec, radius: number, ratio: number, color: string) {
    const ctx = this.ctx;
    const w = Math.max(26, radius * this.scale * 2.2);
    const x = p.x - w / 2;
    const y = p.y - radius * this.scale - 10;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, ratio), 4);
  }

  private drawLabel(p: Vec, radius: number, text: string, color: string) {
    const ctx = this.ctx;
    ctx.font = "600 11px var(--font-inter), system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.fillText(text, p.x, p.y - radius * this.scale - 8);
  }

  private drawTag(p: Vec, radius: number, text: string, color: string) {
    const ctx = this.ctx;
    ctx.font = "600 11px var(--font-inter), system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.fillText(text, p.x, p.y + radius * this.scale + 16);
  }
}

/** Textura del mapa: losas con variación determinista, muros con borde iluminado. */
function buildMapTexture(layout: FloorLayout): HTMLCanvasElement {
  const t = TEXTURE_TILE;
  const canvas = document.createElement("canvas");
  canvas.width = layout.width * t;
  canvas.height = layout.height * t;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const isFloor = (x: number, y: number) => x >= 0 && y >= 0 && x < layout.width && y < layout.height && layout.tiles[y * layout.width + x] === TILE_FLOOR;
  for (let y = 0; y < layout.height; y++) {
    for (let x = 0; x < layout.width; x++) {
      const h = hash(x, y, layout.seed);
      if (isFloor(x, y)) {
        const shade = 34 + (h % 10);
        ctx.fillStyle = `rgb(${shade},${shade - 4},${shade + 8})`;
        ctx.fillRect(x * t, y * t, t, t);
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.strokeRect(x * t + 0.5, y * t + 0.5, t - 1, t - 1);
        if (h % 17 === 0) {
          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.fillRect(x * t + (h % 20), y * t + ((h >> 3) % 20), 6, 3);
        }
      } else if (isFloor(x, y + 1) || isFloor(x, y - 1) || isFloor(x + 1, y) || isFloor(x - 1, y)) {
        // Muro visible (junto a suelo)
        ctx.fillStyle = "#1a1622";
        ctx.fillRect(x * t, y * t, t, t);
        if (isFloor(x, y + 1)) {
          ctx.fillStyle = "#2e2738";
          ctx.fillRect(x * t, y * t + t - 8, t, 8);
          ctx.fillStyle = "rgba(217,122,43,0.08)";
          ctx.fillRect(x * t, y * t + t - 2, t, 2);
        }
      } else {
        ctx.fillStyle = "#0a090e";
        ctx.fillRect(x * t, y * t, t, t);
      }
    }
  }
  return canvas;
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
