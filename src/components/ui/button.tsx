import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export const buttonStyles = (variant: ButtonVariant = "primary", extra?: string) =>
  cn(
    "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold tracking-wide transition",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400",
    "disabled:cursor-not-allowed disabled:opacity-50",
    variant === "primary" &&
      "bg-gradient-to-b from-ember-500 to-ember-600 text-abyss-950 shadow-[0_0_20px_-6px_rgba(240,160,75,0.6)] hover:from-ember-400 hover:to-ember-500",
    variant === "secondary" && "border border-abyss-600 bg-abyss-800 text-bone-100 hover:border-ember-600 hover:bg-abyss-700",
    variant === "danger" && "border border-blood-500/60 bg-blood-500/15 text-blood-400 hover:bg-blood-500/25",
    variant === "ghost" && "text-bone-300 hover:bg-abyss-800 hover:text-bone-100",
    extra,
  );

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={buttonStyles(variant, className)} {...props} />;
}
