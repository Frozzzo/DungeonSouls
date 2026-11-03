import type { ItemCategory } from "@/game/items/bases";

/** Iconos de categoría de objeto (trazo uniforme, coloreados con la rareza). */
export function ItemIcon({ category, color, className = "h-8 w-8" }: { category: ItemCategory; color: string; className?: string }) {
  const paths: Record<ItemCategory, string> = {
    WEAPON: "M6 26 L20 12 M18 6 L26 14 M14 18 L10 22 M8 20 L12 24",
    HELMET: "M8 20 C8 11 24 11 24 20 L24 24 L19 24 L19 20 L13 20 L13 24 L8 24 Z",
    CHEST: "M10 7 L22 7 L26 12 L23 14 L23 26 L9 26 L9 14 L6 12 Z",
    GLOVES: "M11 26 L11 13 L13 8 M15 13 L15 7 M18 13 L18 8 M21 15 L21 10 M11 26 L22 26 L22 15",
    LEGS: "M10 7 L22 7 L23 26 L18 26 L16 14 L14 26 L9 26 Z",
    BOOTS: "M11 6 L17 6 L17 19 L25 22 L25 26 L11 26 Z",
    ACCESSORY: "M16 8 A8 8 0 1 0 16.01 8 M16 4 L16 8",
  };
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[category]} />
    </svg>
  );
}
