import { addAttributes } from "../attributes";
import { BALANCE } from "../balance";
import { getClassDefinition } from "../classes/definitions";
import type { GearBonus } from "../items/equipment";
import { ATTRIBUTE_KEYS, type Attributes, type ClassId, type DerivedStats, zeroAttributes } from "../types";

/**
 * Entrada mínima para calcular las estadísticas de un personaje.
 * `allocated` son los puntos que el jugador asignó; `gear` es la bonificación del equipo puesto.
 */
export interface StatsInput {
  classId: ClassId;
  level: number;
  allocated: Attributes;
  /** Atributos extra sueltos (p. ej. efectos temporales). */
  bonus?: Attributes;
  gear?: GearBonus;
}

export interface CharacterStats {
  attributes: Attributes;
  derived: DerivedStats;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10000) / 10000;

export function clampLevel(level: number): number {
  return clamp(Math.floor(level), 1, BALANCE.progression.maxLevel);
}

/** Atributos totales: base de clase + crecimiento por nivel + asignados + bonificaciones. */
export function computeAttributes(input: StatsInput): Attributes {
  const def = getClassDefinition(input.classId);
  const levelsAboveOne = clampLevel(input.level) - 1;
  const growth = zeroAttributes();
  for (const key of ATTRIBUTE_KEYS) growth[key] = def.growthPerLevel[key] * levelsAboveOne;

  const total = addAttributes(def.baseAttributes, growth, input.allocated, input.bonus ?? zeroAttributes(), input.gear?.attributes ?? zeroAttributes());
  for (const key of ATTRIBUTE_KEYS) {
    total[key] = clamp(Math.floor(total[key]), 0, BALANCE.attributes.maxTotalPerAttribute);
  }
  return total;
}

/** Fórmulas únicas de estadísticas derivadas. Cliente y servidor usan esta misma función. */
export function computeDerivedStats(classId: ClassId, level: number, attributes: Attributes, gear?: GearBonus): DerivedStats {
  const def = getClassDefinition(classId);
  const lvl = clampLevel(level);
  const d = BALANCE.derived;
  const { strength, dexterity, intelligence, vitality } = attributes;

  const maxHealth = Math.round(
    (d.health.base + vitality * d.health.perVitality + lvl * d.health.perLevel) * def.modifiers.healthMultiplier,
  );

  const resourceScaling = def.resource.scalingAttribute ? attributes[def.resource.scalingAttribute] : 0;
  const maxResource = Math.round(def.resource.base + resourceScaling * def.resource.perPoint);

  const weapon = Math.max(0, gear?.weaponDamage ?? 0);
  const physicalDamage = round2(
    (d.physicalDamage.base + strength * d.physicalDamage.perStrength + dexterity * d.physicalDamage.perDexterity + weapon) *
      def.modifiers.physicalScaling,
  );
  const magicDamage = round2(
    (d.magicDamage.base + intelligence * d.magicDamage.perIntelligence + weapon) * def.modifiers.magicScaling,
  );

  const armor = Math.round(
    def.modifiers.baseArmor + strength * d.armor.perStrength + vitality * d.armor.perVitality + lvl * d.armor.perLevel + Math.max(0, gear?.armor ?? 0),
  );
  const dr = d.damageReduction;
  const damageReduction = round4(
    clamp(armor / (armor + dr.constant + lvl * dr.perLevel) + def.modifiers.damageReductionBonus, 0, dr.cap),
  );

  const critChance = round4(clamp(d.crit.baseChance + dexterity * d.crit.chancePerDexterity + Math.max(0, gear?.critChance ?? 0), 0, d.crit.chanceCap));
  const critMultiplier = round2(
    clamp(d.crit.baseMultiplier + dexterity * d.crit.multiplierPerDexterity, 1, d.crit.multiplierCap),
  );

  const moveSpeed = round2(
    def.modifiers.baseMoveSpeed * (1 + clamp(dexterity * d.moveSpeed.perDexterity, 0, d.moveSpeed.maxBonus)),
  );

  const healingPower = round2(
    clamp(d.healingPower.base + intelligence * d.healingPower.perIntelligence * def.modifiers.healingScaling, 0, d.healingPower.cap),
  );

  return {
    maxHealth,
    maxResource,
    physicalDamage,
    magicDamage,
    armor,
    critChance,
    critMultiplier,
    moveSpeed,
    healingPower,
    damageReduction,
  };
}

export function computeCharacterStats(input: StatsInput): CharacterStats {
  const attributes = computeAttributes(input);
  return { attributes, derived: computeDerivedStats(input.classId, input.level, attributes, input.gear) };
}
