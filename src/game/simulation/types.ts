import type { BossAttackId, BossId } from "../bosses/definitions";
import type { ActiveStatus } from "../combat/status";
import type { DifficultyId } from "../difficulty/definitions";
import type { EnemyKindId } from "../enemies/definitions";
import type { Vec } from "../math/vec";
import type { ClassId, DerivedStats } from "../types";

/**
 * Versión de las reglas de simulación. Si cambia, las partidas empezadas con otra versión no
 * pueden validarse (la repetición daría otro resultado) y se descartan.
 */
export const SIM_VERSION = 1;

// ---------------------------------------------------------------- Entradas

/** Bits del campo `buttons` de una entrada. */
export const BUTTON_ATTACK = 1;
export const BUTTON_DODGE = 2;
export const BUTTON_ABILITY = 4;
export const BUTTON_MASK = BUTTON_ATTACK | BUTTON_DODGE | BUTTON_ABILITY;

/** Escala de los ejes cuantizados: los ejes son enteros en [-AXIS_MAX, AXIS_MAX]. */
export const AXIS_MAX = 100;

/**
 * Intención de un jugador durante un tick. Solo intenciones: el cliente nunca envía daño,
 * posiciones ni resultados. Los ejes son enteros para que la repetición sea exacta.
 */
export interface PlayerInput {
  /** Dirección de movimiento. */
  mx: number;
  my: number;
  /** Dirección de apuntado (0,0 = la dirección en la que mira). */
  ax: number;
  ay: number;
  buttons: number;
}

export const IDLE_INPUT: PlayerInput = Object.freeze({ mx: 0, my: 0, ax: 0, ay: 0, buttons: 0 });

// ---------------------------------------------------------------- Configuración

export interface SimPlayerConfig {
  id: string;
  name: string;
  classId: ClassId;
  level: number;
  /** Estadísticas derivadas calculadas en el servidor (computeCharacterStats). */
  stats: DerivedStats;
}

/** Todo lo necesario para reproducir una partida. Lo construye el servidor. */
export interface SimConfig {
  version: number;
  seed: number;
  floor: number;
  difficulty: DifficultyId;
  players: SimPlayerConfig[];
}

// ---------------------------------------------------------------- Estado

export type Telegraph =
  | { shape: "CIRCLE"; center: Vec; radius: number; total: number; remaining: number }
  | { shape: "CONE"; origin: Vec; dir: Vec; range: number; cosHalfAngle: number; total: number; remaining: number }
  | { shape: "LINE"; origin: Vec; dir: Vec; length: number; width: number; total: number; remaining: number }
  | { shape: "RING"; center: Vec; radius: number; total: number; remaining: number };

export type PlayerAction =
  | { kind: "NONE" }
  | { kind: "ATTACK"; phase: "WINDUP" | "RECOVERY"; ticks: number; dir: Vec }
  | { kind: "DODGE"; ticks: number; dir: Vec };

export interface PlayerEntity {
  id: string;
  name: string;
  classId: ClassId;
  stats: DerivedStats;
  pos: Vec;
  radius: number;
  facing: Vec;
  hp: number;
  maxHp: number;
  resource: number;
  maxResource: number;
  life: "ALIVE" | "DOWNED";
  action: PlayerAction;
  attackCooldown: number;
  dodgeCooldown: number;
  abilityCooldown: number;
  invulnerable: number;
  dodgeBuffer: number;
  statuses: ActiveStatus[];
  /** Último tick en que recibió daño (para efectos visuales). */
  lastHurtTick: number;
}

export type EnemyState = "IDLE" | "CHASE" | "WINDUP" | "RECOVERY";

export interface EnemyEntity {
  id: number;
  kind: EnemyKindId;
  pos: Vec;
  radius: number;
  facing: Vec;
  hp: number;
  maxHp: number;
  /** Reducción por armadura ya calculada para su nivel. */
  armorReduction: number;
  /** Daño del ataque ya escalado por piso y dificultad. */
  damage: number;
  aggro: boolean;
  state: EnemyState;
  ticks: number;
  attackCooldown: number;
  /** Dirección fijada al empezar el telegráfico. */
  lockedDir: Vec;
  telegraph: Telegraph | null;
  statuses: ActiveStatus[];
  lastHurtTick: number;
  /** Aparece por invocación de un jefe. */
  summoned: boolean;
}

export type BossState = "IDLE" | "MOVE" | "WINDUP" | "RECOVERY" | "TRANSITION";

export interface BossEntity {
  id: number;
  bossId: BossId;
  pos: Vec;
  radius: number;
  facing: Vec;
  hp: number;
  maxHp: number;
  armorReduction: number;
  damageMultiplier: number;
  aggro: boolean;
  phase: number;
  patternIndex: number;
  state: BossState;
  ticks: number;
  current: BossAttackId | null;
  repeatsLeft: number;
  lockedDir: Vec;
  telegraph: Telegraph | null;
  lastHurtTick: number;
}

export interface Projectile {
  id: number;
  team: "PLAYER" | "ENEMY";
  ownerId: string | number;
  pos: Vec;
  vel: Vec;
  radius: number;
  damage: number;
  crit: boolean;
  ticksLeft: number;
  applies: { status: "SLOW"; ticks: number } | null;
}

export interface RingHazard {
  id: number;
  center: Vec;
  radius: number;
  /** Casillas por tick. */
  growth: number;
  maxRadius: number;
  thickness: number;
  damage: number;
  /** Jugadores ya alcanzados por esta onda (solo un impacto por onda). */
  hit: string[];
}

export type SimEvent =
  | { type: "DAMAGE"; target: "PLAYER" | "ENEMY" | "BOSS"; targetId: string | number; amount: number; crit: boolean; pos: Vec; blocked: boolean }
  | { type: "HEAL"; targetId: string; amount: number; pos: Vec }
  | { type: "DODGED"; targetId: string; pos: Vec }
  | { type: "ATTACK"; actorId: string; pos: Vec; dir: Vec }
  | { type: "ABILITY"; actorId: string; abilityId: string; pos: Vec }
  | { type: "ENEMY_DIED"; enemyId: number; kind: EnemyKindId; pos: Vec }
  | { type: "BOSS_PHASE"; phase: number; name: string }
  | { type: "BOSS_DIED"; pos: Vec }
  | { type: "PLAYER_DOWNED"; playerId: string; pos: Vec }
  | { type: "PORTAL_OPEN"; pos: Vec };

export type SimStatus = "RUNNING" | "VICTORY" | "DEFEAT";

export interface SimSummary {
  kills: Record<EnemyKindId, number>;
  bossDefeated: boolean;
  damageDealt: number;
  damageTaken: number;
  dodges: number;
}

export interface SimState {
  tick: number;
  status: SimStatus;
  /** Motivo de la derrota, si la hay. */
  defeatReason: "DOWNED" | "TIMEOUT" | null;
  rng: number;
  nextId: number;
  players: PlayerEntity[];
  enemies: EnemyEntity[];
  boss: BossEntity | null;
  projectiles: Projectile[];
  hazards: RingHazard[];
  portalOpen: boolean;
  summary: SimSummary;
  /** Eventos producidos en el último tick (para la presentación). */
  events: SimEvent[];
}
