import { cn } from "./cn";

/** Barra de progreso (vida, recurso, experiencia). */
export function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-bone-300">
        <span>{label}</span>
        <span className="tabular-nums">
          {value.toLocaleString("es")} / {max.toLocaleString("es")}
        </span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full border border-abyss-600 bg-abyss-950"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div className={cn("h-full rounded-full transition-[width] duration-500")} style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
