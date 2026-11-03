import { BOSS_DEFINITIONS, type BossAttack, type BossAttackId } from "../bosses/definitions";
import { circleFits } from "../dungeon/grid";
import type { EnemyKindId } from "../enemies/definitions";
import { DIRECTIONS_16, directionTo, distance, inCone } from "../math/vec";
import { DT, type SimContext, secondsToTicks } from "./context";
import { spawnEnemy } from "./create";
import { moveTowards, nearestPlayer } from "./enemy-ai";
import { damagePlayer } from "./hits";
import { flowDistance, flowFieldTo } from "./navigation";
import type { BossEntity, PlayerEntity, SimState } from "./types";

const AGGRO_RANGE = 12;

/**
 * IA del jefe: patrón cíclico por fase, telegráficos con tiempo de reacción, recuperación tras
 * cada ataque (ventana de castigo) y transición invulnerable entre fases con invocaciones.
 */
export function updateBoss(ctx: SimContext, state: SimState, boss: BossEntity): void {
  if (boss.hp <= 0) return;
  const def = BOSS_DEFINITIONS[boss.bossId];
  const target = nearestPlayer(state, boss.pos);
  if (!target) {
    boss.telegraph = null;
    return;
  }

  if (!boss.aggro) {
    const d = flowDistance(ctx.layout, flowFieldTo(ctx.layout, target.pos), boss.pos);
    if (d < 0 || d > AGGRO_RANGE) return;
    boss.aggro = true;
    boss.state = "MOVE";
    boss.ticks = secondsToTicks(1);
  }

  // Cambio de fase: solo entre ataques, para no cortar un telegráfico a medias.
  const nextPhase = def.phases[boss.phase + 1];
  if (nextPhase && boss.hp / boss.maxHp <= nextPhase.fromHealth && (boss.state === "MOVE" || boss.state === "RECOVERY")) {
    boss.phase++;
    boss.patternIndex = 0;
    boss.state = "TRANSITION";
    boss.ticks = secondsToTicks(nextPhase.transition);
    boss.telegraph = null;
    state.events.push({ type: "BOSS_PHASE", phase: boss.phase, name: nextPhase.name });
    summon(ctx, state, boss, nextPhase.summons);
    return;
  }

  const phase = def.phases[boss.phase];
  const aggression = ctx.difficulty.enemyAggression;
  const dist = distance(boss.pos, target.pos);

  switch (boss.state) {
    case "TRANSITION":
    case "IDLE":
      boss.ticks--;
      if (boss.ticks <= 0) {
        boss.state = "MOVE";
        boss.ticks = secondsToTicks(phase.attackDelay / aggression);
      }
      return;
    case "MOVE": {
      boss.facing = directionTo(boss.pos, target.pos, boss.facing);
      if (dist > 2.2) boss.pos = moveTowards(ctx, boss.pos, target.pos, phase.moveSpeed, boss.radius).pos;
      if (boss.ticks > 0) {
        boss.ticks--;
        return;
      }
      let attackId: BossAttackId = phase.pattern[boss.patternIndex % phase.pattern.length];
      const sweep = def.attacks.SWEEP;
      // Si el objetivo está fuera del alcance del barrido, el patrón usa el mazazo a distancia.
      if (attackId === "SWEEP" && sweep.id === "SWEEP" && dist > sweep.range + target.radius + 0.6) attackId = "SLAM";
      boss.patternIndex++;
      startAttack(ctx, boss, def.attacks[attackId], target, true);
      return;
    }
    case "WINDUP": {
      boss.ticks--;
      if (boss.telegraph) boss.telegraph.remaining = boss.ticks;
      if (boss.ticks > 0) return;
      const attack = def.attacks[boss.current ?? "SLAM"];
      resolveAttack(state, boss, attack);
      if ((attack.id === "SLAM" || attack.id === "TRIPLE_SLAM") && boss.repeatsLeft > 1) {
        boss.repeatsLeft--;
        startAttack(ctx, boss, attack, target, false);
        return;
      }
      boss.telegraph = null;
      boss.state = "RECOVERY";
      boss.ticks = secondsToTicks(attack.recovery);
      return;
    }
    case "RECOVERY":
      boss.ticks--;
      if (boss.ticks <= 0) {
        boss.state = "MOVE";
        boss.ticks = secondsToTicks(phase.attackDelay / aggression);
      }
      return;
  }
}

function startAttack(ctx: SimContext, boss: BossEntity, attack: BossAttack, target: PlayerEntity, first: boolean) {
  const telegraphTime = ctx.difficulty.telegraphTime;
  boss.state = "WINDUP";
  boss.current = attack.id;
  const dir = directionTo(boss.pos, target.pos, boss.facing);
  boss.facing = dir;
  boss.lockedDir = dir;
  switch (attack.id) {
    case "SWEEP": {
      const ticks = Math.max(1, secondsToTicks(attack.windup * telegraphTime));
      boss.ticks = ticks;
      boss.telegraph = { shape: "CONE", origin: { ...boss.pos }, dir, range: attack.range, cosHalfAngle: attack.cosHalfAngle, total: ticks, remaining: ticks };
      return;
    }
    case "SLAM":
    case "TRIPLE_SLAM": {
      if (first) boss.repeatsLeft = attack.repeats;
      const ticks = Math.max(1, secondsToTicks((first ? attack.windup : attack.chainWindup) * telegraphTime));
      boss.ticks = ticks;
      boss.telegraph = { shape: "CIRCLE", center: { ...target.pos }, radius: attack.radius, total: ticks, remaining: ticks };
      return;
    }
    case "EMBER_RING": {
      const ticks = Math.max(1, secondsToTicks(attack.windup * telegraphTime));
      boss.ticks = ticks;
      boss.telegraph = { shape: "RING", center: { ...boss.pos }, radius: attack.maxRadius, total: ticks, remaining: ticks };
      return;
    }
  }
}

function resolveAttack(state: SimState, boss: BossEntity, attack: BossAttack) {
  const mult = boss.damageMultiplier;
  const tg = boss.telegraph;
  switch (attack.id) {
    case "SWEEP":
      for (const p of state.players) {
        if (inCone(boss.pos, boss.lockedDir, p.pos, attack.range, attack.cosHalfAngle, p.radius)) damagePlayer(state, p, Math.round(attack.damage * mult));
      }
      return;
    case "SLAM":
    case "TRIPLE_SLAM": {
      const center = tg && tg.shape === "CIRCLE" ? tg.center : boss.pos;
      for (const p of state.players) {
        if (distance(center, p.pos) <= attack.radius + p.radius) damagePlayer(state, p, Math.round(attack.damage * mult), attack.stun);
      }
      return;
    }
    case "EMBER_RING":
      state.hazards.push({
        id: state.nextId++,
        center: { ...boss.pos },
        radius: boss.radius,
        growth: attack.speed * DT,
        maxRadius: attack.maxRadius,
        thickness: attack.thickness,
        damage: Math.round(attack.damage * mult),
        hit: [],
      });
      return;
  }
}

function summon(ctx: SimContext, state: SimState, boss: BossEntity, kinds: readonly EnemyKindId[]) {
  let dirIndex = 2;
  for (const kind of kinds) {
    // Busca una posición libre alrededor del jefe en direcciones fijas (determinista).
    for (let tries = 0; tries < 16; tries++) {
      const d = DIRECTIONS_16[dirIndex % 16];
      dirIndex += 5;
      const pos = { x: boss.pos.x + d.x * 3, y: boss.pos.y + d.y * 3 };
      if (circleFits(ctx.layout, pos.x, pos.y, 0.4)) {
        state.enemies.push(spawnEnemy(ctx, state.nextId++, kind, pos, true));
        break;
      }
    }
  }
}
