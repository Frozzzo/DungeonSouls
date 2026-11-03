import { TILE_FLOOR, type FloorLayout } from "./types";

type Grid = Pick<FloorLayout, "width" | "height" | "tiles">;

export function isFloorTile(grid: Grid, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) return false;
  return grid.tiles[ty * grid.width + tx] === TILE_FLOOR;
}

/** ¿Es transitable el punto del mundo (x, y)? Una casilla mide 1×1 unidades. */
export function isWalkable(grid: Grid, x: number, y: number): boolean {
  return isFloorTile(grid, Math.floor(x), Math.floor(y));
}

/** ¿Cabe un círculo de radio r centrado en (x, y) sin tocar muros? */
export function circleFits(grid: Grid, x: number, y: number, r: number): boolean {
  const minX = Math.floor(x - r);
  const maxX = Math.floor(x + r);
  const minY = Math.floor(y - r);
  const maxY = Math.floor(y + r);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (isFloorTile(grid, tx, ty)) continue;
      // Punto del muro más cercano al centro del círculo.
      const cx = Math.max(tx, Math.min(x, tx + 1));
      const cy = Math.max(ty, Math.min(y, ty + 1));
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < r * r) return false;
    }
  }
  return true;
}

/**
 * Distancias BFS (en casillas, 4 vecinos) desde una casilla a todas las demás transitables.
 * -1 = inalcanzable. Es la base de la validación de mapas y de la navegación de enemigos.
 */
export function bfsDistances(grid: Grid, startX: number, startY: number, maxDistance = Infinity): Int32Array {
  const { width, height } = grid;
  const dist = new Int32Array(width * height).fill(-1);
  if (!isFloorTile(grid, startX, startY)) return dist;
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const start = startY * width + startX;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const cur = queue[head++];
    const d = dist[cur];
    if (d >= maxDistance) continue;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    // Orden fijo de vecinos: el resultado es determinista.
    const neighbors = [cur + 1, cur - 1, cur + width, cur - width];
    const valid = [cx + 1 < width, cx > 0, cy + 1 < height, cy > 0];
    for (let i = 0; i < 4; i++) {
      if (!valid[i]) continue;
      const n = neighbors[i];
      if (dist[n] !== -1 || grid.tiles[n] !== TILE_FLOOR) continue;
      dist[n] = d + 1;
      queue[tail++] = n;
    }
  }
  return dist;
}

/** ¿Hay línea de visión entre dos puntos (sin muros en medio)? Muestreo cada 0,25 unidades. */
export function hasLineOfSight(grid: Grid, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(len / 0.25));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (!isWalkable(grid, ax + dx * t, ay + dy * t)) return false;
  }
  return true;
}
