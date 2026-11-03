import type { InputHTMLAttributes } from "react";
import { cn } from "./cn";

export function Field({
  label,
  name,
  errors,
  hint,
  className,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
}) {
  const errorId = errors?.length ? `${name}-error` : undefined;
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={name} className="text-xs font-semibold uppercase tracking-[0.15em] text-bone-300">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={errors?.length ? true : undefined}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        className={cn(
          "rounded-md border bg-abyss-950/80 px-3 py-2.5 text-bone-100 placeholder:text-bone-500",
          "focus:border-ember-500 focus:outline-none focus:ring-1 focus:ring-ember-500",
          errors?.length ? "border-blood-500" : "border-abyss-600",
        )}
        {...input}
      />
      {hint && !errors?.length ? (
        <p id={hintId} className="text-xs text-bone-500">
          {hint}
        </p>
      ) : null}
      {errors?.length ? (
        <p id={errorId} role="alert" className="text-xs text-blood-400">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}
