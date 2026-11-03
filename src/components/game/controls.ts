import { quantizeDirection } from "@/game/simulation/input";
import { BUTTON_ABILITY, BUTTON_ATTACK, BUTTON_DODGE, type PlayerInput } from "@/game/simulation/types";

/**
 * Traduce teclado, ratón y controles táctiles en intenciones de la simulación.
 * Solo produce intenciones (dirección, apuntado, botones): nunca toca el estado del juego.
 *
 * Escritorio: WASD/flechas para moverse, ratón para apuntar, clic izquierdo o J para atacar,
 * Espacio/Mayús/K para esquivar y Q/E/clic derecho/L para la habilidad.
 */
export class InputController {
  private keys = new Set<string>();
  private mouse: { x: number; y: number } | null = null;
  private mouseDown = false;
  private lastMouseMove = 0;
  private pendingDodge = false;
  private pendingAbility = false;
  /** Estado de los controles táctiles (lo actualiza el componente TouchControls). */
  private touch = { moveX: 0, moveY: 0, attack: false, active: false };
  private cleanup: Array<() => void> = [];

  attach(canvas: HTMLCanvasElement) {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
      if (!e.repeat) {
        if (k === " " || k === "shift" || k === "k") this.pendingDodge = true;
        if (k === "q" || k === "e" || k === "l") this.pendingAbility = true;
      }
      this.keys.add(k);
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const onBlur = () => {
      this.keys.clear();
      this.mouseDown = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.lastMouseMove = performance.now();
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.pendingAbility = true;
      onMouseMove(e);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.mouseDown = false;
    };
    const onContext = (e: Event) => e.preventDefault();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("contextmenu", onContext);
    this.cleanup = [
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => window.removeEventListener("blur", onBlur),
      () => canvas.removeEventListener("mousemove", onMouseMove),
      () => canvas.removeEventListener("mousedown", onMouseDown),
      () => window.removeEventListener("mouseup", onMouseUp),
      () => canvas.removeEventListener("contextmenu", onContext),
    ];
  }

  detach() {
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
  }

  setTouchMove(x: number, y: number) {
    this.touch.moveX = x;
    this.touch.moveY = y;
    this.touch.active = true;
  }

  setTouchAttack(down: boolean) {
    this.touch.attack = down;
    this.touch.active = true;
  }

  pressDodge() {
    this.pendingDodge = true;
  }

  pressAbility() {
    this.pendingAbility = true;
  }

  /**
   * Entrada del tick actual. `playerScreen` es la posición del jugador en pantalla (para apuntar
   * con el ratón) y `autoAim` la dirección hacia el enemigo más cercano (para pantallas táctiles).
   */
  sample(playerScreen: { x: number; y: number }, autoAim: { x: number; y: number } | null): PlayerInput {
    const k = this.keys;
    let mx = (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0);
    let my = (k.has("s") || k.has("arrowdown") ? 1 : 0) - (k.has("w") || k.has("arrowup") ? 1 : 0);
    let magnitude = 1;
    if (this.touch.active && mx === 0 && my === 0) {
      mx = this.touch.moveX;
      my = this.touch.moveY;
      magnitude = Math.min(1, Math.sqrt(mx * mx + my * my));
    }
    const move = quantizeDirection(mx, my, magnitude);

    let aim = { x: 0, y: 0 };
    const mouseRecent = this.mouse && performance.now() - this.lastMouseMove < 4000;
    if (mouseRecent && this.mouse) aim = quantizeDirection(this.mouse.x - playerScreen.x, this.mouse.y - playerScreen.y);
    else if (autoAim) aim = quantizeDirection(autoAim.x, autoAim.y);

    let buttons = 0;
    if (this.mouseDown || k.has("j") || this.touch.attack) buttons |= BUTTON_ATTACK;
    if (this.pendingDodge) buttons |= BUTTON_DODGE;
    if (this.pendingAbility) buttons |= BUTTON_ABILITY;
    this.pendingDodge = false;
    this.pendingAbility = false;
    return { mx: move.x, my: move.y, ax: aim.x, ay: aim.y, buttons };
  }
}
