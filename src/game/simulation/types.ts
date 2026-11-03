import type { BossAttackId, BossId } from "../bosses/definitions";
import type { ActiveStatus } from "../combat/status";
import type { DifficultyId } from "../difficulty/definitions";
import type { EnemyKindId } from "../enemies/definitions";
import type { UniqueEffectId } from "../items/bases";
import type { EquippedSkill, ResolvedSkill } from "../skills/rules";
import type { Vec } from "../math/vec";
import type { ClassId, DerivedStats } from "../types";

/**
 * Versión de las reglas de simulación. Si cambia, las partidas empezadas con otra versión no
 * pueden validarse (la repetición daría otro resultado) y se descartan.
 */
export const SIM_VERSION = 2;

// ---------------------------------------------------------------- Entradas

/** Bits del campo `buttons` de una entrada. */
export const BUTTON_ATTACK = 1;
export const BUTTON_DODGE = 2;
/** Habilidades equipadas: 3 básicas y la definitiva, en el orden de los huecos. */
export const BUTTON_SKILL_1 = 4;
export const BUTTON_SKILL_2 = 8;
export const BUTTON_SKILL_3 = 16;
export const BUTTON_ULTIMATE = 32;
export const BUTTON_POTION = 64;
export const SKILL_BUTTONS = [BUTTON_SKILL_1, BUTTON_SKILL_2, BUTTON_SKILL_3, BUTTON_ULTIMATE] as const;
export const BUTTON_MASK = BUTTON_ATTACK | BUTTON_DODGE | BUTTON_SKILL_1 | BUTTON_SKILL_2 | BUTTON_SKILL_3 | BUTTON_ULTIMATE | BUTTON_POTION;

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
  /** Estadísticas derivadas calculadas en el servidor (computeCharacterStats, equipo incluido). */
  stats: DerivedStats;
  /** Habilidades equipadas por hueco (BASIC_1..3, ULTIMATE), con su rango. */
  loadout: readonly (EquippedSkill | null)[];
  /** Pociones que lleva al piso (ya limitadas por el servidor). */
  potions: number;
  /** Efectos únicos del equipo. */
  uniqueEffects: readonly UniqueEffectId[];
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
  /** Habilidades resueltas por hueco (null = hueco vacío). */
  skills: (ResolvedSkill | null)[];
  /** Enfriamiento restante (ticks) de cada hueco. */
  skillCooldowns: number[];
  potions: number;
  potionCooldown: number;
  uniqueEffects: UniqueEffectId[];
  /** Bonificación de daño pendiente para el siguiente golpe (efecto único). */
  nextHitBonus: number;
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
  applies: { status: "SLOW" | "STUN"; ticks: number } | null;
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
  | { type: "ABILITY"; actorId: string; abilityId: string; slot: number; pos: Vec; dir: Vec }
  | { type: "POTION"; actorId: string; amount: number; pos: Vec }
  | { type: "ABSORBED"; targetId: string; amount: number; pos: Vec }
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
  /** Pociones bebidas (el servidor las descuenta del inventario). */
  potionsUsed: number;
  skillsUsed: number;
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
