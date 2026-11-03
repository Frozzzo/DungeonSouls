import { AXIS_MAX, BUTTON_MASK, type PlayerInput } from "./types";

/**
 * Registro compacto de entradas: codificación por longitud de racha (RLE).
 * Cada segmento es [ticks, mx, my, ax, ay, buttons] y significa "esta entrada durante N ticks".
 * Las entradas cambian poco de un tick a otro, así que un piso de varios minutos ocupa unos KB.
 */
export type InputSegment = [count: number, mx: number, my: number, ax: number, ay: number, buttons: number];

const clampAxis = (v: number) => Math.max(-AXIS_MAX, Math.min(AXIS_MAX, Math.round(v)));

/** Normaliza una entrada: ejes enteros dentro de rango y solo bits de botón conocidos. */
export function sanitizeInput(input: PlayerInput): PlayerInput {
  return {
    mx: clampAxis(input.mx),
    my: clampAxis(input.my),
    ax: clampAxis(input.ax),
    ay: clampAxis(input.ay),
    buttons: input.buttons & BUTTON_MASK,
  };
}

/** Convierte una dirección continua (cualquier longitud) en ejes enteros. */
export function quantizeDirection(x: number, y: number, magnitude = 1): { x: number; y: number } {
  const len = Math.sqrt(x * x + y * y);
  if (len < 1e-6) return { x: 0, y: 0 };
  const m = Math.min(1, magnitude) * AXIS_MAX;
  return { x: clampAxis((x / len) * m), y: clampAxis((y / len) * m) };
}

function sameInput(seg: InputSegment, input: PlayerInput): boolean {
  return seg[1] === input.mx && seg[2] === input.my && seg[3] === input.ax && seg[4] === input.ay && seg[5] === input.buttons;
}

/** Acumula entradas tick a tick y las comprime al vuelo. */
export class InputRecorder {
  readonly segments: InputSegment[] = [];
  ticks = 0;

  push(raw: PlayerInput): PlayerInput {
    const input = sanitizeInput(raw);
    const last = this.segments[this.segments.length - 1];
    if (last && sameInput(last, input)) last[0]++;
    else this.segments.push([1, input.mx, input.my, input.ax, input.ay, input.buttons]);
    this.ticks++;
    return input;
  }
}

export function encodeInputs(inputs: readonly PlayerInput[]): InputSegment[] {
  const rec = new InputRecorder();
  for (const i of inputs) rec.push(i);
  return rec.segments;
}

/** Recorre los segmentos devolviendo una entrada por tick. */
export function* iterateInputs(segments: readonly InputSegment[]): Generator<PlayerInput> {
  for (const [count, mx, my, ax, ay, buttons] of segments) {
    const input = sanitizeInput({ mx, my, ax, ay, buttons });
    for (let i = 0; i < count; i++) yield input;
  }
}

export function totalTicks(segments: readonly InputSegment[]): number {
  return segments.reduce((acc, s) => acc + s[0], 0);
}
