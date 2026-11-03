import { describe, expect, it } from "vitest";
import { BALANCE } from "@/game/balance";
import { applyExperience, levelProgress, xpToNextLevel } from "@/game/progression/experience";

const { maxLevel, statPointsPerLevel, skillPointsPerLevel } = BALANCE.progression;

describe("curva de experiencia", () => {
  it("es estrictamente creciente", () => {
    for (let l = 1; l < maxLevel - 1; l++) expect(xpToNextLevel(l + 1)).toBeGreaterThan(xpToNextLevel(l));
  });
  it("vale 0 en el nivel máximo", () => {
    expect(xpToNextLevel(maxLevel)).toBe(0);
  });
});

describe("applyExperience", () => {
  it("acumula XP sin subir de nivel", () => {
    const r = applyExperience({ level: 1, experience: 0 }, xpToNextLevel(1) - 1);
    expect(r).toMatchObject({ level: 1, levelsGained: 0, statPointsGained: 0 });
  });

  it("sube de nivel y otorga puntos", () => {
    const r = applyExperience({ level: 1, experience: 0 }, xpToNextLevel(1) + 5);
    expect(r).toEqual({
      level: 2,
      experience: 5,
      levelsGained: 1,
      statPointsGained: statPointsPerLevel,
      skillPointsGained: skillPointsPerLevel,
    });
  });

  it("resuelve varias subidas encadenadas", () => {
    const r = applyExperience({ level: 1, experience: 0 }, xpToNextLevel(1) + xpToNextLevel(2) + xpToNextLevel(3));
    expect(r.level).toBe(4);
    expect(r.experience).toBe(0);
    expect(r.statPointsGained).toBe(3 * statPointsPerLevel);
  });

  it("no supera el nivel máximo", () => {
    const r = applyExperience({ level: maxLevel - 1, experience: 0 }, 10_000_000);
    expect(r.level).toBe(maxLevel);
    expect(r.experience).toBe(0);
    expect(r.levelsGained).toBe(1);
  });

  it("rechaza XP negativa o no entera", () => {
    expect(() => applyExperience({ level: 1, experience: 0 }, -1)).toThrow(RangeError);
    expect(() => applyExperience({ level: 1, experience: 0 }, 1.5)).toThrow(RangeError);
    expect(() => applyExperience({ level: 1, experience: 0 }, Number.NaN)).toThrow(RangeError);
  });

  it("calcula el progreso del nivel", () => {
    expect(levelProgress({ level: 1, experience: 0 })).toBe(0);
    expect(levelProgress({ level: maxLevel, experience: 0 })).toBe(1);
  });
});
