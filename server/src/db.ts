import { PrismaClient } from "@prisma/client";
import type { ActiveGameSummary, AuthUser, CampaignRecord, GameState, ProfileCharacterRecord, SkillId, UnitClass } from "../../shared/game.js";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function mapAuthUser(user: {
  id: string;
  email: string;
  displayName: string;
  wins: number;
  losses: number;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    wins: user.wins,
    losses: user.losses
  };
}

function mapProfileCharacter(character: { id: string; name: string; className: string; portraitUrl?: string | null; skillId?: string | null }): ProfileCharacterRecord {
  return {
    id: character.id,
    name: character.name,
    className: character.className as UnitClass,
    portraitUrl: character.portraitUrl ?? undefined,
    skillId: (character.skillId as SkillId | null) ?? undefined
  };
}

function mapProfileCampaign(campaign: {
  id: string;
  name: string;
  allowedPlayerUnits: number;
  campaignJson: string;
}): CampaignRecord {
  const parsed = JSON.parse(campaign.campaignJson) as CampaignRecord;
  const maps = parsed.maps.map((map) => ({
    ...map,
    enemies: map.enemies.map((enemy) => ({
      ...enemy,
      behavior: (enemy.behavior === "hold" ? "hold" : "advance") as "hold" | "advance"
    }))
  }));
  return {
    ...parsed,
    maps,
    id: campaign.id,
    name: campaign.name,
    allowedPlayerUnits: campaign.allowedPlayerUnits
  };
}

function describeObjective(state: GameState): string {
  if (state.map.objective.type === "defend") {
    return `Defend for ${state.map.objective.turnLimit ?? 0} turns`;
  }
  if (state.map.objective.type === "arrive") {
    return "Reach the goal";
  }
  return "Route the enemy";
}

export async function saveRoomState(state: GameState) {
  await prisma.gameRoom.upsert({
    where: { roomCode: state.roomCode },
    update: {
      hostId: state.hostId,
      stateJson: JSON.stringify(state)
    },
    create: {
      roomCode: state.roomCode,
      hostId: state.hostId,
      stateJson: JSON.stringify(state)
    }
  });
}

export async function loadRoomState(roomCode: string) {
  const record = await prisma.gameRoom.findUnique({
    where: { roomCode: roomCode.toUpperCase() }
  });

  if (!record) {
    return null;
  }

  return JSON.parse(record.stateJson) as GameState;
}

export async function listActiveGamesForUser(userId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ roomCode: string; stateJson: string }>>(
    `SELECT "roomCode", "stateJson" FROM "GameRoom" ORDER BY "updatedAt" DESC`
  );

  const summaries: ActiveGameSummary[] = [];

  for (const row of rows) {
    const state = JSON.parse(row.stateJson) as GameState;
    if (state.status === "complete") {
      continue;
    }
    const player = state.players.find((entry) => entry.userId === userId);
    if (!player) {
      continue;
    }

    summaries.push({
      roomCode: state.roomCode,
      status: state.status,
      phase: state.phase,
      turnCount: state.turnCount,
      playerId: player.id,
      playerName: player.name,
      isHost: player.isHost,
      playerCount: state.players.length,
      objective: describeObjective(state),
      campaignName: state.campaign?.name ?? undefined
    });
  }

  return summaries;
}

export async function createUserAccount(input: {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  displayName: string;
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "User" ("id", "email", "passwordHash", "salt", "displayName") VALUES (?, ?, ?, ?, ?)`,
    input.id,
    input.email,
    input.passwordHash,
    input.salt,
    input.displayName
  );

  return {
    id: input.id,
    email: input.email,
    displayName: input.displayName,
    wins: 0,
    losses: 0
  };
}

export async function findUserByEmail(email: string) {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      email: string;
      passwordHash: string;
      salt: string;
      displayName: string;
      wins: number;
      losses: number;
    }>
  >(`SELECT "id", "email", "passwordHash", "salt", "displayName", "wins", "losses" FROM "User" WHERE "email" = ? LIMIT 1`, email.toLowerCase());
  return rows[0] ?? null;
}

export async function findUserById(id: string) {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; email: string; displayName: string; wins: number; losses: number }>
  >(`SELECT "id", "email", "displayName", "wins", "losses" FROM "User" WHERE "id" = ? LIMIT 1`, id);
  const user = rows[0];
  return user ? mapAuthUser(user) : null;
}

export async function createAuthSession(input: { token: string; userId: string; expiresAt: Date }) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AuthSession" ("token", "userId", "expiresAt") VALUES (?, ?, ?)`,
    input.token,
    input.userId,
    input.expiresAt.toISOString()
  );
}

export async function deleteAuthSession(token: string) {
  await prisma.$executeRawUnsafe(`DELETE FROM "AuthSession" WHERE "token" = ?`, token);
}

export async function getSessionUser(token: string) {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      token: string;
      expiresAt: string;
      id: string;
      email: string;
      displayName: string;
      wins: number;
      losses: number;
    }>
  >(
    `SELECT s."token", s."expiresAt", u."id", u."email", u."displayName", u."wins", u."losses"
     FROM "AuthSession" s
     INNER JOIN "User" u ON u."id" = s."userId"
     WHERE s."token" = ?
     LIMIT 1`,
    token
  );
  const session = rows[0];

  if (!session) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await deleteAuthSession(token);
    return null;
  }

  return {
    token: session.token,
    user: mapAuthUser(session)
  };
}

export async function listProfileCharacters(userId: string) {
  const characters = await prisma.$queryRawUnsafe<
    Array<{ id: string; name: string; className: string; portraitUrl: string | null; skillId: string | null }>
  >(
    `SELECT "id", "name", "className", "portraitUrl", "skillId"
     FROM "ProfileCharacter"
     WHERE "userId" = ?
     ORDER BY "createdAt" ASC`,
    userId
  );
  return characters.map(mapProfileCharacter);
}

export async function listProfileCampaigns(userId: string) {
  const campaigns = await prisma.$queryRawUnsafe<
    Array<{ id: string; name: string; allowedPlayerUnits: number; campaignJson: string }>
  >(
    `SELECT "id", "name", "allowedPlayerUnits", "campaignJson"
     FROM "ProfileCampaign"
     WHERE "userId" = ?
     ORDER BY "updatedAt" DESC`,
    userId
  );
  return campaigns.map(mapProfileCampaign);
}

export async function createProfileCharacter(input: {
  id: string;
  userId: string;
  name: string;
  className: UnitClass;
  portraitUrl?: string;
  skillId?: SkillId;
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProfileCharacter" ("id", "userId", "name", "className", "portraitUrl", "skillId") VALUES (?, ?, ?, ?, ?, ?)`,
    input.id,
    input.userId,
    input.name,
    input.className,
    input.portraitUrl ?? null,
    input.skillId ?? null
  );
  return {
    id: input.id,
    name: input.name,
    className: input.className,
    portraitUrl: input.portraitUrl,
    skillId: input.skillId
  };
}

export async function createProfileCampaign(input: {
  id: string;
  userId: string;
  name: string;
  allowedPlayerUnits: number;
  campaignJson: string;
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProfileCampaign" ("id", "userId", "name", "allowedPlayerUnits", "campaignJson") VALUES (?, ?, ?, ?, ?)`,
    input.id,
    input.userId,
    input.name,
    input.allowedPlayerUnits,
    input.campaignJson
  );
  return mapProfileCampaign({
    id: input.id,
    name: input.name,
    allowedPlayerUnits: input.allowedPlayerUnits,
    campaignJson: input.campaignJson
  });
}

export async function updateProfileCampaign(input: {
  id: string;
  userId: string;
  name: string;
  allowedPlayerUnits: number;
  campaignJson: string;
}) {
  const updatedRows = await prisma.$executeRawUnsafe(
    `UPDATE "ProfileCampaign"
     SET "name" = ?, "allowedPlayerUnits" = ?, "campaignJson" = ?, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = ? AND "userId" = ?`,
    input.name,
    input.allowedPlayerUnits,
    input.campaignJson,
    input.id,
    input.userId
  );

  if (updatedRows === 0) {
    return null;
  }

  return mapProfileCampaign({
    id: input.id,
    name: input.name,
    allowedPlayerUnits: input.allowedPlayerUnits,
    campaignJson: input.campaignJson
  });
}

export async function deleteProfileCharacter(id: string, userId: string) {
  await prisma.$executeRawUnsafe(`DELETE FROM "ProfileCharacter" WHERE "id" = ? AND "userId" = ?`, id, userId);
}

export async function deleteProfileCampaign(id: string, userId: string) {
  await prisma.$executeRawUnsafe(`DELETE FROM "ProfileCampaign" WHERE "id" = ? AND "userId" = ?`, id, userId);
}

export async function recordRoomOutcome(winnerUserIds: string[], loserUserIds: string[]) {
  if (winnerUserIds.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "wins" = "wins" + 1 WHERE "id" IN (${winnerUserIds.map(() => "?").join(", ")})`,
      ...winnerUserIds
    );
  }

  if (loserUserIds.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "losses" = "losses" + 1 WHERE "id" IN (${loserUserIds.map(() => "?").join(", ")})`,
      ...loserUserIds
    );
  }
}

export async function ensureDatabase() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GameRoom" (
      "roomCode" TEXT NOT NULL PRIMARY KEY,
      "hostId" TEXT NOT NULL,
      "stateJson" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL UNIQUE,
      "passwordHash" TEXT NOT NULL,
      "salt" TEXT NOT NULL,
      "displayName" TEXT NOT NULL,
      "wins" INTEGER NOT NULL DEFAULT 0,
      "losses" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AuthSession" (
      "token" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "expiresAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AuthSession_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProfileCharacter" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "className" TEXT NOT NULL,
      "portraitUrl" TEXT,
      "skillId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ProfileCharacter_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProfileCampaign" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "allowedPlayerUnits" INTEGER NOT NULL,
      "campaignJson" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ProfileCampaign_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  const profileColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("ProfileCharacter")`);
  if (!profileColumns.some((column) => column.name === "portraitUrl")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ProfileCharacter" ADD COLUMN "portraitUrl" TEXT`);
  }
  if (!profileColumns.some((column) => column.name === "skillId")) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ProfileCharacter" ADD COLUMN "skillId" TEXT`);
  }

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AuthSession_userId_idx" ON "AuthSession"("userId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProfileCharacter_userId_idx" ON "ProfileCharacter"("userId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ProfileCampaign_userId_idx" ON "ProfileCampaign"("userId")`);
}
