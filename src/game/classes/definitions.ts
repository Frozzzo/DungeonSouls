import type { AttributeKey, Attributes, ClassId, ResourceKind } from "../types";

export type WeaponType = "SWORD_SHIELD" | "MACE" | "AXE" | "DAGGERS" | "BOW" | "STAFF" | "SCEPTER";
export type ArmorWeight = "HEAVY" | "MEDIUM" | "LIGHT";

export interface SkillBranch {
  id: string;
  name: string;
  description: string;
}

export interface ClassDefinition {
  id: ClassId;
  name: string;
  role: string;
  summary: string;
  strengths: readonly string[];
  weaknesses: readonly string[];
  resource: {
    kind: ResourceKind;
    name: string;
    base: number;
    /** Atributo que amplía el recurso máximo (null si es fijo). */
    scalingAttribute: AttributeKey | null;
    perPoint: number;
  };
  baseAttributes: Attributes;
  /** Atributos ganados automáticamente por cada nivel por encima del 1. */
  growthPerLevel: Attributes;
  modifiers: {
    healthMultiplier: number;
    baseArmor: number;
    /** Reducción plana añadida tras la fórmula de armadura (sigue sujeta al techo global). */
    damageReductionBonus: number;
    physicalScaling: number;
    magicScaling: number;
    healingScaling: number;
    baseMoveSpeed: number;
  };
  /** Ramas del árbol de habilidades (el contenido llega en la fase 3). */
  skillBranches: readonly SkillBranch[];
  /** Restricciones de equipamiento configurables. */
  equipment: {
    weapons: readonly WeaponType[];
    armor: readonly ArmorWeight[];
  };
  /** Color de acento para la interfaz. */
  accent: string;
}

export const CLASS_DEFINITIONS: Record<ClassId, ClassDefinition> = {
  TANK: {
    id: "TANK",
    name: "Guardián",
    role: "Tanque",
    summary:
      "Un muro de acero que atrae la furia de los enemigos y protege al grupo. Resiste lo que otros no pueden, pero no es inmortal.",
    strengths: [
      "Vida y armadura muy superiores",
      "Provocación y control de enemigos",
      "Escudos y protección temporal para aliados",
      "Resistencia a interrupciones",
    ],
    weaknesses: ["Daño bajo", "Movilidad reducida", "Depende del grupo para eliminar amenazas"],
    resource: { kind: "RAGE", name: "Furia", base: 100, scalingAttribute: null, perPoint: 0 },
    baseAttributes: { strength: 14, dexterity: 7, intelligence: 5, vitality: 16 },
    growthPerLevel: { strength: 2, dexterity: 1, intelligence: 0, vitality: 3 },
    modifiers: {
      healthMultiplier: 1.35,
      baseArmor: 40,
      damageReductionBonus: 0.05,
      physicalScaling: 0.8,
      magicScaling: 0.5,
      healingScaling: 0.5,
      baseMoveSpeed: 4.6,
    },
    skillBranches: [
      { id: "tank-survival", name: "Supervivencia", description: "Mitigación, escudos propios y resistencia." },
      { id: "tank-taunt", name: "Provocación", description: "Atraer y mantener la atención de los enemigos." },
      { id: "tank-protection", name: "Protección", description: "Barreras y salvaguardas para los aliados." },
    ],
    equipment: { weapons: ["SWORD_SHIELD", "MACE", "AXE"], armor: ["HEAVY", "MEDIUM"] },
    accent: "#c9a227",
  },
  DPS: {
    id: "DPS",
    name: "Segador",
    role: "DPS",
    summary:
      "Un asesino ágil que elimina objetivos prioritarios. Su daño es devastador, siempre que esté en el lugar correcto.",
    strengths: [
      "Mayor potencial de daño",
      "Ataques de área y de objetivo único",
      "Sinergias con estados alterados",
      "Evasión y movilidad",
    ],
    weaknesses: ["Vida baja", "Castiga duramente los errores de posicionamiento", "Sin apoyo al grupo"],
    resource: { kind: "ENERGY", name: "Energía", base: 100, scalingAttribute: "dexterity", perPoint: 0.5 },
    baseAttributes: { strength: 10, dexterity: 16, intelligence: 7, vitality: 9 },
    growthPerLevel: { strength: 1, dexterity: 3, intelligence: 1, vitality: 1 },
    modifiers: {
      healthMultiplier: 0.9,
      baseArmor: 15,
      damageReductionBonus: 0,
      physicalScaling: 1.25,
      magicScaling: 0.8,
      healingScaling: 0.3,
      baseMoveSpeed: 5.2,
    },
    skillBranches: [
      { id: "dps-direct", name: "Daño directo", description: "Golpes devastadores contra un único objetivo." },
      { id: "dps-area", name: "Daño de área", description: "Ataques que barren grupos de enemigos." },
      { id: "dps-mobility", name: "Movilidad", description: "Desplazamientos, evasión y reposicionamiento." },
    ],
    equipment: { weapons: ["DAGGERS", "BOW", "AXE"], armor: ["MEDIUM", "LIGHT"] },
    accent: "#b3261e",
  },
  HEALER: {
    id: "HEALER",
    name: "Oráculo",
    role: "Healer",
    summary:
      "Guardiana de la llama vital. Mantiene al grupo en pie con curaciones y escudos, administrando su maná con cuidado.",
    strengths: [
      "Curación individual y de área",
      "Escudos temporales y limpieza de efectos",
      "Mejoras para aliados",
    ],
    weaknesses: ["Daño ofensivo limitado", "Recurso escaso: el maná se agota", "Vulnerable si es alcanzada"],
    resource: { kind: "MANA", name: "Maná", base: 80, scalingAttribute: "intelligence", perPoint: 4 },
    baseAttributes: { strength: 5, dexterity: 8, intelligence: 17, vitality: 12 },
    growthPerLevel: { strength: 0, dexterity: 1, intelligence: 3, vitality: 2 },
    modifiers: {
      healthMultiplier: 1,
      baseArmor: 20,
      damageReductionBonus: 0,
      physicalScaling: 0.5,
      magicScaling: 0.9,
      healingScaling: 1.3,
      baseMoveSpeed: 4.9,
    },
    skillBranches: [
      { id: "healer-healing", name: "Curación", description: "Restaurar vida a uno o varios aliados." },
      { id: "healer-shields", name: "Escudos", description: "Absorber daño antes de que llegue." },
      { id: "healer-support", name: "Apoyo", description: "Mejoras, limpieza de estados y utilidad." },
    ],
    equipment: { weapons: ["STAFF", "SCEPTER", "MACE"], armor: ["MEDIUM", "LIGHT"] },
    accent: "#3fa7a0",
  },
};

export function getClassDefinition(id: ClassId): ClassDefinition {
  return CLASS_DEFINITIONS[id];
}

export const CLASS_LIST: readonly ClassDefinition[] = Object.values(CLASS_DEFINITIONS);
