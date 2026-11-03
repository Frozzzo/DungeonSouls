-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('NORMAL', 'HARD', 'NIGHTMARE', 'ABYSS');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ItemRarity" AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC');

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "highestFloorCleared" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DungeonRun" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'NORMAL',
    "seed" INTEGER NOT NULL,
    "simVersion" INTEGER NOT NULL,
    "levelAtStart" INTEGER NOT NULL,
    "allocatedAtStart" JSONB NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'ACTIVE',
    "rejectedSubmissions" INTEGER NOT NULL DEFAULT 0,
    "outcome" JSONB,
    "ticks" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "DungeonRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardGrant" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL,
    "levelsGained" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemInstance" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "baseItemId" TEXT NOT NULL,
    "rarity" "ItemRarity" NOT NULL,
    "itemLevel" INTEGER NOT NULL,
    "affixes" JSONB NOT NULL,
    "sourceRewardGrantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DungeonRun_characterId_status_idx" ON "DungeonRun"("characterId", "status");

-- CreateIndex
CREATE INDEX "DungeonRun_characterId_startedAt_idx" ON "DungeonRun"("characterId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardGrant_idempotencyKey_key" ON "RewardGrant"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "RewardGrant_runId_key" ON "RewardGrant"("runId");

-- CreateIndex
CREATE INDEX "RewardGrant_characterId_idx" ON "RewardGrant"("characterId");

-- CreateIndex
CREATE INDEX "ItemInstance_characterId_createdAt_idx" ON "ItemInstance"("characterId", "createdAt");

-- AddForeignKey
ALTER TABLE "DungeonRun" ADD CONSTRAINT "DungeonRun_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DungeonRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_sourceRewardGrantId_fkey" FOREIGN KEY ("sourceRewardGrantId") REFERENCES "RewardGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
