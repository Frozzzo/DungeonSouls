import { BALANCE } from "../balance";

const { maxLevel, xpCurve, statPointsPerLevel, skillPointsPerLevel } = BALANCE.progression;

/** XP necesaria para pasar de `level` a `level + 1`. En el nivel máximo devuelve 0. */
export function xpToNextLevel(level: number): number {
  if (level >= maxLevel) return 0;
  return Math.round(xpCurve.base * Math.pow(Math.max(1, level), xpCurve.exponent));
}

export interface ProgressState {
  level: number;
  /** XP acumulada dentro del nivel actual. */
  experience: number;
}

export interface ExperienceResult extends ProgressState {
  levelsGained: number;
  statPointsGained: number;
  skillPointsGained: number;
}

/**
 * Aplica XP ganada y resuelve subidas de nivel encadenadas.
 * Debe ejecutarse SOLO en el servidor con XP calculada por el servidor.
 */
export function applyExperience(state: ProgressState, gained: number): ExperienceResult {
  if (!Number.isFinite(gained) || gained < 0 || !Number.isInteger(gained)) {
    throw new RangeError("La experiencia ganada debe ser un entero no negativo");
  }
  let level = state.level;
  let experience = state.experience + gained;
  let levelsGained = 0;

  while (level < maxLevel && experience >= xpToNextLevel(level)) {
    experience -= xpToNextLevel(level);
    level += 1;
    levelsGained += 1;
  }
  if (level >= maxLevel) experience = 0;

  return {
    level,
    experience,
    levelsGained,
    statPointsGained: levelsGained * statPointsPerLevel,
    skillPointsGained: levelsGained * skillPointsPerLevel,
  };
}

/** Progreso 0..1 dentro del nivel actual, útil para barras de XP. */
export function levelProgress(state: ProgressState): number {
  const needed = xpToNextLevel(state.level);
  if (needed === 0) return 1;
  return Math.min(1, state.experience / needed);
}
