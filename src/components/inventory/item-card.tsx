import type { ItemView } from "@/server/inventory/service";
import { ItemIcon } from "./item-icon";

export const CATEGORY_LABELS = {
  WEAPON: "Arma",
  HELMET: "Casco",
  CHEST: "Pechera",
  GLOVES: "Guantes",
  LEGS: "Pantalones",
  BOOTS: "Botas",
  ACCESSORY: "Accesorio",
} as const;

export const SLOT_LABELS = {
  WEAPON: "Arma",
  HELMET: "Casco",
  CHEST: "Pechera",
  GLOVES: "Guantes",
  LEGS: "Pantalones",
  BOOTS: "Botas",
  ACCESSORY_1: "Accesorio 1",
  ACCESSORY_2: "Accesorio 2",
} as const;

/** Tarjeta de objeto. `children` permite añadir acciones (equipar, desmontar...) y la comparación. */
export function ItemCard({ item, children }: { item: ItemView; children?: React.ReactNode }) {
  return (
    <article className="panel flex gap-3 rounded-lg p-3" style={{ borderColor: `${item.rarityColor}55` }} data-testid="inventory-item" data-equipped={item.equippedSlot ?? undefined}>
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border bg-abyss-950" style={{ borderColor: `${item.rarityColor}88` }}>
        <ItemIcon category={item.category} color={item.rarityColor} />
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <p className="truncate font-semibold" style={{ color: item.rarityColor }}>
          {item.name}
        </p>
        <p className="text-xs text-bone-500">
          {item.rarityName} · {CATEGORY_LABELS[item.category]} · Nivel de objeto {item.itemLevel}
        </p>
        {item.implicit ? <p className="mt-1 text-xs text-bone-100">{item.implicit}</p> : null}
        {item.affixes.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-xs text-verdigris-400">
            {item.affixes.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : null}
        {item.uniqueEffect ? <p className="mt-1 text-xs italic text-ember-400">{item.uniqueEffect}</p> : null}
        {!item.usableByClass ? <p className="mt-1 text-xs text-blood-400">Tu clase no puede usarlo</p> : null}
        {item.equippedSlot ? <p className="mt-1 text-xs font-semibold text-verdigris-400">Equipado · {SLOT_LABELS[item.equippedSlot]}</p> : null}
        {children}
      </div>
    </article>
  );
}
