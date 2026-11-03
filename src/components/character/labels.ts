import type { AttributeKey, DerivedStats } from "@/game/types";

export const ATTRIBUTE_LABELS: Record<AttributeKey, { name: string; short: string; description: string }> = {
  strength: { name: "Fuerza", short: "FUE", description: "Daño físico y armadura." },
  dexterity: { name: "Destreza", short: "DES", description: "Crítico, velocidad y daño físico." },
  intelligence: { name: "Inteligencia", short: "INT", description: "Daño mágico, curación y maná." },
  vitality: { name: "Vitalidad", short: "VIT", description: "Vida máxima y armadura." },
};

type DerivedKey = keyof DerivedStats;

export const DERIVED_ORDER: DerivedKey[] = [
  "maxHealth",
  "maxResource",
  "physicalDamage",
  "magicDamage",
  "armor",
  "damageReduction",
  "critChance",
  "critMultiplier",
  "moveSpeed",
  "healingPower",
];

const pct = (v: number) => `${(v * 100).toLocaleString("es", { maximumFractionDigits: 1 })} %`;
const num = (v: number) => v.toLocaleString("es", { maximumFractionDigits: 2 });

export const DERIVED_LABELS: Record<DerivedKey, { name: string; format: (v: number) => string }> = {
  maxHealth: { name: "Vida máxima", format: num },
  maxResource: { name: "Recurso máximo", format: num },
  physicalDamage: { name: "Daño físico", format: num },
  magicDamage: { name: "Daño mágico", format: num },
  armor: { name: "Armadura", format: num },
  damageReduction: { name: "Reducción de daño", format: pct },
  critChance: { name: "Prob. de crítico", format: pct },
  critMultiplier: { name: "Multiplicador crítico", format: (v) => `×${num(v)}` },
  moveSpeed: { name: "Velocidad de movimiento", format: num },
  healingPower: { name: "Curación realizada", format: (v) => `×${num(v)}` },
};
