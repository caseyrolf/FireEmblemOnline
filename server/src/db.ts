import { PrismaClient } from "@prisma/client";
import type { GameState } from "../../shared/game.js";

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
}
