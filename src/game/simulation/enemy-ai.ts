import { applyStatus, isIncapacitated, moveMultiplier, tickStatuses } from "../combat/status";
import { hasLineOfSight } from "../dungeon/grid";
import { ENEMY_DEFINITIONS } from "../enemies/definitions";
import { directionTo, distance, inCone, normalize, rotateTowards, type Vec } from "../math/vec";
import { DT, type SimContext, secondsToTicks } from "./context";
import { damagePlayer } from "./hits";
import { flowDirection, flowDistance, flowFieldTo, moveCircle } from "./navigation";
import type { EnemyEntity, PlayerEntity, SimState } from "./types";

/** Jugador vivo más cercano (en línea recta). Desempate estable por orden de la lista. */
export function nearestPlayer(state: SimState, pos: Vec): PlayerEntity | null {
  let best: PlayerEntity | null = null;
  let bestDist = Infinity;
  for (const p of state.players) {
    if (p.life !== "ALIVE") continue;
    const d = distance(pos, p.pos);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/** Desplaza una entidad hacia un objetivo: en línea recta si lo ve y está cerca, si no por el campo de flujo. */
export function moveTowards(ctx: SimContext, pos: Vec, target: Vec, speed: number, radius: number): { pos: Vec; dir: Vec | null } {
  let dir: Vec | null;
  if (distance(pos, target) < 3 && hasLineOfSight(ctx.layout, pos.x, pos.y, target.x, target.y)) {
    dir = directionTo(pos, target, { x: 0, y: 0 });
  } else {
    dir = flowDirection(ctx.layout, flowFieldTo(ctx.layout, target), pos, target);
  }
  if (!dir) return { pos, dir: null };
  const step = speed * DT;
  return { pos: moveCircle(ctx.layout, pos, dir.x * step, dir.y * step, radius), dir };
}

export function updateEnemy(ctx: SimContext, state: SimState, enemy: EnemyEntity): void {
  if (enemy.hp <= 0) return;
  const def = ENEMY_DEFINITIONS[enemy.kind];
  const diff = ctx.difficulty;
  enemy.statuses = tickStatuses(enemy.statuses);
  if (enemy.attackCooldown > 0) enemy.attackCooldown--;

  const target = nearestPlayer(state, enemy.pos);
  if (!target) {
    enemy.telegraph = null;
    enemy.state = "IDLE";
    return;
  }

  // Detección: distancia por caminos transitables (los muros bloquean).
  if (!enemy.aggro) {
    const d = flowDistance(ctx.layout, flowFieldTo(ctx.layout, target.pos), enemy.pos);
    if (d >= 0 && d <= def.aggroRange) enemy.aggro = true;
    else return;
  }
  if (enemy.state === "IDLE") enemy.state = "CHASE";
  if (isIncapacitated(enemy.statuses)) return;

  const attack = def.attack;
  const dist = distance(enemy.pos, target.pos);
  const toTarget = directionTo(enemy.pos, target.pos, enemy.facing);

  switch (enemy.state) {
    case "CHASE": {
      // Orientación: algunos enemigos giran despacio (se les puede rodear).
      enemy.facing = def.turnStep ? rotateTowards(enemy.facing, toTarget, def.turnStep.cos, def.turnStep.sin) : toTarget;

      if (enemy.attackCooldown === 0 && canStartAttack(ctx, enemy, target, dist)) {
        startWindup(ctx, enemy, target);
        return;
      }

      const speed = def.moveSpeed * moveMultiplier(enemy.statuses);
      if (attack.kind === "PROJECTILE") {
        const sees = hasLineOfSight(ctx.layout, enemy.pos.x, enemy.pos.y, target.pos.x, target.pos.y);
        if (sees && dist < def.preferredRange - 1.5) {
          // Retrocede para mantener la distancia.
          const away = normalize(enemy.pos.x - target.pos.x, enemy.pos.y - target.pos.y);
          enemy.pos = moveCircle(ctx.layout, enemy.pos, away.x * speed * DT, away.y * speed * DT, enemy.radius);
        } else if (!sees || dist > def.preferredRange) {
          enemy.pos = moveTowards(ctx, enemy.pos, target.pos, speed, enemy.radius).pos;
        }
      } else {
        const reach = attack.kind === "SLAM" ? attack.triggerRange : attack.range;
        if (dist > reach * 0.8 + target.radius) {
          enemy.pos = moveTowards(ctx, enemy.pos, target.pos, speed, enemy.radius).pos;
        }
      }
      return;
    }
    case "WINDUP": {
      enemy.ticks--;
      if (enemy.telegraph) enemy.telegraph.remaining = enemy.ticks;
      if (def.turnStep && attack.kind === "SLAM") {
        enemy.facing = rotateTowards(enemy.facing, toTarget, def.turnStep.cos, def.turnStep.sin);
      }
      if (enemy.ticks > 0) return;
      resolveAttack(state, enemy);
      enemy.telegraph = null;
      enemy.state = "RECOVERY";
      enemy.ticks = secondsToTicks(attack.recovery);
      return;
    }
    case "RECOVERY": {
      // Ventana de castigo: ni se mueve ni gira.
      enemy.ticks--;
      if (enemy.ticks > 0) return;
      enemy.state = "CHASE";
      enemy.attackCooldown = secondsToTicks(attack.cooldown / diff.enemyAggression);
      return;
    }
    default:
      return;
  }
}

function canStartAttack(ctx: SimContext, enemy: EnemyEntity, target: PlayerEntity, dist: number): boolean {
  const attack = ENEMY_DEFINITIONS[enemy.kind].attack;
  switch (attack.kind) {
    case "MELEE_ARC":
      return dist <= attack.range + target.radius - 0.1;
    case "SLAM":
      return dist <= attack.triggerRange + target.radius;
    case "PROJECTILE":
      return dist <= attack.range && hasLineOfSight(ctx.layout, enemy.pos.x, enemy.pos.y, target.pos.x, target.pos.y);
  }
}

function startWindup(ctx: SimContext, enemy: EnemyEntity, target: PlayerEntity) {
  const attack = ENEMY_DEFINITIONS[enemy.kind].attack;
  const ticks = Math.max(1, secondsToTicks(attack.windup * ctx.difficulty.telegraphTime));
  const dir = directionTo(enemy.pos, target.pos, enemy.facing);
  enemy.state = "WINDUP";
  enemy.ticks = ticks;
  enemy.lockedDir = dir;
  if (attack.kind !== "SLAM") enemy.facing = dir;
  switch (attack.kind) {
    case "MELEE_ARC":
      enemy.telegraph = { shape: "CONE", origin: { ...enemy.pos }, dir, range: attack.range, cosHalfAngle: attack.cosHalfAngle, total: ticks, remaining: ticks };
      break;
    case "SLAM":
      enemy.telegraph = { shape: "CIRCLE", center: { ...enemy.pos }, radius: attack.radius, total: ticks, remaining: ticks };
      break;
    case "PROJECTILE":
      enemy.telegraph = { shape: "LINE", origin: { ...enemy.pos }, dir, length: attack.range, width: attack.projectileRadius * 2, total: ticks, remaining: ticks };
      break;
  }
}

function resolveAttack(state: SimState, enemy: EnemyEntity) {
  const attack = ENEMY_DEFINITIONS[enemy.kind].attack;
  switch (attack.kind) {
    case "MELEE_ARC":
      for (const p of state.players) {
        if (inCone(enemy.pos, enemy.lockedDir, p.pos, attack.range, attack.cosHalfAngle, p.radius)) damagePlayer(state, p, enemy.damage);
      }
      return;
    case "SLAM":
      for (const p of state.players) {
        if (distance(enemy.pos, p.pos) <= attack.radius + p.radius) damagePlayer(state, p, enemy.damage);
      }
      return;
    case "PROJECTILE": {
      const speed = attack.projectileSpeed * DT;
      state.projectiles.push({
        id: state.nextId++,
        team: "ENEMY",
        ownerId: enemy.id,
        pos: { x: enemy.pos.x + enemy.lockedDir.x * 0.45, y: enemy.pos.y + enemy.lockedDir.y * 0.45 },
        vel: { x: enemy.lockedDir.x * speed, y: enemy.lockedDir.y * speed },
        radius: attack.projectileRadius,
        damage: enemy.damage,
        crit: false,
        ticksLeft: Math.ceil(attack.range / speed),
        applies: attack.applies ? { status: attack.applies.status, ticks: secondsToTicks(attack.applies.duration) } : null,
      });
      return;
    }
  }
}

/** Aplica el estado de un proyectil enemigo a un jugador alcanzado. */
export function applyProjectileStatus(player: PlayerEntity, applies: { status: "SLOW"; ticks: number } | null) {
  if (applies && player.life === "ALIVE") applyStatus(player.statuses, applies.status, applies.ticks);
}
