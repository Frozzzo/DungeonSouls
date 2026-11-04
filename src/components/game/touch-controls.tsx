"use client";

import { useRef, useState } from "react";
import type { InputController } from "./controls";

/** Joystick virtual (mitad izquierda) y botones de acción para pantallas táctiles. */
export function TouchControls({ controller, skills, potions, revive = false }: { controller: InputController; skills: readonly (string | null)[]; potions: number; revive?: boolean }) {
  const [stick, setStick] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const pointerId = useRef<number | null>(null);
  const RADIUS = 56;

  const update = (ox: number, oy: number, x: number, y: number) => {
    let dx = x - ox;
    let dy = y - oy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    controller.setTouchMove(dx / RADIUS, dy / RADIUS);
    setStick({ ox, oy, x: ox + dx, y: oy + dy });
  };

  const release = () => {
    pointerId.current = null;
    controller.setTouchMove(0, 0);
    setStick(null);
  };

  return (
    <>
      <div
        className="absolute bottom-0 left-0 top-1/3 w-1/2"
        onPointerDown={(e) => {
          pointerId.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          update(e.clientX, e.clientY, e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (pointerId.current === e.pointerId && stick) update(stick.ox, stick.oy, e.clientX, e.clientY);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        aria-label="Joystick de movimiento"
      />
      {stick ? (
        <div className="pointer-events-none fixed z-10" style={{ left: stick.ox - RADIUS, top: stick.oy - RADIUS }}>
          <div className="relative rounded-full border-2 border-bone-300/30 bg-abyss-950/30" style={{ width: RADIUS * 2, height: RADIUS * 2 }}>
            <div
              className="absolute h-12 w-12 rounded-full bg-bone-100/40"
              style={{ left: stick.x - stick.ox + RADIUS - 24, top: stick.y - stick.oy + RADIUS - 24 }}
            />
          </div>
        </div>
      ) : null}
      <div className="absolute bottom-6 right-4 flex items-end gap-3">
        <div className="flex flex-col items-center gap-3">
          {potions > 0 ? <TouchButton label={`Poción (${potions})`} onPress={() => controller.pressPotion()} className="h-12 w-12 text-[9px]" /> : null}
          <TouchButton label="Esquivar" onPress={() => controller.pressDodge()} className="h-16 w-16" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {skills.map((name, slot) =>
            name ? <TouchButton key={slot} label={name} onPress={() => controller.pressSkill(slot)} className={`h-14 w-14 text-[9px] leading-tight ${slot === 3 ? "border-ember-400/80" : ""}`} /> : null,
          )}
        </div>
        <div className="flex flex-col items-center gap-3">
          {revive ? (
            <button
              type="button"
              className="h-14 w-14 rounded-full border-2 border-verdigris-400/70 bg-verdigris-400/20 text-[10px] font-semibold text-bone-100"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                controller.setTouchInteract(true);
              }}
              onPointerUp={() => controller.setTouchInteract(false)}
              onPointerCancel={() => controller.setTouchInteract(false)}
            >
              Reanimar
            </button>
          ) : null}
          <button
            type="button"
            className="h-20 w-20 rounded-full border-2 border-ember-400/70 bg-ember-600/40 text-sm font-semibold text-bone-100 active:bg-ember-500/60"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              controller.setTouchAttack(true);
            }}
            onPointerUp={() => controller.setTouchAttack(false)}
            onPointerCancel={() => controller.setTouchAttack(false)}
          >
            Atacar
          </button>
        </div>
      </div>
    </>
  );
}

function TouchButton({ label, onPress, className }: { label: string; onPress: () => void; className: string }) {
  return (
    <button
      type="button"
      className={`rounded-full border-2 border-bone-300/50 bg-abyss-800/60 text-xs font-semibold text-bone-100 active:bg-abyss-600 ${className}`}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress();
      }}
    >
      {label}
    </button>
  );
}
