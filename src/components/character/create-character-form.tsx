"use client";

import { useActionState } from "react";
import { createCharacterAction } from "@/app/(game)/characters/actions";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { BALANCE } from "@/game/balance";
import type { FormState } from "@/lib/validation/form";
import { ClassPicker } from "./class-picker";

export function CreateCharacterForm() {
  const [state, formAction] = useActionState<FormState, FormData>(createCharacterAction, {});
  return (
    <form action={formAction} className="space-y-6" noValidate>
      <Field
        label="Nombre"
        name="name"
        required
        maxLength={BALANCE.characters.nameMaxLength}
        defaultValue={state.values?.name}
        errors={state.fieldErrors?.name}
        hint={`${BALANCE.characters.nameMinLength}–${BALANCE.characters.nameMaxLength} caracteres. Debe ser único.`}
        className="max-w-sm"
      />
      <ClassPicker defaultValue={state.values?.classId} error={state.fieldErrors?.classId} />
      {state.message ? <Alert>{state.message}</Alert> : null}
      <SubmitButton pendingText="Forjando…">Crear personaje</SubmitButton>
    </form>
  );
}
