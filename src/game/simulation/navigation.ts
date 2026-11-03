import { bfsDistances, circleFits, isFloorTile } from "../dungeon/grid";
import type { FloorLayout } from "../dungeon/types";
import { normalize, type Vec } from "../math/vec";

/**
 * Campos de flujo (distancias BFS hacia una casilla objetivo). Son una función pura de
 * (mapa, casilla), así que se guardan en caché fuera del estado sin romper el determinismo.
 */
const cache = new WeakMap<FloorLayout, Map<number, Int32Array>>();
const MAX_CACHED = 96;

export function flowFieldTo(layout: FloorLayout, target: Vec): Int32Array {
  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);
  const key = ty * layout.width + tx;
  let perLayout = cache.get(layout);
  if (!perLayout) {
    perLayout = new Map();
    cache.set(layout, perLayout);
  }
  const hit = perLayout.get(key);
  if (hit) return hit;
  if (perLayout.size >= MAX_CACHED) perLayout.clear();
  const field = bfsDistances(layout, tx, ty);
  perLayout.set(key, field);
  return field;
}

/** Distancia en casillas según el campo de flujo (-1 si es inalcanzable). */
export function flowDistance(layout: FloorLayout, field: Int32Array, pos: Vec): number {
  const tx = Math.floor(pos.x);
  const ty = Math.floor(pos.y);
  if (!isFloorTile(layout, tx, ty)) return -1;
  return field[ty * layout.width + tx];
}

const NEIGHBORS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/**
 * Dirección para avanzar por el campo de flujo desde `pos`: hacia el centro de la casilla vecina
 * con menor distancia (sin cortar esquinas en diagonal). Si ya está en la casilla objetivo,
 * devuelve la dirección directa a `target`.
 */
export function flowDirection(layout: FloorLayout, field: Int32Array, pos: Vec, target: Vec): Vec | null {
  const tx = Math.floor(pos.x);
  const ty = Math.floor(pos.y);
  const here = isFloorTile(layout, tx, ty) ? field[ty * layout.width + tx] : -1;
  if (here === 0) return normalize(target.x - pos.x, target.y - pos.y, { x: 0, y: 0 });
  let best = -1;
  let bestDist = here < 0 ? Number.MAX_SAFE_INTEGER : here;
  for (let i = 0; i < NEIGHBORS.length; i++) {
    const [dx, dy] = NEIGHBORS[i];
    const nx = tx + dx;
    const ny = ty + dy;
    if (!isFloorTile(layout, nx, ny)) continue;
    if (dx !== 0 && dy !== 0 && (!isFloorTile(layout, tx + dx, ty) || !isFloorTile(layout, tx, ty + dy))) continue;
    const d = field[ny * layout.width + nx];
    if (d >= 0 && d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best < 0) return null;
  const [dx, dy] = NEIGHBORS[best];
  return normalize(tx + dx + 0.5 - pos.x, ty + dy + 0.5 - pos.y, { x: 0, y: 0 });
}

/**
 * Mueve un círculo con colisión contra muros, por ejes separados (permite deslizarse por las
 * paredes). Si el paso completo choca, prueba fracciones más cortas.
 */
export function moveCircle(layout: FloorLayout, pos: Vec, dx: number, dy: number, radius: number): Vec {
  let x = pos.x;
  let y = pos.y;
  if (dx !== 0) {
    for (const f of [1, 0.5, 0.25]) {
      if (circleFits(layout, x + dx * f, y, radius)) {
        x += dx * f;
        break;
      }
    }
  }
  if (dy !== 0) {
    for (const f of [1, 0.5, 0.25]) {
      if (circleFits(layout, x, y + dy * f, radius)) {
        y += dy * f;
        break;
      }
    }
  }
  return { x, y };
}
