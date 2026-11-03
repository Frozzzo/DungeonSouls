import { BOSS_DEFINITIONS } from "../bosses/definitions";
import { getCombatKit } from "../combat/kits";
import { mitigate, rollOutgoingDamage } from "../combat/damage";
import { applyStatus, hasStatus, statusValue } from "../combat/status";
import { ENEMY_DEFINITIONS } from "../enemies/definitions";
import { directionTo, dot, type Vec } from "../math/vec";
import { rand, secondsToTicks } from "./context";
import type { BossEntity, EnemyEntity, PlayerEntity, SimState } from "./types";

/** Tira el daño saliente de un jugador (variación y crítico con el generador del estado). */
export function rollPlayerDamage(state: SimState, player: PlayerEntity, multiplier: number, damageType: "PHYSICAL" | "MAGIC") {
  const base = damageType === "PHYSICAL" ? player.stats.physicalDamage : player.stats.magicDamage;
  return rollOutgoingDamage(base, multiplier, player.stats.critChance, player.stats.critMultiplier, rand(state), rand(state));
}

function gainOnHit(player: PlayerEntity) {
  const gain = getCombatKit(player.classId).resource.gainOnHit;
  if (gain > 0) player.resource = Math.min(player.maxResource, player.resource + gain);
}

/** Aplica daño de un jugador a un enemigo común, con armadura y bloqueo frontal. */
export function damageEnemy(state: SimState, player: PlayerEntity, enemy: EnemyEntity, amount: number, crit: boolean, source: Vec) {
  if (enemy.hp <= 0) return;
  const def = ENEMY_DEFINITIONS[enemy.kind];
  const reductions = [enemy.armorReduction];
  let blocked = false;
  if (def.frontalBlock) {
    // El golpe llega por delante si la fuente está dentro del cono frontal del escudo.
    const toSource = directionTo(enemy.pos, source, enemy.facing);
    if (dot(enemy.facing, toSource) >= def.frontalBlock.cosHalfAngle) {
      reductions.push(def.frontalBlock.reduction);
      blocked = true;
    }
  }
  const dealt = Math.min(enemy.hp, mitigate(amount, reductions));
  enemy.hp -= dealt;
  enemy.aggro = true;
  enemy.lastHurtTick = state.tick;
  state.summary.damageDealt += dealt;
  gainOnHit(player);
  state.events.push({ type: "DAMAGE", target: "ENEMY", targetId: enemy.id, amount: dealt, crit, pos: { ...enemy.pos }, blocked });
}

/** Aplica daño de un jugador al jefe. Durante la transición de fase es invulnerable. */
export function damageBoss(state: SimState, player: PlayerEntity, boss: BossEntity, amount: number, crit: boolean) {
  if (boss.hp <= 0) return;
  if (boss.state === "TRANSITION") {
    state.events.push({ type: "DAMAGE", target: "BOSS", targetId: boss.id, amount: 0, crit: false, pos: { ...boss.pos }, blocked: true });
    return;
  }
  const dealt = Math.min(boss.hp, mitigate(amount, [boss.armorReduction]));
  boss.hp -= dealt;
  boss.aggro = true;
  boss.lastHurtTick = state.tick;
  state.summary.damageDealt += dealt;
  gainOnHit(player);
  state.events.push({ type: "DAMAGE", target: "BOSS", targetId: boss.id, amount: dealt, crit, pos: { ...boss.pos }, blocked: false });
}

/**
 * Aplica daño enemigo a un jugador. La invulnerabilidad de la esquiva anula el golpe por completo.
 * Devuelve true si el golpe conectó.
 */
export function damagePlayer(state: SimState, player: PlayerEntity, amount: number, stunSeconds = 0): boolean {
  if (player.life !== "ALIVE") return false;
  if (player.invulnerable > 0) {
    state.events.push({ type: "DODGED", targetId: player.id, pos: { ...player.pos } });
    return false;
  }
  const reductions = [player.stats.damageReduction];
  if (hasStatus(player.statuses, "FORTIFIED")) reductions.push(statusValue(player.statuses, "FORTIFIED"));
  const dealt = Math.min(player.hp, mitigate(amount, reductions));
  player.hp -= dealt;
  player.lastHurtTick = state.tick;
  state.summary.damageTaken += dealt;
  const gain = getCombatKit(player.classId).resource.gainOnHurt;
  if (gain > 0) player.resource = Math.min(player.maxResource, player.resource + gain);
  state.events.push({ type: "DAMAGE", target: "PLAYER", targetId: player.id, amount: dealt, crit: false, pos: { ...player.pos }, blocked: false });
  if (stunSeconds > 0) applyStatus(player.statuses, "STUN", secondsToTicks(stunSeconds));
  if (player.hp <= 0) {
    player.hp = 0;
    player.life = "DOWNED";
    player.action = { kind: "NONE" };
    state.events.push({ type: "PLAYER_DOWNED", playerId: player.id, pos: { ...player.pos } });
  }
  return true;
}

export function bossDefinition(boss: BossEntity) {
  return BOSS_DEFINITIONS[boss.bossId];
}
