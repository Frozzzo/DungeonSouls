"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/validation/form";
import type { ButtonVariant } from "./button";
import { cn } from "./cn";
import { SubmitButton } from "./submit-button";

/**
 * Botón que envía una Server Action con campos ocultos y muestra su resultado.
 * `confirmText` pide confirmación antes de enviar (acciones que no se pueden deshacer).
 */
export function ActionButton({
  action,
  fields,
  children,
  variant = "secondary",
  className,
  pendingText,
  confirmText,
  disabled,
  testId,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: Record<string, string>;
  children: React.ReactNode;
  variant?: ButtonVariant;
  className?: string;
  pendingText?: string;
  confirmText?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  return (
    <form
      action={formAction}
      className="inline-flex flex-col items-start gap-1"
      data-testid={testId}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton variant={variant} className={cn("px-3 py-1.5 text-xs", className)} pendingText={pendingText ?? "…"} disabled={disabled}>
        {children}
      </SubmitButton>
      {state.message && !state.ok ? (
        <p role="alert" className="text-xs text-blood-400">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
