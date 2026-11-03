"use client";

import { useState } from "react";
import { CLASS_LIST } from "@/game/classes/definitions";
import { computeCharacterStats } from "@/game/stats/compute";
import { type ClassId, zeroAttributes } from "@/game/types";
import { cn } from "@/components/ui/cn";
import { ClassEmblem } from "./class-emblem";

export function ClassPicker({ defaultValue, error }: { defaultValue?: string; error?: string[] }) {
  const [selected, setSelected] = useState<ClassId | undefined>(
    CLASS_LIST.find((c) => c.id === defaultValue)?.id,
  );
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-bone-300">Clase</legend>
      <div className="grid gap-4 md:grid-cols-3">
        {CLASS_LIST.map((def) => {
          const stats = computeCharacterStats({ classId: def.id, level: 1, allocated: zeroAttributes() });
          const active = selected === def.id;
          return (
            <label
              key={def.id}
              className={cn(
                "panel flex cursor-pointer flex-col gap-3 rounded-lg p-4 transition",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ember-400",
                active ? "relative" : "relative opacity-80 hover:opacity-100",
              )}
              style={
                active
                  ? { borderColor: def.accent, boxShadow: `0 0 0 1px ${def.accent}, 0 0 36px -8px ${def.accent}` }
                  : undefined
              }
            >
              <input
                type="radio"
                name="classId"
                value={def.id}
                checked={active}
                onChange={() => setSelected(def.id)}
                className="sr-only"
              />
              {active ? (
                <span
                  className="absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-abyss-950"
                  style={{ background: def.accent }}
                >
                  Elegida
                </span>
              ) : null}
              <div className="flex items-center gap-3" style={{ color: def.accent }}>
                <ClassEmblem classId={def.id} />
                <div>
                  <p className="font-display text-lg text-bone-100">{def.name}</p>
                  <p className="text-xs uppercase tracking-widest">{def.role}</p>
                </div>
              </div>
              <p className="text-sm text-bone-300">{def.summary}</p>
              <ul className="space-y-1 text-xs text-bone-300">
                {def.strengths.slice(0, 3).map((s) => (
                  <li key={s}>
                    <span className="text-verdigris-400">+</span> {s}
                  </li>
                ))}
                {def.weaknesses.slice(0, 2).map((w) => (
                  <li key={w}>
                    <span className="text-blood-400">−</span> {w}
                  </li>
                ))}
              </ul>
              <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-abyss-700 pt-3 text-center text-xs">
                <div>
                  <dt className="text-bone-500">Vida</dt>
                  <dd className="font-semibold tabular-nums">{stats.derived.maxHealth}</dd>
                </div>
                <div>
                  <dt className="text-bone-500">{def.resource.name}</dt>
                  <dd className="font-semibold tabular-nums">{stats.derived.maxResource}</dd>
                </div>
                <div>
                  <dt className="text-bone-500">Armadura</dt>
                  <dd className="font-semibold tabular-nums">{stats.derived.armor}</dd>
                </div>
              </dl>
            </label>
          );
        })}
      </div>
      {error?.length ? (
        <p role="alert" className="text-xs text-blood-400">
          {error[0]}
        </p>
      ) : null}
    </fieldset>
  );
}
