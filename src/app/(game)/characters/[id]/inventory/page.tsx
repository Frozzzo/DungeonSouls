import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { craftPotionAction, dismantleItemAction, equipItemAction, unequipItemAction } from "@/app/(game)/characters/progression-actions";
import { CATEGORY_LABELS, ItemCard, SLOT_LABELS } from "@/components/inventory/item-card";
import { ItemComparisonList } from "@/components/inventory/item-comparison";
import { ItemIcon } from "@/components/inventory/item-icon";
import { ActionButton } from "@/components/ui/action-button";
import { cn } from "@/components/ui/cn";
import { BALANCE } from "@/game/balance";
import { ITEM_CATEGORIES } from "@/game/items/bases";
import { RARITIES, RARITY_IDS, type RarityId, rarityRank } from "@/game/items/rarities";
import { characterIdSchema } from "@/lib/validation/character";
import { requireUser } from "@/server/auth/current-user";
import { getOwnedCharacter } from "@/server/characters/service";
import { type InventorySort, isItemCategory, listInventory } from "@/server/inventory/service";

export const metadata: Metadata = { title: "Inventario" };

const isRarity = (v: unknown): v is RarityId => typeof v === "string" && (RARITY_IDS as readonly string[]).includes(v);

export default async function InventoryPage({ params, searchParams }: PageProps<"/characters/[id]/inventory">) {
  const user = await requireUser();
  const { id } = await params;
  const q = await searchParams;
  const parsed = characterIdSchema.safeParse(id);
  if (!parsed.success) notFound();
  const character = await getOwnedCharacter(user.id, parsed.data);
  if (!character) notFound();

  const category = isItemCategory(q.category) ? q.category : undefined;
  const minRarity = isRarity(q.rarity) ? q.rarity : undefined;
  const sort: InventorySort = q.sort === "rarity" ? "rarity" : "recent";
  const { items, total, equipment, potions, materials, craft } = await listInventory(user.id, character.id, { category, minRarity, sort });

  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { category, rarity: minRarity, sort: sort === "recent" ? undefined : sort, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return `/characters/${character.id}/inventory${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <Link href={`/characters/${character.id}`} className="text-sm text-bone-300 hover:text-bone-100">
        ← Volver a {character.name}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl">Inventario</h1>
        <p className="text-sm text-bone-300" data-testid="inventory-count">
          {total} / {BALANCE.rewards.inventoryCapacity} objetos
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel rounded-xl p-4 lg:col-span-2" aria-labelledby="equipment-title">
          <h2 id="equipment-title" className="mb-3 font-display text-xl">
            Equipo
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="equipment">
            {equipment.map(({ slot, item }) => (
              <li key={slot} className="flex items-center gap-3 rounded-md border border-abyss-700 p-2 text-sm" data-testid={`equipment-${slot}`}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border bg-abyss-950" style={{ borderColor: item ? `${item.rarityColor}88` : undefined }}>
                  {item ? <ItemIcon category={item.category} color={item.rarityColor} /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-wider text-bone-500">{SLOT_LABELS[slot]}</p>
                  <p className="truncate" style={item ? { color: item.rarityColor } : undefined}>
                    {item ? item.name : <span className="text-bone-500">Vacío</span>}
                  </p>
                </div>
                {item ? (
                  <ActionButton action={unequipItemAction} fields={{ characterId: character.id, slot }} variant="ghost">
                    Quitar
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-bone-500">El equipo suma a tus estadísticas en combate. Los cambios se aplican al empezar el siguiente piso.</p>
        </section>

        <section className="panel rounded-xl p-4" aria-labelledby="supplies-title">
          <h2 id="supplies-title" className="mb-3 font-display text-xl">
            Provisiones
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-bone-300">Pociones de vida</dt>
              <dd className="tabular-nums font-semibold" data-testid="potion-count">
                {potions.quantity} / {potions.max}
              </dd>
            </div>
            {materials.map((m) => (
              <div key={m.id} className="flex justify-between">
                <dt className="text-bone-300">{m.name}</dt>
                <dd className="tabular-nums font-semibold" data-testid={`material-${m.id}`}>
                  {m.quantity}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-bone-500">Llevas hasta {potions.perRun} pociones a cada piso. Las que bebes se descuentan al validar la partida.</p>
          <div className="mt-3">
            <ActionButton action={craftPotionAction} fields={{ characterId: character.id }} disabled={!craft.canCraft} testId="craft-potion">
              Fabricar poción ({craft.cost} {craft.materialName.toLowerCase()})
            </ActionButton>
          </div>
        </section>
      </div>

      <nav className="space-y-2 text-sm" aria-label="Filtros del inventario">
        <div className="flex flex-wrap gap-2">
          <FilterLink href={href({ category: undefined })} active={!category}>
            Todo
          </FilterLink>
          {ITEM_CATEGORIES.map((c) => (
            <FilterLink key={c} href={href({ category: c })} active={category === c}>
              {CATEGORY_LABELS[c]}
            </FilterLink>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterLink href={href({ rarity: undefined })} active={!minRarity}>
            Cualquier rareza
          </FilterLink>
          {RARITY_IDS.slice(1).map((r) => (
            <FilterLink key={r} href={href({ rarity: r })} active={minRarity === r} color={RARITIES[r].color}>
              {RARITIES[r].name}+
            </FilterLink>
          ))}
          <span className="mx-1 text-bone-500">|</span>
          <FilterLink href={href({ sort: undefined })} active={sort === "recent"}>
            Recientes
          </FilterLink>
          <FilterLink href={href({ sort: "rarity" })} active={sort === "rarity"}>
            Por rareza
          </FilterLink>
        </div>
      </nav>

      {items.length === 0 ? (
        <div className="panel rounded-lg p-8 text-center text-sm text-bone-300">
          {total === 0 ? "Aún no tienes objetos. Completa un piso para conseguir botín." : "Ningún objeto coincide con el filtro."}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item}>
              {item.comparison && !item.comparison.blocker ? <ItemComparisonList comparison={item.comparison} /> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {item.equippedSlot ? (
                  <ActionButton action={unequipItemAction} fields={{ characterId: character.id, slot: item.equippedSlot }} variant="ghost">
                    Quitar
                  </ActionButton>
                ) : (
                  <>
                    {item.comparison && !item.comparison.blocker ? (
                      <ActionButton action={equipItemAction} fields={{ characterId: character.id, itemId: item.id }} variant="primary" testId="equip-item">
                        Equipar
                      </ActionButton>
                    ) : null}
                    <ActionButton
                      action={dismantleItemAction}
                      fields={{ characterId: character.id, itemId: item.id }}
                      variant="danger"
                      confirmText={rarityRank(item.rarity) >= rarityRank("RARE") ? `¿Desmontar ${item.name} (${item.rarityName})? No se puede deshacer.` : undefined}
                      testId="dismantle-item"
                    >
                      Desmontar (+{item.dismantleValue})
                    </ActionButton>
                  </>
                )}
              </div>
            </ItemCard>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterLink({ href, active, color, children }: { href: string; active: boolean; color?: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn("rounded-full border px-3 py-1 text-xs transition", active ? "border-ember-500 bg-ember-500/15 text-bone-100" : "border-abyss-600 text-bone-300 hover:border-ember-600")}
      style={color && !active ? { color } : undefined}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
