import { BALANCE } from "../balance";
import { applyStatus } from "../combat/status";
import { isWalkable } from "../dungeon/grid";
import { distance } from "../math/vec";
import { updateBoss } from "./boss-ai";
import { MAX_TICKS, type SimContext } from "./context";
import { applyProjectileStatus, updateEnemy } from "./enemy-ai";
import { damageBoss, damageEnemy, damagePlayer } from "./hits";
import { moveCircle } from "./navigation";
import { updatePlayer } from "./players";
import { IDLE_INPUT, type PlayerInput, type SimState } from "./types";

/**
 * Avanza la simulación un tick (1/20 s) y devuelve el estado nuevo, sin modificar el anterior.
 *
 * `inputs[i]` es la intención del jugador `state.players[i]`. El paso es fijo (no hay `dt`
 * variable) para que la misma secuencia de entradas produzca siempre el mismo resultado: así el
 * servidor puede volver a ejecutar la partida y validar lo que el cliente mostró.
 */
export function step(ctx: SimContext, state: SimState, inputs: readonly PlayerInput[]): SimState {
  const next = cloneState(state);
  stepInPlace(ctx, next, inputs);
  return next;
}

/** Igual que `step`, pero modifica el estado recibido (más rápido para repeticiones largas). */
export function stepInPlace(ctx: SimContext, state: SimState, inputs: readonly PlayerInput[]): void {
  if (state.status !== "RUNNING") {
    state.events = [];
    return;
  }
  state.tick++;
  state.events = [];

  for (let i = 0; i < state.players.length; i++) updatePlayer(ctx, state, state.players[i], inputs[i] ?? IDLE_INPUT);
  for (const enemy of state.enemies) updateEnemy(ctx, state, enemy);
  if (state.boss) updateBoss(ctx, state, state.boss);

  updateProjectiles(ctx, state);
  updateHazards(state);
  separate(ctx, state);
  removeDead(state);
  checkOutcome(ctx, state);
}

function updateProjectiles(ctx: SimContext, state: SimState) {
  const alive = [];
  for (const p of state.projectiles) {
    p.pos = { x: p.pos.x + p.vel.x, y: p.pos.y + p.vel.y };
    p.ticksLeft--;
    let consumed = !isWalkable(ctx.layout, p.pos.x, p.pos.y) || p.ticksLeft <= 0;
    if (!consumed && p.team === "PLAYER") {
      const owner = state.players.find((pl) => pl.id === p.ownerId);
      for (const enemy of state.enemies) {
        if (enemy.hp > 0 && distance(enemy.pos, p.pos) <= enemy.radius + p.radius) {
          if (owner) damageEnemy(state, owner, enemy, p.damage, p.crit, { x: p.pos.x - p.vel.x, y: p.pos.y - p.vel.y });
          if (p.applies && enemy.hp > 0) applyStatus(enemy.statuses, p.applies.status, p.applies.ticks);
          consumed = true;
          break;
        }
      }
      const boss = state.boss;
      if (!consumed && boss && boss.hp > 0 && distance(boss.pos, p.pos) <= boss.radius + p.radius) {
        if (owner) damageBoss(state, owner, boss, p.damage, p.crit);
        consumed = true;
      }
    } else if (!consumed) {
      for (const player of state.players) {
        if (player.life === "ALIVE" && distance(player.pos, p.pos) <= player.radius + p.radius) {
          // La saeta atraviesa a quien esquiva (invulnerable) y sigue su camino.
          if (damagePlayer(state, player, p.damage)) {
            applyProjectileStatus(player, p.applies);
            consumed = true;
            break;
          }
        }
      }
    }
    if (!consumed) alive.push(p);
  }
  state.projectiles = alive;
}

function updateHazards(state: SimState) {
  const alive = [];
  for (const h of state.hazards) {
    h.radius += h.growth;
    for (const p of state.players) {
      if (p.life !== "ALIVE" || h.hit.includes(p.id)) continue;
      const d = distance(h.center, p.pos);
      // Golpea a quien esté en el frente de la onda. Esquivar con invulnerabilidad la atraviesa.
      if (Math.abs(d - h.radius) <= h.thickness / 2 + p.radius) {
        if (p.invulnerable > 0) {
          state.events.push({ type: "DODGED", targetId: p.id, pos: { ...p.pos } });
          h.hit.push(p.id);
        } else if (damagePlayer(state, p, h.damage)) {
          h.hit.push(p.id);
        }
      }
    }
    if (h.radius < h.maxRadius) alive.push(h);
  }
  state.hazards = alive;
}

/** Evita que las entidades se superpongan (empuje simétrico, respetando muros). */
function separate(ctx: SimContext, state: SimState) {
  const bodies: Array<{ pos: { x: number; y: number }; radius: number; fixed: boolean; set: (x: number, y: number) => void }> = [];
  for (const p of state.players) if (p.life === "ALIVE") bodies.push({ pos: p.pos, radius: p.radius, fixed: false, set: (x, y) => (p.pos = { x, y }) });
  for (const e of state.enemies) if (e.hp > 0) bodies.push({ pos: e.pos, radius: e.radius, fixed: false, set: (x, y) => (e.pos = { x, y }) });
  const boss = state.boss;
  if (boss && boss.hp > 0) bodies.push({ pos: boss.pos, radius: boss.radius, fixed: true, set: () => undefined });

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const min = a.radius + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      const nx = d > 1e-6 ? dx / d : 1;
      const ny = d > 1e-6 ? dy / d : 0;
      const overlap = min - d;
      const share = a.fixed || b.fixed ? 1 : 0.5;
      if (!a.fixed) tryPush(ctx, a, -nx * overlap * share, -ny * overlap * share);
      if (!b.fixed) tryPush(ctx, b, nx * overlap * share, ny * overlap * share);
    }
  }
}

function tryPush(ctx: SimContext, body: { pos: { x: number; y: number }; radius: number; set: (x: number, y: number) => void }, dx: number, dy: number) {
  const moved = moveCircle(ctx.layout, body.pos, dx, dy, body.radius);
  body.set(moved.x, moved.y);
  body.pos = moved;
}

function removeDead(state: SimState) {
  const alive = [];
  for (const e of state.enemies) {
    if (e.hp > 0) {
      alive.push(e);
    } else {
      state.summary.kills[e.kind]++;
      state.events.push({ type: "ENEMY_DIED", enemyId: e.id, kind: e.kind, pos: { ...e.pos } });
    }
  }
  state.enemies = alive;
  if (state.boss && state.boss.hp <= 0 && !state.summary.bossDefeated) {
    state.summary.bossDefeated = true;
    state.boss.telegraph = null;
    state.hazards = [];
    state.events.push({ type: "BOSS_DIED", pos: { ...state.boss.pos } });
  }
}

function checkOutcome(ctx: SimContext, state: SimState) {
  if (state.players.every((p) => p.life !== "ALIVE")) {
    state.status = "DEFEAT";
    state.defeatReason = "DOWNED";
    return;
  }
  const bossAlive = state.boss !== null && state.boss.hp > 0;
  if (!state.portalOpen && state.enemies.length === 0 && !bossAlive) {
    state.portalOpen = true;
    state.projectiles = state.projectiles.filter((p) => p.team === "PLAYER");
    state.events.push({ type: "PORTAL_OPEN", pos: { ...ctx.layout.exit } });
  }
  if (state.portalOpen && state.players.some((p) => p.life === "ALIVE" && distance(p.pos, ctx.layout.exit) <= BALANCE.combat.portalRadius)) {
    state.status = "VICTORY";
    return;
  }
  if (state.tick >= MAX_TICKS) {
    state.status = "DEFEAT";
    state.defeatReason = "TIMEOUT";
  }
}

/** Copia profunda del estado (solo contiene datos planos). */
export function cloneState(state: SimState): SimState {
  return structuredClone(state);
}
