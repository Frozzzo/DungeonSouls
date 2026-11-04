import { DERIVED_LABELS, DERIVED_ORDER } from "@/components/character/labels";
import type { ItemComparison } from "@/server/inventory/service";
import { SLOT_LABELS } from "./item-card";

/** Qué cambia si te pones el objeto (calculado en el servidor con las mismas fórmulas del combate). */
export function ItemComparisonList({ comparison }: { comparison: ItemComparison }) {
  const keys = DERIVED_ORDER.filter((k) => comparison.changes[k]);
  return (
    <div className="mt-2 rounded-md border border-abyss-700 bg-abyss-950/50 p-2 text-[11px]" data-testid="item-comparison">
      <p className="text-bone-500">
        {SLOT_LABELS[comparison.slot]}: {comparison.replaces ? `sustituye a ${comparison.replaces}` : "hueco vacío"}
      </p>
      {keys.length === 0 ? (
        <p className="text-bone-500">Sin cambios en tus estadísticas.</p>
      ) : (
        <ul className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
          {keys.map((k) => {
            const [before, after] = comparison.changes[k]!;
            const better = after > before;
            return (
              <li key={k} className="flex justify-between gap-2">
                <span className="text-bone-300">{DERIVED_LABELS[k].name}</span>
                <span className={better ? "text-verdigris-400" : "text-blood-400"}>
                  {better ? "▲" : "▼"} {DERIVED_LABELS[k].format(after)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
