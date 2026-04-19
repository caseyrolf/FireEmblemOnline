import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  calculateDamage,
  calculateHitChance,
  calculateCritChance,
  canUnitAttackAtDistance,
  checkIfDoubles,
  CLASS_GROWTH_RATES,
  CLASS_TEMPLATES,
  getPromotedClass,
  getPortraitForUnit,
  getTerrainDefense,
  isStaffClass,
  PROMOTION_BONUSES,
  type AuthUser,
  type BaseUnitClass,
  type CharacterDraft,
  type ClientToServerEvents,
  type CombatLogEntry,
  type GameMap,
  type GameState,
  type Item,
  type JoinRoomResponse,
  type PlayerPresence,
  type Position,
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
  createProfileCharacter,
  createUserAccount,
  deleteAuthSession,
  deleteProfileCharacter,
  ensureDatabase,
  findUserByEmail,
  getSessionUser,
  listProfileCharacters,
  loadRoomState,
  recordRoomOutcome,
  saveRoomState
} from "./db.js";

type Room = {
  state: GameState;
  sockets: Map<string, string>;
};

type AuthedRequest = express.Request & {
  authUser?: AuthUser;
  authToken?: string;
};

const app = express();
app.use(cors());
app.use(express.json());

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
    portraitUrl
  });
  res.status(201).json({ character: record });
});

app.delete("/api/profile/characters/:id", authenticateRequest, async (req: AuthedRequest, res) => {
  await deleteProfileCharacter(String(req.params.id), req.authUser!.id);
  res.json({ ok: true });
});

app.get("/api/profile/games", authenticateRequest, async (req: AuthedRequest, res) => {
  const games = await listActiveGamesForUser(req.authUser!.id);
  res.json({ games });
});

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
const PLAYER_INITIATE_COMBAT_EXP = 20;
const PLAYER_DEFEND_COMBAT_EXP = 10;
const EXP_PER_LEVEL = 100;
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

function cryptoRandomId() {
  return Math.random().toString(36).slice(2, 10);
}

function initialState(roomCode: string, hostId: string, hostName: string): GameState {
  return {
    roomCode,
    status: "lobby",
    hostId,
    phase: "player",
    turnCount: 1,
    activePlayerId: null,
    players: [{ id: hostId, name: hostName, connected: true, isHost: true, gold: 0 }],
    characterDrafts: [],
    map: createMap(1),
    units: [],
    selectedUnitId: null,
    highlights: [],
    logs: [{ id: cryptoRandomId(), text: `${hostName} opened room ${roomCode}.` }],
    chatMessages: [],
    winner: null,
    outcomeRecorded: false,
    chapter: 1,
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
    base.hp = Math.max(1, Math.min(base.maxHp, base.hp - hpPenalty));
    base.str = Math.max(template.str, base.str - statPenalty);
    base.mag = Math.max(template.mag, base.mag - statPenalty);
    base.skl = Math.max(template.skl, base.skl - statPenalty);
    base.spd = Math.max(template.spd, base.spd - statPenalty);
    base.def = Math.max(template.def, base.def - statPenalty);
    base.res = Math.max(template.res, base.res - statPenalty);
  }

  // Global enemy nerf to keep battles less punishing on compact maps.
  base.maxHp = Math.max(1, base.maxHp - 3);
  base.hp = Math.max(1, Math.min(base.maxHp, base.hp - 3));
  base.str = Math.max(0, base.str - 1);
  base.mag = Math.max(0, base.mag - 1);
  base.skl = Math.max(0, base.skl - 1);
  base.spd = Math.max(0, base.spd - 1);
  base.def = Math.max(0, base.def - 1);
  base.res = Math.max(0, base.res - 1);

  return base;
}

function getWeaponsForClass(className: UnitClass): Weapon[] {
  switch (className) {
    case "Lord":
    case "Great Lord":
    case "Mercenary":
    case "Hero":
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
    equippedWeapon: getWeaponsForClass(draft.className)[0] || null // equip first weapon
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

function spawnUnits(state: GameState, options?: { preservePlayerProgress?: boolean }) {
  const occupiedSpawnTiles = new Set<string>();
  const preservePlayerProgress = options?.preservePlayerProgress ?? false;

  const playerUnits: Unit[] = state.characterDrafts.map((draft, index) => {
    if (preservePlayerProgress) {
      return buildChapterCarryoverUnit(state, draft, index, occupiedSpawnTiles);
    }
    return buildFreshPlayerUnit(state, draft, index, occupiedSpawnTiles);
  });

  let enemies: Array<{ name: string; className: UnitClass; position: Position }> = [];
  if (state.chapter === 1) {
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

  const enemyUnits: Unit[] = enemies.map((enemy) => {
    const position = findNearestOpenSpawn(state.map, enemy.position, occupiedSpawnTiles);
    return {
      id: cryptoRandomId(),
      name: enemy.name,
      className: enemy.className,
      team: "enemy",
      portraitUrl: getPortraitForUnit("enemy", enemy.className),
      position,
      originalPosition: { ...position },
      stats: seededEnemyStats(enemy.className, state.chapter, enemies.length),
      acted: false,
      moved: false,
      level: state.chapter,
      exp: 0,
      alive: true,
      inventory: {
        weapons: getWeaponsForClass(enemy.className),
        items: []
      },
      equippedWeapon: getWeaponsForClass(enemy.className)[0] || null // equip first weapon
    };
  });

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
  state.map = createMap(state.chapter);
  spawnUnits(state, options);
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

function resolveAttack(state: GameState, attacker: Unit, defender: Unit) {
  const defenderTerrainDefense = getTerrainDefense(state.map, defender.position);
  const attackerTerrainDefense = getTerrainDefense(state.map, attacker.position);
  let playerCombatExpAward = 0;
  let playerCombatExpRecipient: Unit | null = null;

  if (attacker.team === "player") {
    playerCombatExpRecipient = attacker;
    playerCombatExpAward += PLAYER_INITIATE_COMBAT_EXP;
  } else if (attacker.team === "enemy" && defender.team === "player") {
    playerCombatExpRecipient = defender;
    playerCombatExpAward += PLAYER_DEFEND_COMBAT_EXP;
  }

  // Determine number of attacks
  let attackerAttacks = 1;
  let defenderAttacks = 1;
  if (checkIfDoubles(attacker, defender)) {
    attackerAttacks = 2;
  } else if (checkIfDoubles(defender, attacker)) {
    defenderAttacks = 2;
  }

  // Attacker's attacks
  for (let i = 0; i < attackerAttacks && defender.stats.hp > 0; i++) {
    const hitChance = calculateHitChance(attacker, defender);
    const hitRoll = Math.random() * 100;
    if (hitRoll < hitChance) {
      const critChance = calculateCritChance(attacker, defender);
      const critRoll = Math.random() * 100;
      const isCrit = critRoll < critChance;
      const baseDamage = calculateDamage(attacker, defender, defenderTerrainDefense);
      const damage = isCrit ? baseDamage * 2 : baseDamage;
      defender.stats.hp = Math.max(0, defender.stats.hp - damage);
      const critText = isCrit ? " (critical!)" : "";
      pushLog(state, `${attacker.name} hit ${defender.name} for ${damage} damage${critText}.`);
    } else {
      pushLog(state, `${attacker.name} missed ${defender.name}.`);
    }
  }

  if (defender.stats.hp === 0) {
    defender.alive = false;
    pushLog(state, `${defender.name} was defeated.`);
    if (attacker.team === "player") {
      playerCombatExpAward += 50;
    }
  } else {
    // Defender's counterattacks
    const retaliateDistance = distance(attacker.position, defender.position);
    if (canUnitAttackAtDistance(defender, retaliateDistance)) {
      for (let i = 0; i < defenderAttacks && attacker.stats.hp > 0; i++) {
        const hitChance = calculateHitChance(defender, attacker);
        const hitRoll = Math.random() * 100;
        if (hitRoll < hitChance) {
          const critChance = calculateCritChance(defender, attacker);
          const critRoll = Math.random() * 100;
          const isCrit = critRoll < critChance;
          const baseDamage = calculateDamage(defender, attacker, attackerTerrainDefense);
          const damage = isCrit ? baseDamage * 2 : baseDamage;
          attacker.stats.hp = Math.max(0, attacker.stats.hp - damage);
          const critText = isCrit ? " (critical!)" : "";
          pushLog(state, `${defender.name} countered for ${damage}${critText}.`);
        } else {
          pushLog(state, `${defender.name} missed ${attacker.name}.`);
        }
      }
      if (attacker.stats.hp === 0) {
        attacker.alive = false;
        pushLog(state, `${attacker.name} fell in battle.`);
      }
    }
  }

  if (playerCombatExpRecipient) {
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

function checkWinState(state: GameState) {
  const livingPlayers = state.units.filter((unit) => unit.team === "player" && unit.alive);
  const livingEnemies = state.units.filter((unit) => unit.team === "enemy" && unit.alive);
  const objective = state.map.objective;

  if (objective.type === "arrive" && objective.target) {
    const arrived = livingPlayers.some(
      (unit) => unit.position.x === objective.target!.x && unit.position.y === objective.target!.y
    );
    if (arrived) {
      if (state.chapter < CAMPAIGN_FINAL_CHAPTER) {
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
    if (state.chapter < CAMPAIGN_FINAL_CHAPTER) {
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
    if (state.chapter < CAMPAIGN_FINAL_CHAPTER) {
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

  for (const enemy of state.units.filter((unit) => unit.team === "enemy" && unit.alive)) {
    const livingPlayers = state.units.filter((unit) => unit.team === "player" && unit.alive);
    if (livingPlayers.length === 0) {
      break;
    }
    const target = [...livingPlayers].sort((a, b) => distance(enemy.position, a.position) - distance(enemy.position, b.position))[0];
    if (!canUnitAttackAtDistance(enemy, distance(enemy.position, target.position))) {
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
      state.latestCombatEvent = { attackerId: enemy.id, type: 'attack' };
      await emitState(room);
      state.latestCombatEvent = null;
      await new Promise(resolve => setTimeout(resolve, 2500));
    } else {
      enemy.acted = true;
    }
  }

  checkWinState(state);
  state.latestCombatEvent = null;
  if (state.status !== "complete" && state.phase === "enemy") {
    state.phase = "player";
    state.turnCount += 1;
    resetPlayerActions(state);
    pushLog(state, `Turn ${state.turnCount} begins.`);
  }
  await emitState(room);
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

  socket.on("createRoom", async ({ name, userId }, callback) => {
    const trimmedName = name.trim().slice(0, 20);
    if (!trimmedName) {
      callback({ ok: false, message: "Choose a player name." });
      return;
    }

    let roomCode = createRoomCode();
    while (rooms.has(roomCode)) {
      roomCode = createRoomCode();
    }

    playerId = cryptoRandomId();
    const room = { state: initialState(roomCode, playerId, trimmedName), sockets: new Map<string, string>() };
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

  socket.on("createCharacter", async ({ roomCode, name, className, portraitUrl }) => {
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

    const draft: CharacterDraft = {
      id: cryptoRandomId(),
      ownerId: playerId,
      name: trimmedName,
      className,
      portraitUrl: portraitUrl?.startsWith("data:image/") ? portraitUrl : undefined
    };
    room.state.characterDrafts.push(draft);
    pushLog(room.state, `${player.name} recruited ${draft.name} the ${draft.className}.`);
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
    pushLog(room.state, "Battle started.");
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

  socket.on("advanceToBaseCamp", async ({ roomCode }) => {
    const room = await ensureRoom(socket.id, roomCode);
    if (!room || room.state.hostId !== playerId) {
      return;
    }
    if (
      room.state.chapter >= CAMPAIGN_FINAL_CHAPTER ||
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
      unit.stats.hp = Math.min(unit.stats.maxHp, unit.stats.hp + 10);
      pushLog(room.state, `${unit.name} used a potion and recovered 10 HP.`);
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
    if (!(room.state.status === "complete" && room.state.winner === "enemy")) {
      io.to(socket.id).emit("errorMessage", "The DM can only restart after a defeat.");
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
    if (room.state.chapter >= CAMPAIGN_FINAL_CHAPTER) {
      io.to(socket.id).emit("errorMessage", "The campaign is already at the final chapter.");
      return;
    }
    room.state.chapter += 1;
    resetBattleState(room.state, { preservePlayerProgress: true });
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
    console.log(`Fire Emblem Online server listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start Fire Emblem Online server.", error);
  process.exit(1);
});
