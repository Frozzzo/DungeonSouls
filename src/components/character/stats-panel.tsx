import type { CharacterStats } from "@/game/stats/compute";
import { ATTRIBUTE_KEYS } from "@/game/types";
import { ATTRIBUTE_LABELS, DERIVED_LABELS, DERIVED_ORDER } from "./labels";

/** Muestra estadísticas ya calculadas. Opcionalmente resalta diferencias con una vista previa. */
export function StatsPanel({ stats, preview }: { stats: CharacterStats; preview?: CharacterStats }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <section>
        <h3 className="mb-3 font-display text-sm uppercase tracking-[0.2em] text-ember-400">Atributos</h3>
        <dl className="space-y-2">
          {ATTRIBUTE_KEYS.map((key) => (
            <Row key={key} name={ATTRIBUTE_LABELS[key].name} value={String(stats.attributes[key])} next={preview ? String(preview.attributes[key]) : undefined} />
          ))}
        </dl>
      </section>
      <section>
        <h3 className="mb-3 font-display text-sm uppercase tracking-[0.2em] text-ember-400">Derivadas</h3>
        <dl className="space-y-2" data-testid="derived-stats">
          {DERIVED_ORDER.map((key) => {
            const { name, format } = DERIVED_LABELS[key];
            const next = preview ? preview.derived[key] : undefined;
            return (
              <Row
                key={key}
                name={name}
                value={format(stats.derived[key])}
                next={next !== undefined && next !== stats.derived[key] ? format(next) : undefined}
              />
            );
          })}
        </dl>
      </section>
    </div>
  );
}

function Row({ name, value, next }: { name: string; value: string; next?: string }) {
  const changed = next !== undefined && next !== value;
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-abyss-700/70 pb-1.5 text-sm">
      <dt className="text-bone-300">{name}</dt>
      <dd className="tabular-nums font-semibold text-bone-100">
        {value}
        {changed ? <span className="ml-2 text-verdigris-400">→ {next}</span> : null}
      </dd>
    </div>
  );
}
