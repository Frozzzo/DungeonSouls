-- CreateEnum
CREATE TYPE "PartyStatus" AS ENUM ('OPEN', 'IN_EXPEDITION', 'CLOSED');

-- CreateEnum
CREATE TYPE "ExpeditionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DEFEATED', 'ABANDONED');

-- AlterTable
ALTER TABLE "DungeonRun" ADD COLUMN     "expeditionId" TEXT,
ADD COLUMN     "partySlot" INTEGER;

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "leaderUserId" TEXT NOT NULL,
    "status" "PartyStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyMember" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expedition" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'NORMAL',
    "seed" INTEGER NOT NULL,
    "simVersion" INTEGER NOT NULL,
    "playerCount" INTEGER NOT NULL,
    "status" "ExpeditionStatus" NOT NULL DEFAULT 'ACTIVE',
    "result" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Expedition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Party_code_key" ON "Party"("code");

-- CreateIndex
CREATE INDEX "Party_status_idx" ON "Party"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PartyMember_userId_key" ON "PartyMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyMember_characterId_key" ON "PartyMember"("characterId");

-- CreateIndex
CREATE INDEX "PartyMember_partyId_idx" ON "PartyMember"("partyId");

-- CreateIndex
CREATE INDEX "Expedition_partyId_status_idx" ON "Expedition"("partyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DungeonRun_expeditionId_partySlot_key" ON "DungeonRun"("expeditionId", "partySlot");

-- CreateIndex
CREATE UNIQUE INDEX "DungeonRun_expeditionId_characterId_key" ON "DungeonRun"("expeditionId", "characterId");

-- AddForeignKey
ALTER TABLE "DungeonRun" ADD CONSTRAINT "DungeonRun_expeditionId_fkey" FOREIGN KEY ("expeditionId") REFERENCES "Expedition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyMember" ADD CONSTRAINT "PartyMember_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyMember" ADD CONSTRAINT "PartyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyMember" ADD CONSTRAINT "PartyMember_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expedition" ADD CONSTRAINT "Expedition_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Restricciones que Prisma no expresa.
ALTER TABLE "DungeonRun" ADD CONSTRAINT "DungeonRun_partySlot_check" CHECK ("partySlot" IS NULL OR ("partySlot" >= 0 AND "partySlot" < 4));
ALTER TABLE "Expedition" ADD CONSTRAINT "Expedition_playerCount_check" CHECK ("playerCount" BETWEEN 1 AND 4);

-- SIM_VERSION pasa a 3 (reanimación, conexión, escalado por grupo): los intentos activos ya no se pueden validar.
UPDATE "DungeonRun" SET "status" = 'ABANDONED', "endedAt" = CURRENT_TIMESTAMP WHERE "status" = 'ACTIVE';
