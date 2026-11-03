import { z } from "zod";
import { MAX_FLOOR } from "@/game/dungeon/floors";
import { ENEMY_KIND_IDS } from "@/game/enemies/definitions";
import { MAX_TICKS } from "@/game/simulation/context";
import { AXIS_MAX, BUTTON_MASK } from "@/game/simulation/types";
import { ATTRIBUTE_KEYS } from "@/game/types";

export const startRunSchema = z.object({
  characterId: z.string().min(1).max(64),
  floor: z.coerce.number().int().min(1).max(MAX_FLOOR),
});

const axis = z.number().int().min(-AXIS_MAX).max(AXIS_MAX);

/** Segmento RLE de entradas: [ticks, mx, my, ax, ay, botones]. */
export const inputSegmentSchema = z.tuple([
  z.number().int().min(1).max(MAX_TICKS),
  axis,
  axis,
  axis,
  axis,
  z.number().int().min(0).max(BUTTON_MASK),
]);

/**
 * Envío de un piso: SOLO el id del intento y las intenciones del jugador. Es un objeto estricto:
 * cualquier otro campo (xp, daño, botín...) hace que se rechace la petición.
 */
export const submitRunSchema = z
  .object({
    runId: z.string().min(1).max(64),
    segments: z
      .array(inputSegmentSchema)
      .min(1)
      .max(MAX_TICKS)
      .refine((segs) => segs.reduce((acc, s) => acc + s[0], 0) <= MAX_TICKS, "Demasiadas entradas"),
  })
  .strict();

export const runIdSchema = z.string().min(1).max(64);

const nonNegInt = z.number().int().min(0);

export const allocatedSnapshotSchema = z.object(
  Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, nonNegInt])) as Record<(typeof ATTRIBUTE_KEYS)[number], typeof nonNegInt>,
);

/** Resultado verificado guardado en DungeonRun.outcome. */
export const runOutcomeSchema = z.object({
  result: z.enum(["VICTORY", "DEFEAT"]),
  defeatReason: z.enum(["DOWNED", "TIMEOUT"]).nullable(),
  ticks: nonNegInt,
  kills: z.object(Object.fromEntries(ENEMY_KIND_IDS.map((k) => [k, nonNegInt])) as Record<(typeof ENEMY_KIND_IDS)[number], typeof nonNegInt>),
  bossDefeated: z.boolean(),
  damageDealt: nonNegInt,
  damageTaken: nonNegInt,
  dodges: nonNegInt,
  xp: z
    .object({ enemies: nonNegInt, boss: nonNegInt, clear: nonNegInt, levelFactor: z.number().min(0).max(1), total: nonNegInt })
    .nullable(),
  levelBefore: z.number().int().min(1),
  levelAfter: z.number().int().min(1),
  itemsLost: nonNegInt,
});

export type SubmitRunInput = z.infer<typeof submitRunSchema>;
export type RunOutcome = z.infer<typeof runOutcomeSchema>;
