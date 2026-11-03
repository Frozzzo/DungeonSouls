import { STATUS_DEFINITIONS } from "../combat/status";
import type { SkillAppliedStatus, SkillEffect } from "./definitions";

const pct = (v: number) => `${Math.round(v * 100)} %`;
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, ""));
const dmg = (type: "PHYSICAL" | "MAGIC") => (type === "PHYSICAL" ? "daño físico" : "daño mágico");
const applied = (a?: SkillAppliedStatus) => (a ? ` y aplica ${STATUS_DEFINITIONS[a.status].name.toLowerCase()} ${num(a.duration)} s` : "");

function supportFormula(e: { base: number; magicScaling: number; maxHpRatio: number }): string {
  const parts = [num(Math.round(e.base))];
  if (e.magicScaling > 0) parts.push(`${pct(e.magicScaling)} del daño mágico`);
  if (e.maxHpRatio > 0) parts.push(`${pct(e.maxHpRatio)} de la vida máxima`);
  return parts.join(" + ");
}

/** Texto de un efecto ya resuelto para un rango (para el árbol y la comparación entre rangos). */
export function describeEffect(e: SkillEffect): string {
  switch (e.kind) {
    case "FORTIFY":
      return `Reduce el daño recibido un ${pct(e.reduction)} durante ${num(e.duration)} s`;
    case "EMPOWER":
      return `+${pct(e.bonus)} de daño durante ${num(e.duration)} s`;
    case "HEAL":
      return `Cura ${supportFormula(e)}`;
    case "BARRIER":
      return `Barrera de ${supportFormula(e)} durante ${num(e.duration)} s`;
    case "REGEN":
      return `Cura ${supportFormula(e)} repartido en ${num(e.duration)} s`;
    case "NOVA":
      return `${pct(e.multiplier)} de ${dmg(e.damageType)} a ${num(e.radius)} casillas a tu alrededor${applied(e.applies)}`;
    case "CONE":
      return `${pct(e.multiplier)} de ${dmg(e.damageType)} en un cono de ${num(e.range)} casillas${applied(e.applies)}`;
    case "DASH":
      return `Avanza ${num(e.distance)} casillas e inflige ${pct(e.multiplier)} de ${dmg(e.damageType)} a lo que atraviesa`;
    case "PROJECTILE":
      return `Proyectil: ${pct(e.multiplier)} de ${dmg(e.damageType)}${applied(e.applies)}`;
  }
}
