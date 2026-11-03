-- CreateEnum
CREATE TYPE "SkillSlot" AS ENUM ('BASIC_1', 'BASIC_2', 'BASIC_3', 'ULTIMATE');

-- CreateEnum
CREATE TYPE "EquipmentSlotId" AS ENUM ('WEAPON', 'HELMET', 'CHEST', 'GLOVES', 'LEGS', 'BOOTS', 'ACCESSORY_1', 'ACCESSORY_2');

-- AlterTable
ALTER TABLE "DungeonRun" ADD COLUMN     "gearAtStart" JSONB,
ADD COLUMN     "loadoutAtStart" JSONB,
ADD COLUMN     "potionsAtStart" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CharacterSkill" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterLoadoutSlot" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "slot" "SkillSlot" NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "CharacterLoadoutSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentSlot" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "slot" "EquipmentSlotId" NOT NULL,
    "itemInstanceId" TEXT NOT NULL,

    CONSTRAINT "EquipmentSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumableStack" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "consumableId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ConsumableStack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialStack" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MaterialStack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterSkill_characterId_skillId_key" ON "CharacterSkill"("characterId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterLoadoutSlot_characterId_slot_key" ON "CharacterLoadoutSlot"("characterId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterLoadoutSlot_characterId_skillId_key" ON "CharacterLoadoutSlot"("characterId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentSlot_itemInstanceId_key" ON "EquipmentSlot"("itemInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentSlot_characterId_slot_key" ON "EquipmentSlot"("characterId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumableStack_characterId_consumableId_key" ON "ConsumableStack"("characterId", "consumableId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialStack_characterId_materialId_key" ON "MaterialStack"("characterId", "materialId");

-- AddForeignKey
ALTER TABLE "CharacterSkill" ADD CONSTRAINT "CharacterSkill_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterLoadoutSlot" ADD CONSTRAINT "CharacterLoadoutSlot_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentSlot" ADD CONSTRAINT "EquipmentSlot_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentSlot" ADD CONSTRAINT "EquipmentSlot_itemInstanceId_fkey" FOREIGN KEY ("itemInstanceId") REFERENCES "ItemInstance"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumableStack" ADD CONSTRAINT "ConsumableStack_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialStack" ADD CONSTRAINT "MaterialStack_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Garantías en la base de datos además de las del servicio.
-- (ON DELETE NO ACTION en EquipmentSlot→ItemInstance: no se puede borrar un objeto equipado, pero
-- borrar el personaje elimina en la misma sentencia sus huecos y sus objetos.)
ALTER TABLE "CharacterSkill" ADD CONSTRAINT "CharacterSkill_rank_check" CHECK ("rank" >= 1);
ALTER TABLE "ConsumableStack" ADD CONSTRAINT "ConsumableStack_quantity_check" CHECK ("quantity" >= 0);
ALTER TABLE "MaterialStack" ADD CONSTRAINT "MaterialStack_quantity_check" CHECK ("quantity" >= 0);

-- Personajes existentes: habilidad inicial de su clase (rango 1) equipada en el primer hueco,
-- el punto de habilidad inicial y las pociones iniciales (los mismos valores que src/game).
INSERT INTO "CharacterSkill" ("id", "characterId", "skillId", "rank", "updatedAt")
SELECT gen_random_uuid()::text, c."id",
       CASE c."class" WHEN 'TANK' THEN 'tank-bulwark' WHEN 'DPS' THEN 'dps-whirlwind' ELSE 'healer-mending-light' END,
       1, CURRENT_TIMESTAMP
FROM "Character" c;

INSERT INTO "CharacterLoadoutSlot" ("id", "characterId", "slot", "skillId")
SELECT gen_random_uuid()::text, c."id", 'BASIC_1',
       CASE c."class" WHEN 'TANK' THEN 'tank-bulwark' WHEN 'DPS' THEN 'dps-whirlwind' ELSE 'healer-mending-light' END
FROM "Character" c;

INSERT INTO "ConsumableStack" ("id", "characterId", "consumableId", "quantity")
SELECT gen_random_uuid()::text, c."id", 'HEALTH_POTION', 3 FROM "Character" c;

UPDATE "Character" SET "skillPoints" = "skillPoints" + 1;

-- Los intentos en curso se empezaron con las reglas anteriores: se abandonan.
UPDATE "DungeonRun" SET "status" = 'ABANDONED', "endedAt" = CURRENT_TIMESTAMP WHERE "status" = 'ACTIVE';
