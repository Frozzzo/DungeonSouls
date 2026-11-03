import { BALANCE } from "../balance";
import { BOSS_DEFINITIONS } from "../bosses/definitions";
import { armorReduction } from "../combat/damage";
import { getCombatKit } from "../combat/kits";
import { circleFits } from "../dungeon/grid";
import { floorScaling } from "../dungeon/floors";
import { ENEMY_DEFINITIONS, ENEMY_KIND_IDS, type EnemyKindId } from "../enemies/definitions";
import type { Vec } from "../math/vec";
import { deriveSeed } from "../random/rng";
import type { SimContext } from "./context";
import type { EnemyEntity, PlayerEntity, SimState } from "./types";

const SPAWN_OFFSETS: readonly Vec[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

export function emptyKills(): Record<EnemyKindId, number> {
  const out = {} as Record<EnemyKindId, number>;
  for (const id of ENEMY_KIND_IDS) out[id] = 0;
  return out;
}

/** Crea un enemigo con sus valores escalados por piso y dificultad. */
export function spawnEnemy(ctx: SimContext, id: number, kind: EnemyKindId, pos: Vec, summoned: boolean): EnemyEntity {
  const def = ENEMY_DEFINITIONS[kind];
  const scale = floorScaling(ctx.config.floor);
  const hp = Math.round(def.health * scale.health * ctx.difficulty.enemyHealth);
  return {
    id,
    kind,
    pos: { ...pos },
    radius: def.radius,
    facing: { x: -1, y: 0 },
    hp,
    maxHp: hp,
    armorReduction: armorReduction(def.armor, ctx.config.floor),
    damage: Math.round(def.attack.damage * scale.damage * ctx.difficulty.enemyDamage),
    aggro: summoned,
    state: summoned ? "CHASE" : "IDLE",
    ticks: 0,
    attackCooldown: 0,
    lockedDir: { x: 1, y: 0 },
    telegraph: null,
    statuses: [],
    lastHurtTick: -1000,
    summoned,
  };
}

/** Estado inicial de la simulación a partir del contexto (mapa ya generado). */
export function createInitialState(ctx: SimContext): SimState {
  const { layout, config } = ctx;
  let nextId = 1;

  const players: PlayerEntity[] = config.players.map((p, i) => {
    const kit = getCombatKit(p.classId);
    const offset = SPAWN_OFFSETS[i % SPAWN_OFFSETS.length];
    const candidate = { x: layout.playerSpawn.x + offset.x, y: layout.playerSpawn.y + offset.y };
    const pos = circleFits(layout, candidate.x, candidate.y, BALANCE.combat.playerRadius) ? candidate : { ...layout.playerSpawn };
    return {
      id: p.id,
      name: p.name,
      classId: p.classId,
      stats: { ...p.stats },
      pos,
      radius: BALANCE.combat.playerRadius,
      facing: { x: 1, y: 0 },
      hp: p.stats.maxHealth,
      maxHp: p.stats.maxHealth,
      resource: kit.resource.start === "FULL" ? p.stats.maxResource : 0,
      maxResource: p.stats.maxResource,
      life: "ALIVE",
      action: { kind: "NONE" },
      attackCooldown: 0,
      dodgeCooldown: 0,
      abilityCooldown: 0,
      invulnerable: 0,
      dodgeBuffer: 0,
      statuses: [],
      lastHurtTick: -1000,
    };
  });

  const enemies = layout.enemies.map((e) => spawnEnemy(ctx, nextId++, e.kind, e.position, false));

  let boss: SimState["boss"] = null;
  if (layout.boss) {
    const def = BOSS_DEFINITIONS[layout.boss.id];
    const hp = Math.round(def.health * ctx.difficulty.bossHealth);
    boss = {
      id: nextId++,
      bossId: def.id,
      pos: { ...layout.boss.position },
      radius: def.radius,
      facing: { x: -1, y: 0 },
      hp,
      maxHp: hp,
      armorReduction: armorReduction(def.armor, config.floor),
      damageMultiplier: ctx.difficulty.bossDamage,
      aggro: false,
      phase: 0,
      patternIndex: 0,
      state: "IDLE",
      ticks: 0,
      current: null,
      repeatsLeft: 0,
      lockedDir: { x: -1, y: 0 },
      telegraph: null,
      lastHurtTick: -1000,
    };
  }

  return {
    tick: 0,
    status: "RUNNING",
    defeatReason: null,
    rng: deriveSeed(config.seed, 0x5eed),
    nextId,
    players,
    enemies,
    boss,
    projectiles: [],
    hazards: [],
    portalOpen: false,
    summary: { kills: emptyKills(), bossDefeated: false, damageDealt: 0, damageTaken: 0, dodges: 0 },
    events: [],
  };
}
