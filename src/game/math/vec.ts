/**
 * Utilidades vectoriales deterministas.
 *
 * La simulación se vuelve a ejecutar en el servidor para validar una partida, así que debe dar
 * el mismo resultado bit a bit en el navegador y en Node. Por eso aquí solo se usan
 * operaciones que IEEE 754 define con exactitud (+, -, *, /, sqrt) y nunca trigonometría
 * (`Math.sin`, `Math.atan2`...), cuya precisión depende del motor.
 */
export interface Vec {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec => ({ x, y });

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function distance(a: Vec, b: Vec): number {
  return length(b.x - a.x, b.y - a.y);
}

export function distanceSq(a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/** Normaliza (x, y). Devuelve `fallback` si el vector es nulo. */
export function normalize(x: number, y: number, fallback: Vec = { x: 1, y: 0 }): Vec {
  const len = length(x, y);
  if (len < 1e-9) return { x: fallback.x, y: fallback.y };
  return { x: x / len, y: y / len };
}

export function directionTo(from: Vec, to: Vec, fallback?: Vec): Vec {
  return normalize(to.x - from.x, to.y - from.y, fallback);
}

export function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Gira la dirección `current` hacia `target` como máximo un paso angular fijo.
 * `cosStep` y `sinStep` son constantes literales (no se calculan con trigonometría).
 */
export function rotateTowards(current: Vec, target: Vec, cosStep: number, sinStep: number): Vec {
  if (dot(current, target) >= cosStep) return { x: target.x, y: target.y };
  // Sentido de giro según el producto vectorial.
  const cross = current.x * target.y - current.y * target.x;
  const s = cross >= 0 ? sinStep : -sinStep;
  const x = current.x * cosStep - current.y * s;
  const y = current.x * s + current.y * cosStep;
  return normalize(x, y, current);
}

/** ¿Está `point` dentro del cono con vértice `origin`, dirección `dir` (unitaria), radio y coseno de semiapertura? */
export function inCone(origin: Vec, dir: Vec, point: Vec, radius: number, cosHalfAngle: number, pointRadius = 0): boolean {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const d = length(dx, dy);
  if (d > radius + pointRadius) return false;
  if (d < 1e-6 || d <= pointRadius) return true;
  return (dx * dir.x + dy * dir.y) / d >= cosHalfAngle;
}

/** 16 direcciones unitarias exactas (construidas con sqrt, sin trigonometría). */
const C1 = Math.sqrt(2 + Math.SQRT2) / 2; // cos 22,5°
const S1 = Math.sqrt(2 - Math.SQRT2) / 2; // sin 22,5°
const H = Math.SQRT1_2;
export const DIRECTIONS_16: readonly Vec[] = [
  { x: 1, y: 0 },
  { x: C1, y: S1 },
  { x: H, y: H },
  { x: S1, y: C1 },
  { x: 0, y: 1 },
  { x: -S1, y: C1 },
  { x: -H, y: H },
  { x: -C1, y: S1 },
  { x: -1, y: 0 },
  { x: -C1, y: -S1 },
  { x: -H, y: -H },
  { x: -S1, y: -C1 },
  { x: 0, y: -1 },
  { x: S1, y: -C1 },
  { x: H, y: -H },
  { x: C1, y: -S1 },
];
