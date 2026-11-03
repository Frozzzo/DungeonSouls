"use client";

import { useActionState, useState } from "react";
import { deleteCharacterAction } from "@/app/(game)/characters/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/validation/form";

export function DeleteCharacterForm({ characterId, name }: { characterId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<FormState, FormData>(deleteCharacterAction, {});

  if (!open) {
    return (
      <Button variant="danger" onClick={() => setOpen(true)}>
        Borrar personaje
      </Button>
    );
  }
  return (
    <form action={formAction} className="space-y-3 rounded-md border border-blood-500/40 bg-blood-500/5 p-4">
      <input type="hidden" name="characterId" value={characterId} />
      <p className="text-sm text-bone-300">
        Esta acción es permanente. Escribe <strong className="text-bone-100">{name}</strong> para confirmar.
      </p>
      <Field label="Nombre del personaje" name="confirmName" autoComplete="off" required />
      {state.message ? <Alert>{state.message}</Alert> : null}
      <div className="flex gap-2">
        <SubmitButton variant="danger" pendingText="Borrando…">
          Borrar definitivamente
        </SubmitButton>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
