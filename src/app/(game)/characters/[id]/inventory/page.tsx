import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CATEGORY_LABELS, ItemCard } from "@/components/inventory/item-card";
import { cn } from "@/components/ui/cn";
import { BALANCE } from "@/game/balance";
import { ITEM_CATEGORIES } from "@/game/items/bases";
import { RARITIES, RARITY_IDS, type RarityId } from "@/game/items/rarities";
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
  const { items, total } = await listInventory(user.id, character.id, { category, minRarity, sort });

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
      <p className="text-xs text-bone-500">Equipar, comparar y desmontar llegan en la Fase 3. Los objetos que consigues ya se guardan aquí.</p>

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
            <ItemCard key={item.id} item={item} />
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
