import type { DamageType } from "../combat/kits";
import type { ClassId } from "../types";

/**
 * Árbol de habilidades de cada clase (Fase 3).
 *
 * Cada clase tiene tres ramas con dos habilidades básicas cada una y dos definitivas (ultimates).
 * El personaje equipa hasta 3 básicas y 1 definitiva; el ataque básico no ocupa hueco.
 * Las definiciones son datos: la simulación solo interpreta los efectos de aquí.
 * Tiempos en segundos, distancias en casillas.
 */
export type SkillKind = "BASIC" | "ULTIMATE";

/** Estados que una habilidad puede aplicar a los enemigos alcanzados. */
export type SkillAppliedStatus = { status: "SLOW" | "STUN"; duration: number };

/**
 * Efectos que entiende la simulación. La "magnitud" de cada efecto (multiplicador de daño,
 * reducción, cantidad curada...) se multiplica por el escalado de rango de la habilidad.
 */
export type SkillEffect =
  /** Reduce el daño recibido (estado Bastión). Magnitud: `reduction`. */
  | { kind: "FORTIFY"; reduction: number; duration: number }
  /** Daño alrededor del lanzador. Magnitud: `multiplier`. */
  | { kind: "NOVA"; radius: number; multiplier: number; damageType: DamageType; applies?: SkillAppliedStatus }
  /** Daño en un cono hacia donde apunta. Magnitud: `multiplier`. */
  | { kind: "CONE"; range: number; cosHalfAngle: number; multiplier: number; damageType: DamageType; applies?: SkillAppliedStatus }
  /** Desplazamiento instantáneo con invulnerabilidad breve que daña lo que atraviesa. Magnitud: `multiplier`. */
  | { kind: "DASH"; distance: number; width: number; multiplier: number; damageType: DamageType; invulnerability: number }
  /** Proyectil. Magnitud: `multiplier`. */
  | { kind: "PROJECTILE"; range: number; speed: number; radius: number; multiplier: number; damageType: DamageType; applies?: SkillAppliedStatus }
  /** Curación inmediata = (base + daño mágico × magicScaling + vida máx. × maxHpRatio) × curación realizada. */
  | { kind: "HEAL"; base: number; magicScaling: number; maxHpRatio: number }
  /** Escudo que absorbe daño (misma fórmula que HEAL) durante `duration`. */
  | { kind: "BARRIER"; base: number; magicScaling: number; maxHpRatio: number; duration: number }
  /** Curación repartida a lo largo de `duration` (misma fórmula que HEAL para el total). */
  | { kind: "REGEN"; base: number; magicScaling: number; maxHpRatio: number; duration: number }
  /** Aumenta el daño infligido. Magnitud: `bonus` (0.3 = +30 %). */
  | { kind: "EMPOWER"; bonus: number; duration: number };

export interface SkillDefinition {
  id: string;
  classId: ClassId;
  /** Rama del árbol (ids de CLASS_DEFINITIONS[clase].skillBranches). */
  branchId: string;
  name: string;
  description: string;
  kind: SkillKind;
  /** Nivel de personaje necesario para aprenderla. */
  requiredLevel: number;
  /** Habilidades previas y rango mínimo exigido. */
  requires: readonly { skillId: string; rank: number }[];
  maxRank: number;
  /** Puntos de habilidad por rango. */
  pointCost: number;
  /** Coste de recurso por uso. */
  resourceCost: number;
  cooldown: number;
  /** Enfriamiento que se resta por cada rango por encima del 1. */
  cooldownPerRank: number;
  /** Enfriamiento mínimo: nunca baja de aquí (y siempre es > 0). */
  minCooldown: number;
  /** Aumento de magnitud de los efectos por cada rango por encima del 1 (0.12 = +12 %). */
  rankScaling: number;
  effects: readonly SkillEffect[];
}

const COS_45 = 0.7071067811865476;
const COS_60 = 0.5;
const COS_70 = 0.3420201433256687;

export const SKILL_DEFINITIONS: readonly SkillDefinition[] = [
  // ------------------------------------------------------------------ Guardián
  {
    id: "tank-bulwark",
    classId: "TANK",
    branchId: "tank-survival",
    name: "Bastión",
    description: "Reduce el daño recibido durante 4 s. Cuesta Furia, que se gana golpeando y recibiendo golpes.",
    kind: "BASIC",
    requiredLevel: 1,
    requires: [],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 40,
    cooldown: 12,
    cooldownPerRank: 0.75,
    minCooldown: 8,
    rankScaling: 0.08,
    effects: [{ kind: "FORTIFY", reduction: 0.5, duration: 4 }],
  },
  {
    id: "tank-second-wind",
    classId: "TANK",
    branchId: "tank-survival",
    name: "Segundo aliento",
    description: "Recupera de golpe parte de tu vida máxima.",
    kind: "BASIC",
    requiredLevel: 3,
    requires: [{ skillId: "tank-bulwark", rank: 2 }],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 35,
    cooldown: 18,
    cooldownPerRank: 1,
    minCooldown: 12,
    rankScaling: 0.12,
    effects: [{ kind: "HEAL", base: 10, magicScaling: 0, maxHpRatio: 0.18 }],
  },
  {
    id: "tank-challenging-shout",
    classId: "TANK",
    branchId: "tank-taunt",
    name: "Grito desafiante",
    description: "Un rugido que hiere y ralentiza a los enemigos cercanos y los obliga a fijarse en ti.",
    kind: "BASIC",
    requiredLevel: 1,
    requires: [],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 20,
    cooldown: 9,
    cooldownPerRank: 0.5,
    minCooldown: 6,
    rankScaling: 0.15,
    effects: [{ kind: "NOVA", radius: 3, multiplier: 0.5, damageType: "PHYSICAL", applies: { status: "SLOW", duration: 2.5 } }],
  },
  {
    id: "tank-shield-bash",
    classId: "TANK",
    branchId: "tank-taunt",
    name: "Embate de escudo",
    description: "Golpe frontal con el escudo que aturde brevemente a quien alcanza.",
    kind: "BASIC",
    requiredLevel: 3,
    requires: [{ skillId: "tank-challenging-shout", rank: 1 }],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 25,
    cooldown: 8,
    cooldownPerRank: 0.5,
    minCooldown: 5,
    rankScaling: 0.12,
    effects: [{ kind: "CONE", range: 2, cosHalfAngle: COS_60, multiplier: 1.4, damageType: "PHYSICAL", applies: { status: "STUN", duration: 0.8 } }],
  },
  {
    id: "tank-iron-ward",
    classId: "TANK",
    branchId: "tank-protection",
    name: "Égida de hierro",
    description: "Levanta una barrera que absorbe daño durante 6 s.",
    kind: "BASIC",
    requiredLevel: 2,
    requires: [],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 30,
    cooldown: 14,
    cooldownPerRank: 0.75,
    minCooldown: 9,
    rankScaling: 0.15,
    effects: [{ kind: "BARRIER", base: 20, magicScaling: 0, maxHpRatio: 0.15, duration: 6 }],
  },
  {
    id: "tank-pent-fury",
    classId: "TANK",
    branchId: "tank-protection",
    name: "Furia contenida",
    description: "Durante 6 s, todo tu daño aumenta.",
    kind: "BASIC",
    requiredLevel: 4,
    requires: [{ skillId: "tank-iron-ward", rank: 1 }],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 35,
    cooldown: 15,
    cooldownPerRank: 0.75,
    minCooldown: 10,
    rankScaling: 0.15,
    effects: [{ kind: "EMPOWER", bonus: 0.25, duration: 6 }],
  },
  {
    id: "tank-unbreakable",
    classId: "TANK",
    branchId: "tank-survival",
    name: "Inquebrantable",
    description: "Definitiva. Durante 6 s el daño apenas te afecta y una barrera te cubre.",
    kind: "ULTIMATE",
    requiredLevel: 5,
    requires: [{ skillId: "tank-bulwark", rank: 2 }],
    maxRank: 3,
    pointCost: 1,
    resourceCost: 60,
    cooldown: 45,
    cooldownPerRank: 5,
    minCooldown: 30,
    rankScaling: 0.1,
    effects: [
      { kind: "FORTIFY", reduction: 0.7, duration: 6 },
      { kind: "BARRIER", base: 30, magicScaling: 0, maxHpRatio: 0.2, duration: 6 },
    ],
  },
  {
    id: "tank-earthshatter",
    classId: "TANK",
    branchId: "tank-taunt",
    name: "Quiebratierra",
    description: "Definitiva. Golpea el suelo: daño enorme a tu alrededor y aturdimiento prolongado.",
    kind: "ULTIMATE",
    requiredLevel: 5,
    requires: [{ skillId: "tank-challenging-shout", rank: 2 }],
    maxRank: 3,
    pointCost: 1,
    resourceCost: 70,
    cooldown: 40,
    cooldownPerRank: 5,
    minCooldown: 25,
    rankScaling: 0.15,
    effects: [{ kind: "NOVA", radius: 4, multiplier: 2.6, damageType: "PHYSICAL", applies: { status: "STUN", duration: 1.5 } }],
  },

  // ------------------------------------------------------------------ Segador
  {
    id: "dps-rend",
    classId: "DPS",
    branchId: "dps-direct",
    name: "Desgarro",
    description: "Una estocada brutal contra lo que tengas delante.",
    kind: "BASIC",
    requiredLevel: 1,
    requires: [],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 30,
    cooldown: 4,
    cooldownPerRank: 0.25,
    minCooldown: 2.5,
    rankScaling: 0.12,
    effects: [{ kind: "CONE", range: 1.8, cosHalfAngle: COS_45, multiplier: 2.2, damageType: "PHYSICAL" }],
  },
  {
    id: "dps-blood-mark",
    classId: "DPS",
    branchId: "dps-direct",
    name: "Marca de sangre",
    description: "Durante 5 s, todo tu daño aumenta.",
    kind: "BASIC",
    requiredLevel: 3,
    requires: [{ skillId: "dps-rend", rank: 2 }],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 35,
    cooldown: 14,
    cooldownPerRank: 0.75,
    minCooldown: 9,
    rankScaling: 0.15,
    effects: [{ kind: "EMPOWER", bonus: 0.3, duration: 5 }],
  },
  {
    id: "dps-whirlwind",
    classId: "DPS",
    branchId: "dps-area",
    name: "Torbellino",
    description: "Gira con las hojas desplegadas e inflige daño elevado a todos los enemigos cercanos.",
    kind: "BASIC",
    requiredLevel: 1,
    requires: [],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 40,
    cooldown: 5,
    cooldownPerRank: 0.3,
    minCooldown: 3,
    rankScaling: 0.12,
    effects: [{ kind: "NOVA", radius: 2.3, multiplier: 1.7, damageType: "PHYSICAL" }],
  },
  {
    id: "dps-fan-of-knives",
    classId: "DPS",
    branchId: "dps-area",
    name: "Abanico de dagas",
    description: "Lanza un abanico de hojas que hiere y ralentiza en un cono amplio.",
    kind: "BASIC",
    requiredLevel: 3,
    requires: [{ skillId: "dps-whirlwind", rank: 1 }],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 35,
    cooldown: 7,
    cooldownPerRank: 0.4,
    minCooldown: 4,
    rankScaling: 0.12,
    effects: [{ kind: "CONE", range: 3.2, cosHalfAngle: COS_70, multiplier: 1.3, damageType: "PHYSICAL", applies: { status: "SLOW", duration: 1.5 } }],
  },
  {
    id: "dps-shadow-step",
    classId: "DPS",
    branchId: "dps-mobility",
    name: "Paso sombrío",
    description: "Te desvaneces y reapareces unas casillas más allá, hiriendo a lo que atraviesas. Eres invulnerable un instante.",
    kind: "BASIC",
    requiredLevel: 2,
    requires: [],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 25,
    cooldown: 7,
    cooldownPerRank: 0.5,
    minCooldown: 4,
    rankScaling: 0.15,
    effects: [{ kind: "DASH", distance: 4, width: 0.6, multiplier: 1, damageType: "PHYSICAL", invulnerability: 0.25 }],
  },
  {
    id: "dps-throwing-blade",
    classId: "DPS",
    branchId: "dps-mobility",
    name: "Hoja arrojadiza",
    description: "Arroja una hoja a distancia que ralentiza al impactar.",
    kind: "BASIC",
    requiredLevel: 4,
    requires: [{ skillId: "dps-shadow-step", rank: 1 }],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 20,
    cooldown: 5,
    cooldownPerRank: 0.3,
    minCooldown: 3,
    rankScaling: 0.12,
    effects: [{ kind: "PROJECTILE", range: 9, speed: 16, radius: 0.3, multiplier: 1.6, damageType: "PHYSICAL", applies: { status: "SLOW", duration: 2 } }],
  },
  {
    id: "dps-blade-storm",
    classId: "DPS",
    branchId: "dps-area",
    name: "Tormenta de acero",
    description: "Definitiva. Un huracán de cuchillas que arrasa todo a tu alrededor.",
    kind: "ULTIMATE",
    requiredLevel: 5,
    requires: [{ skillId: "dps-whirlwind", rank: 2 }],
    maxRank: 3,
    pointCost: 1,
    resourceCost: 80,
    cooldown: 35,
    cooldownPerRank: 4,
    minCooldown: 22,
    rankScaling: 0.15,
    effects: [{ kind: "NOVA", radius: 3.4, multiplier: 4, damageType: "PHYSICAL" }],
  },
  {
    id: "dps-death-sentence",
    classId: "DPS",
    branchId: "dps-direct",
    name: "Sentencia",
    description: "Definitiva. Durante 6 s tu daño se dispara.",
    kind: "ULTIMATE",
    requiredLevel: 5,
    requires: [{ skillId: "dps-rend", rank: 2 }],
    maxRank: 3,
    pointCost: 1,
    resourceCost: 60,
    cooldown: 45,
    cooldownPerRank: 5,
    minCooldown: 30,
    rankScaling: 0.2,
    effects: [{ kind: "EMPOWER", bonus: 0.8, duration: 6 }],
  },

  // ------------------------------------------------------------------ Oráculo
  {
    id: "healer-mending-light",
    classId: "HEALER",
    branchId: "healer-healing",
    name: "Luz restauradora",
    description: "Restaura vida según tu daño mágico y tu curación realizada. Consume maná: adminístralo.",
    kind: "BASIC",
    requiredLevel: 1,
    requires: [],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 35,
    cooldown: 7,
    cooldownPerRank: 0.4,
    minCooldown: 4.5,
    rankScaling: 0.12,
    effects: [{ kind: "HEAL", base: 25, magicScaling: 1.5, maxHpRatio: 0 }],
  },
  {
    id: "healer-renewal",
    classId: "HEALER",
    branchId: "healer-healing",
    name: "Renovación",
    description: "Una luz suave que cura poco a poco durante 8 s.",
    kind: "BASIC",
    requiredLevel: 3,
    requires: [{ skillId: "healer-mending-light", rank: 1 }],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 30,
    cooldown: 12,
    cooldownPerRank: 0.75,
    minCooldown: 7,
    rankScaling: 0.15,
    effects: [{ kind: "REGEN", base: 30, magicScaling: 2, maxHpRatio: 0, duration: 8 }],
  },
  {
    id: "healer-veil",
    classId: "HEALER",
    branchId: "healer-shields",
    name: "Velo de luz",
    description: "Un escudo de luz que absorbe daño durante 6 s.",
    kind: "BASIC",
    requiredLevel: 1,
    requires: [],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 35,
    cooldown: 12,
    cooldownPerRank: 0.75,
    minCooldown: 7,
    rankScaling: 0.15,
    effects: [{ kind: "BARRIER", base: 25, magicScaling: 1.2, maxHpRatio: 0, duration: 6 }],
  },
  {
    id: "healer-grace",
    classId: "HEALER",
    branchId: "healer-shields",
    name: "Gracia protectora",
    description: "Durante 5 s recibes menos daño.",
    kind: "BASIC",
    requiredLevel: 3,
    requires: [{ skillId: "healer-veil", rank: 1 }],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 30,
    cooldown: 14,
    cooldownPerRank: 0.75,
    minCooldown: 9,
    rankScaling: 0.1,
    effects: [{ kind: "FORTIFY", reduction: 0.3, duration: 5 }],
  },
  {
    id: "healer-smite",
    classId: "HEALER",
    branchId: "healer-support",
    name: "Castigo",
    description: "Un proyectil sagrado que hiere y ralentiza.",
    kind: "BASIC",
    requiredLevel: 2,
    requires: [],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 20,
    cooldown: 4,
    cooldownPerRank: 0.25,
    minCooldown: 2.5,
    rankScaling: 0.12,
    effects: [{ kind: "PROJECTILE", range: 9, speed: 13, radius: 0.35, multiplier: 1.8, damageType: "MAGIC", applies: { status: "SLOW", duration: 1.5 } }],
  },
  {
    id: "healer-radiance",
    classId: "HEALER",
    branchId: "healer-support",
    name: "Destello",
    description: "Un estallido de luz que hiere y aturde a los enemigos cercanos.",
    kind: "BASIC",
    requiredLevel: 4,
    requires: [{ skillId: "healer-smite", rank: 1 }],
    maxRank: 5,
    pointCost: 1,
    resourceCost: 35,
    cooldown: 12,
    cooldownPerRank: 0.75,
    minCooldown: 7,
    rankScaling: 0.12,
    effects: [{ kind: "NOVA", radius: 2.8, multiplier: 0.9, damageType: "MAGIC", applies: { status: "STUN", duration: 1 } }],
  },
  {
    id: "healer-divine-intervention",
    classId: "HEALER",
    branchId: "healer-healing",
    name: "Intervención divina",
    description: "Definitiva. Una curación enorme y un escudo de luz a la vez.",
    kind: "ULTIMATE",
    requiredLevel: 5,
    requires: [{ skillId: "healer-mending-light", rank: 2 }],
    maxRank: 3,
    pointCost: 1,
    resourceCost: 60,
    cooldown: 45,
    cooldownPerRank: 5,
    minCooldown: 30,
    rankScaling: 0.15,
    effects: [
      { kind: "HEAL", base: 60, magicScaling: 3, maxHpRatio: 0 },
      { kind: "BARRIER", base: 40, magicScaling: 1.5, maxHpRatio: 0, duration: 8 },
    ],
  },
  {
    id: "healer-judgement",
    classId: "HEALER",
    branchId: "healer-support",
    name: "Juicio radiante",
    description: "Definitiva. La luz cae a tu alrededor: daño mágico enorme y aturdimiento.",
    kind: "ULTIMATE",
    requiredLevel: 5,
    requires: [{ skillId: "healer-smite", rank: 2 }],
    maxRank: 3,
    pointCost: 1,
    resourceCost: 60,
    cooldown: 40,
    cooldownPerRank: 5,
    minCooldown: 25,
    rankScaling: 0.15,
    effects: [{ kind: "NOVA", radius: 4, multiplier: 3.2, damageType: "MAGIC", applies: { status: "STUN", duration: 1.2 } }],
  },
];

/** Habilidad con la que empieza cada clase (rango 1, equipada en el primer hueco). */
export const STARTER_SKILLS: Record<ClassId, string> = {
  TANK: "tank-bulwark",
  DPS: "dps-whirlwind",
  HEALER: "healer-mending-light",
};


const BY_ID = new Map(SKILL_DEFINITIONS.map((s) => [s.id, s]));

export function getSkill(id: string): SkillDefinition | undefined {
  return BY_ID.get(id);
}

export function skillsForClass(classId: ClassId): SkillDefinition[] {
  return SKILL_DEFINITIONS.filter((s) => s.classId === classId);
}
