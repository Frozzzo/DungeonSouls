"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createPartyAction, joinPartyAction, startExpeditionAction } from "@/app/(game)/party/actions";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/validation/form";

export interface CharacterOption {
  id: string;
  label: string;
}

function CharacterSelect({ options, name = "characterId" }: { options: CharacterOption[]; name?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-xs font-semibold uppercase tracking-[0.15em] text-bone-300">
        Personaje
      </label>
      <select id={name} name={name} className="rounded-md border border-abyss-600 bg-abyss-950/80 px-3 py-2.5 text-bone-100" data-testid="party-character">
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CreatePartyForm({ characters }: { characters: CharacterOption[] }) {
  const [state, action] = useActionState<FormState, FormData>(createPartyAction, {});
  return (
    <form action={action} className="space-y-3">
      <CharacterSelect options={characters} />
      <SubmitButton pendingText="Creando…">Crear grupo</SubmitButton>
      {state.message && !state.ok ? <Alert>{state.message}</Alert> : null}
    </form>
  );
}

export function JoinPartyForm({ characters, defaultCode }: { characters: CharacterOption[]; defaultCode?: string }) {
  const [state, action] = useActionState<FormState, FormData>(joinPartyAction, {});
  return (
    <form action={action} className="space-y-3">
      <Field
        label="Código del grupo"
        name="code"
        defaultValue={state.values?.code ?? defaultCode}
        placeholder="ABC234"
        maxLength={6}
        autoComplete="off"
        className="uppercase"
        data-testid="party-code-input"
      />
      <CharacterSelect options={characters} name="characterId" />
      <SubmitButton variant="secondary" pendingText="Uniéndote…">
        Unirse
      </SubmitButton>
      {state.message && !state.ok ? <Alert>{state.message}</Alert> : null}
    </form>
  );
}

export function StartExpeditionForm({ floors, disabled }: { floors: number[]; disabled: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(startExpeditionAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="floor" className="text-xs font-semibold uppercase tracking-[0.15em] text-bone-300">
          Piso
        </label>
        <select id="floor" name="floor" defaultValue={floors[floors.length - 1]} className="rounded-md border border-abyss-600 bg-abyss-950/80 px-3 py-2.5 text-bone-100">
          {floors.map((f) => (
            <option key={f} value={f}>
              Piso {f}
            </option>
          ))}
        </select>
      </div>
      <SubmitButton disabled={disabled} pendingText="Abriendo el umbral…">
        Empezar expedición
      </SubmitButton>
      {state.message && !state.ok ? <Alert>{state.message}</Alert> : null}
    </form>
  );
}

/** Refresca la sala de espera cada pocos segundos (miembros, listos, inicio de la expedición). */
export function AutoRefresh({ everyMs = 3000, redirectTo }: { everyMs?: number; redirectTo?: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (redirectTo) {
      router.push(redirectTo);
      return;
    }
    const t = window.setInterval(() => {
      if (!document.hidden) router.refresh();
    }, everyMs);
    return () => window.clearInterval(t);
  }, [router, everyMs, redirectTo]);
  return null;
}
