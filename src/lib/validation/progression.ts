import { z } from "zod";
import { EQUIPMENT_SLOTS } from "@/game/items/equipment";
import { UNIQUE_EFFECT_IDS } from "@/game/items/bases";
import { LOADOUT_SLOTS } from "@/game/skills/rules";
import { ATTRIBUTE_KEYS } from "@/game/types";

const id = z.string().min(1).max(64);
const skillId = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/);

export const learnSkillSchema = z.object({ characterId: id, skillId }).strict();

export const equipSkillSchema = z
  .object({
    characterId: id,
    slot: z.enum(LOADOUT_SLOTS),
    /** Vacío = dejar el hueco libre. */
    skillId: z.union([skillId, z.literal("")]),
  })
  .strict();

export const equipItemSchema = z
  .object({
    characterId: id,
    itemId: id,
    /** Opcional: para elegir el hueco de accesorio. */
    slot: z.enum(EQUIPMENT_SLOTS).optional(),
  })
  .strict();

export const unequipItemSchema = z.object({ characterId: id, slot: z.enum(EQUIPMENT_SLOTS) }).strict();
export const dismantleItemSchema = z.object({ characterId: id, itemId: id }).strict();
export const craftPotionSchema = z.object({ characterId: id }).strict();

// ------------------------------------------------------------------ Instantáneas de un intento

/** DungeonRun.loadoutAtStart: una posición por hueco (BASIC_1..3, ULTIMATE). */
export const loadoutSnapshotSchema = z
  .array(z.object({ skillId, rank: z.number().int().min(1).max(10) }).nullable())
  .length(LOADOUT_SLOTS.length);

const nonNeg = z.number().min(0);

/** DungeonRun.gearAtStart: bonificación del equipo y efectos únicos. */
export const gearSnapshotSchema = z.object({
  bonus: z.object({
    attributes: z.object(Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, z.number().int().min(0)])) as Record<(typeof ATTRIBUTE_KEYS)[number], z.ZodNumber>),
    armor: nonNeg,
    weaponDamage: nonNeg,
    critChance: z.number().min(0).max(1),
  }),
  uniqueEffects: z.array(z.enum(UNIQUE_EFFECT_IDS)).max(8),
});

export type GearSnapshot = z.infer<typeof gearSnapshotSchema>;
