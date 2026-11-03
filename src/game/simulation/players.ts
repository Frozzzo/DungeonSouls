import { BALANCE } from "../balance";
import { getCombatKit } from "../combat/kits";
import { applyStatus, isIncapacitated, moveMultiplier, tickStatuses } from "../combat/status";
import { DODGE_EMPOWER_BONUS } from "../items/bases";
import { CONSUMABLES } from "../items/consumables";
import { distance, inCone, length, normalize, type Vec } from "../math/vec";
import type { SkillEffect } from "../skills/definitions";
import { DT, type SimContext, secondsToTicks } from "./context";
import { damageBoss, damageEnemy, healPlayer, rollPlayerDamage } from "./hits";
import { moveCircle } from "./navigation";
import { AXIS_MAX, BUTTON_ATTACK, BUTTON_DODGE, BUTTON_POTION, type EnemyEntity, type PlayerEntity, type PlayerInput, SKILL_BUTTONS, type SimState } from "./types";

/** La curación periódica (REGEN) se aplica cada medio segundo. */
export const REGEN_PULSE_TICKS = 10;

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
  for (const status of player.statuses) {
    if (status.id === "REGEN" && status.ticks % REGEN_PULSE_TICKS === 0) healPlayer(state, player, status.value);
  }
  if (player.attackCooldown > 0) player.attackCooldown--;
  if (player.dodgeCooldown > 0) player.dodgeCooldown--;
  for (let i = 0; i < player.skillCooldowns.length; i++) if (player.skillCooldowns[i] > 0) player.skillCooldowns[i]--;
  if (player.potionCooldown > 0) player.potionCooldown--;
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

  // Poción: se bebe al instante (también en mitad de un ataque); limitada y con enfriamiento.
  if (input.buttons & BUTTON_POTION && player.potions > 0 && player.potionCooldown === 0 && player.hp < player.maxHp) {
    const potion = CONSUMABLES.HEALTH_POTION;
    player.potions--;
    player.potionCooldown = secondsToTicks(potion.cooldown);
    state.summary.potionsUsed++;
    const healed = healPlayer(state, player, Math.round(player.maxHp * potion.healRatio), false);
    state.events.push({ type: "POTION", actorId: player.id, amount: healed, pos: { ...player.pos } });
  }

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
    if (player.uniqueEffects.includes("DODGE_EMPOWER")) player.nextHitBonus = DODGE_EMPOWER_BONUS;
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

  // Habilidades equipadas: comprueba hueco, enfriamiento y recurso (el primer botón válido gana).
  for (let slot = 0; slot < SKILL_BUTTONS.length; slot++) {
    if (!(input.buttons & SKILL_BUTTONS[slot])) continue;
    const skill = player.skills[slot];
    if (!skill || player.skillCooldowns[slot] > 0 || player.resource < skill.resourceCost) continue;
    if (aim) player.facing = aim;
    castSkill(ctx, state, player, slot);
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
    player.nextHitBonus = 0;
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
  player.nextHitBonus = 0;
}

/** Lanza la habilidad del hueco `slot`. La validación (enfriamiento, recurso) ya está hecha. */
function castSkill(ctx: SimContext, state: SimState, player: PlayerEntity, slot: number) {
  const skill = player.skills[slot]!;
  player.resource -= skill.resourceCost;
  player.skillCooldowns[slot] = Math.max(1, secondsToTicks(skill.cooldown));
  state.summary.skillsUsed++;
  const dir = { ...player.facing };
  state.events.push({ type: "ABILITY", actorId: player.id, abilityId: skill.id, slot, pos: { ...player.pos }, dir });
  for (const effect of skill.effects) applySkillEffect(ctx, state, player, effect, dir);
  player.nextHitBonus = 0;
}

/** Cantidad de las curaciones y escudos: (base + daño mágico × escala + vida máx. × proporción) × curación realizada. */
function supportAmount(player: PlayerEntity, e: { base: number; magicScaling: number; maxHpRatio: number }): number {
  return Math.max(0, Math.round((e.base + player.stats.magicDamage * e.magicScaling + player.maxHp * e.maxHpRatio) * player.stats.healingPower));
}

function applyToEnemy(enemy: EnemyEntity, applies: { status: "SLOW" | "STUN"; duration: number } | undefined) {
  if (applies && enemy.hp > 0) applyStatus(enemy.statuses, applies.status, secondsToTicks(applies.duration));
}

function applySkillEffect(ctx: SimContext, state: SimState, player: PlayerEntity, effect: SkillEffect, dir: Vec) {
  switch (effect.kind) {
    case "FORTIFY":
      applyStatus(player.statuses, "FORTIFIED", secondsToTicks(effect.duration), effect.reduction);
      break;
    case "EMPOWER":
      applyStatus(player.statuses, "EMPOWERED", secondsToTicks(effect.duration), effect.bonus);
      break;
    case "HEAL":
      healPlayer(state, player, supportAmount(player, effect));
      break;
    case "BARRIER": {
      const amount = supportAmount(player, effect);
      // La barrera nueva sustituye a la anterior si es mayor (no se acumulan).
      applyStatus(player.statuses, "BARRIER", secondsToTicks(effect.duration), amount);
      break;
    }
    case "REGEN": {
      const ticks = secondsToTicks(effect.duration);
      const pulses = Math.max(1, Math.floor((ticks - 1) / REGEN_PULSE_TICKS));
      applyStatus(player.statuses, "REGEN", ticks, Math.max(1, Math.round(supportAmount(player, effect) / pulses)));
      break;
    }
    case "NOVA":
    case "CONE": {
      const range = effect.kind === "NOVA" ? effect.radius : effect.range;
      const cos = effect.kind === "NOVA" ? -1 : effect.cosHalfAngle;
      for (const enemy of state.enemies) {
        if (enemy.hp > 0 && inCone(player.pos, dir, enemy.pos, range, cos, enemy.radius)) {
          const roll = rollPlayerDamage(state, player, effect.multiplier, effect.damageType);
          damageEnemy(state, player, enemy, roll.amount, roll.crit, player.pos);
          applyToEnemy(enemy, effect.applies);
        }
      }
      const boss = state.boss;
      if (boss && boss.hp > 0 && inCone(player.pos, dir, boss.pos, range, cos, boss.radius)) {
        const roll = rollPlayerDamage(state, player, effect.multiplier, effect.damageType);
        damageBoss(state, player, boss, roll.amount, roll.crit);
      }
      break;
    }
    case "PROJECTILE": {
      const roll = rollPlayerDamage(state, player, effect.multiplier, effect.damageType);
      state.projectiles.push({
        id: state.nextId++,
        team: "PLAYER",
        ownerId: player.id,
        pos: { x: player.pos.x + dir.x * 0.5, y: player.pos.y + dir.y * 0.5 },
        vel: { x: dir.x * effect.speed * DT, y: dir.y * effect.speed * DT },
        radius: effect.radius,
        damage: roll.amount,
        crit: roll.crit,
        ticksLeft: Math.ceil(effect.range / (effect.speed * DT)),
        applies: effect.applies ? { status: effect.applies.status, ticks: secondsToTicks(effect.applies.duration) } : null,
      });
      break;
    }
    case "DASH": {
      // Avanza a pasos cortos (respetando muros) y golpea una vez a cada enemigo que atraviesa.
      player.invulnerable = Math.max(player.invulnerable, secondsToTicks(effect.invulnerability));
      const hitEnemies = new Set<number>();
      let hitBoss = false;
      const stepLen = 0.25;
      const steps = Math.ceil(effect.distance / stepLen);
      for (let i = 0; i < steps; i++) {
        player.pos = moveCircle(ctx.layout, player.pos, dir.x * stepLen, dir.y * stepLen, player.radius);
        for (const enemy of state.enemies) {
          if (enemy.hp > 0 && !hitEnemies.has(enemy.id) && distance(enemy.pos, player.pos) <= enemy.radius + effect.width) {
            hitEnemies.add(enemy.id);
            const roll = rollPlayerDamage(state, player, effect.multiplier, effect.damageType);
            damageEnemy(state, player, enemy, roll.amount, roll.crit, player.pos);
          }
        }
        const boss = state.boss;
        if (!hitBoss && boss && boss.hp > 0 && distance(boss.pos, player.pos) <= boss.radius + effect.width) {
          hitBoss = true;
          const roll = rollPlayerDamage(state, player, effect.multiplier, effect.damageType);
          damageBoss(state, player, boss, roll.amount, roll.crit);
        }
      }
      break;
    }
  }
}
