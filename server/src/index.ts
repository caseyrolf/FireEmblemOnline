import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
  calculateDamage,
  calculateHitChance,
  calculateCritChance,
  canUnitAttackAtDistance,
  checkIfDoubles,
  CLASS_SKILLS,
  CLASS_GROWTH_RATES,
  CLASS_TEMPLATES,
  getPromotedClass,
  getPortraitForUnit,
  getTerrainDefense,
  isStaffClass,
  isDancerClass,
  PROMOTION_BONUSES,
  type AuthUser,
  type BaseUnitClass,
  type CampaignEnemyRecord,
  type CampaignMapRecord,
  type CampaignObjective,
  type CampaignRecord,
  type CharacterDraft,
  type ClientToServerEvents,
  type CombatContext,
  type CombatLogEntry,
  type GameMap,
  type GameState,
  type Item,
  type JoinRoomResponse,
  type PlayerPresence,
  type Position,
  type SkillId,
  type ServerToClientEvents,
  type TerrainTile,
  type Unit,
  type UnitClass,
  type Weapon,
  WEAPONS,
  ITEMS
} from "../../shared/game.js";
import { createId, hashPassword, readBearerToken, verifyPassword } from "./auth.js";
import {
  listActiveGamesForUser,
  createAuthSession,
  createProfileCampaign,
  createProfileCharacter,
  createUserAccount,
  deleteAuthSession,
  deleteProfileCampaign,
  deleteProfileCharacter,
  ensureDatabase,
  findUserByEmail,
  getSessionUser,
  listProfileCampaigns,
  listProfileCharacters,
  loadRoomState,
  recordRoomOutcome,
  saveRoomState,
  updateProfileCampaign
} from "./db.js";

type Room = {
  state: GameState;
  sockets: Map<string, string>;
};

type AuthedRequest = express.Request & {
  authUser?: AuthUser;
  authToken?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, "../../../client");
const hasClientBuild = existsSync(path.join(clientDistPath, "index.html"));

const app = express();
app.use(cors());
app.use(express.json());

if (hasClientBuild) {
  app.use(express.static(clientDistPath));
}

async function authenticateRequest(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const token = readBearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ message: "Missing auth token." });
    return;
  }

  const session = await getSessionUser(token);
  if (!session) {
    res.status(401).json({ message: "Session expired or invalid." });
    return;
  }

  req.authUser = session.user;
  req.authToken = session.token;
  next();
}

function sanitizeDisplayName(value: string) {
  return value.trim().slice(0, 20);
}

function sanitizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function authPayload(user: AuthUser, token: string) {
  return { token, user };
}

function isTerrainType(value: string): value is TerrainTile["type"] {
  return value === "grass" || value === "forest" || value === "fort" || value === "mountain" || value === "goal";
}

function getWeaponTypesForClass(className: UnitClass): Weapon["type"][] {
  switch (className) {
    case "Lord":
    case "Great Lord":
    case "Mercenary":
    case "Hero":
    case "Dancer":
    case "Diva":
      return ["Sword"];
    case "Knight":
    case "General":
      return ["Lance"];
    case "Brigand":
    case "Warrior":
      return ["Axe"];
    case "Archer":
    case "Sniper":
      return ["Bow"];
    case "Mage":
    case "Sage":
      return ["Magic Tome"];
    case "Cleric":
    case "Bishop":
      return ["Staff"];
    default:
      return [];
  }
}

function sanitizeCampaignName(value: string) {
  return value.trim().slice(0, 40);
}

function sanitizeCampaignRecord(input: unknown, existingId?: string): CampaignRecord | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const raw = input as Partial<CampaignRecord>;
  const name = sanitizeCampaignName(String(raw.name ?? ""));
  const allowedPlayerUnits = Number(raw.allowedPlayerUnits ?? 0);
  const maps = Array.isArray(raw.maps) ? raw.maps : [];

  if (!name || !Number.isInteger(allowedPlayerUnits) || allowedPlayerUnits < 1 || allowedPlayerUnits > 12) {
    return null;
  }
  if (maps.length < 1 || maps.length > 12) {
    return null;
  }

  const sanitizedMaps: CampaignMapRecord[] = [];
  for (let index = 0; index < maps.length; index += 1) {
    const map = maps[index] as Partial<CampaignMapRecord>;
    const width = Number(map.width ?? 0);
    const height = Number(map.height ?? 0);
    const mapName = sanitizeCampaignName(String(map.name ?? `Map ${index + 1}`));
    const rawTiles = Array.isArray(map.tiles) ? map.tiles : [];
    const rawStarts = Array.isArray(map.playerStarts) ? map.playerStarts : [];
    const rawEnemies = Array.isArray(map.enemies) ? map.enemies : [];
    const rawObjective = (map.objective ?? {}) as Partial<CampaignObjective>;

    if (!mapName || !Number.isInteger(width) || !Number.isInteger(height) || width < 4 || height < 4 || width > 16 || height > 16) {
      return null;
    }
    if (rawTiles.length !== height || rawTiles.some((row) => !Array.isArray(row) || row.length !== width)) {
      return null;
    }

    const tiles = rawTiles.map((row) =>
      row.map((tile) => {
        const value = String(tile ?? "grass");
        if (!isTerrainType(value)) {
          throw new Error("Invalid terrain.");
        }
        return value;
      })
    );

    const playerStarts = rawStarts
      .map((start) => ({ x: Number(start?.x ?? -1), y: Number(start?.y ?? -1) }))
      .filter((start) => Number.isInteger(start.x) && Number.isInteger(start.y) && start.x >= 0 && start.y >= 0 && start.x < width && start.y < height);
    const uniqueStartKeys = new Set(playerStarts.map((start) => `${start.x},${start.y}`));
    if (playerStarts.length !== uniqueStartKeys.size || playerStarts.length === 0) {
      return null;
    }

    const objectiveType = rawObjective.type;
    if (objectiveType !== "route" && objectiveType !== "arrive" && objectiveType !== "defend") {
      return null;
    }

    const objective: CampaignObjective = { type: objectiveType };
    if (objectiveType === "arrive") {
      const target = {
        x: Number(rawObjective.target?.x ?? -1),
        y: Number(rawObjective.target?.y ?? -1)
      };
      if (!Number.isInteger(target.x) || !Number.isInteger(target.y) || target.x < 0 || target.y < 0 || target.x >= width || target.y >= height) {
        return null;
      }
      objective.target = target;
      tiles[target.y][target.x] = "goal";
    }
    if (objectiveType === "defend") {
      const turnLimit = Number(rawObjective.turnLimit ?? 0);
      if (!Number.isInteger(turnLimit) || turnLimit < 1 || turnLimit > 50) {
        return null;
      }
      objective.turnLimit = turnLimit;
    }

    const enemies: CampaignEnemyRecord[] = [];
    for (const rawEnemy of rawEnemies) {
      const className = String(rawEnemy?.className ?? "") as UnitClass;
      const weaponId = String(rawEnemy?.weaponId ?? "");
      const weapon = WEAPONS.find((entry) => entry.id === weaponId);
      const level = Number(rawEnemy?.level ?? 1);
      const turn = Number(rawEnemy?.turn ?? 1);
      const position = {
        x: Number(rawEnemy?.position?.x ?? -1),
        y: Number(rawEnemy?.position?.y ?? -1)
      };
      const nameValue = sanitizeDisplayName(String(rawEnemy?.name ?? "Enemy"));

      if (!(className in CLASS_TEMPLATES) || !weapon || !getWeaponTypesForClass(className).includes(weapon.type)) {
        return null;
      }
      if (!Number.isInteger(level) || level < 1 || level > 20 || !Number.isInteger(turn) || turn < 1 || turn > 50) {
        return null;
      }
      if (!Number.isInteger(position.x) || !Number.isInteger(position.y) || position.x < 0 || position.y < 0 || position.x >= width || position.y >= height) {
        return null;
      }
      enemies.push({
        id: String(rawEnemy?.id ?? createId()),
        name: nameValue || className,
        className,
        level,
        weaponId,
        position,
        turn,
        behavior: rawEnemy?.behavior === "hold" ? "hold" : "advance"
      });
    }

    sanitizedMaps.push({
      id: String(map.id ?? createId()),
      name: mapName,
      width,
      height,
      tiles,
      playerStarts,
      objective,
      enemies
    });
  }

  return {
    id: existingId ?? String(raw.id ?? createId()),
    name,
    allowedPlayerUnits,
    maps: sanitizedMaps
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", async (req, res) => {
  const email = sanitizeEmail(String(req.body?.email ?? ""));
  const password = String(req.body?.password ?? "");
  const displayName = sanitizeDisplayName(String(req.body?.displayName ?? ""));

  if (!email || !password || !displayName) {
    res.status(400).json({ message: "Email, password, and display name are required." });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ message: "Password must be at least 6 characters." });
    return;
  }

  if (await findUserByEmail(email)) {
    res.status(409).json({ message: "That email is already registered." });
    return;
  }

  const salt = createId(12);
  const user = await createUserAccount({
    id: createId(),
    email,
    salt,
    passwordHash: hashPassword(password, salt),
    displayName
  });
  const token = createId(24);
  await createAuthSession({
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_LENGTH_MS)
  });
  res.status(201).json(authPayload(user, token));
});

app.post("/api/auth/login", async (req, res) => {
  const email = sanitizeEmail(String(req.body?.email ?? ""));
  const password = String(req.body?.password ?? "");
  const user = await findUserByEmail(email);

  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
    res.status(401).json({ message: "Invalid email or password." });
    return;
  }

  const token = createId(24);
  await createAuthSession({
    token,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_LENGTH_MS)
  });
  res.json(
    authPayload(
      {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        wins: user.wins,
        losses: user.losses
      },
      token
    )
  );
});

app.get("/api/auth/me", authenticateRequest, async (req: AuthedRequest, res) => {
  res.json({ user: req.authUser });
});

app.post("/api/auth/logout", authenticateRequest, async (req: AuthedRequest, res) => {
  if (req.authToken) {
    await deleteAuthSession(req.authToken);
  }
  res.json({ ok: true });
});

app.get("/api/profile/characters", authenticateRequest, async (req: AuthedRequest, res) => {
  const records = await listProfileCharacters(req.authUser!.id);
  res.json({ characters: records });
});

app.post("/api/profile/characters", authenticateRequest, async (req: AuthedRequest, res) => {
  const name = sanitizeDisplayName(String(req.body?.name ?? ""));
  const className = String(req.body?.className ?? "") as UnitClass;
  const portraitUrl =
    typeof req.body?.portraitUrl === "string" && req.body.portraitUrl.startsWith("data:image/")
      ? req.body.portraitUrl
      : undefined;
  if (!name || !(className in CLASS_TEMPLATES)) {
    res.status(400).json({ message: "A valid character name and class are required." });
    return;
  }
  const requestedSkillId = typeof req.body?.skillId === "string" ? req.body.skillId : undefined;
  const skillId = requestedSkillId && CLASS_SKILLS[className].includes(requestedSkillId as SkillId)
    ? (requestedSkillId as SkillId)
    : undefined;

  const records = await listProfileCharacters(req.authUser!.id);
  if (records.length >= 12) {
    res.status(400).json({ message: "You can save up to 12 profile characters." });
    return;
  }

  const record = await createProfileCharacter({
    id: createId(),
    userId: req.authUser!.id,
    name,
    className,
    portraitUrl,
    skillId
  });
  res.status(201).json({ character: record });
});

app.delete("/api/profile/characters/:id", authenticateRequest, async (req: AuthedRequest, res) => {
  await deleteProfileCharacter(String(req.params.id), req.authUser!.id);
  res.json({ ok: true });
});

app.get("/api/profile/campaigns", authenticateRequest, async (req: AuthedRequest, res) => {
  const campaigns = await listProfileCampaigns(req.authUser!.id);
  res.json({ campaigns });
});

app.post("/api/profile/campaigns", authenticateRequest, async (req: AuthedRequest, res) => {
  let campaign: CampaignRecord | null = null;
  try {
    campaign = sanitizeCampaignRecord(req.body?.campaign);
  } catch {
    campaign = null;
  }

  if (!campaign) {
    res.status(400).json({ message: "Campaign data is invalid." });
    return;
  }

  const saved = await createProfileCampaign({
    id: campaign.id,
    userId: req.authUser!.id,
    name: campaign.name,
    allowedPlayerUnits: campaign.allowedPlayerUnits,
    campaignJson: JSON.stringify(campaign)
  });
  res.status(201).json({ campaign: saved });
});

app.put("/api/profile/campaigns/:id", authenticateRequest, async (req: AuthedRequest, res) => {
  let campaign: CampaignRecord | null = null;
  try {
    campaign = sanitizeCampaignRecord(req.body?.campaign, String(req.params.id));
  } catch {
    campaign = null;
  }

  if (!campaign) {
    res.status(400).json({ message: "Campaign data is invalid." });
    return;
  }

  const saved = await updateProfileCampaign({
    id: campaign.id,
    userId: req.authUser!.id,
    name: campaign.name,
    allowedPlayerUnits: campaign.allowedPlayerUnits,
    campaignJson: JSON.stringify(campaign)
  });

  if (!saved) {
    res.status(404).json({ message: "Campaign not found." });
    return;
  }

  res.json({ campaign: saved });
});

app.delete("/api/profile/campaigns/:id", authenticateRequest, async (req: AuthedRequest, res) => {
  await deleteProfileCampaign(String(req.params.id), req.authUser!.id);
  res.json({ ok: true });
});

app.get("/api/profile/games", authenticateRequest, async (req: AuthedRequest, res) => {
  const games = await listActiveGamesForUser(req.authUser!.id);
  res.json({ games });
});

if (hasClientBuild) {
  app.get(/^(?!\/api\/|\/socket\.io\/|\/health$).*/, (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: "*"
  }
});

const rooms = new Map<string, Room>();
const PLAYER_LIMIT = 8;
const CHARACTER_LIMIT = 8;
const SESSION_LENGTH_MS = 1000 * 60 * 60 * 24 * 30;
const CLERIC_HEAL_EXP = 15;
// Base XP values for combat (before level scaling)
const COMBAT_HIT_BASE_XP = 10;
const EXP_PER_LEVEL = 100;

/**
 * Calculate experience gain for a hit/damage (without kill).
 * Scales based on level difference: higher level enemies = more XP.
 * Formula: 10 + max(0, (enemy level - player level) * 2), min 1
 */
function calculateHitExp(playerLevel: number, enemyLevel: number): number {
  const levelDiff = enemyLevel - playerLevel;
  const baseExp = COMBAT_HIT_BASE_XP + levelDiff * 2;
  return Math.max(1, baseExp);
}

/**
 * Calculate experience gain for defeating an enemy.
 * Scales based on level difference: higher level enemies = more XP.
 * Formula: 30 + max(0, (enemy level - player level) * 5), capped at 100, min 1
 */
function calculateKillExp(playerLevel: number, enemyLevel: number): number {
  const levelDiff = enemyLevel - playerLevel;
  const baseExp = 30 + levelDiff * 5;
  return Math.max(1, Math.min(100, baseExp));
}
const CAMPAIGN_FINAL_CHAPTER = 7;
const CHAT_HISTORY_LIMIT = 80;

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizeChatText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function makeTile(type: TerrainTile["type"]): TerrainTile {
  switch (type) {
    case "forest":
      return { type, moveCost: 2, defense: 1, avoid: 20 };
    case "fort":
      return { type, moveCost: 2, defense: 2, avoid: 15 };
    case "mountain":
      return { type, moveCost: 99, defense: 0, avoid: 0 };
    case "goal":
      return { type, moveCost: 1, defense: 0, avoid: 0 };
    default:
      return { type: "grass", moveCost: 1, defense: 0, avoid: 0 };
  }
}

function getObjectiveLabel(state: GameState): string {
  const objective = state.map.objective;
  if (objective.type === "arrive") {
    return "Reach the goal";
  }
  if (objective.type === "defend") {
    return `Defend for ${objective.turnLimit} turns`;
  }
  return "Route the enemy";
}

function createMap(chapter: number = 1): GameMap {
  const parseLayout = (rows: string[]) =>
    rows.map((row) =>
      row.split("").map((tile): TerrainTile["type"] => {
        switch (tile) {
          case "F":
            return "forest";
          case "M":
            return "mountain";
          case "T":
            return "fort";
          case "G":
          default:
            return "grass";
        }
      })
    );

  if (chapter === 1) {
    const layout = parseLayout([
      "GGGGFGGGGG",
      "GGFFGGGGGG",
      "GGGGMGGGGG",
      "GGGGMMGGGG",
      "GTFGGGGFGF",
      "GGGGGGGGGG",
      "GGGGFGGGGG",
      "GGGFGGGGGG",
      "GGGGGGGGMM",
      "GGGFGGGMMM"
    ]);

    layout[1][9] = "goal";

    return {
      width: 10,
      height: 10,
      tiles: layout.map((row) => row.map((tile) => makeTile(tile))),
      playerStarts: [
        { x: 1, y: 9 },
        { x: 2, y: 9 },
        { x: 3, y: 9 },
        { x: 1, y: 8 },
        { x: 2, y: 8 },
        { x: 3, y: 8 }
      ],
      objective: {
        type: "route",
        target: { x: 9, y: 1 }
      }
    };
  } else if (chapter === 2) {
    // Chapter 2 map - mountain pass gauntlet
    const layout = parseLayout([
      "GGGGFGGGGM",
      "GFGGGGGGMM",
      "GGGGGGGMMM",
      "GGFGGGMMMM",
      "GGGGGGGMMM",
      "GGGGGGGGMM",
      "GGTFGGGGGM",
      "GGGGGGGGGG",
      "GGGGFGGGGG",
      "GGGFGGGGGG"
    ]);

    layout[1][9] = "goal";

    return {
      width: 10,
      height: 10,
      tiles: layout.map((row) => row.map((tile) => makeTile(tile))),
      playerStarts: [
        { x: 1, y: 9 },
        { x: 2, y: 9 },
        { x: 3, y: 9 },
        { x: 1, y: 8 },
        { x: 2, y: 8 },
        { x: 3, y: 8 }
      ],
      objective: {
        type: "route",
        target: { x: 9, y: 1 }
      }
    };
  } else if (chapter === 3) {
    // Chapter 3 map - forest ambush corridor
    const layout = parseLayout([
      "GGFFGGGGGG",
      "GFFFGGGFGG",
      "GGFGGGGFGG",
      "GGGGGFGGGG",
      "GGTTGGGGFG",
      "GGGGGGGGGG",
      "GGFGGGFFGG",
      "GGGFGGFGGG",
      "GGGGGGGGFG",
      "GGGGFGGGGG"
    ]);

    layout[1][9] = "goal";

    return {
      width: 10,
      height: 10,
      tiles: layout.map((row) => row.map((tile) => makeTile(tile))),
      playerStarts: [
        { x: 1, y: 9 },
        { x: 2, y: 9 },
        { x: 3, y: 9 },
        { x: 1, y: 8 },
        { x: 2, y: 8 },
        { x: 3, y: 8 }
      ],
      objective: {
        type: "route",
        target: { x: 9, y: 1 }
      }
    };
  } else if (chapter === 4) {
    // Chapter 4 map - fortress ridge assault
    const layout = parseLayout([
      "GGGMMMGGGG",
      "GGMMMMGGGG",
      "GGGMMMGGFG",
      "GGGGGGGFGG",
      "GTTGGGGGGG",
      "GGFGGGGGGG",
      "GGFGGGGFGG",
      "GGGGGGGGGG",
      "GGGGFGGGGG",
      "GGGFGGGGGG"
    ]);

    layout[1][9] = "goal";

    return {
      width: 10,
      height: 10,
      tiles: layout.map((row) => row.map((tile) => makeTile(tile))),
      playerStarts: [
        { x: 1, y: 9 },
        { x: 2, y: 9 },
        { x: 3, y: 9 },
        { x: 1, y: 8 },
        { x: 2, y: 8 },
        { x: 3, y: 8 }
      ],
      objective: {
        type: "route",
        target: { x: 9, y: 1 }
      }
    };
  } else if (chapter === 5) {
    // Chapter 5 map - final keep approach
    const layout = parseLayout([
      "GGGMMMGGGG",
      "GGMMMMGGGG",
      "GMMMMMMGGG",
      "GGGMMMGFGG",
      "GTTGGGGFGG",
      "GGFGGGGGGG",
      "GGFGGGGGFG",
      "GGGGGGGFGG",
      "GGGGFGGGGG",
      "GGGFGGGGGG"
    ]);

    layout[1][9] = "goal";

    return {
      width: 10,
      height: 10,
      tiles: layout.map((row) => row.map((tile) => makeTile(tile))),
      playerStarts: [
        { x: 1, y: 9 },
        { x: 2, y: 9 },
        { x: 3, y: 9 },
        { x: 1, y: 8 },
        { x: 2, y: 8 },
        { x: 3, y: 8 }
      ],
      objective: {
        type: "route",
        target: { x: 9, y: 1 }
      }
    };
  } else if (chapter === 6) {
    // Chapter 6 map - hold the eastern keep for 15 turns
    const layout = parseLayout([
      "GGGGFFGGGG",
      "GGGFGGGFGG",
      "GGTTGGGGGG",
      "GGGGGGFGGG",
      "GGFGGGGGGG",
      "GGGGGGGGFG",
      "GGFGGGGGGG",
      "GGGGGGFGGG",
      "GGGFGGGGGG",
      "GGGGGGGGGG"
    ]);

    layout[2][2] = "goal";

    return {
      width: 10,
      height: 10,
      tiles: layout.map((row) => row.map((tile) => makeTile(tile))),
      playerStarts: [
        { x: 1, y: 9 },
        { x: 2, y: 9 },
        { x: 3, y: 9 },
        { x: 1, y: 8 },
        { x: 2, y: 8 },
        { x: 3, y: 8 }
      ],
      objective: {
        type: "defend",
        turnLimit: 15
      }
    };
  } else if (chapter === 7) {
    // Chapter 7 map - break through and arrive at the extraction point
    const layout = parseLayout([
      "GGGGGGGGGG",
      "GFGGGFFGGG",
      "GGGGFGGGGG",
      "GGTTGGGGFG",
      "GGGGGGGGGG",
      "GGFGGGFGGG",
      "GGGGGGGGGG",
      "GGGFGGGGGG",
      "GGGGGGFGGG",
      "GGGGGGGGGG"
    ]);

    layout[1][9] = "goal";

    return {
      width: 10,
      height: 10,
      tiles: layout.map((row) => row.map((tile) => makeTile(tile))),
      playerStarts: [
        { x: 1, y: 9 },
        { x: 2, y: 9 },
        { x: 3, y: 9 },
        { x: 1, y: 8 },
        { x: 2, y: 8 },
        { x: 3, y: 8 }
      ],
      objective: {
        type: "arrive",
        target: { x: 9, y: 1 }
      }
    };
  }
  // Default to chapter 1
  return createMap(1);
}

function buildGameMapFromCampaignMap(map: CampaignMapRecord): GameMap {
  const tiles = map.tiles.map((row) => row.map((tile) => makeTile(tile)));
  if (map.objective.type === "arrive" && map.objective.target) {
    tiles[map.objective.target.y][map.objective.target.x] = makeTile("goal");
  }

  return {
    width: map.width,
    height: map.height,
    tiles,
    playerStarts: map.playerStarts.map((position) => ({ ...position })),
    objective: clone(map.objective)
  };
}

function getCampaignChapterLimit(state: GameState) {
  return state.campaign?.maps.length ?? CAMPAIGN_FINAL_CHAPTER;
}

function getCampaignMapRecord(state: GameState) {
  return state.campaign?.maps[state.chapter - 1] ?? null;
}

function getMapForState(state: GameState) {
  const campaignMap = getCampaignMapRecord(state);
  if (campaignMap) {
    return buildGameMapFromCampaignMap(campaignMap);
  }
  return createMap(state.chapter);
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2, 10);
}

function initialState(roomCode: string, hostId: string, hostName: string, campaign: CampaignRecord | null = null): GameState {
  const chapter = 1;
  return {
    roomCode,
    status: "lobby",
    hostId,
    campaign,
    phase: "player",
    turnCount: 1,
    activePlayerId: null,
    players: [{ id: hostId, name: hostName, connected: true, isHost: true, gold: 0 }],
    characterDrafts: [],
    map: campaign ? buildGameMapFromCampaignMap(campaign.maps[0]) : createMap(chapter),
    units: [],
    selectedUnitId: null,
    highlights: [],
    logs: [{ id: cryptoRandomId(), text: `${hostName} opened room ${roomCode}.` }],
    chatMessages: [],
    winner: null,
    outcomeRecorded: false,
    chapter,
    mapStartPlayerUnits: [],
    latestCombatEvent: null,
    latestLevelUpEvent: null,
    latestPromotionEvent: null
  };
}

function getRoom(roomCode: string) {
  return rooms.get(roomCode.toUpperCase());
}

async function emitState(room: Room) {
  if (room.state.status === "complete" && !room.state.outcomeRecorded) {
    const playerUserIds = [...new Set(room.state.players
      .map((player) => player.userId)
      .filter((value): value is string => Boolean(value)))];
    if (playerUserIds.length > 0) {
      if (room.state.winner === "player") {
        await recordRoomOutcome(playerUserIds, []);
      } else if (room.state.winner === "enemy") {
        await recordRoomOutcome([], playerUserIds);
      }
    }
    room.state.outcomeRecorded = true;
  }
  await saveRoomState(room.state);
  io.to(room.state.roomCode).emit("stateUpdated", clone(room.state));
}

function migrateUnit(unit: any): Unit {
  if (!unit.inventory) {
    unit.inventory = { weapons: [], items: [] };
  }
  if (unit.equippedWeapon === undefined) {
    unit.equippedWeapon = null;
  }
  if (unit.team === "enemy" && unit.aiBehavior !== "hold" && unit.aiBehavior !== "advance") {
    unit.aiBehavior = "advance";
  }
  return unit as Unit;
}

function migratePlayer(player: any): PlayerPresence {
  if (player.gold === undefined) {
    player.gold = 0;
  }
  return player as PlayerPresence;
}

async function getOrLoadRoom(roomCode: string) {
  const normalizedCode = roomCode.toUpperCase();
  const existing = rooms.get(normalizedCode);
  if (existing) {
    return existing;
  }

  const persistedState = await loadRoomState(normalizedCode);
  if (!persistedState) {
    return null;
  }

  // Migrate units to add missing properties
  persistedState.units = persistedState.units.map(migrateUnit);
  // Migrate players to add missing properties
  persistedState.players = persistedState.players.map(migratePlayer);
  // Add chapter if missing
  if (!persistedState.chapter) {
    persistedState.chapter = 1;
  }
  if (!("campaign" in persistedState)) {
    (persistedState as any).campaign = null;
  }
  // Add map-start snapshot if missing (best effort for older saves).
  if (!("mapStartPlayerUnits" in persistedState) || !Array.isArray((persistedState as any).mapStartPlayerUnits)) {
    (persistedState as any).mapStartPlayerUnits = persistedState.units
      .filter((unit) => unit.team === "player")
      .map((unit) => clone(unit));
  }
  // Add latestCombatEvent if missing
  if (!('latestCombatEvent' in persistedState)) {
    (persistedState as any).latestCombatEvent = null;
  }
  // Add latestLevelUpEvent if missing
  if (!("latestLevelUpEvent" in persistedState)) {
    (persistedState as any).latestLevelUpEvent = null;
  }
  // Add latestPromotionEvent if missing
  if (!("latestPromotionEvent" in persistedState)) {
    (persistedState as any).latestPromotionEvent = null;
  }
  // Add chat history if missing
  if (!("chatMessages" in persistedState) || !Array.isArray((persistedState as any).chatMessages)) {
    (persistedState as any).chatMessages = [];
  }
  if (!persistedState.map || persistedState.map.width <= 0 || persistedState.map.height <= 0) {
    persistedState.map = getMapForState(persistedState);
  }

  const room: Room = {
    state: persistedState,
    sockets: new Map<string, string>()
  };
  rooms.set(normalizedCode, room);
  return room;
}

function pushLog(state: GameState, text: string) {
  const entry: CombatLogEntry = { id: cryptoRandomId(), text };
  state.logs = [entry, ...state.logs].slice(0, 24);
}

function pushChat(state: GameState, playerId: string, playerName: string, text: string) {
  state.chatMessages = [
    ...state.chatMessages,
    {
      id: cryptoRandomId(),
      playerId,
      playerName,
      text,
      createdAt: new Date().toISOString()
    }
  ].slice(-CHAT_HISTORY_LIMIT);
}

function findPlayer(state: GameState, playerId: string) {
  return state.players.find((player) => player.id === playerId);
}

function findUnit(state: GameState, unitId: string) {
  return state.units.find((unit) => unit.id === unitId && unit.alive);
}

function positionKey(position: Position) {
  return `${position.x},${position.y}`;
}

function unitAt(state: GameState, position: Position) {
  return state.units.find((unit) => unit.alive && unit.position.x === position.x && unit.position.y === position.y);
}

function inBounds(map: GameMap, position: Position) {
  return position.x >= 0 && position.y >= 0 && position.x < map.width && position.y < map.height;
}

function getTile(map: GameMap, position: Position) {
  return map.tiles[position.y]?.[position.x];
}

function isPassableTile(map: GameMap, position: Position) {
  const tile = getTile(map, position);
  return Boolean(tile && tile.type !== "mountain");
}

function neighbors(position: Position): Position[] {
  return [
    { x: position.x + 1, y: position.y },
    { x: position.x - 1, y: position.y },
    { x: position.x, y: position.y + 1 },
    { x: position.x, y: position.y - 1 }
  ];
}

function movementRange(state: GameState, unit: Unit) {
  const frontier: Array<{ position: Position; cost: number }> = [{ position: unit.position, cost: 0 }];
  const bestCost = new Map<string, number>([[positionKey(unit.position), 0]]);
  const reachable: Position[] = [];

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    for (const next of neighbors(current.position)) {
      if (!inBounds(state.map, next) || !isPassableTile(state.map, next)) {
        continue;
      }
      const tile = getTile(state.map, next)!;
      const occupant = unitAt(state, next);
      if (occupant && occupant.id !== unit.id) {
        if (occupant.team !== unit.team) {
          continue;
        }
      }
      const nextCost = current.cost + tile.moveCost;
      if (nextCost > unit.stats.mov) {
        continue;
      }
      const key = positionKey(next);
      const known = bestCost.get(key);
      if (known !== undefined && known <= nextCost) {
        continue;
      }
      bestCost.set(key, nextCost);
      if (!occupant || occupant.id === unit.id) {
        reachable.push(next);
      }
      frontier.push({ position: next, cost: nextCost });
    }
  }

  return reachable;
}

function findNearestOpenSpawn(map: GameMap, desired: Position, occupied: Set<string>) {
  const fallback: Position = { x: 0, y: 0 };
  if (!inBounds(map, desired)) {
    desired = fallback;
  }

  const queue: Position[] = [desired];
  const visited = new Set<string>([positionKey(desired)]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = positionKey(current);
    if (isPassableTile(map, current) && !occupied.has(key)) {
      occupied.add(key);
      return current;
    }

    for (const next of neighbors(current)) {
      if (!inBounds(map, next)) {
        continue;
      }
      const nextKey = positionKey(next);
      if (visited.has(nextKey)) {
        continue;
      }
      visited.add(nextKey);
      queue.push(next);
    }
  }

  // Last resort: first available non-mountain tile in scan order.
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const candidate = { x, y };
      const key = positionKey(candidate);
      if (isPassableTile(map, candidate) && !occupied.has(key)) {
        occupied.add(key);
        return candidate;
      }
    }
  }

  return fallback;
}

function attackableTargets(state: GameState, unit: Unit) {
  return state.units.filter((candidate) => {
    if (!candidate.alive || candidate.team === unit.team) {
      return false;
    }
    const gap = Math.abs(candidate.position.x - unit.position.x) + Math.abs(candidate.position.y - unit.position.y);
    return canUnitAttackAtDistance(unit, gap);
  });
}

function getBestHealableTarget(state: GameState, healer: Unit, fromPosition: Position = healer.position) {
  const allies = state.units
    .filter((candidate) => {
      if (!candidate.alive || candidate.team !== healer.team || candidate.id === healer.id) {
        return false;
      }
      if (candidate.stats.hp >= candidate.stats.maxHp) {
        return false;
      }
      const gap = Math.abs(candidate.position.x - fromPosition.x) + Math.abs(candidate.position.y - fromPosition.y);
      return gap <= healer.stats.range;
    })
    .sort((a, b) => {
      const missingA = a.stats.maxHp - a.stats.hp;
      const missingB = b.stats.maxHp - b.stats.hp;
      if (missingA !== missingB) {
        return missingB - missingA;
      }
      if (a.stats.hp !== b.stats.hp) {
        return a.stats.hp - b.stats.hp;
      }
      return distance(fromPosition, a.position) - distance(fromPosition, b.position);
    });

  return allies[0] ?? null;
}

function canControlUnit(state: GameState, playerId: string, unit: Unit) {
  return unit.ownerId === playerId && state.phase === "player" && state.status === "battle";
}

function allPlayerUnitsActed(state: GameState) {
  return state.units.filter((unit) => unit.team === "player" && unit.alive).every((unit) => unit.acted);
}

function resetPlayerActions(state: GameState) {
  for (const unit of state.units) {
    if (unit.team === "player" && unit.alive) {
      unit.acted = false;
      unit.moved = false;
      unit.originalPosition = { ...unit.position };
    }
  }
  state.selectedUnitId = null;
  state.highlights = [];
}

function resetEnemyActions(state: GameState) {
  for (const unit of state.units) {
    if (unit.team === "enemy" && unit.alive) {
      unit.acted = false;
      unit.moved = false;
      unit.originalPosition = { ...unit.position };
    }
  }
}

function distance(a: Position, b: Position) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function seededEnemyStats(className: UnitClass, level: number = 1, enemyCount: number = 4) {
  const template = CLASS_TEMPLATES[className];
  const base = clone(template);
  const levelBonus = level - 1;

  // Keep chapter progression meaningful, but lighter now that maps field more enemies.
  base.hp += 2 + levelBonus;
  base.maxHp += 2 + levelBonus;
  base.str += Math.max(0, Math.ceil(levelBonus / 2));
  base.mag += Math.max(0, Math.ceil(levelBonus / 2));
  base.skl += Math.max(0, Math.floor(levelBonus / 2));
  base.spd += Math.max(0, Math.floor(levelBonus / 2));
  base.def += Math.max(0, Math.floor(levelBonus / 2));
  base.res += Math.max(0, Math.floor(levelBonus / 2));

  const crowdPenalty = Math.max(0, enemyCount - 4);
  if (crowdPenalty > 0) {
    const statPenalty = Math.min(2, Math.floor((crowdPenalty + 1) / 2));
    const hpPenalty = statPenalty * 2;
    base.maxHp = Math.max(template.maxHp, base.maxHp - hpPenalty);
    base.str = Math.max(template.str, base.str - statPenalty);
    base.mag = Math.max(template.mag, base.mag - statPenalty);
    base.skl = Math.max(template.skl, base.skl - statPenalty);
    base.spd = Math.max(template.spd, base.spd - statPenalty);
    base.def = Math.max(template.def, base.def - statPenalty);
    base.res = Math.max(template.res, base.res - statPenalty);
  }

  // Global enemy nerf to keep battles less punishing on compact maps.
  base.maxHp = Math.max(1, base.maxHp - 3);
  base.str = Math.max(0, base.str - 1);
  base.mag = Math.max(0, base.mag - 1);
  base.skl = Math.max(0, base.skl - 1);
  base.spd = Math.max(0, base.spd - 1);
  base.def = Math.max(0, base.def - 1);
  base.res = Math.max(0, base.res - 1);

  // Enemies always spawn at full HP.
  base.hp = base.maxHp;

  return base;
}

function getWeaponsForClass(className: UnitClass): Weapon[] {
  switch (className) {
    case "Lord":
    case "Great Lord":
    case "Mercenary":
    case "Hero":
    case "Dancer":
    case "Diva":
      return WEAPONS.filter(w => w.type === "Sword").slice(0, 2);
    case "Knight":
    case "General":
      return WEAPONS.filter(w => w.type === "Lance").slice(0, 2);
    case "Brigand":
    case "Warrior":
      return WEAPONS.filter(w => w.type === "Axe").slice(0, 2);
    case "Archer":
    case "Sniper":
      return WEAPONS.filter(w => w.type === "Bow").slice(0, 2);
    case "Mage":
    case "Sage":
      return WEAPONS.filter(w => w.type === "Magic Tome").slice(0, 2);
    case "Cleric":
    case "Bishop":
      return WEAPONS.filter(w => w.type === "Staff").slice(0, 2);
    default:
      return [];
  }
}

type EnemySpawnDefinition = {
  name: string;
  className: UnitClass;
  position: Position;
  level?: number;
  weaponId?: string;
  turn?: number;
  behavior?: CampaignEnemyRecord["behavior"];
};

function buildEnemyUnit(
  state: GameState,
  enemy: EnemySpawnDefinition,
  occupiedSpawnTiles: Set<string>,
  enemyCount: number
): Unit {
  const position = findNearestOpenSpawn(state.map, enemy.position, occupiedSpawnTiles);
  const defaultWeapons = getWeaponsForClass(enemy.className);
  const selectedWeapon = enemy.weaponId
    ? defaultWeapons.find((weapon) => weapon.id === enemy.weaponId) ?? WEAPONS.find((weapon) => weapon.id === enemy.weaponId) ?? null
    : null;
  const weapons = selectedWeapon ? [selectedWeapon] : defaultWeapons;
  const level = enemy.level ?? state.chapter;
  return {
    id: cryptoRandomId(),
    name: enemy.name,
    className: enemy.className,
    team: "enemy",
    portraitUrl: getPortraitForUnit("enemy", enemy.className),
    position,
    originalPosition: { ...position },
    stats: seededEnemyStats(enemy.className, level, enemyCount),
    acted: false,
    moved: false,
    level,
    exp: 0,
    alive: true,
    inventory: {
      weapons,
      items: []
    },
    equippedWeapon: weapons[0] || null,
    skillId: null,
    aiBehavior: enemy.behavior ?? "advance"
  };
}

function getDefendReinforcementWave(state: GameState): EnemySpawnDefinition[] {
  const waveNumber = Math.floor((state.turnCount - 1) / 2);
  const entryPoints: Position[] = [
    { x: state.map.width - 1, y: state.map.height - 1 },
    { x: state.map.width - 1, y: Math.max(0, state.map.height - 3) },
    { x: state.map.width - 1, y: Math.floor(state.map.height / 2) },
    { x: state.map.width - 1, y: 1 },
    { x: Math.max(0, state.map.width - 2), y: 0 },
    { x: Math.floor(state.map.width / 2), y: 0 }
  ];
  const classCycle: UnitClass[] = ["Brigand", "Archer", "Knight", "Mage"];
  const firstClass = classCycle[(state.chapter + waveNumber - 1) % classCycle.length];
  const secondClass = classCycle[(state.chapter + waveNumber) % classCycle.length];
  const firstEntry = entryPoints[((waveNumber - 1) * 2) % entryPoints.length];
  const secondEntry = entryPoints[((waveNumber - 1) * 2 + 1) % entryPoints.length];

  return [
    {
      name: `Reinforcement ${waveNumber}A`,
      className: firstClass,
      position: firstEntry
    },
    {
      name: `Reinforcement ${waveNumber}B`,
      className: secondClass,
      position: secondEntry
    }
  ];
}

function spawnDefendReinforcements(state: GameState) {
  if (state.campaign) {
    return 0;
  }
  if (state.map.objective.type !== "defend" || state.turnCount < 3 || state.turnCount % 2 === 0) {
    return 0;
  }

  const occupiedSpawnTiles = new Set<string>(
    state.units.filter((unit) => unit.alive).map((unit) => positionKey(unit.position))
  );
  const reinforcements = getDefendReinforcementWave(state);
  const enemyCount = state.units.filter((unit) => unit.team === "enemy" && unit.alive).length + reinforcements.length;
  const enemyUnits = reinforcements.map((enemy) => buildEnemyUnit(state, enemy, occupiedSpawnTiles, enemyCount));

  state.units.push(...enemyUnits);
  pushLog(state, "Enemy reinforcements arrived.");
  return enemyUnits.length;
}

function spawnCampaignReinforcements(state: GameState) {
  const campaignMap = getCampaignMapRecord(state);
  if (!campaignMap) {
    return 0;
  }

  const reinforcements = campaignMap.enemies.filter((enemy) => enemy.turn === state.turnCount && enemy.turn > 1);
  if (reinforcements.length === 0) {
    return 0;
  }

  const occupiedSpawnTiles = new Set<string>(
    state.units.filter((unit) => unit.alive).map((unit) => positionKey(unit.position))
  );
  const enemyCount = state.units.filter((unit) => unit.team === "enemy" && unit.alive).length + reinforcements.length;
  const enemyUnits = reinforcements.map((enemy) => buildEnemyUnit(state, enemy, occupiedSpawnTiles, enemyCount));
  state.units.push(...enemyUnits);
  pushLog(state, `${enemyUnits.length} enemy reinforcement${enemyUnits.length === 1 ? "" : "s"} arrived.`);
  return enemyUnits.length;
}

function buildFreshPlayerUnit(state: GameState, draft: CharacterDraft, index: number, occupiedSpawnTiles: Set<string>): Unit {
  const desiredPosition = state.map.playerStarts[index] ?? { x: 0, y: 7 - index };
  const position = findNearestOpenSpawn(state.map, desiredPosition, occupiedSpawnTiles);
  return {
    id: draft.id,
    name: draft.name,
    className: draft.className,
    team: "player",
    ownerId: draft.ownerId,
    portraitUrl: getPortraitForUnit("player", draft.className, draft.portraitUrl),
    position,
    originalPosition: { ...position },
    stats: clone(CLASS_TEMPLATES[draft.className]),
    acted: false,
    moved: false,
    level: 1,
    exp: 0,
    alive: true,
    inventory: {
      weapons: getWeaponsForClass(draft.className),
      items: [ITEMS[0]] // potion
    },
    equippedWeapon: getWeaponsForClass(draft.className)[0] || null, // equip first weapon
    skillId: draft.skillId ?? null
  };
}

function buildChapterCarryoverUnit(state: GameState, draft: CharacterDraft, index: number, occupiedSpawnTiles: Set<string>): Unit {
  const previousUnit = state.units.find((unit) => unit.team === "player" && unit.id === draft.id);
  if (!previousUnit) {
    return buildFreshPlayerUnit(state, draft, index, occupiedSpawnTiles);
  }

  const desiredPosition = state.map.playerStarts[index] ?? { x: 0, y: 7 - index };
  const position = findNearestOpenSpawn(state.map, desiredPosition, occupiedSpawnTiles);
  const restoredStats = clone(previousUnit.stats);
  return {
    ...clone(previousUnit),
    name: draft.name,
    className: draft.className,
    ownerId: draft.ownerId,
    portraitUrl: getPortraitForUnit("player", draft.className, draft.portraitUrl),
    position,
    originalPosition: { ...position },
    stats: {
      ...restoredStats,
      hp: restoredStats.maxHp
    },
    acted: false,
    moved: false,
    alive: true
  };
}

function buildMapStartSnapshotUnit(state: GameState, draft: CharacterDraft, index: number, occupiedSpawnTiles: Set<string>): Unit {
  const snapshotUnit = state.mapStartPlayerUnits.find((unit) => unit.id === draft.id);
  if (!snapshotUnit) {
    return buildFreshPlayerUnit(state, draft, index, occupiedSpawnTiles);
  }

  const desiredPosition = state.map.playerStarts[index] ?? { x: 0, y: 7 - index };
  const position = findNearestOpenSpawn(state.map, desiredPosition, occupiedSpawnTiles);
  const restoredStats = clone(snapshotUnit.stats);
  return {
    ...clone(snapshotUnit),
    name: draft.name,
    className: draft.className,
    ownerId: draft.ownerId,
    portraitUrl: getPortraitForUnit("player", draft.className, draft.portraitUrl),
    position,
    originalPosition: { ...position },
    stats: {
      ...restoredStats,
      hp: restoredStats.maxHp
    },
    acted: false,
    moved: false,
    alive: true,
    skillId: draft.skillId ?? snapshotUnit.skillId ?? null
  };
}

function captureMapStartPlayerUnits(state: GameState) {
  state.mapStartPlayerUnits = state.units
    .filter((unit) => unit.team === "player")
    .map((unit) => clone(unit));
}

function spawnUnits(state: GameState, options?: { preservePlayerProgress?: boolean; restoreFromMapStartSnapshot?: boolean }) {
  const occupiedSpawnTiles = new Set<string>();
  const preservePlayerProgress = options?.preservePlayerProgress ?? false;
  const restoreFromMapStartSnapshot = options?.restoreFromMapStartSnapshot ?? false;

  const playerUnits: Unit[] = state.characterDrafts.map((draft, index) => {
    if (restoreFromMapStartSnapshot) {
      return buildMapStartSnapshotUnit(state, draft, index, occupiedSpawnTiles);
    }
    if (preservePlayerProgress) {
      return buildChapterCarryoverUnit(state, draft, index, occupiedSpawnTiles);
    }
    return buildFreshPlayerUnit(state, draft, index, occupiedSpawnTiles);
  });

  let enemies: EnemySpawnDefinition[] = [];
  const campaignMap = getCampaignMapRecord(state);
  if (campaignMap) {
    enemies = campaignMap.enemies.filter((enemy) => enemy.turn <= 1);
  } else if (state.chapter === 1) {
    enemies = [
      { name: "Bandit Axer", className: "Brigand", position: { x: 7, y: 3 } },
      { name: "Outlaw Shot", className: "Archer", position: { x: 9, y: 2 } },
      { name: "Fort Guard", className: "Knight", position: { x: 8, y: 6 } },
      { name: "Camp Raider", className: "Brigand", position: { x: 8, y: 7 } },
      { name: "Ridge Archer", className: "Archer", position: { x: 9, y: 8 } },
      { name: "Road Mage", className: "Mage", position: { x: 9, y: 9 } },
      { name: "Iron Wall", className: "Knight", position: { x: 7, y: 5 } }
    ];
  } else if (state.chapter === 2) {
    enemies = [
      { name: "Veteran Brigand", className: "Brigand", position: { x: 7, y: 4 } },
      { name: "Elite Archer", className: "Archer", position: { x: 9, y: 2 } },
      { name: "Armored Knight", className: "Knight", position: { x: 7, y: 7 } },
      { name: "Dark Mage", className: "Mage", position: { x: 9, y: 8 } },
      { name: "Pass Marauder", className: "Brigand", position: { x: 8, y: 5 } },
      { name: "Highland Archer", className: "Archer", position: { x: 9, y: 9 } },
      { name: "Citadel Guard", className: "Knight", position: { x: 8, y: 8 } },
      { name: "Hex Adept", className: "Mage", position: { x: 7, y: 8 } },
      { name: "Flank Reaver", className: "Brigand", position: { x: 6, y: 9 } }
    ];
  } else if (state.chapter === 3) {
    enemies = [
      { name: "Shade Archer", className: "Archer", position: { x: 8, y: 2 } },
      { name: "Ruin Mage", className: "Mage", position: { x: 9, y: 2 } },
      { name: "Ravine Knight", className: "Knight", position: { x: 8, y: 4 } },
      { name: "Forest Brigand", className: "Brigand", position: { x: 7, y: 4 } },
      { name: "Hunter Scout", className: "Archer", position: { x: 9, y: 5 } },
      { name: "Ward Knight", className: "Knight", position: { x: 7, y: 6 } },
      { name: "Witchfire", className: "Mage", position: { x: 8, y: 7 } },
      { name: "Path Reaver", className: "Brigand", position: { x: 9, y: 8 } },
      { name: "Trail Archer", className: "Archer", position: { x: 7, y: 8 } },
      { name: "Night Raider", className: "Brigand", position: { x: 8, y: 9 } }
    ];
  } else if (state.chapter === 4) {
    enemies = [
      { name: "Citadel Bow", className: "Archer", position: { x: 8, y: 1 } },
      { name: "Blackwall Knight", className: "Knight", position: { x: 7, y: 2 } },
      { name: "Siege Mage", className: "Mage", position: { x: 9, y: 2 } },
      { name: "Gate Brigand", className: "Brigand", position: { x: 8, y: 3 } },
      { name: "Bastion Guard", className: "Knight", position: { x: 6, y: 4 } },
      { name: "Ridge Archer", className: "Archer", position: { x: 9, y: 4 } },
      { name: "Ash Adept", className: "Mage", position: { x: 7, y: 5 } },
      { name: "Fort Reaver", className: "Brigand", position: { x: 8, y: 6 } },
      { name: "Wall Knight", className: "Knight", position: { x: 6, y: 7 } },
      { name: "Crossbowman", className: "Archer", position: { x: 9, y: 7 } },
      { name: "Hex Marshal", className: "Mage", position: { x: 8, y: 8 } },
      { name: "Vanguard Reaver", className: "Brigand", position: { x: 7, y: 9 } }
    ];
  } else if (state.chapter === 5) {
    enemies = [
      { name: "Final Bow", className: "Archer", position: { x: 8, y: 1 } },
      { name: "Dread Knight", className: "Knight", position: { x: 7, y: 1 } },
      { name: "Grand Mage", className: "Mage", position: { x: 9, y: 1 } },
      { name: "Outer Reaver", className: "Brigand", position: { x: 8, y: 2 } },
      { name: "Iron Bastion", className: "Knight", position: { x: 6, y: 3 } },
      { name: "Storm Archer", className: "Archer", position: { x: 9, y: 3 } },
      { name: "Flame Adept", className: "Mage", position: { x: 7, y: 4 } },
      { name: "Gatebreaker", className: "Brigand", position: { x: 8, y: 5 } },
      { name: "Bulwark Knight", className: "Knight", position: { x: 6, y: 6 } },
      { name: "Skirmish Archer", className: "Archer", position: { x: 9, y: 6 } },
      { name: "Dusk Magus", className: "Mage", position: { x: 8, y: 7 } },
      { name: "Ruin Reaver", className: "Brigand", position: { x: 7, y: 8 } },
      { name: "Last Wall", className: "Knight", position: { x: 8, y: 9 } }
    ];
  } else if (state.chapter === 6) {
    enemies = [
      { name: "Keep Breaker", className: "Brigand", position: { x: 8, y: 8 } },
      { name: "Siege Bow", className: "Archer", position: { x: 9, y: 7 } },
      { name: "Ash Knight", className: "Knight", position: { x: 7, y: 7 } },
      { name: "Hex Raider", className: "Mage", position: { x: 8, y: 6 } },
      { name: "Outer Pike", className: "Knight", position: { x: 9, y: 5 } },
      { name: "Flank Archer", className: "Archer", position: { x: 7, y: 5 } },
      { name: "Dread Reaver", className: "Brigand", position: { x: 8, y: 4 } },
      { name: "Siege Hex", className: "Mage", position: { x: 9, y: 3 } },
      { name: "Wall Hunter", className: "Archer", position: { x: 7, y: 3 } },
      { name: "Iron Vanguard", className: "Knight", position: { x: 8, y: 2 } },
      { name: "Night Reaver", className: "Brigand", position: { x: 9, y: 1 } }
    ];
  } else if (state.chapter === 7) {
    enemies = [
      { name: "Gate Archer", className: "Archer", position: { x: 7, y: 8 } },
      { name: "Hold Knight", className: "Knight", position: { x: 8, y: 8 } },
      { name: "Shade Mage", className: "Mage", position: { x: 9, y: 8 } },
      { name: "Bridge Reaver", className: "Brigand", position: { x: 7, y: 6 } },
      { name: "Pursuit Archer", className: "Archer", position: { x: 8, y: 6 } },
      { name: "Ward Knight", className: "Knight", position: { x: 9, y: 6 } },
      { name: "Night Hex", className: "Mage", position: { x: 7, y: 4 } },
      { name: "Wall Reaver", className: "Brigand", position: { x: 8, y: 4 } },
      { name: "Overwatch", className: "Archer", position: { x: 9, y: 4 } },
      { name: "Citadel Knight", className: "Knight", position: { x: 8, y: 2 } },
      { name: "Escape Warden", className: "Mage", position: { x: 9, y: 2 } },
      { name: "Last Pursuer", className: "Brigand", position: { x: 8, y: 1 } }
    ];
  }

  const enemyUnits: Unit[] = enemies.map((enemy) => buildEnemyUnit(state, enemy, occupiedSpawnTiles, enemies.length));

  state.units = [...playerUnits, ...enemyUnits];
}

function resetBattleState(state: GameState, options?: { preservePlayerProgress?: boolean }) {
  state.status = "battle";
  state.phase = "player";
  state.turnCount = 1;
  state.activePlayerId = null;
  state.selectedUnitId = null;
  state.highlights = [];
  state.winner = null;
  state.outcomeRecorded = false;
  state.latestCombatEvent = null;
  state.latestLevelUpEvent = null;
  state.latestPromotionEvent = null;
  state.map = getMapForState(state);
  const restoreFromMapStartSnapshot = options?.preservePlayerProgress === undefined && state.mapStartPlayerUnits.length > 0;
  spawnUnits(state, {
    preservePlayerProgress: options?.preservePlayerProgress,
    restoreFromMapStartSnapshot
  });
}

function rollLevelUpStatGains(unit: Unit) {
  const gains: Array<{ stat: keyof Unit["stats"]; gain: number; newValue: number }> = [];
  const rates = CLASS_GROWTH_RATES[unit.className];
  const statsToRoll: Array<keyof Unit["stats"]> = ["maxHp", "str", "mag", "skl", "spd", "def", "res"];
  for (const stat of statsToRoll) {
    const chance = rates[stat] ?? 0;
    if (Math.random() * 100 < chance) {
      if (stat === "maxHp") {
        unit.stats.maxHp += 1;
        unit.stats.hp = Math.min(unit.stats.maxHp, unit.stats.hp + 1);
        gains.push({ stat, gain: 1, newValue: unit.stats.maxHp });
        continue;
      }
      unit.stats[stat] += 1;
      gains.push({ stat, gain: 1, newValue: unit.stats[stat] });
    }
  }
  return gains;
}

function applyPromotion(unit: Unit) {
  const promotedClass = getPromotedClass(unit.className);
  if (!promotedClass || unit.level < 20) {
    return null;
  }

  const oldClassName = unit.className as BaseUnitClass;
  const promotionBonuses = PROMOTION_BONUSES[oldClassName];
  const promotedTemplate = CLASS_TEMPLATES[promotedClass];
  const statsToBoost: Array<keyof Unit["stats"]> = ["maxHp", "str", "mag", "skl", "spd", "def", "res", "mov", "range"];
  const statGains: Array<{ stat: keyof Unit["stats"]; gain: number; newValue: number }> = [];

  for (const stat of statsToBoost) {
    let gain = 0;
    const bonus = promotionBonuses[stat] ?? 0;
    if (bonus > 0) {
      unit.stats[stat] += bonus;
      gain += bonus;
    }

    const promotedFloor = promotedTemplate[stat];
    if (unit.stats[stat] < promotedFloor) {
      const floorGain = promotedFloor - unit.stats[stat];
      unit.stats[stat] = promotedFloor;
      gain += floorGain;
    }

    if (gain > 0) {
      statGains.push({ stat, gain, newValue: unit.stats[stat] });
    }
  }

  const maxHpGain = statGains.find((gain) => gain.stat === "maxHp")?.gain ?? 0;
  if (maxHpGain > 0) {
    unit.stats.hp = Math.min(unit.stats.maxHp, unit.stats.hp + maxHpGain);
  }

  unit.className = promotedClass;

  return {
    oldClassName,
    newClassName: promotedClass,
    statGains
  };
}

function grantExp(state: GameState, unit: Unit, amount: number) {
  if (amount <= 0 || !unit.alive) {
    return;
  }
  unit.exp += amount;
  while (unit.exp >= EXP_PER_LEVEL) {
    unit.exp -= EXP_PER_LEVEL;
    unit.level += 1;
    const statGains = rollLevelUpStatGains(unit);
    const promotion = applyPromotion(unit);
    state.latestLevelUpEvent = {
      unitId: unit.id,
      unitName: unit.name,
      className: unit.className,
      team: unit.team,
      newLevel: unit.level,
      expRemainder: unit.exp,
      statGains
    };
    state.latestPromotionEvent = promotion
      ? {
          unitId: unit.id,
          unitName: unit.name,
          oldClassName: promotion.oldClassName,
          newClassName: promotion.newClassName,
          team: unit.team,
          newLevel: unit.level,
          statGains: promotion.statGains
        }
      : null;
    pushLog(state, `${unit.name} reached level ${unit.level}!`);
    if (promotion) {
      pushLog(state, `${unit.name} promoted to ${promotion.newClassName}!`);
    }
  }
}

/** Returns the number of living allied units (same team) adjacent to `unit`. */
function countAdjacentAllies(state: GameState, unit: Unit): number {
  return state.units.filter(
    (u) => u.alive && u.id !== unit.id && u.team === unit.team &&
      Math.abs(u.position.x - unit.position.x) + Math.abs(u.position.y - unit.position.y) === 1
  ).length;
}

/**
 * Execute a single strike from `striker` onto `struck`.
 * Returns the amount of damage dealt (0 on miss).
 * Mutates `struck.stats.hp` and logs to state.
 */
function executeStrike(
  state: GameState,
  striker: Unit,
  struck: Unit,
  terrainDefense: number,
  ctx: CombatContext,
  label: string
): number {
  const hitChance = calculateHitChance(striker, struck, ctx);
  if (Math.random() * 100 >= hitChance) {
    pushLog(state, `${striker.name} missed ${struck.name}.`);
    return 0;
  }

  const critChance = calculateCritChance(striker, struck);
  const isCrit = Math.random() * 100 < critChance;
  let baseDamage = calculateDamage(striker, struck, terrainDefense);

  // Skill: Ignis — 30% chance to add half of the off-stat to damage
  if (striker.skillId === "ignis" && Math.random() < 0.3) {
    const bonus = striker.equippedWeapon?.type === "Magic Tome"
      ? Math.floor(striker.stats.str / 2)
      : Math.floor(striker.stats.mag / 2);
    if (bonus > 0) {
      baseDamage += bonus;
      pushLog(state, `${striker.name}'s Ignis flares!`);
    }
  }

  let damage = isCrit ? baseDamage * 2 : baseDamage;

  // Skill: Aether — 25% chance: double damage + heal half
  if (striker.skillId === "aether" && Math.random() < 0.25) {
    damage = baseDamage * 2;
    const healAmt = Math.floor(damage / 2);
    striker.stats.hp = Math.min(striker.stats.maxHp, striker.stats.hp + healAmt);
    pushLog(state, `${striker.name}'s Aether activates! Healed ${healAmt} HP.`);
  }
  // Skill: Sol — 30% chance to restore HP equal to damage dealt
  else if (striker.skillId === "sol" && Math.random() < 0.3) {
    striker.stats.hp = Math.min(striker.stats.maxHp, striker.stats.hp + damage);
    pushLog(state, `${striker.name}'s Sol activates! Healed ${damage} HP.`);
  }

  // Skill: Pavise (defender) — 30% chance to halve physical damage taken
  if (struck.skillId === "pavise" && striker.equippedWeapon?.type !== "Magic Tome" && Math.random() < 0.3) {
    damage = Math.floor(damage / 2);
    pushLog(state, `${struck.name}'s Pavise reduces the blow!`);
  }
  // Skill: Great Shield (defender) — 15% chance to negate all physical damage
  else if (struck.skillId === "great-shield" && striker.equippedWeapon?.type !== "Magic Tome" && Math.random() < 0.15) {
    damage = 0;
    pushLog(state, `${struck.name}'s Great Shield nullifies the attack!`);
  }

  if (damage > 0) {
    // Skill: Miracle — if HP > 1, 30% chance to survive lethal blow with 1 HP
    if (struck.skillId === "miracle" && struck.stats.hp > 1 && damage >= struck.stats.hp && Math.random() < 0.3) {
      damage = struck.stats.hp - 1;
      pushLog(state, `${struck.name}'s Miracle keeps them standing!`);
    }
    struck.stats.hp = Math.max(0, struck.stats.hp - damage);
    const critText = isCrit ? " (critical!)" : "";
    pushLog(state, `${label} ${damage} damage${critText}.`);
  }

  return damage;
}

function resolveAttack(state: GameState, attacker: Unit, defender: Unit) {
  const defenderTerrainDefense = getTerrainDefense(state.map, defender.position);
  const attackerTerrainDefense = getTerrainDefense(state.map, attacker.position);
  let playerCombatExpAward = 0;
  let playerCombatExpRecipient: Unit | null = null;
  let playerDealtDamage = false;
  let playerWasKilled = false;

  const combatDistance = distance(attacker.position, defender.position);

  // Build combat contexts (adjacentAllies only relevant for Charm holders)
  const attackerCtx: CombatContext = {
    initiating: true,
    distance: combatDistance,
    adjacentAllies: attacker.skillId === "charm" ? countAdjacentAllies(state, attacker) : 0
  };
  const defenderCtx: CombatContext = {
    initiating: false,
    distance: combatDistance,
    adjacentAllies: defender.skillId === "charm" ? countAdjacentAllies(state, defender) : 0
  };

  // Determine number of attacks
  let attackerStrikes = 1;
  let defenderStrikes = 1;
  if (checkIfDoubles(attacker, defender)) {
    attackerStrikes = 2;
  } else if (checkIfDoubles(defender, attacker)) {
    defenderStrikes = 2;
  }

  // Skill: Vantage — defender attacks first when HP < 50%
  const defenderHasVantage = defender.skillId === "vantage" && defender.stats.hp < defender.stats.maxHp * 0.5;
  // Skill: Magic Counter — defender can counter at range 2 with any weapon
  const defenderCanCounter = canUnitAttackAtDistance(defender, combatDistance) ||
    (defender.skillId === "magic-counter" && combatDistance === 2);

  function runAttackerStrikes() {
    for (let i = 0; i < attackerStrikes && defender.stats.hp > 0; i++) {
      // Skill: Dual Strike+ — +10 damage on second strike (treated as bonus on hits)
      const ctx = attacker.skillId === "dual-strike-plus" && i === 1
        ? { ...attackerCtx, dualStrikePlus: true }
        : attackerCtx;
      let label = `${attacker.name} hit ${defender.name} for`;
      let damage = executeStrike(state, attacker, defender, defenderTerrainDefense, ctx, label);
      // Apply Dual Strike+ flat bonus after if it landed
      if (attacker.skillId === "dual-strike-plus" && i === 1 && damage > 0) {
        const bonus = Math.min(10, defender.stats.hp);
        defender.stats.hp = Math.max(0, defender.stats.hp - bonus);
        if (bonus > 0) pushLog(state, `Dual Strike+ adds ${bonus} extra damage!`);
      }
      // Track if player dealt damage
      if (attacker.team === "player" && damage > 0) {
        playerDealtDamage = true;
      }
    }
  }

  function runDefenderStrikes() {
    if (!defenderCanCounter || defender.stats.hp === 0) return;
    for (let i = 0; i < defenderStrikes && attacker.stats.hp > 0; i++) {
      const label = `${defender.name} countered for`;
      const damage = executeStrike(state, defender, attacker, attackerTerrainDefense, defenderCtx, label);
      // Skill: Counter — reflect physical damage back to the striker
      if (attacker.skillId === "counter" && damage > 0 && defender.equippedWeapon?.type !== "Magic Tome") {
        const reflected = Math.min(damage, defender.stats.hp);
        defender.stats.hp = Math.max(0, defender.stats.hp - reflected);
        pushLog(state, `${attacker.name}'s Counter reflects ${reflected} damage!`);
      }
      // Track if player dealt damage
      if (defender.team === "player" && damage > 0) {
        playerDealtDamage = true;
      }
    }
  }

  if (defenderHasVantage) {
    pushLog(state, `${defender.name}'s Vantage strikes first!`);
    runDefenderStrikes();
    if (attacker.stats.hp > 0) runAttackerStrikes();
  } else {
    runAttackerStrikes();
    if (defender.stats.hp > 0) runDefenderStrikes();
  }

  // Determine player unit and experience recipient
  if (attacker.team === "player") {
    playerCombatExpRecipient = attacker;
  } else if (defender.team === "player") {
    playerCombatExpRecipient = defender;
  }

  function applyPlayerKillEffects(killer: Unit) {
    // Skill: Despoil — earn 100 gold on kill
    if (killer.skillId === "despoil") {
      const owner = state.players.find((p) => p.id === killer.ownerId);
      if (owner) {
        owner.gold += 100;
        pushLog(state, `${killer.name}'s Despoil yields 100 gold!`);
      }
    }
    // Skill: Lifetaker — restore 50% max HP on kill
    if (killer.skillId === "lifetaker") {
      const healAmt = Math.floor(killer.stats.maxHp * 0.5);
      killer.stats.hp = Math.min(killer.stats.maxHp, killer.stats.hp + healAmt);
      pushLog(state, `${killer.name}'s Lifetaker restores ${healAmt} HP!`);
    }
  }

  // On-kill effects for attacker
  if (defender.stats.hp === 0) {
    defender.alive = false;
    pushLog(state, `${defender.name} was defeated.`);
    if (attacker.team === "player") {
      // Award scaled kill XP based on level difference
      playerCombatExpAward += calculateKillExp(attacker.level, defender.level);
      applyPlayerKillEffects(attacker);
    }
  }

  // On-kill effects for defender counter
  if (attacker.stats.hp === 0) {
    attacker.alive = false;
    pushLog(state, `${attacker.name} fell in battle.`);
    if (defender.team === "player") {
      // Award scaled kill XP based on level difference
      playerCombatExpAward += calculateKillExp(defender.level, attacker.level);
      applyPlayerKillEffects(defender);
    }
  }

  // Award hit XP if player dealt damage but didn't kill
  if (playerCombatExpRecipient && playerDealtDamage && playerCombatExpRecipient.alive) {
    const damagedUnit = attacker.team === "player" ? defender : attacker;
    playerCombatExpAward += calculateHitExp(playerCombatExpRecipient.level, damagedUnit.level);
  }

  if (playerCombatExpRecipient && playerCombatExpRecipient.alive) {
    grantExp(state, playerCombatExpRecipient, playerCombatExpAward);
  }

  attacker.acted = true;
  state.selectedUnitId = null;
  state.highlights = [];
}

function resolveHeal(state: GameState, healer: Unit, target: Unit) {
  let healAmount = healer.stats.mag;
  if (healer.equippedWeapon && healer.equippedWeapon.type === "Staff") {
    healAmount += healer.equippedWeapon.might;
  }
  const actualHeal = Math.min(healAmount, target.stats.maxHp - target.stats.hp);
  target.stats.hp = Math.min(target.stats.maxHp, target.stats.hp + actualHeal);
  if (isStaffClass(healer.className)) {
    grantExp(state, healer, CLERIC_HEAL_EXP);
  }
  pushLog(state, `${healer.name} healed ${target.name} for ${actualHeal} HP.`);
}

function getConsumableHealAmount(item: Item) {
  switch (item.id) {
    case "hi-potion":
      return 20;
    case "elixir":
      return 999;
    case "potion":
    default:
      return 10;
  }
}

function checkWinState(state: GameState) {
  const campaignChapterLimit = getCampaignChapterLimit(state);
  const livingPlayers = state.units.filter((unit) => unit.team === "player" && unit.alive);
  const livingEnemies = state.units.filter((unit) => unit.team === "enemy" && unit.alive);
  const objective = state.map.objective;

  if (objective.type === "arrive" && objective.target) {
    const arrived = livingPlayers.some(
      (unit) => unit.position.x === objective.target!.x && unit.position.y === objective.target!.y
    );
    if (arrived) {
      if (state.chapter < campaignChapterLimit) {
        state.phase = "victory";
        state.status = "battle";
        state.winner = "player";
        pushLog(state, `Chapter ${state.chapter} cleared! Objective complete: ${getObjectiveLabel(state)}.`);
      } else {
        state.phase = "victory";
        state.status = "complete";
        state.winner = "player";
        pushLog(state, "The squad reached the final objective.");
      }
      return;
    }
  }

  const defendTurnLimit = objective.type === "defend" ? (objective.turnLimit ?? 0) : 0;
  if (objective.type === "defend" && state.turnCount >= defendTurnLimit && livingPlayers.length > 0) {
    if (state.chapter < campaignChapterLimit) {
      state.phase = "victory";
      state.status = "battle";
      state.winner = "player";
      pushLog(state, `Chapter ${state.chapter} cleared! Objective complete: ${getObjectiveLabel(state)}.`);
    } else {
      state.phase = "victory";
      state.status = "complete";
      state.winner = "player";
      pushLog(state, "The squad held the line through the final turn.");
    }
    return;
  }

  if (objective.type === "route" && livingEnemies.length === 0) {
    if (state.chapter < campaignChapterLimit) {
      // Keep battle map visible and let the DM move the party into Base Camp.
      state.phase = "victory";
      state.status = "battle";
      state.winner = "player";
      pushLog(state, `Chapter ${state.chapter} cleared! Awaiting the DM to advance to Base Camp.`);
    } else {
      // Final victory
      state.phase = "victory";
      state.status = "complete";
      state.winner = "player";
      pushLog(state, "The squad cleared the final chapter.");
    }
  } else if (livingPlayers.length === 0) {
    state.phase = "defeat";
    state.status = "complete";
    state.winner = "enemy";
    pushLog(state, "The party was wiped out.");
  }
}

async function takeEnemyPhase(room: Room) {
  const state = room.state;
  state.phase = "enemy";
  state.latestCombatEvent = null;
  state.latestLevelUpEvent = null;
  state.latestPromotionEvent = null;
  state.activePlayerId = null;
  resetEnemyActions(state);
  pushLog(state, "Enemy phase begins.");
  await emitState(room);

  try {
    for (const enemy of state.units.filter((unit) => unit.team === "enemy" && unit.alive)) {
      if (!enemy.alive) continue;

      if (isStaffClass(enemy.className)) {
        const damagedAlly = state.units.some(
          (unit) => unit.alive && unit.team === enemy.team && unit.id !== enemy.id && unit.stats.hp < unit.stats.maxHp
        );
        if (damagedAlly) {
          const shouldAdvance = (enemy.aiBehavior ?? "advance") === "advance";
          let healTarget = getBestHealableTarget(state, enemy);
          if (!healTarget && shouldAdvance) {
            const options = movementRange(state, enemy)
              .filter((option) => !unitAt(state, option))
              .sort((a, b) => {
                const targetA = getBestHealableTarget(state, enemy, a);
                const targetB = getBestHealableTarget(state, enemy, b);
                const canHealA = targetA ? 0 : 1;
                const canHealB = targetB ? 0 : 1;
                if (canHealA !== canHealB) {
                  return canHealA - canHealB;
                }
                if (targetA && targetB) {
                  const missingA = targetA.stats.maxHp - targetA.stats.hp;
                  const missingB = targetB.stats.maxHp - targetB.stats.hp;
                  if (missingA !== missingB) {
                    return missingB - missingA;
                  }
                  return distance(a, targetA.position) - distance(b, targetB.position);
                }
                const fallbackA = state.units
                  .filter((unit) => unit.alive && unit.team === enemy.team && unit.id !== enemy.id && unit.stats.hp < unit.stats.maxHp)
                  .sort((u1, u2) => distance(a, u1.position) - distance(a, u2.position))[0];
                const fallbackB = state.units
                  .filter((unit) => unit.alive && unit.team === enemy.team && unit.id !== enemy.id && unit.stats.hp < unit.stats.maxHp)
                  .sort((u1, u2) => distance(b, u1.position) - distance(b, u2.position))[0];
                const distA = fallbackA ? distance(a, fallbackA.position) : Number.MAX_SAFE_INTEGER;
                const distB = fallbackB ? distance(b, fallbackB.position) : Number.MAX_SAFE_INTEGER;
                return distA - distB;
              });
            if (options[0]) {
              enemy.position = options[0];
              enemy.moved = true;
              state.latestCombatEvent = null;
              await emitState(room);
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
            healTarget = getBestHealableTarget(state, enemy);
          }

          if (healTarget) {
            resolveHeal(state, enemy, healTarget);
            enemy.acted = true;
            state.latestCombatEvent = { attackerId: enemy.id, type: 'heal' };
            await emitState(room);
            state.latestCombatEvent = null;
            await new Promise(resolve => setTimeout(resolve, 2500));
            continue;
          }
        }
      }

      const livingPlayers = state.units.filter((unit) => unit.team === "player" && unit.alive);
      if (livingPlayers.length === 0) {
        break;
      }
      const target = [...livingPlayers].sort((a, b) => distance(enemy.position, a.position) - distance(enemy.position, b.position))[0];
      const shouldAdvance = (enemy.aiBehavior ?? "advance") === "advance";
      if (shouldAdvance && !canUnitAttackAtDistance(enemy, distance(enemy.position, target.position))) {
        const options = movementRange(state, enemy)
          .filter((option) => !unitAt(state, option))
          .sort((a, b) => {
            const distanceA = distance(a, target.position);
            const distanceB = distance(b, target.position);
            const aCanAttack = canUnitAttackAtDistance(enemy, distanceA) ? 0 : 1;
            const bCanAttack = canUnitAttackAtDistance(enemy, distanceB) ? 0 : 1;
            if (aCanAttack !== bCanAttack) {
              return aCanAttack - bCanAttack;
            }
            return distanceA - distanceB;
          });
        if (options[0]) {
          enemy.position = options[0];
          enemy.moved = true;
          state.latestCombatEvent = null;
          await emitState(room);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      const victim = attackableTargets(state, enemy).sort((a, b) => a.stats.hp - b.stats.hp)[0];
      if (victim) {
        resolveAttack(state, enemy, victim);
        enemy.acted = true;
        state.latestCombatEvent = { attackerId: enemy.id, type: 'attack' };
        await emitState(room);
        state.latestCombatEvent = null;
        await new Promise(resolve => setTimeout(resolve, 2500));
      } else {
        enemy.acted = true;
      }
    }
  } catch (err) {
    console.error("[takeEnemyPhase] Error during enemy loop:", err);
  }

  checkWinState(state);
  state.latestCombatEvent = null;
  state.latestLevelUpEvent = null;
  state.latestPromotionEvent = null;
  if (state.status !== "complete" && state.phase === "enemy") {
    state.phase = "player";
    state.turnCount += 1;
    resetPlayerActions(state);
    spawnDefendReinforcements(state);
    spawnCampaignReinforcements(state);
    // Skill: Renewal — restore 10% max HP at the start of each player phase
    for (const unit of state.units.filter((u) => u.alive && u.team === "player" && u.skillId === "renewal")) {
      const healAmt = Math.max(1, Math.floor(unit.stats.maxHp * 0.1));
      if (unit.stats.hp < unit.stats.maxHp) {
        unit.stats.hp = Math.min(unit.stats.maxHp, unit.stats.hp + healAmt);
        pushLog(state, `${unit.name}'s Renewal restores ${healAmt} HP.`);
      }
    }
    // Skill: Relief — restore 20% max HP at the start of player phase if no ally is adjacent
    for (const unit of state.units.filter((u) => u.alive && u.team === "player" && u.skillId === "relief")) {
      const hasAdjacentAlly = state.units.some(
        (other) => other.alive && other.id !== unit.id && other.team === "player" &&
          Math.abs(other.position.x - unit.position.x) + Math.abs(other.position.y - unit.position.y) === 1
      );
      if (!hasAdjacentAlly && unit.stats.hp < unit.stats.maxHp) {
        const healAmt = Math.max(1, Math.floor(unit.stats.maxHp * 0.2));
        unit.stats.hp = Math.min(unit.stats.maxHp, unit.stats.hp + healAmt);
        pushLog(state, `${unit.name}'s Relief restores ${healAmt} HP.`);
      }
    }
    pushLog(state, `Turn ${state.turnCount} begins.`);
  }
  try {
    await emitState(room);
  } catch (err) {
    console.error("[takeEnemyPhase] Failed to emit final state, broadcasting directly:", err);
    io.to(state.roomCode).emit("stateUpdated", clone(state));
  }
}

async function ensureRoom(socketId: string, roomCode: string) {
  const room = await getOrLoadRoom(roomCode);
  if (!room) {
    io.to(socketId).emit("errorMessage", "Room not found.");
    return null;
  }
  return room;
}

async function markDisconnected(playerId: string) {
  for (const room of rooms.values()) {
    const player = room.state.players.find((entry) => entry.id === playerId);
    if (player) {
      player.connected = false;
      room.sockets.delete(playerId);
      pushLog(room.state, `${player.name} disconnected.`);
      await emitState(room);
    }
  }
}

async function leaveRoomByPlayerId(playerId: string) {
  for (const room of rooms.values()) {
    const player = room.state.players.find((entry) => entry.id === playerId);
    if (player) {
      player.connected = false;
      room.sockets.delete(playerId);
      pushLog(room.state, `${player.name} left the chapter view.`);
      await emitState(room);
      return room;
    }
  }

  return null;
}

io.on("connection", (socket) => {
  let playerId = "";

  socket.on("createRoom", async ({ name, userId, campaign }, callback) => {
    const trimmedName = name.trim().slice(0, 20);
    if (!trimmedName) {
      callback({ ok: false, message: "Choose a player name." });
      return;
    }

    let sanitizedCampaign: CampaignRecord | null = null;
    if (campaign) {
      try {
        sanitizedCampaign = sanitizeCampaignRecord(campaign, campaign.id);
      } catch {
        sanitizedCampaign = null;
      }
      if (!sanitizedCampaign) {
        callback({ ok: false, message: "That campaign could not be loaded." });
        return;
      }
    }

    let roomCode = createRoomCode();
    while (rooms.has(roomCode)) {
      roomCode = createRoomCode();
    }

    playerId = cryptoRandomId();
    const room = { state: initialState(roomCode, playerId, trimmedName, sanitizedCampaign), sockets: new Map<string, string>() };
    room.state.players[0].userId = userId;
    room.sockets.set(playerId, socket.id);
    rooms.set(roomCode, room);
    socket.join(roomCode);
    callback({ ok: true, roomCode, playerId } satisfies JoinRoomResponse);
    await emitState(room);
  });

  socket.on("joinRoom", async ({ roomCode, name, userId }, callback) => {
    const room = await getOrLoadRoom(roomCode);
    const trimmedName = name.trim().slice(0, 20);
    if (!room) {
      callback({ ok: false, message: "That room code does not exist." });
      return;
    }
    if (!trimmedName) {
      callback({ ok: false, message: "Choose a player name." });
      return;
    }
    if (room.state.players.length >= PLAYER_LIMIT) {
      callback({ ok: false, message: "The room is full." });
      return;
    }

    playerId = cryptoRandomId();
    const player: PlayerPresence = {
      id: playerId,
      name: trimmedName,
      connected: true,
      isHost: false,
      userId,
      gold: 0
    };
    room.state.players.push(player);
    room.sockets.set(playerId, socket.id);
    socket.join(room.state.roomCode);
    pushLog(room.state, `${trimmedName} joined the room.`);
    callback({ ok: true, roomCode: room.state.roomCode, playerId });
    await emitState(room);
  });

  socket.on("resumeSession", async ({ roomCode, playerId: requestedPlayerId, name, userId }, callback) => {
    const room = await getOrLoadRoom(roomCode);
    const trimmedName = name.trim().slice(0, 20);
    if (!room) {
      callback({ ok: false, message: "Saved room was not found." });
      return;
    }

    const player = room.state.players.find((entry) => entry.id === requestedPlayerId && entry.name === trimmedName);
    if (!player) {
      callback({ ok: false, message: "Saved player session could not be restored." });
      return;
    }

    playerId = requestedPlayerId;
    player.connected = true;
    if (userId) {
      player.userId = userId;
    }
    room.sockets.set(playerId, socket.id);
    socket.join(room.state.roomCode);
    pushLog(room.state, `${player.name} rejoined the battle.`);
    callback({ ok: true, roomCode: room.state.roomCode, playerId, resumed: true });
    await emitState(room);
  });

  socket.on("createCharacter", async ({ roomCode, name, className, portraitUrl, skillId }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || room.state.status !== "lobby" || !playerId) {
      return;
    }
    const player = findPlayer(room.state, playerId);
    const trimmedName = name.trim().slice(0, 20);
    if (!player || !trimmedName) {
      return;
    }
    const owned = room.state.characterDrafts.filter((draft) => draft.ownerId === playerId);
    if (owned.length >= CHARACTER_LIMIT) {
      io.to(socket.id).emit("errorMessage", `Each player can create up to ${CHARACTER_LIMIT} units.`);
      return;
    }
    if (room.state.campaign && room.state.characterDrafts.length >= room.state.campaign.allowedPlayerUnits) {
      io.to(socket.id).emit("errorMessage", `This campaign only allows ${room.state.campaign.allowedPlayerUnits} player units.`);
      return;
    }

    const draft: CharacterDraft = {
      id: cryptoRandomId(),
      ownerId: playerId,
      name: trimmedName,
      className,
      portraitUrl: portraitUrl?.startsWith("data:image/") ? portraitUrl : undefined,
      skillId
    };
    room.state.characterDrafts.push(draft);
    pushLog(room.state, `${player.name} recruited ${draft.name} the ${draft.className}.`);
    await emitState(room);
  });

  socket.on("removeCharacterDraft", async ({ roomCode, draftId }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || room.state.status !== "lobby" || !playerId || room.state.hostId !== playerId) {
      return;
    }

    const draftIndex = room.state.characterDrafts.findIndex((draft) => draft.id === draftId);
    if (draftIndex === -1) {
      return;
    }

    const [removedDraft] = room.state.characterDrafts.splice(draftIndex, 1);
    const removedBy = findPlayer(room.state, playerId)?.name ?? "DM";
    pushLog(room.state, `${removedBy} removed ${removedDraft.name} the ${removedDraft.className} from the party.`);
    await emitState(room);
  });

  socket.on("startBattle", async ({ roomCode }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || room.state.status !== "lobby" || room.state.hostId !== playerId) {
      return;
    }
    if (room.state.characterDrafts.length === 0) {
      io.to(socket.id).emit("errorMessage", "Add at least one character before starting.");
      return;
    }
    resetBattleState(room.state);
    captureMapStartPlayerUnits(room.state);
    pushLog(room.state, room.state.campaign ? `${room.state.campaign.name} began.` : "Battle started.");
    await emitState(room);
  });

  socket.on("selectUnit", async ({ roomCode, unitId }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || !playerId) {
      return;
    }
    const unit = findUnit(room.state, unitId);
    if (!unit || unit.acted || !canControlUnit(room.state, playerId, unit)) {
      return;
    }

    if (room.state.selectedUnitId === unit.id) {
      room.state.selectedUnitId = null;
      room.state.highlights = [];
      room.state.activePlayerId = playerId;
      await emitState(room);
      return;
    }

    room.state.selectedUnitId = unit.id;
    room.state.highlights = unit.moved ? [] : movementRange(room.state, unit);
    room.state.activePlayerId = playerId;
    await emitState(room);
  });

  socket.on("moveUnit", async ({ roomCode, unitId, position }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || !playerId) {
      return;
    }
    const unit = findUnit(room.state, unitId);
    if (!unit || unit.acted || unit.moved || !canControlUnit(room.state, playerId, unit)) {
      return;
    }
    const legal = movementRange(room.state, unit).some((tile) => tile.x === position.x && tile.y === position.y);
    if (!legal || !isPassableTile(room.state.map, position) || unitAt(room.state, position)) {
      io.to(socket.id).emit("errorMessage", "That move is not valid.");
      return;
    }
    unit.originalPosition = { ...unit.position };
    unit.position = position;
    unit.moved = true;
    room.state.selectedUnitId = unit.id;
    room.state.highlights = [];
    room.state.activePlayerId = playerId;
    pushLog(room.state, `${unit.name} moved to (${position.x + 1}, ${position.y + 1}).`);
    checkWinState(room.state);
    await emitState(room);
  });

  socket.on("attackUnit", async ({ roomCode, attackerId, targetId }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || !playerId) {
      return;
    }
    const attacker = findUnit(room.state, attackerId);
    const target = findUnit(room.state, targetId);
    if (!attacker || !target || attacker.acted || !canControlUnit(room.state, playerId, attacker)) {
      return;
    }
    if (!attackableTargets(room.state, attacker).some((unit) => unit.id === target.id)) {
      io.to(socket.id).emit("errorMessage", "Target is out of range.");
      return;
    }
    resolveAttack(room.state, attacker, target);
    room.state.latestCombatEvent = { attackerId: attacker.id, type: 'attack' };
    checkWinState(room.state);
    await emitState(room);
    room.state.latestCombatEvent = null;
    room.state.latestLevelUpEvent = null;
    room.state.latestPromotionEvent = null;
    if (room.state.phase === "player" && room.state.status !== "complete" && allPlayerUnitsActed(room.state)) {
      await takeEnemyPhase(room);
      return;
    }
    await emitState(room);
  });

  socket.on("healUnit", async ({ roomCode, healerId, targetId }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || !playerId) {
      return;
    }
    const healer = findUnit(room.state, healerId);
    const target = findUnit(room.state, targetId);
    if (!healer || !target || healer.acted || !canControlUnit(room.state, playerId, healer)) {
      return;
    }
    if (healer.id === target.id) {
      io.to(socket.id).emit("errorMessage", "A unit cannot heal itself.");
      return;
    }
    if (!isStaffClass(healer.className) || target.team !== "player") {
      io.to(socket.id).emit("errorMessage", "Only staff classes can heal allied units.");
      return;
    }
    const distance = Math.abs(healer.position.x - target.position.x) + Math.abs(healer.position.y - target.position.y);
    if (distance > healer.stats.range) {
      io.to(socket.id).emit("errorMessage", "Target is out of range.");
      return;
    }
    resolveHeal(room.state, healer, target);
    healer.acted = true;
    room.state.selectedUnitId = null;
    room.state.highlights = [];
    room.state.latestCombatEvent = { attackerId: healer.id, type: 'heal' };
    await emitState(room);
    room.state.latestCombatEvent = null;
    room.state.latestLevelUpEvent = null;
    room.state.latestPromotionEvent = null;
    if (room.state.phase === "player" && allPlayerUnitsActed(room.state)) {
      await takeEnemyPhase(room);
      return;
    }
    await emitState(room);
  });

  socket.on("danceUnit", async ({ roomCode, dancerId, targetId }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || !playerId) {
      return;
    }
    const dancer = findUnit(room.state, dancerId);
    const target = findUnit(room.state, targetId);
    if (!dancer || !target || dancer.acted || !canControlUnit(room.state, playerId, dancer)) {
      return;
    }
    if (!isDancerClass(dancer.className)) {
      io.to(socket.id).emit("errorMessage", "Only Dancers can use Dance.");
      return;
    }
    if (target.team !== "player" || !target.alive) {
      io.to(socket.id).emit("errorMessage", "Dance can only target an allied unit.");
      return;
    }
    if (target.id === dancer.id) {
      io.to(socket.id).emit("errorMessage", "A dancer cannot dance for themselves.");
      return;
    }
    if (!target.acted) {
      io.to(socket.id).emit("errorMessage", "That unit has not acted yet and does not need to be danced.");
      return;
    }
    const dist = Math.abs(dancer.position.x - target.position.x) + Math.abs(dancer.position.y - target.position.y);
    if (dist > 1) {
      io.to(socket.id).emit("errorMessage", "Dance target must be adjacent.");
      return;
    }
    // Grant the target a second turn
    target.acted = false;
    target.moved = false;
    target.originalPosition = { ...target.position };
    pushLog(room.state, `${dancer.name} danced for ${target.name}, granting them another turn!`);
    // Galeforce: 50% chance the dancer is not marked as acted
    const galeforceActivated = dancer.skillId === "galeforce" && Math.random() < 0.5;
    if (galeforceActivated) {
      pushLog(room.state, `${dancer.name}'s Galeforce activates! They can still act this turn.`);
    } else {
      dancer.acted = true;
    }
    room.state.selectedUnitId = null;
    room.state.highlights = [];
    if (allPlayerUnitsActed(room.state)) {
      await takeEnemyPhase(room);
      return;
    }
    await emitState(room);
  });

  socket.on("advanceToBaseCamp", async ({ roomCode }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || room.state.hostId !== playerId) {
      return;
    }
    if (
      room.state.chapter >= getCampaignChapterLimit(room.state) ||
      room.state.phase !== "victory" ||
      room.state.winner !== "player"
    ) {
      io.to(socket.id).emit("errorMessage", "Base Camp can only be opened after a chapter victory.");
      return;
    }
    room.state.phase = "basecamp";
    room.state.status = "battle";
    for (const player of room.state.players) {
      player.gold += 1000;
    }
    pushLog(room.state, "The party arrives at the base camp.");
    pushLog(room.state, "Each player receives 1000 gold!");
    await emitState(room);
  });

  socket.on("waitUnit", async ({ roomCode, unitId }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || !playerId) {
      return;
    }
    const unit = findUnit(room.state, unitId);
    if (!unit || unit.acted || !canControlUnit(room.state, playerId, unit)) {
      return;
    }
    unit.acted = true;
    room.state.selectedUnitId = null;
    room.state.highlights = [];
    pushLog(room.state, `${unit.name} waited.`);
    if (allPlayerUnitsActed(room.state)) {
      await takeEnemyPhase(room);
    }
    await emitState(room);
  });

  socket.on("cancelMove", async ({ roomCode, unitId }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || !playerId) {
      return;
    }
    const unit = findUnit(room.state, unitId);
    if (!unit || unit.acted || !unit.moved || !canControlUnit(room.state, playerId, unit)) {
      return;
    }
    unit.position = { ...unit.originalPosition };
    unit.moved = false;
    room.state.selectedUnitId = unit.id;
    room.state.highlights = movementRange(room.state, unit);
    room.state.activePlayerId = playerId;
    pushLog(room.state, `${unit.name} canceled their move.`);
    await emitState(room);
  });

  socket.on("equipWeapon", async ({ roomCode, unitId, weaponId }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || !playerId) {
      return;
    }
    const unit = findUnit(room.state, unitId);
    if (!unit || !canControlUnit(room.state, playerId, unit)) {
      return;
    }
    if (weaponId === null) {
      unit.equippedWeapon = null;
    } else {
      const weapon = unit.inventory.weapons.find(w => w.id === weaponId);
      if (!weapon) {
        return;
      }
      unit.equippedWeapon = weapon;
    }
    await emitState(room);
  });

  socket.on("useItem", async ({ roomCode, unitId, itemId }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || !playerId) {
      return;
    }
    const unit = findUnit(room.state, unitId);
    if (!unit || unit.acted || !canControlUnit(room.state, playerId, unit)) {
      return;
    }
    const itemIndex = unit.inventory.items.findIndex(i => i.id === itemId);
    if (itemIndex === -1) {
      return;
    }
    const item = unit.inventory.items[itemIndex];
    if (item.type === "Potion") {
      const healAmount = getConsumableHealAmount(item);
      const recoveredHp = Math.min(healAmount, unit.stats.maxHp - unit.stats.hp);
      unit.stats.hp = Math.min(unit.stats.maxHp, unit.stats.hp + healAmount);
      pushLog(room.state, `${unit.name} used ${item.name} and recovered ${recoveredHp} HP.`);
      unit.inventory.items.splice(itemIndex, 1);
      unit.acted = true;
      room.state.selectedUnitId = null;
      room.state.highlights = [];
      room.state.latestCombatEvent = null;
      if (allPlayerUnitsActed(room.state)) {
        await takeEnemyPhase(room);
      }
    }
    await emitState(room);
  });

  socket.on("endTurn", async ({ roomCode }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || room.state.phase !== "player" || room.state.status !== "battle") {
      return;
    }
    for (const unit of room.state.units.filter((entry) => entry.team === "player" && entry.alive)) {
      unit.acted = true;
    }
    pushLog(room.state, "The party ended the phase.");
    await takeEnemyPhase(room);
    await emitState(room);
  });

  socket.on("restartMap", async ({ roomCode }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || room.state.hostId !== playerId) {
      return;
    }
    if (room.state.status === "lobby") {
      io.to(socket.id).emit("errorMessage", "Start the battle before restarting the map.");
      return;
    }
    resetBattleState(room.state);
    pushLog(room.state, "The DM restarted the map.");
    await emitState(room);
  });

  socket.on("buyWeapon", async ({ roomCode, playerId: buyerId, weaponId, unitId }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || room.state.phase !== "basecamp" || playerId !== buyerId) {
      return;
    }
    const player = findPlayer(room.state, buyerId);
    const unit = findUnit(room.state, unitId);
    const weapon = WEAPONS.find(w => w.id === weaponId);
    if (!player || !unit || !weapon || !weapon.price || player.gold < weapon.price || unit.ownerId !== buyerId) {
      io.to(socket.id).emit("errorMessage", "Cannot purchase this weapon.");
      return;
    }
    player.gold -= weapon.price;
    unit.inventory.weapons.push(weapon);
    pushLog(room.state, `${player.name} bought a ${weapon.name} for ${unit.name}.`);
    await emitState(room);
  });

  socket.on("buyItem", async ({ roomCode, playerId: buyerId, itemId, unitId }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || room.state.phase !== "basecamp" || playerId !== buyerId) {
      return;
    }
    const player = findPlayer(room.state, buyerId);
    const unit = findUnit(room.state, unitId);
    const item = ITEMS.find(i => i.id === itemId);
    if (!player || !unit || !item || !item.price || player.gold < item.price || unit.ownerId !== buyerId) {
      io.to(socket.id).emit("errorMessage", "Cannot purchase this item.");
      return;
    }
    player.gold -= item.price;
    unit.inventory.items.push(item);
    pushLog(room.state, `${player.name} bought a ${item.name} for ${unit.name}.`);
    await emitState(room);
  });

  socket.on("advanceToChapter", async ({ roomCode }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || room.state.phase !== "basecamp" || room.state.hostId !== playerId) {
      return;
    }
    if (room.state.chapter >= getCampaignChapterLimit(room.state)) {
      io.to(socket.id).emit("errorMessage", "The campaign is already at the final chapter.");
      return;
    }
    room.state.chapter += 1;
    resetBattleState(room.state, { preservePlayerProgress: true });
    captureMapStartPlayerUnits(room.state);
    pushLog(room.state, `The DM advanced to Chapter ${room.state.chapter}.`);
    await emitState(room);
  });

  socket.on("endGame", async ({ roomCode }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || room.state.hostId !== playerId) {
      return;
    }
    if (room.state.status === "complete") {
      return;
    }
    room.state.status = "complete";
    room.state.phase = "defeat";
    room.state.winner = "enemy";
    pushLog(room.state, "The DM ended the game.");
    await emitState(room);
  });

  socket.on("sendChatMessage", async ({ roomCode, text }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || !playerId) {
      return;
    }
    const player = room.state.players.find((entry) => entry.id === playerId);
    if (!player) {
      return;
    }

    const trimmed = sanitizeChatText(text);
    if (!trimmed) {
      return;
    }

    pushChat(room.state, player.id, player.name, trimmed);
    await emitState(room);
  });

  socket.on("leaveRoom", async ({ roomCode }, callback) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || !playerId) {
      callback({ ok: false });
      return;
    }
    const player = room.state.players.find((entry) => entry.id === playerId);
    if (!player) {
      callback({ ok: false });
      return;
    }
    socket.leave(room.state.roomCode);
    await leaveRoomByPlayerId(playerId);
    playerId = "";
    callback({ ok: true });
  });

  socket.on("disconnect", async () => {
    if (playerId) {
      await markDisconnected(playerId);
    }
  });
});

const port = Number(process.env.PORT ?? 3001);

async function start() {
  await ensureDatabase();
  httpServer.listen(port, () => {
    console.log(`Fire Emblem Online server listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start Fire Emblem Online server.", error);
  process.exit(1);
});
