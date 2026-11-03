import { describe, expect, it } from "vitest";
import { BALANCE } from "@/game/balance";
import { applyAllocation } from "@/game/stats/allocation";
import { zeroAttributes } from "@/game/types";

const delta = (p: Partial<ReturnType<typeof zeroAttributes>>) => ({ ...zeroAttributes(), ...p });

describe("applyAllocation", () => {
  it("asigna puntos y devuelve los restantes", () => {
    const r = applyAllocation(zeroAttributes(), 5, delta({ strength: 2, vitality: 1 }));
    expect(r).toEqual({ ok: true, allocated: delta({ strength: 2, vitality: 1 }), remainingPoints: 2 });
  });

  it("rechaza gastar más puntos de los disponibles", () => {
    const r = applyAllocation(zeroAttributes(), 2, delta({ dexterity: 3 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_ENOUGH_POINTS");
  });

  it("rechaza valores negativos (no se pueden retirar puntos)", () => {
    const r = applyAllocation(delta({ strength: 3 }), 5, delta({ strength: -2, dexterity: 2 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NEGATIVE");
  });

  it("rechaza decimales", () => {
    const r = applyAllocation(zeroAttributes(), 5, delta({ strength: 0.5 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_INTEGER");
  });

  it("rechaza una asignación vacía", () => {
    const r = applyAllocation(zeroAttributes(), 5, zeroAttributes());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("EMPTY");
  });

  it("respeta el máximo de puntos por atributo", () => {
    const cap = BALANCE.attributes.maxAllocatedPerAttribute;
    const r = applyAllocation(delta({ intelligence: cap }), 10, delta({ intelligence: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ATTRIBUTE_CAP");
  });
});
