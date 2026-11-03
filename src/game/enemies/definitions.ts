/**
 * Enemigos comunes. Todo el comportamiento numérico vive aquí; la IA (simulation/enemy-ai.ts)
 * solo interpreta estos datos. Tiempos en segundos, distancias en casillas.
 *
 * Diseño soulslike: cada ataque tiene un telegráfico (windup) visible, un instante de impacto
 * y una recuperación (recovery) que es la ventana para castigar.
 */
export const ENEMY_KIND_IDS = ["STALKER", "ARCHER", "WARDEN"] as const;
export type EnemyKindId = (typeof ENEMY_KIND_IDS)[number];

export type EnemyAttack =
  | {
      kind: "MELEE_ARC";
      range: number;
      /** Coseno de la semiapertura del arco (literal, sin trigonometría). */
      cosHalfAngle: number;
      damage: number;
      windup: number;
      recovery: number;
      cooldown: number;
    }
  | {
      kind: "PROJECTILE";
      range: number;
      damage: number;
      windup: number;
      recovery: number;
      cooldown: number;
      projectileSpeed: number;
      projectileRadius: number;
      /** Estado aplicado al impactar. */
      applies: { status: "SLOW"; duration: number } | null;
    }
  | {
      kind: "SLAM";
      /** Distancia a la que decide golpear. */
      triggerRange: number;
      radius: number;
      damage: number;
      windup: number;
      recovery: number;
      cooldown: number;
    };

export interface EnemyDefinition {
  id: EnemyKindId;
  name: string;
  description: string;
  role: string;
  radius: number;
  health: number;
  armor: number;
  moveSpeed: number;
  /** Distancia BFS (casillas) a la que detecta al jugador. */
  aggroRange: number;
  /** Distancia que intenta mantener (enemigos a distancia). 0 = cuerpo a cuerpo. */
  preferredRange: number;
  /** Bloqueo frontal: fracción del daño que se anula si el golpe llega por delante. */
  frontalBlock: { reduction: number; cosHalfAngle: number } | null;
  /** Giro máximo por tick (cos y sin literales). null = gira al instante. */
  turnStep: { cos: number; sin: number } | null;
  attack: EnemyAttack;
  xp: number;
  color: string;
}

// Constantes de ángulos (coseno de la semiapertura). Literales para que sean idénticas en todo motor.
const COS_45 = 0.7071067811865476;
const COS_60 = 0.5;
// Giro de 5° por tick: cos/sin literales.
const TURN_5_DEG = { cos: 0.9961946980917455, sin: 0.08715574274765817 };

export const ENEMY_DEFINITIONS: Record<EnemyKindId, EnemyDefinition> = {
  STALKER: {
    id: "STALKER",
    name: "Acechador hueco",
    description: "Rápido y frágil. Te persigue sin descanso y se abalanza cuando estás cerca.",
    role: "Perseguidor rápido",
    radius: 0.35,
    health: 42,
    armor: 5,
    moveSpeed: 4.3,
    aggroRange: 11,
    preferredRange: 0,
    frontalBlock: null,
    turnStep: null,
    attack: {
      kind: "MELEE_ARC",
      range: 1.25,
      cosHalfAngle: COS_45,
      damage: 16,
      windup: 0.4,
      recovery: 0.6,
      cooldown: 0.5,
    },
    xp: 12,
    color: "#9b8cc4",
  },
  ARCHER: {
    id: "ARCHER",
    name: "Arquero de hueso",
    description: "Mantiene la distancia y dispara saetas que ralentizan. Obliga a moverse.",
    role: "Atacante a distancia",
    radius: 0.35,
    health: 34,
    armor: 0,
    moveSpeed: 3,
    aggroRange: 12,
    preferredRange: 5.5,
    frontalBlock: null,
    turnStep: null,
    attack: {
      kind: "PROJECTILE",
      range: 8,
      damage: 13,
      windup: 0.7,
      recovery: 0.6,
      cooldown: 1.6,
      projectileSpeed: 9,
      projectileRadius: 0.2,
      applies: { status: "SLOW", duration: 1.5 },
    },
    xp: 14,
    color: "#c9b27a",
  },
  WARDEN: {
    id: "WARDEN",
    name: "Centinela de piedra",
    description:
      "Lento y blindado. Su escudo frena casi todo el daño frontal: rodéalo o castígalo tras su golpe.",
    role: "Bloqueador resistente",
    radius: 0.5,
    health: 120,
    armor: 30,
    moveSpeed: 2.1,
    aggroRange: 9,
    preferredRange: 0,
    frontalBlock: { reduction: 0.75, cosHalfAngle: COS_60 },
    turnStep: TURN_5_DEG,
    attack: {
      kind: "SLAM",
      triggerRange: 1.8,
      radius: 2,
      damage: 28,
      windup: 0.9,
      recovery: 1.3,
      cooldown: 0.8,
    },
    xp: 22,
    color: "#7f8c8d",
  },
};

export const ENEMY_LIST: readonly EnemyDefinition[] = Object.values(ENEMY_DEFINITIONS);
