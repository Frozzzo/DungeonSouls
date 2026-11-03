import { BALANCE } from "../balance";
import type { BossId } from "../bosses/definitions";
import { getClassDefinition } from "../classes/definitions";
import { DIFFICULTIES, type DifficultyId } from "../difficulty/definitions";
import { deriveSeed, Rng } from "../random/rng";
import type { ClassId } from "../types";
import { AFFIX_IDS, AFFIXES, type RolledAffix } from "./affixes";
import { BASE_ITEMS, type BaseItem } from "./bases";
import { RARITIES, RARITY_IDS, type RarityId } from "./rarities";

export interface ItemDrop {
  baseItemId: string;
  rarity: RarityId;
  itemLevel: number;
  affixes: RolledAffix[];
}

/** ¿Puede usar la clase este objeto? (restricciones de equipo configurables por clase). */
export function canClassUse(classId: ClassId, base: BaseItem): boolean {
  const eq = getClassDefinition(classId).equipment;
  if (base.weaponType) return eq.weapons.includes(base.weaponType);
  if (base.armorWeight) return eq.armor.includes(base.armorWeight);
  return true;
}

export interface LootInput {
  /** Semilla de la partida (registrada): el botín es reproducible. */
  seed: number;
  floor: number;
  difficulty: DifficultyId;
  classId: ClassId;
  boss: BossId | null;
}

/** Elige rareza según pesos; la dificultad multiplica el peso de las rarezas altas. */
export function rollRarity(rng: Rng, difficulty: DifficultyId): RarityId {
  const boost = DIFFICULTIES[difficulty].rareLootChance;
  const weights = RARITY_IDS.map((id) => RARITIES[id].weight * (RARITIES[id].boostedByDifficulty ? boost : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < RARITY_IDS.length; i++) {
    roll -= weights[i];
    if (roll < 0) return RARITY_IDS[i];
  }
  return "COMMON";
}

export function rollAffixes(rng: Rng, rarity: RarityId, itemLevel: number): RolledAffix[] {
  const def = RARITIES[rarity];
  const pool = [...AFFIX_IDS];
  const out: RolledAffix[] = [];
  for (let i = 0; i < def.affixes && pool.length > 0; i++) {
    const id = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    const a = AFFIXES[id];
    const raw = (rng.int(a.base[0], a.base[1]) + itemLevel * a.perItemLevel) * def.power;
    out.push({ id, value: Math.min(a.max, Math.max(1, Math.round(raw))) });
  }
  return out;
}

/**
 * Genera el botín de un piso completado. Es determinista (misma semilla → mismo botín), solo
 * incluye objetos que la clase puede usar y los jefes añaden su recompensa exclusiva.
 */
export function generateFloorLoot(input: LootInput): ItemDrop[] {
  const rng = new Rng(deriveSeed(input.seed, 0x1007));
  const r = BALANCE.rewards;
  const quantity = DIFFICULTIES[input.difficulty].lootQuantity;
  let count = Math.round(rng.int(r.itemsPerFloor[0], r.itemsPerFloor[1]) * quantity);
  if (input.boss) count += r.bonusBossItems;

  const itemLevel = input.floor;
  const pool = BASE_ITEMS.filter((b) => !b.exclusiveTo && b.minFloor <= input.floor && canClassUse(input.classId, b));
  const drops: ItemDrop[] = [];

  if (input.boss) {
    const exclusive = BASE_ITEMS.find((b) => b.exclusiveTo === input.boss);
    if (exclusive) {
      // La recompensa exclusiva del jefe es al menos legendaria.
      const rarity: RarityId = rng.chance(0.1 * DIFFICULTIES[input.difficulty].rareLootChance) ? "MYTHIC" : "LEGENDARY";
      drops.push({ baseItemId: exclusive.id, rarity, itemLevel, affixes: rollAffixes(rng, rarity, itemLevel) });
    }
  }
  for (let i = 0; i < count; i++) {
    const base = rng.pick(pool);
    let rarity = rollRarity(rng, input.difficulty);
    // Los jefes garantizan al menos un objeto raro.
    if (input.boss && i === 0 && RARITY_IDS.indexOf(rarity) < RARITY_IDS.indexOf("RARE")) rarity = "RARE";
    drops.push({ baseItemId: base.id, rarity, itemLevel, affixes: rollAffixes(rng, rarity, itemLevel) });
  }
  return drops;
}

/** Valor del implícito del objeto según rareza y nivel. */
export function implicitValue(base: BaseItem, rarity: RarityId, itemLevel: number): number | null {
  if (!base.implicit) return null;
  return Math.round(base.implicit.value * RARITIES[rarity].power * (1 + (itemLevel - 1) * 0.12));
}
