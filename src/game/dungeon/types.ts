import type { Vec } from "../math/vec";
import type { EnemyKindId } from "../enemies/definitions";
import type { BossId } from "../bosses/definitions";

export const TILE_WALL = 0;
export const TILE_FLOOR = 1;

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EnemySpawn {
  kind: EnemyKindId;
  position: Vec;
  /** Índice de la sala en la que aparece. */
  room: number;
}

/** Mapa de un piso. Se genera igual en cliente y servidor a partir de (semilla, piso). */
export interface FloorLayout {
  floor: number;
  seed: number;
  width: number;
  height: number;
  /** width * height casillas, fila a fila: TILE_WALL o TILE_FLOOR. */
  tiles: Uint8Array;
  rooms: Room[];
  playerSpawn: Vec;
  /** Portal de salida: se activa al eliminar a todos los enemigos. */
  exit: Vec;
  enemies: EnemySpawn[];
  boss: { id: BossId; position: Vec } | null;
  /** Número de intentos de generación hasta obtener un mapa válido (depuración). */
  attempts: number;
}
