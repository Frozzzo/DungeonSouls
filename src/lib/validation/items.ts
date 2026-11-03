import { z } from "zod";
import { AFFIX_IDS, AFFIXES } from "@/game/items/affixes";

/** Afijos guardados en ItemInstance.affixes. Se validan al escribir y al leer. */
export const affixesSchema = z
  .array(
    z.object({
      id: z.enum(AFFIX_IDS),
      value: z.number().int().min(1),
    }),
  )
  .max(6)
  .refine((list) => list.every((a) => a.value <= AFFIXES[a.id].max), "Valor de afijo fuera de rango")
  .refine((list) => new Set(list.map((a) => a.id)).size === list.length, "Afijos repetidos");
