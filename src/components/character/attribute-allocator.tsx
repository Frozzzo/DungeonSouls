"use client";

import { useActionState, useState } from "react";
import { allocateStatsAction } from "@/app/(game)/characters/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { addAttributes, sumAttributes } from "@/game/attributes";
import { BALANCE } from "@/game/balance";
import type { GearBonus } from "@/game/items/equipment";
import { type CharacterStats, computeCharacterStats } from "@/game/stats/compute";
import { ATTRIBUTE_KEYS, type AttributeKey, type Attributes, type ClassId, zeroAttributes } from "@/game/types";
import type { FormState } from "@/lib/validation/form";
import { ATTRIBUTE_LABELS } from "./labels";
import { StatsPanel } from "./stats-panel";

interface Props {
  characterId: string;
  classId: ClassId;
  level: number;
  allocated: Attributes;
  availablePoints: number;
  stats: CharacterStats;
  /** Bonificación del equipo puesto (para que la vista previa coincida con el servidor). */
  gear?: GearBonus;
}

/**
 * Asignación de puntos con vista previa. La vista previa usa las mismas fórmulas que el servidor
 * (src/game), pero el servidor vuelve a validar y calcular todo al enviar.
 */
export function AttributeAllocator({ characterId, classId, level, allocated, availablePoints, stats, gear }: Props) {
  const [delta, setDelta] = useState<Attributes>(zeroAttributes);
  const [state, formAction] = useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await allocateStatsAction(prev, formData);
    if (result.ok) setDelta(zeroAttributes());
    return result;
  }, {});

  const spent = sumAttributes(delta);
  const remaining = availablePoints - spent;
  const preview = spent > 0 ? computeCharacterStats({ classId, level, allocated: addAttributes(allocated, delta), gear }) : undefined;
  const cap = BALANCE.attributes.maxAllocatedPerAttribute;

  const change = (key: AttributeKey, amount: number) =>
    setDelta((d) => {
      const nextValue = d[key] + amount;
      if (nextValue < 0 || (amount > 0 && remaining <= 0) || allocated[key] + nextValue > cap) return d;
      return { ...d, [key]: nextValue };
    });

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="characterId" value={characterId} />
        <div className="flex items-center justify-between">
          <p className="text-sm text-bone-300">
            Puntos disponibles:{" "}
            <span className="font-display text-lg text-gold-400" data-testid="stat-points">
              {remaining}
            </span>
          </p>
          {spent > 0 ? (
            <Button type="button" variant="ghost" onClick={() => setDelta(zeroAttributes())}>
              Deshacer
            </Button>
          ) : null}
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {ATTRIBUTE_KEYS.map((key) => (
            <li key={key} className="flex items-center justify-between rounded-md border border-abyss-600 bg-abyss-950/60 px-3 py-2">
              <div>
                <p className="text-sm font-semibold">{ATTRIBUTE_LABELS[key].name}</p>
                <p className="text-xs text-bone-500">{ATTRIBUTE_LABELS[key].description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 w-8 px-0"
                  aria-label={`Quitar punto de ${ATTRIBUTE_LABELS[key].name}`}
                  disabled={delta[key] === 0}
                  onClick={() => change(key, -1)}
                >
                  −
                </Button>
                <span className="w-6 text-center tabular-nums text-verdigris-400" data-testid={`delta-${key}`}>
                  +{delta[key]}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 w-8 px-0"
                  aria-label={`Añadir punto a ${ATTRIBUTE_LABELS[key].name}`}
                  disabled={remaining <= 0 || allocated[key] + delta[key] >= cap}
                  onClick={() => change(key, 1)}
                >
                  +
                </Button>
                <input type="hidden" name={key} value={delta[key]} />
              </div>
            </li>
          ))}
        </ul>
        {state.message ? <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert> : null}
        <SubmitButton disabled={spent === 0} pendingText="Asignando…">
          Confirmar asignación
        </SubmitButton>
      </form>
      <div className="rune-divider" />
      <StatsPanel stats={stats} preview={preview} />
    </div>
  );
}
