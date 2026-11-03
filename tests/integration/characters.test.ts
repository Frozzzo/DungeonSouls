import { beforeEach, describe, expect, it } from "vitest";
import { BALANCE } from "@/game/balance";
import { getClassDefinition } from "@/game/classes/definitions";
import { registerSchema } from "@/lib/validation/auth";
import { createCharacterSchema } from "@/lib/validation/character";
import { registerUser } from "@/server/auth/service";
import {
  allocateStats,
  createCharacter,
  deleteCharacter,
  getOwnedCharacter,
  listCharacters,
} from "@/server/characters/service";
import { db } from "@/server/db";
import { resetDatabase, uniqueUser } from "./helpers";

let ipCounter = 0;
async function newUser() {
  ipCounter += 1;
  return (await registerUser(registerSchema.parse(uniqueUser()), `9.9.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`)).userId;
}
const charInput = (name: string, classId: "TANK" | "DPS" | "HEALER" = "TANK") => createCharacterSchema.parse({ name, classId });

beforeEach(resetDatabase);

describe("creación de personajes", () => {
  it("crea un personaje de nivel 1 con estadísticas de su clase y puntos iniciales", async () => {
    const userId = await newUser();
    const c = await createCharacter(userId, charInput("Brunhilda", "TANK"));
    expect(c).toMatchObject({ level: 1, experience: 0, classId: "TANK", statPoints: BALANCE.progression.startingStatPoints });
    expect(c.stats.attributes).toEqual(getClassDefinition("TANK").baseAttributes);
    expect(await listCharacters(userId)).toHaveLength(1);
  });

  it("los nombres son únicos sin distinguir mayúsculas", async () => {
    const a = await newUser();
    const b = await newUser();
    await createCharacter(a, charInput("Morrigan"));
    await expect(createCharacter(b, charInput("MORRIGAN"))).rejects.toMatchObject({ code: "NAME_TAKEN" });
  });

  it("respeta el máximo de personajes por usuario, también con peticiones simultáneas", async () => {
    const userId = await newUser();
    const attempts = Array.from({ length: BALANCE.characters.maxPerUser + 3 }, (_, i) =>
      createCharacter(userId, charInput(`Heroe ${i}`)).then(
        () => "ok",
        (e) => e.code as string,
      ),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === "ok").length).toBeLessThanOrEqual(BALANCE.characters.maxPerUser);
    expect(await db.character.count({ where: { userId } })).toBeLessThanOrEqual(BALANCE.characters.maxPerUser);
  });
});

describe("propiedad de personajes", () => {
  it("un usuario no puede ver, modificar ni borrar personajes ajenos", async () => {
    const owner = await newUser();
    const intruder = await newUser();
    const c = await createCharacter(owner, charInput("Isolde", "HEALER"));

    expect(await getOwnedCharacter(intruder, c.id)).toBeNull();
    await expect(
      allocateStats(intruder, { characterId: c.id, strength: 1, dexterity: 0, intelligence: 0, vitality: 0 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteCharacter(intruder, c.id, "Isolde")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getOwnedCharacter(owner, c.id)).not.toBeNull();
  });
});

describe("asignación de estadísticas", () => {
  it("aplica los puntos y recalcula las estadísticas en el servidor", async () => {
    const userId = await newUser();
    const c = await createCharacter(userId, charInput("Kaelen", "DPS"));
    const after = await allocateStats(userId, { characterId: c.id, strength: 0, dexterity: 3, intelligence: 0, vitality: 2 });
    expect(after.statPoints).toBe(c.statPoints - 5);
    expect(after.allocated).toEqual({ strength: 0, dexterity: 3, intelligence: 0, vitality: 2 });
    expect(after.stats.attributes.dexterity).toBe(c.stats.attributes.dexterity + 3);
    expect(after.stats.derived.maxHealth).toBeGreaterThan(c.stats.derived.maxHealth);
  });

  it("no permite gastar más puntos de los disponibles", async () => {
    const userId = await newUser();
    const c = await createCharacter(userId, charInput("Ysolde"));
    await expect(
      allocateStats(userId, { characterId: c.id, strength: c.statPoints + 1, dexterity: 0, intelligence: 0, vitality: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_ALLOCATION" });
  });

  it("peticiones simultáneas no pueden gastar los mismos puntos dos veces", async () => {
    const userId = await newUser();
    const c = await createCharacter(userId, charInput("Gareth"));
    const all = { characterId: c.id, strength: c.statPoints, dexterity: 0, intelligence: 0, vitality: 0 };
    const results = await Promise.allSettled([allocateStats(userId, all), allocateStats(userId, all), allocateStats(userId, all)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const fresh = await getOwnedCharacter(userId, c.id);
    expect(fresh?.statPoints).toBe(0);
    expect(fresh?.allocated.strength).toBe(c.statPoints);
  });
});

describe("borrado de personajes", () => {
  it("exige el nombre exacto como confirmación", async () => {
    const userId = await newUser();
    const c = await createCharacter(userId, charInput("Aldric"));
    await expect(deleteCharacter(userId, c.id, "aldric")).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
    await deleteCharacter(userId, c.id, "Aldric");
    expect(await getOwnedCharacter(userId, c.id)).toBeNull();
  });
});
