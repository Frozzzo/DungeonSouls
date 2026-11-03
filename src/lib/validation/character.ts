import { z } from "zod";
import { BALANCE } from "@/game/balance";
import { CLASS_IDS } from "@/game/types";

const { nameMinLength, nameMaxLength } = BALANCE.characters;

export const characterNameSchema = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(nameMinLength, `El nombre debe tener al menos ${nameMinLength} caracteres`)
      .max(nameMaxLength, `El nombre no puede superar ${nameMaxLength} caracteres`)
      .regex(/^[\p{L}][\p{L}\p{N} _-]*$/u, "Empieza por una letra; usa letras, números, espacios, - o _"),
  );

export const createCharacterSchema = z.object({
  name: characterNameSchema,
  classId: z.enum(CLASS_IDS, { message: "Elige una clase válida" }),
});

const points = z.coerce.number().int("Debe ser un entero").min(0).max(BALANCE.attributes.maxAllocatedPerAttribute);

export const allocateStatsSchema = z.object({
  characterId: z.string().min(1).max(64),
  strength: points,
  dexterity: points,
  intelligence: points,
  vitality: points,
});

export const characterIdSchema = z.string().min(1).max(64);

export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;
export type AllocateStatsInput = z.infer<typeof allocateStatsSchema>;
