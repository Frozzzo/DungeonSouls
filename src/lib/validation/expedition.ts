import { z } from "zod";
import { MAX_FLOOR } from "@/game/dungeon/floors";
import { ENEMY_KIND_IDS } from "@/game/enemies/definitions";
import { BALANCE } from "@/game/balance";

/** Alfabeto de los códigos de grupo: sin 0/O ni 1/I/L para poder dictarlos. */
export const PARTY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PARTY_CODE_LENGTH = 6;

export const partyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[${PARTY_CODE_ALPHABET}]{${PARTY_CODE_LENGTH}}$`), "El código tiene 6 letras o números.");

export const characterIdSchema = z.string().min(1).max(64);
export const expeditionIdSchema = z.string().min(1).max(64);

export const createPartySchema = z.object({ characterId: characterIdSchema });
export const joinPartySchema = z.object({ code: partyCodeSchema, characterId: characterIdSchema });
export const startExpeditionSchema = z.object({ floor: z.coerce.number().int().min(1).max(MAX_FLOOR) });

const nonNegInt = z.number().int().min(0);

/** Resultado firmado que envía el servidor de partida. Se valida aunque la firma sea correcta. */
export const expeditionResultSchema = z
  .object({
    expeditionId: expeditionIdSchema,
    status: z.enum(["VICTORY", "DEFEAT", "ABANDONED"]),
    defeatReason: z.enum(["DOWNED", "TIMEOUT"]).nullable(),
    ticks: nonNegInt,
    summary: z.object({
      kills: z.object(Object.fromEntries(ENEMY_KIND_IDS.map((k) => [k, nonNegInt])) as Record<(typeof ENEMY_KIND_IDS)[number], typeof nonNegInt>),
      bossDefeated: z.boolean(),
      damageDealt: nonNegInt,
      damageTaken: nonNegInt,
      dodges: nonNegInt,
      potionsUsed: nonNegInt,
      skillsUsed: nonNegInt,
    }),
    players: z
      .array(z.object({ id: characterIdSchema, left: z.boolean(), potionsLeft: nonNegInt, downs: nonNegInt, revivesGiven: nonNegInt }))
      .min(1)
      .max(BALANCE.multiplayer.maxPartySize),
  })
  .strict();

export type ExpeditionResultInput = z.infer<typeof expeditionResultSchema>;
