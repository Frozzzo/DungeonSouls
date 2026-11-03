import { BALANCE } from "../balance";
import { getCombatKit } from "../combat/kits";
import { applyStatus, isIncapacitated, moveMultiplier, tickStatuses } from "../combat/status";
import { inCone, length, normalize, type Vec } from "../math/vec";
import { DT, type SimContext, secondsToTicks } from "./context";
import { damageBoss, damageEnemy, rollPlayerDamage } from "./hits";
import { moveCircle } from "./navigation";
import { AXIS_MAX, BUTTON_ABILITY, BUTTON_ATTACK, BUTTON_DODGE, type PlayerEntity, type PlayerInput, type SimState } from "./types";

const DODGE = BALANCE.combat.dodge;

/** Convierte ejes enteros en un vector de longitud ≤ 1 (o null si es nulo). */
function axisVector(x: number, y: number): Vec | null {
  if (x === 0 && y === 0) return null;
  const len = length(x, y);
  const scale = Math.min(1, len / AXIS_MAX) / len;
  return { x: x * scale, y: y * scale };
}

/** Avanza un jugador un tick según su intención. Todas las reglas (enfriamientos, coste, estados) se validan aquí. */
export function updatePlayer(ctx: SimContext, state: SimState, player: PlayerEntity, input: PlayerInput): void {
  if (player.life !== "ALIVE") return;
  const kit = getCombatKit(player.classId);

  // Temporizadores y estados.
  player.statuses = tickStatuses(player.statuses);
  if (player.attackCooldown > 0) player.attackCooldown--;
  if (player.dodgeCooldown > 0) player.dodgeCooldown--;
  if (player.abilityCooldown > 0) player.abilityCooldown--;
  if (player.invulnerable > 0) player.invulnerable--;
  if (player.dodgeBuffer > 0) player.dodgeBuffer--;
  if (kit.resource.regenPerSecond > 0) {
    player.resource = Math.min(player.maxResource, player.resource + kit.resource.regenPerSecond * DT);
  }

  const move = axisVector(input.mx, input.my);
  const aimRaw = axisVector(input.ax, input.ay);
  const aim = aimRaw ? normalize(aimRaw.x, aimRaw.y) : null;
  if (input.buttons & BUTTON_DODGE) player.dodgeBuffer = secondsToTicks(DODGE.inputBuffer);

  if (isIncapacitated(player.statuses)) return;

  const action = player.action;

  // Esquiva en curso: desplazamiento fijo, sin control.
  if (action.kind === "DODGE") {
    const step = DODGE.speed * DT;
    player.pos = moveCircle(ctx.layout, player.pos, action.dir.x * step, action.dir.y * step, player.radius);
    action.ticks--;
    if (action.ticks <= 0) player.action = { kind: "NONE" };
    return;
  }

  // Ataque en curso: preparación → impacto → recuperación (compromiso: no se puede esquivar durante la preparación).
  if (action.kind === "ATTACK") {
    action.ticks--;
    if (action.phase === "WINDUP" && action.ticks <= 0) {
      resolveBasicAttack(state, player, action.dir);
      player.action = { kind: "ATTACK", phase: "RECOVERY", ticks: secondsToTicks(kit.basic.recovery), dir: action.dir };
    } else if (action.phase === "RECOVERY" && action.ticks <= 0) {
      player.action = { kind: "NONE" };
      player.attackCooldown = secondsToTicks(kit.basic.cooldown);
    }
  }

  const attacking = player.action.kind === "ATTACK";
  const inWindup = player.action.kind === "ATTACK" && player.action.phase === "WINDUP";

  // Esquiva: desde reposo o durante la recuperación de un ataque (cancela la recuperación).
  if (player.dodgeBuffer > 0 && player.dodgeCooldown === 0 && !inWindup) {
    const dir = move ? normalize(move.x, move.y) : aim ?? player.facing;
    player.action = { kind: "DODGE", ticks: secondsToTicks(DODGE.duration), dir };
    if (attacking) player.attackCooldown = secondsToTicks(kit.basic.cooldown);
    player.dodgeCooldown = secondsToTicks(DODGE.cooldown);
    player.invulnerable = secondsToTicks(DODGE.invulnerability);
    player.dodgeBuffer = 0;
    player.facing = dir;
    state.summary.dodges++;
    return;
  }

  // Movimiento.
  if (move) {
    const speed = player.stats.moveSpeed * moveMultiplier(player.statuses) * (attacking ? BALANCE.combat.moveWhileAttacking : 1);
    player.pos = moveCircle(ctx.layout, player.pos, move.x * speed * DT, move.y * speed * DT, player.radius);
    if (!attacking) player.facing = normalize(move.x, move.y, player.facing);
  }
  if (aim && !attacking) player.facing = aim;

  if (player.action.kind !== "NONE") return;

  // Habilidad característica: comprueba enfriamiento y recurso.
  if (input.buttons & BUTTON_ABILITY && player.abilityCooldown === 0 && player.resource >= kit.ability.cost) {
    castAbility(state, player);
    return;
  }

  // Ataque básico (se mantiene pulsado para encadenar).
  if (input.buttons & BUTTON_ATTACK && player.attackCooldown === 0) {
    const dir = aim ?? player.facing;
    player.facing = dir;
    player.action = { kind: "ATTACK", phase: "WINDUP", ticks: Math.max(1, secondsToTicks(kit.basic.windup)), dir };
    state.events.push({ type: "ATTACK", actorId: player.id, pos: { ...player.pos }, dir: { ...dir } });
  }
}

function resolveBasicAttack(state: SimState, player: PlayerEntity, dir: Vec) {
  const basic = getCombatKit(player.classId).basic;
  if (basic.kind === "PROJECTILE") {
    const roll = rollPlayerDamage(state, player, basic.multiplier, basic.damageType);
    state.projectiles.push({
      id: state.nextId++,
      team: "PLAYER",
      ownerId: player.id,
      pos: { x: player.pos.x + dir.x * 0.5, y: player.pos.y + dir.y * 0.5 },
      vel: { x: dir.x * basic.speed * DT, y: dir.y * basic.speed * DT },
      radius: basic.radius,
      damage: roll.amount,
      crit: roll.crit,
      ticksLeft: Math.ceil(basic.range / (basic.speed * DT)),
      applies: null,
    });
    return;
  }
  for (const enemy of state.enemies) {
    if (enemy.hp > 0 && inCone(player.pos, dir, enemy.pos, basic.range, basic.cosHalfAngle, enemy.radius)) {
      const roll = rollPlayerDamage(state, player, basic.multiplier, basic.damageType);
      damageEnemy(state, player, enemy, roll.amount, roll.crit, player.pos);
    }
  }
  const boss = state.boss;
  if (boss && boss.hp > 0 && inCone(player.pos, dir, boss.pos, basic.range, basic.cosHalfAngle, boss.radius)) {
    const roll = rollPlayerDamage(state, player, basic.multiplier, basic.damageType);
    damageBoss(state, player, boss, roll.amount, roll.crit);
  }
}

function castAbility(state: SimState, player: PlayerEntity) {
  const { ability } = getCombatKit(player.classId);
  player.resource -= ability.cost;
  player.abilityCooldown = secondsToTicks(ability.cooldown);
  state.events.push({ type: "ABILITY", actorId: player.id, abilityId: ability.id, pos: { ...player.pos } });
  const effect = ability.effect;
  switch (effect.kind) {
    case "FORTIFY":
      applyStatus(player.statuses, "FORTIFIED", secondsToTicks(effect.duration), effect.reduction);
      break;
    case "HEAL": {
      const amount = Math.round((effect.base + player.stats.magicDamage * effect.magicScaling) * player.stats.healingPower);
      const healed = Math.min(player.maxHp - player.hp, amount);
      player.hp += healed;
      state.events.push({ type: "HEAL", targetId: player.id, amount: healed, pos: { ...player.pos } });
      break;
    }
    case "WHIRLWIND": {
      for (const enemy of state.enemies) {
        if (enemy.hp > 0 && inCone(player.pos, player.facing, enemy.pos, effect.radius, -1, enemy.radius)) {
          const roll = rollPlayerDamage(state, player, effect.multiplier, effect.damageType);
          damageEnemy(state, player, enemy, roll.amount, roll.crit, player.pos);
        }
      }
      const boss = state.boss;
      if (boss && boss.hp > 0 && inCone(player.pos, player.facing, boss.pos, effect.radius, -1, boss.radius)) {
        const roll = rollPlayerDamage(state, player, effect.multiplier, effect.damageType);
        damageBoss(state, player, boss, roll.amount, roll.crit);
      }
      break;
    }
  }
}
