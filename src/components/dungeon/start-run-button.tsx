"use client";

import { useActionState } from "react";
import { startRunAction } from "@/app/(game)/characters/[id]/runs/actions";
import { Alert } from "@/components/ui/alert";
import type { ButtonVariant } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/validation/form";

/** Botón que empieza un intento de un piso (el servidor fija la semilla y redirige a la partida). */
export function StartRunButton({
  characterId,
  floor,
  label,
  variant = "primary",
  className,
}: {
  characterId: string;
  floor: number;
  label: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(startRunAction, {});
  return (
    <form action={formAction} className="contents">
      <input type="hidden" name="characterId" value={characterId} />
      <input type="hidden" name="floor" value={floor} />
      <SubmitButton variant={variant} className={className} pendingText="Abriendo el umbral…">
        {label}
      </SubmitButton>
      {state.message ? <Alert>{state.message}</Alert> : null}
    </form>
  );
}
