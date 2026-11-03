import { sumAttributes } from "../attributes";
import { BALANCE } from "../balance";
import { ATTRIBUTE_KEYS, type Attributes } from "../types";

export type AllocationError =
  | { code: "EMPTY" }
  | { code: "NEGATIVE"; attribute: keyof Attributes }
  | { code: "NOT_INTEGER"; attribute: keyof Attributes }
  | { code: "NOT_ENOUGH_POINTS"; available: number; requested: number }
  | { code: "ATTRIBUTE_CAP"; attribute: keyof Attributes; cap: number };

export type AllocationResult =
  | { ok: true; allocated: Attributes; remainingPoints: number }
  | { ok: false; error: AllocationError };

/**
 * Valida y aplica una asignación de puntos de atributo.
 * Regla: solo se pueden sumar puntos (la redistribución llegará con un objeto/servicio de reinicio).
 */
export function applyAllocation(current: Attributes, availablePoints: number, delta: Attributes): AllocationResult {
  for (const key of ATTRIBUTE_KEYS) {
    if (!Number.isInteger(delta[key])) return { ok: false, error: { code: "NOT_INTEGER", attribute: key } };
    if (delta[key] < 0) return { ok: false, error: { code: "NEGATIVE", attribute: key } };
  }
  const requested = sumAttributes(delta);
  if (requested === 0) return { ok: false, error: { code: "EMPTY" } };
  if (requested > availablePoints) {
    return { ok: false, error: { code: "NOT_ENOUGH_POINTS", available: availablePoints, requested } };
  }

  const cap = BALANCE.attributes.maxAllocatedPerAttribute;
  const allocated = { ...current };
  for (const key of ATTRIBUTE_KEYS) {
    allocated[key] = current[key] + delta[key];
    if (allocated[key] > cap) return { ok: false, error: { code: "ATTRIBUTE_CAP", attribute: key, cap } };
  }
  return { ok: true, allocated, remainingPoints: availablePoints - requested };
}

export function describeAllocationError(error: AllocationError): string {
  switch (error.code) {
    case "EMPTY":
      return "No has asignado ningún punto.";
    case "NEGATIVE":
      return "No se pueden retirar puntos ya asignados.";
    case "NOT_INTEGER":
      return "Los puntos deben ser números enteros.";
    case "NOT_ENOUGH_POINTS":
      return `Intentas asignar ${error.requested} puntos, pero solo tienes ${error.available}.`;
    case "ATTRIBUTE_CAP":
      return `Un atributo no puede superar ${error.cap} puntos asignados.`;
  }
}
