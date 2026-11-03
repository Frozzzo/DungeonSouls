import { distance, type Vec } from "../math/vec";
import { deriveSeed, Rng } from "../random/rng";
import type { EnemyKindId } from "../enemies/definitions";
import { floorRules, type FloorRules } from "./floors";
import { bfsDistances, isFloorTile } from "./grid";
import { type EnemySpawn, type FloorLayout, type Room, TILE_FLOOR, TILE_WALL } from "./types";

const WIDTH = 60;
const HEIGHT = 44;
const MAX_ATTEMPTS = 40;
/** Distancia mínima (casillas) entre el inicio y cualquier enemigo. */
const MIN_SPAWN_DISTANCE = 9;

export class FloorGenerationError extends Error {}

/**
 * Genera el mapa de un piso a partir de una semilla. Determinista: la misma (semilla, piso)
 * produce siempre el mismo mapa, en el navegador y en el servidor.
 *
 * Las salas se colocan en cadena y cada una se une a la anterior con un pasillo de 2 casillas,
 * así que todo el mapa es conexo por construcción; aun así se valida con BFS y, si algo falla,
 * se reintenta con una semilla derivada (el número de intentos queda registrado).
 */
export function generateFloor(seed: number, floor: number): FloorLayout {
  const rules = floorRules(floor);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const layout = tryGenerate(deriveSeed(seed, floor * 1000 + attempt), seed, rules, attempt + 1);
    if (layout && validateLayout(layout).ok) return layout;
  }
  throw new FloorGenerationError(`No se pudo generar el piso ${floor} con la semilla ${seed}`);
}

function tryGenerate(genSeed: number, seed: number, rules: FloorRules, attempts: number): FloorLayout | null {
  const rng = new Rng(genSeed);
  const tiles = new Uint8Array(WIDTH * HEIGHT).fill(TILE_WALL);
  const rooms: Room[] = [];

  const sizes: Array<[number, number]> = [[7, 6]];
  for (let i = 0; i < rules.rooms; i++) {
    sizes.push(rules.boss ? [17, 15] : [rng.int(8, 12), rng.int(7, 10)]);
  }

  // Coloca cada sala cerca de la anterior sin solaparse (con un margen de 2 casillas de muro).
  for (let i = 0; i < sizes.length; i++) {
    const [w, h] = sizes[i];
    let placed: Room | null = null;
    for (let tries = 0; tries < 200 && !placed; tries++) {
      let x: number;
      let y: number;
      if (i === 0) {
        x = rng.int(2, 10);
        y = rng.int(2, HEIGHT - h - 2);
      } else {
        const prev = rooms[i - 1];
        x = prev.x + rng.int(-4, prev.w + 10);
        y = prev.y + rng.int(-h - 6, prev.h + 6);
      }
      if (x < 1 || y < 1 || x + w >= WIDTH - 1 || y + h >= HEIGHT - 1) continue;
      const candidate = { x, y, w, h };
      if (rooms.some((r) => overlaps(r, candidate, 2))) continue;
      placed = candidate;
    }
    if (!placed) return null;
    rooms.push(placed);
    carveRect(tiles, placed.x, placed.y, placed.w, placed.h);
    if (i > 0) carveCorridor(tiles, center(rooms[i - 1]), center(placed), rng.chance(0.5));
  }

  const playerSpawn = tileCenter(center(rooms[0]));
  const last = rooms[rooms.length - 1];
  const enemies: EnemySpawn[] = [];
  let boss: FloorLayout["boss"] = null;
  let exit: Vec;

  if (rules.boss) {
    boss = { id: rules.boss, position: tileCenter(center(last)) };
    exit = { x: last.x + last.w - 2 + 0.5, y: last.y + Math.floor(last.h / 2) + 0.5 };
  } else {
    exit = tileCenter(center(last));
    const kinds = Object.entries(rules.composition) as Array<[EnemyKindId, number]>;
    for (let r = 1; r < rooms.length; r++) {
      const count = rng.int(rules.enemiesPerRoom[0], rules.enemiesPerRoom[1]);
      for (let k = 0; k < count; k++) {
        const kind = weightedPick(rng, kinds);
        const pos = randomInteriorPoint(rng, rooms[r], enemies);
        if (pos) enemies.push({ kind, position: pos, room: r });
      }
    }
    if (enemies.length === 0) return null;
  }

  return { floor: rules.floor, seed, width: WIDTH, height: HEIGHT, tiles, rooms, playerSpawn, exit, enemies, boss, attempts };
}

export interface LayoutValidation {
  ok: boolean;
  problems: string[];
}

/**
 * Comprueba que el mapa se puede jugar: inicio, salida, enemigos y jefe sobre casillas
 * transitables y alcanzables desde el inicio, y ningún enemigo encima del jugador.
 */
export function validateLayout(layout: FloorLayout): LayoutValidation {
  const problems: string[] = [];
  const sx = Math.floor(layout.playerSpawn.x);
  const sy = Math.floor(layout.playerSpawn.y);
  if (!isFloorTile(layout, sx, sy)) problems.push("inicio sobre un muro");
  const dist = bfsDistances(layout, sx, sy);
  const reachable = (p: Vec) => {
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    return isFloorTile(layout, tx, ty) && dist[ty * layout.width + tx] >= 0;
  };
  if (!reachable(layout.exit)) problems.push("salida inalcanzable");
  for (const e of layout.enemies) {
    if (!reachable(e.position)) problems.push(`enemigo ${e.kind} fuera de la zona jugable`);
    // Un enemigo necesita una casilla libre alrededor para moverse.
    const tx = Math.floor(e.position.x);
    const ty = Math.floor(e.position.y);
    if (!isFloorTile(layout, tx + 1, ty) || !isFloorTile(layout, tx - 1, ty) || !isFloorTile(layout, tx, ty + 1) || !isFloorTile(layout, tx, ty - 1)) {
      problems.push(`enemigo ${e.kind} encajado junto a un muro`);
    }
    if (distance(e.position, layout.playerSpawn) < MIN_SPAWN_DISTANCE) problems.push("enemigo demasiado cerca del inicio");
  }
  if (layout.boss && !reachable(layout.boss.position)) problems.push("jefe inalcanzable");
  // Todas las casillas transitables deben estar conectadas (sin zonas aisladas).
  for (let i = 0; i < layout.tiles.length; i++) {
    if (layout.tiles[i] === TILE_FLOOR && dist[i] < 0) {
      problems.push("zona transitable aislada");
      break;
    }
  }
  return { ok: problems.length === 0, problems };
}

function overlaps(a: Room, b: Room, margin: number): boolean {
  return a.x - margin < b.x + b.w && b.x - margin < a.x + a.w && a.y - margin < b.y + b.h && b.y - margin < a.y + a.h;
}

function center(r: Room): { x: number; y: number } {
  return { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
}

function tileCenter(t: { x: number; y: number }): Vec {
  return { x: t.x + 0.5, y: t.y + 0.5 };
}

function carveRect(tiles: Uint8Array, x: number, y: number, w: number, h: number) {
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) tiles[ty * WIDTH + tx] = TILE_FLOOR;
  }
}

/** Pasillo en L de 2 casillas de ancho. */
function carveCorridor(tiles: Uint8Array, a: { x: number; y: number }, b: { x: number; y: number }, horizontalFirst: boolean) {
  const corner = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  carveLine(tiles, a, corner);
  carveLine(tiles, corner, b);
}

function carveLine(tiles: Uint8Array, a: { x: number; y: number }, b: { x: number; y: number }) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  carveRect(tiles, x0, y0, x1 - x0 + 2, y1 - y0 + 2);
}

function weightedPick<T>(rng: Rng, entries: ReadonlyArray<[T, number]>): T {
  const total = entries.reduce((acc, [, w]) => acc + w, 0);
  let roll = rng.next() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[entries.length - 1][0];
}

function randomInteriorPoint(rng: Rng, room: Room, taken: readonly EnemySpawn[]): Vec | null {
  for (let tries = 0; tries < 30; tries++) {
    const p = { x: rng.int(room.x + 1, room.x + room.w - 2) + 0.5, y: rng.int(room.y + 1, room.y + room.h - 2) + 0.5 };
    if (taken.every((t) => distance(t.position, p) >= 1.5)) return p;
  }
  return null;
}
