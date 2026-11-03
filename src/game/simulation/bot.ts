import { BALANCE } from "../balance";
import { getCombatKit } from "../combat/kits";
import { circleFits, hasLineOfSight } from "../dungeon/grid";
import { ENEMY_DEFINITIONS } from "../enemies/definitions";
import { DIRECTIONS_16, distance, dot, inCone, normalize, type Vec } from "../math/vec";
import { DT, type SimContext } from "./context";
import { quantizeDirection } from "./input";
import { flowDirection, flowDistance, flowFieldTo } from "./navigation";
import { BUTTON_ABILITY, BUTTON_ATTACK, BUTTON_DODGE, IDLE_INPUT, type PlayerEntity, type PlayerInput, type SimState, type Telegraph } from "./types";

/**
 * Piloto automático: una política sencilla que juega usando solo la información que vería
 * un jugador (telegráficos, posiciones). Produce intenciones normales, igual que el teclado.
 *
 * Se usa en las pruebas (derrotar al jefe con una secuencia de entradas reproducible) y en la
 * prueba E2E que completa un piso en el navegador. No forma parte del juego normal.
 */
export function botInput(ctx: SimContext, state: SimState, playerIndex = 0): PlayerInput {
  const p = state.players[playerIndex];
  if (!p || p.life !== "ALIVE" || state.status !== "RUNNING") return IDLE_INPUT;
  const kit = getCombatKit(p.classId);

  // 1) Evitar el peligro.
  const threat = worstThreat(ctx, state, p);
  if (threat) {
    const dodgeReady = p.dodgeCooldown === 0 && !(p.action.kind === "ATTACK" && p.action.phase === "WINDUP");
    if (threat.kind === "RING") {
      if (threat.ticks <= 1 && dodgeReady) return input(threat.away, null, BUTTON_DODGE);
      return input(null, null, 0);
    }
    const walk = p.stats.moveSpeed * DT * Math.max(0, threat.ticks - 1);
    const escape = bestEscape(ctx, state, p, walk);
    if (escape) return input(escape, null, 0);
    if (dodgeReady && threat.ticks <= 4) {
      const dodgeEscape = bestEscape(ctx, state, p, BALANCE.combat.dodge.speed * BALANCE.combat.dodge.duration) ?? threat.away;
      return input(dodgeEscape, null, BUTTON_DODGE);
    }
    return input(threat.away, null, 0);
  }

  // 2) Habilidad.
  let buttons = 0;
  if (p.abilityCooldown === 0 && p.resource >= kit.ability.cost) {
    const effect = kit.ability.effect;
    if (effect.kind === "HEAL" && p.hp < p.maxHp * 0.55) buttons |= BUTTON_ABILITY;
    if (effect.kind === "FORTIFY" && (p.hp < p.maxHp * 0.7 || (state.boss && state.boss.hp > 0 && distance(p.pos, state.boss.pos) < 4))) buttons |= BUTTON_ABILITY;
    if (effect.kind === "WHIRLWIND") {
      const near = state.enemies.filter((e) => distance(e.pos, p.pos) <= effect.radius + e.radius).length;
      const bossNear = state.boss && state.boss.hp > 0 && distance(state.boss.pos, p.pos) <= effect.radius + state.boss.radius;
      if (near >= 2 || bossNear || (near === 1 && p.resource >= p.maxResource * 0.9)) buttons |= BUTTON_ABILITY;
    }
  }

  // 3) Elegir objetivo.
  const target = pickTarget(ctx, state, p);
  if (!target) {
    if (state.portalOpen) return input(navigate(ctx, p.pos, ctx.layout.exit), null, buttons);
    return input(null, null, buttons);
  }

  const dist = distance(p.pos, target.pos);
  const basic = kit.basic;
  const aim = normalize(target.pos.x - p.pos.x, target.pos.y - p.pos.y);

  if (basic.kind === "PROJECTILE") {
    const sees = hasLineOfSight(ctx.layout, p.pos.x, p.pos.y, target.pos.x, target.pos.y);
    const ideal = target.isBoss ? 5 : 4.5;
    if (!sees || dist > basic.range - 1) return input(navigate(ctx, p.pos, target.pos), aim, buttons);
    let move: Vec | null = null;
    if (dist < ideal - 1.5) move = freeDirection(ctx, p, normalize(p.pos.x - target.pos.x, p.pos.y - target.pos.y));
    return input(move, aim, buttons | BUTTON_ATTACK);
  }

  // Cuerpo a cuerpo: colocarse a la espalda de los enemigos con escudo salvo en su recuperación.
  let goal = target.pos;
  if (target.shielded && target.state !== "RECOVERY") {
    goal = { x: target.pos.x - target.facing.x * (target.radius + 0.8), y: target.pos.y - target.facing.y * (target.radius + 0.8) };
  }
  const reach = basic.range + target.radius - 0.15;
  const canHit = dist <= reach && (!target.shielded || target.state === "RECOVERY" || dot(target.facing, normalize(p.pos.x - target.pos.x, p.pos.y - target.pos.y)) < 0.3);
  const bossSafe = !target.isBoss || target.state !== "WINDUP";
  if (canHit && bossSafe) return input(null, aim, buttons | BUTTON_ATTACK);
  if (target.isBoss && !bossSafe) return input(null, aim, buttons);
  return input(navigate(ctx, p.pos, goal), aim, buttons);
}

interface Target {
  pos: Vec;
  facing: Vec;
  radius: number;
  state: string;
  shielded: boolean;
  isBoss: boolean;
}

function pickTarget(ctx: SimContext, state: SimState, p: PlayerEntity): Target | null {
  const field = flowFieldTo(ctx.layout, p.pos);
  let best: Target | null = null;
  let bestScore = Infinity;
  for (const e of state.enemies) {
    const d = flowDistance(ctx.layout, field, e.pos);
    if (d < 0) continue;
    // Prioriza a los arqueros (obligan a moverse) y a los enemigos en ventana de castigo.
    const score = d - (e.kind === "ARCHER" ? 3 : 0) - (e.state === "RECOVERY" ? 2 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = { pos: e.pos, facing: e.facing, radius: e.radius, state: e.state, shielded: ENEMY_DEFINITIONS[e.kind].frontalBlock !== null, isBoss: false };
    }
  }
  const boss = state.boss;
  if (boss && boss.hp > 0 && (best === null || bestScore > 6)) {
    return { pos: boss.pos, facing: boss.facing, radius: boss.radius, state: boss.state, shielded: false, isBoss: true };
  }
  return best;
}

/** ~300 ms de tiempo de reacción. */
const REACTION_TICKS = 6;

interface Threat {
  kind: "AREA" | "RING";
  ticks: number;
  away: Vec;
}

function inTelegraph(t: Telegraph, pos: Vec, margin: number): boolean {
  switch (t.shape) {
    case "CIRCLE":
      return distance(t.center, pos) <= t.radius + margin;
    case "CONE":
      return inCone(t.origin, t.dir, pos, t.range + margin, t.cosHalfAngle - 0.08, margin);
    case "LINE": {
      const rx = pos.x - t.origin.x;
      const ry = pos.y - t.origin.y;
      const along = rx * t.dir.x + ry * t.dir.y;
      if (along < -margin || along > t.length + margin) return false;
      const perp = Math.abs(rx * t.dir.y - ry * t.dir.x);
      return perp <= t.width / 2 + margin;
    }
    case "RING":
      return false;
  }
}

function telegraphCenter(t: Telegraph): Vec {
  return t.shape === "CIRCLE" || t.shape === "RING" ? t.center : t.origin;
}

function threatsAt(ctx: SimContext, state: SimState, pos: Vec, margin: number): number {
  let n = 0;
  for (const e of state.enemies) if (e.telegraph && inTelegraph(e.telegraph, pos, margin)) n++;
  if (state.boss?.telegraph && inTelegraph(state.boss.telegraph, pos, margin)) n++;
  return n;
}

function worstThreat(ctx: SimContext, state: SimState, p: PlayerEntity): Threat | null {
  const margin = p.radius + 0.25;
  let worst: Threat | null = null;
  const consider = (t: Threat) => {
    if (!worst || t.ticks < worst.ticks) worst = t;
  };
  const telegraphs: Telegraph[] = [];
  for (const e of state.enemies) if (e.telegraph) telegraphs.push(e.telegraph);
  if (state.boss?.telegraph) telegraphs.push(state.boss.telegraph);
  for (const t of telegraphs) {
    // Tiempo de reacción humano: el piloto no "ve" un telegráfico hasta que lleva unos ticks activo.
    if (t.total - t.remaining < REACTION_TICKS) continue;
    if (inTelegraph(t, p.pos, margin)) {
      const c = telegraphCenter(t);
      let away = normalize(p.pos.x - c.x, p.pos.y - c.y, { x: 1, y: 0 });
      if (t.shape === "LINE") away = { x: -t.dir.y, y: t.dir.x };
      consider({ kind: "AREA", ticks: t.remaining, away });
    }
  }
  for (const h of state.hazards) {
    const d = distance(h.center, p.pos);
    if (h.hit.includes(p.id) || d < h.radius) continue;
    const gap = d - h.radius - h.thickness / 2 - p.radius;
    const ticks = Math.floor(gap / h.growth);
    if (ticks <= 6) consider({ kind: "RING", ticks, away: normalize(h.center.x - p.pos.x, h.center.y - p.pos.y) });
  }
  for (const pr of state.projectiles) {
    if (pr.team !== "ENEMY") continue;
    for (let k = 1; k <= 5; k++) {
      const fx = pr.pos.x + pr.vel.x * k;
      const fy = pr.pos.y + pr.vel.y * k;
      if (distance({ x: fx, y: fy }, p.pos) <= pr.radius + p.radius + 0.15) {
        const len = Math.sqrt(pr.vel.x * pr.vel.x + pr.vel.y * pr.vel.y);
        consider({ kind: "AREA", ticks: k, away: { x: -pr.vel.y / len, y: pr.vel.x / len } });
        break;
      }
    }
  }
  return worst;
}

/** Busca una dirección que saque al jugador de todas las zonas de peligro en `reach` casillas. */
function bestEscape(ctx: SimContext, state: SimState, p: PlayerEntity, reach: number): Vec | null {
  if (reach <= 0.05) return null;
  let best: Vec | null = null;
  let bestScore = -Infinity;
  for (const d of DIRECTIONS_16) {
    const end = { x: p.pos.x + d.x * reach, y: p.pos.y + d.y * reach };
    const mid = { x: p.pos.x + d.x * reach * 0.5, y: p.pos.y + d.y * reach * 0.5 };
    if (!circleFits(ctx.layout, end.x, end.y, p.radius) || !circleFits(ctx.layout, mid.x, mid.y, p.radius)) continue;
    if (threatsAt(ctx, state, end, p.radius + 0.2) > 0) continue;
    // Preferir quedarse cerca de los enemigos (para contraatacar) y lejos de los muros.
    let score = 0;
    const boss = state.boss;
    if (boss && boss.hp > 0) score -= Math.abs(distance(end, boss.pos) - 2.4);
    if (best === null || score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function freeDirection(ctx: SimContext, p: PlayerEntity, preferred: Vec): Vec | null {
  let best: Vec | null = null;
  let bestDot = -Infinity;
  for (const d of DIRECTIONS_16) {
    if (!circleFits(ctx.layout, p.pos.x + d.x * 0.6, p.pos.y + d.y * 0.6, p.radius)) continue;
    const s = dot(d, preferred);
    if (s > bestDot) {
      bestDot = s;
      best = d;
    }
  }
  return bestDot > -0.2 ? best : null;
}

function navigate(ctx: SimContext, from: Vec, to: Vec): Vec | null {
  if (distance(from, to) < 2.5 && hasLineOfSight(ctx.layout, from.x, from.y, to.x, to.y)) return normalize(to.x - from.x, to.y - from.y);
  return flowDirection(ctx.layout, flowFieldTo(ctx.layout, to), from, to);
}

function input(move: Vec | null, aim: Vec | null, buttons: number): PlayerInput {
  const m = move ? quantizeDirection(move.x, move.y) : { x: 0, y: 0 };
  const a = aim ? quantizeDirection(aim.x, aim.y) : { x: 0, y: 0 };
  return { mx: m.x, my: m.y, ax: a.x, ay: a.y, buttons };
}

