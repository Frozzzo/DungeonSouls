import type { EnemyKindId } from "../enemies/definitions";

/**
 * Jefes. Cada jefe tiene fases con su propio patrón de ataques (secuencia cíclica y reconocible)
 * y un umbral de vida para pasar a la siguiente. La IA (simulation/boss-ai.ts) interpreta estos datos.
 */
export const BOSS_IDS = ["ASH_JAILER"] as const;
export type BossId = (typeof BOSS_IDS)[number];

export type BossAttackId = "SWEEP" | "SLAM" | "TRIPLE_SLAM" | "EMBER_RING";

export type BossAttack =
  | {
      id: "SWEEP";
      name: string;
      /** Cono frontal fijado al empezar el telegráfico. */
      range: number;
      cosHalfAngle: number;
      damage: number;
      windup: number;
      recovery: number;
    }
  | {
      id: "SLAM" | "TRIPLE_SLAM";
      name: string;
      /** Círculo colocado sobre la posición del objetivo al empezar el telegráfico. */
      radius: number;
      damage: number;
      windup: number;
      recovery: number;
      /** Golpes encadenados (cada uno con su telegráfico). */
      repeats: number;
      /** Telegráfico de los golpes siguientes al primero. */
      chainWindup: number;
      stun: number;
    }
  | {
      id: "EMBER_RING";
      name: string;
      /** Onda que se expande desde el jefe: hay que esquivarla (invulnerabilidad) o estar fuera de su alcance. */
      windup: number;
      speed: number;
      maxRadius: number;
      thickness: number;
      damage: number;
      recovery: number;
    };

export interface BossPhase {
  /** La fase empieza cuando la vida baja de este porcentaje (1 = desde el principio). */
  fromHealth: number;
  name: string;
  /** Patrón cíclico. Si el objetivo está lejos, SWEEP se sustituye por SLAM. */
  pattern: readonly BossAttackId[];
  moveSpeed: number;
  /** Pausa entre ataques (s). */
  attackDelay: number;
  /** Rugido de transición: invulnerable y sin atacar durante este tiempo (s). */
  transition: number;
  /** Enemigos auxiliares que aparecen al entrar en la fase. */
  summons: readonly EnemyKindId[];
}

export interface BossDefinition {
  id: BossId;
  name: string;
  title: string;
  lore: string;
  radius: number;
  health: number;
  armor: number;
  attacks: Record<BossAttackId, BossAttack>;
  phases: readonly BossPhase[];
  xp: number;
  color: string;
}

const COS_70 = 0.3420201433256687;

export const BOSS_DEFINITIONS: Record<BossId, BossDefinition> = {
  ASH_JAILER: {
    id: "ASH_JAILER",
    name: "Varkhul",
    title: "el Carcelero de Ceniza",
    lore:
      "Custodió durante siglos las celdas del primer umbral. Cuando la llama del abismo se apagó, " +
      "se quedó a guardar las cenizas. Nadie le ha dicho que ya no queda nadie a quien encerrar.",
    radius: 0.9,
    health: 1900,
    armor: 40,
    attacks: {
      SWEEP: {
        id: "SWEEP",
        name: "Barrido de cadenas",
        range: 3.2,
        cosHalfAngle: COS_70,
        damage: 40,
        windup: 0.8,
        recovery: 0.9,
      },
      SLAM: {
        id: "SLAM",
        name: "Mazazo",
        radius: 2.1,
        damage: 48,
        windup: 1,
        recovery: 1.1,
        repeats: 1,
        chainWindup: 0,
        stun: 0.5,
      },
      TRIPLE_SLAM: {
        id: "TRIPLE_SLAM",
        name: "Condena triple",
        radius: 1.8,
        damage: 32,
        windup: 0.85,
        recovery: 1.4,
        repeats: 3,
        chainWindup: 0.6,
        stun: 0.4,
      },
      EMBER_RING: {
        id: "EMBER_RING",
        name: "Anillo de brasas",
        windup: 1.1,
        speed: 5.5,
        maxRadius: 9,
        thickness: 0.6,
        damage: 30,
        recovery: 1,
      },
    },
    phases: [
      {
        fromHealth: 1,
        name: "El guardián",
        pattern: ["SWEEP", "SLAM", "SWEEP", "SWEEP", "SLAM"],
        moveSpeed: 2.6,
        attackDelay: 0.5,
        transition: 0,
        summons: [],
      },
      {
        fromHealth: 0.5,
        name: "La llama encadenada",
        pattern: ["EMBER_RING", "SWEEP", "TRIPLE_SLAM", "SWEEP", "EMBER_RING", "SLAM"],
        moveSpeed: 3.1,
        attackDelay: 0.35,
        transition: 1.6,
        summons: ["STALKER", "STALKER"],
      },
    ],
    xp: 260,
    color: "#e0602b",
  },
};
