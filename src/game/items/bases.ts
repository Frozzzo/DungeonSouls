import type { BossId } from "../bosses/definitions";
import type { ArmorWeight, WeaponType } from "../classes/definitions";

/** Categorías de equipo (huecos). Los consumibles llegan en la Fase 3. */
export const ITEM_CATEGORIES = ["WEAPON", "HELMET", "CHEST", "GLOVES", "LEGS", "BOOTS", "ACCESSORY"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export interface BaseItem {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  /** Solo armas. */
  weaponType?: WeaponType;
  /** Solo armaduras (casco, pechera, guantes, pantalones, botas). */
  armorWeight?: ArmorWeight;
  /** Nivel mínimo de piso en el que puede aparecer. */
  minFloor: number;
  requiredLevel: number;
  /** Estadística propia del objeto, antes de rareza y nivel. */
  implicit: { kind: "DAMAGE" | "ARMOR"; value: number } | null;
  /** Solo lo suelta este jefe (recompensa exclusiva). */
  exclusiveTo?: BossId;
  /** Efecto único (se activa con el sistema de equipo de la Fase 3). */
  uniqueEffect?: string;
}

const weapon = (id: string, name: string, weaponType: WeaponType, value: number, description: string): BaseItem => ({
  id,
  name,
  description,
  category: "WEAPON",
  weaponType,
  minFloor: 1,
  requiredLevel: 1,
  implicit: { kind: "DAMAGE", value },
});

const armor = (id: string, name: string, category: ItemCategory, armorWeight: ArmorWeight, value: number, description: string): BaseItem => ({
  id,
  name,
  description,
  category,
  armorWeight,
  minFloor: 1,
  requiredLevel: 1,
  implicit: { kind: "ARMOR", value },
});

export const BASE_ITEMS: readonly BaseItem[] = [
  weapon("rusted-blade-shield", "Hoja oxidada y broquel", "SWORD_SHIELD", 6, "Acero viejo y un escudo abollado."),
  weapon("iron-mace", "Maza de hierro", "MACE", 7, "Pesada y honesta."),
  weapon("bearded-axe", "Hacha barbada", "AXE", 8, "Muerde y no suelta."),
  weapon("twin-shivs", "Puñales gemelos", "DAGGERS", 6, "Ligeros, rápidos, crueles."),
  weapon("ashwood-bow", "Arco de fresno ceniciento", "BOW", 7, "Su madera nunca termina de enfriarse."),
  weapon("acolyte-staff", "Báculo de acólito", "STAFF", 6, "Tallado con plegarias olvidadas."),
  weapon("ember-scepter", "Cetro de rescoldo", "SCEPTER", 7, "Una brasa dormida en la punta."),

  armor("iron-helm", "Yelmo de hierro", "HELMET", "HEAVY", 8, "Abolladuras de mil golpes."),
  armor("chain-coif", "Cofia de malla", "HELMET", "MEDIUM", 5, "Anillas remachadas a mano."),
  armor("linen-hood", "Capucha de lino", "HELMET", "LIGHT", 2, "Protege del frío, no del acero."),
  armor("plate-cuirass", "Coraza de placas", "CHEST", "HEAVY", 16, "Pesa tanto como protege."),
  armor("brigandine", "Brigantina", "CHEST", "MEDIUM", 10, "Placas cosidas bajo el cuero."),
  armor("mystic-robe", "Túnica mística", "CHEST", "LIGHT", 4, "Bordada con hilo de plata."),
  armor("gauntlets", "Guanteletes", "GLOVES", "HEAVY", 6, "Dedos articulados de acero."),
  armor("leather-gloves", "Guantes de cuero", "GLOVES", "MEDIUM", 4, "Curtidos y flexibles."),
  armor("silk-wraps", "Vendas de seda", "GLOVES", "LIGHT", 1, "Para manos que conjuran."),
  armor("greaves", "Grebas", "LEGS", "HEAVY", 10, "Rodillas que no se doblan."),
  armor("studded-trousers", "Calzas tachonadas", "LEGS", "MEDIUM", 6, "Cuero con remaches."),
  armor("cloth-leggings", "Calzas de tela", "LEGS", "LIGHT", 2, "Silenciosas al caminar."),
  armor("sabatons", "Escarpes", "BOOTS", "HEAVY", 6, "Cada paso resuena."),
  armor("travel-boots", "Botas de viaje", "BOOTS", "MEDIUM", 4, "Gastadas por mil caminos."),
  armor("soft-slippers", "Zapatillas suaves", "BOOTS", "LIGHT", 1, "Ligeras como un susurro."),

  {
    id: "bone-ring",
    name: "Anillo de hueso",
    description: "Tallado en una falange de algo que no era humano.",
    category: "ACCESSORY",
    minFloor: 1,
    requiredLevel: 1,
    implicit: null,
  },
  {
    id: "ember-amulet",
    name: "Amuleto de ascuas",
    description: "Late con un calor tenue.",
    category: "ACCESSORY",
    minFloor: 3,
    requiredLevel: 1,
    implicit: null,
  },
  {
    id: "jailer-shackle",
    name: "Grillete de Varkhul",
    description: "El último grillete del Carcelero. Sigue esperando una muñeca.",
    category: "ACCESSORY",
    minFloor: 5,
    requiredLevel: 1,
    implicit: null,
    exclusiveTo: "ASH_JAILER",
    uniqueEffect: "Tras esquivar un ataque, tu siguiente golpe inflige un 30 % más de daño (se activa con el equipo de la Fase 3).",
  },
];

const BY_ID = new Map(BASE_ITEMS.map((b) => [b.id, b]));

export function getBaseItem(id: string): BaseItem | undefined {
  return BY_ID.get(id);
}
