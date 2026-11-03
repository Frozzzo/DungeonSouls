/**
 * Generador pseudoaleatorio determinista (mulberry32).
 *
 * Solo usa operaciones enteras de 32 bits (`Math.imul`, desplazamientos), así que produce
 * exactamente la misma secuencia en cualquier navegador y en Node. El estado es un número,
 * de modo que se guarda dentro del estado de la simulación y se clona con él.
 */
export function nextRandom(state: number): { value: number; state: number } {
  const s = (state + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: s };
}

/** Envoltorio mutable para generación (mapas, botín) donde no hace falta guardar el estado. */
export class Rng {
  constructor(private state: number) {}

  /** Número en [0, 1). */
  next(): number {
    const r = nextRandom(this.state);
    this.state = r.state;
    return r.value;
  }

  /** Entero en [min, max] (ambos incluidos). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("pick() sobre una lista vacía");
    return items[Math.floor(this.next() * items.length)];
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  get current(): number {
    return this.state;
  }
}

/** Deriva una semilla nueva a partir de otra y un número (p. ej. piso o reintento). */
export function deriveSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Semilla máxima admitida (entero positivo de 31 bits, cabe en un INT de Postgres). */
export const MAX_SEED = 0x7fffffff;
