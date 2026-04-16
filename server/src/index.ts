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
  CLASS_TEMPLATES,
  getPortraitForUnit,
  getTerrainDefense,
  type AuthUser,
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
const EXP_PER_LEVEL = 100;

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

function createMap(chapter: number = 1): GameMap {
  if (chapter === 1) {
    const layout = [
      ["grass", "grass", "forest", "grass", "grass", "forest", "grass", "goal"],
      ["grass", "mountain", "mountain", "grass", "forest", "grass", "grass", "grass"],
      ["fort", "grass", "grass", "grass", "grass", "forest", "mountain", "grass"],
      ["grass", "forest", "grass", "mountain", "grass", "grass", "mountain", "grass"],
      ["grass", "grass", "grass", "mountain", "grass", "forest", "grass", "grass"],
      ["grass", "forest", "grass", "grass", "grass", "grass", "grass", "fort"],
      ["grass", "grass", "mountain", "forest", "mountain", "grass", "grass", "grass"],
      ["grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass"]
    ] as const;

    return {
      width: 8,
      height: 8,
      tiles: layout.map((row) => row.map((tile) => makeTile(tile))),
      playerStarts: [
        { x: 0, y: 7 },
        { x: 1, y: 7 },
        { x: 2, y: 7 },
        { x: 0, y: 6 },
        { x: 1, y: 6 },
        { x: 2, y: 5 }
      ],
      objective: {
        type: "route",
        target: { x: 7, y: 0 }
      }
    };
  } else if (chapter === 2) {
    // Chapter 2 map - different layout
    const layout = [
      ["grass", "forest", "grass", "mountain", "grass", "grass", "fort", "goal"],
      ["grass", "grass", "grass", "grass", "forest", "mountain", "grass", "grass"],
      ["fort", "grass", "mountain", "grass", "grass", "grass", "forest", "grass"],
      ["grass", "forest", "grass", "grass", "mountain", "grass", "grass", "grass"],
      ["grass", "grass", "grass", "forest", "grass", "grass", "mountain", "grass"],
      ["grass", "mountain", "grass", "grass", "grass", "forest", "grass", "fort"],
      ["grass", "grass", "forest", "mountain", "grass", "grass", "grass", "grass"],
      ["grass", "grass", "grass", "grass", "grass", "grass", "grass", "grass"]
    ] as const;

    return {
      width: 8,
      height: 8,
      tiles: layout.map((row) => row.map((tile) => makeTile(tile))),
      playerStarts: [
        { x: 0, y: 7 },
        { x: 1, y: 7 },
        { x: 2, y: 7 },
        { x: 0, y: 6 },
        { x: 1, y: 6 },
        { x: 2, y: 5 }
      ],
      objective: {
        type: "route",
        target: { x: 7, y: 0 }
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
    winner: null,
    outcomeRecorded: false,
    chapter: 1,
    latestCombatEvent: null,
    latestLevelUpEvent: null
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
      if (!inBounds(state.map, next)) {
        continue;
      }
      const tile = getTile(state.map, next);
      if (!tile || tile.type === "mountain") {
        continue;
      }
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

function seededEnemyStats(className: UnitClass, level: number = 1) {
  const base = clone(CLASS_TEMPLATES[className]);
  const levelBonus = level - 1;
  base.hp += 4 + levelBonus * 2;
  base.maxHp += 4 + levelBonus * 2;
  base.str += 1 + levelBonus;
  base.mag += 1 + levelBonus;
  base.skl += levelBonus;
  base.spd += levelBonus;
  base.def += levelBonus;
  base.res += levelBonus;
  return base;
}

function getWeaponsForClass(className: UnitClass): Weapon[] {
  switch (className) {
    case "Lord":
    case "Mercenary":
      return WEAPONS.filter(w => w.type === "Sword").slice(0, 2);
    case "Knight":
      return WEAPONS.filter(w => w.type === "Lance").slice(0, 2);
    case "Brigand":
      return WEAPONS.filter(w => w.type === "Axe").slice(0, 2);
    case "Archer":
      return WEAPONS.filter(w => w.type === "Bow").slice(0, 2);
    case "Mage":
      return WEAPONS.filter(w => w.type === "Magic Tome").slice(0, 2);
    case "Cleric":
      return WEAPONS.filter(w => w.type === "Staff").slice(0, 2);
    default:
      return [];
  }
}

function spawnUnits(state: GameState) {
  const playerUnits: Unit[] = state.characterDrafts.map((draft, index) => {
    const position = state.map.playerStarts[index] ?? { x: 0, y: 7 - index };
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
  });

  let enemies: Array<{ name: string; className: UnitClass; position: Position }> = [];
  if (state.chapter === 1) {
    enemies = [
      { name: "Bandit Axer", className: "Brigand", position: { x: 6, y: 1 } },
      { name: "Outlaw Shot", className: "Archer", position: { x: 7, y: 2 } },
      { name: "Fort Guard", className: "Knight", position: { x: 5, y: 5 } }
    ];
  } else if (state.chapter === 2) {
    enemies = [
      { name: "Veteran Brigand", className: "Brigand", position: { x: 6, y: 1 } },
      { name: "Elite Archer", className: "Archer", position: { x: 7, y: 2 } },
      { name: "Armored Knight", className: "Knight", position: { x: 5, y: 5 } },
      { name: "Dark Mage", className: "Mage", position: { x: 4, y: 3 } }
    ];
  }

  const enemyUnits: Unit[] = enemies.map((enemy) => ({
    id: cryptoRandomId(),
    name: enemy.name,
    className: enemy.className,
    team: "enemy",
    portraitUrl: getPortraitForUnit("enemy", enemy.className),
    position: enemy.position,
    originalPosition: { ...enemy.position },
    stats: seededEnemyStats(enemy.className, state.chapter),
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
  }));

  state.units = [...playerUnits, ...enemyUnits];
}

function resetBattleState(state: GameState) {
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
  state.map = createMap(state.chapter);
  spawnUnits(state);
}

function rollLevelUpStatGains(unit: Unit) {
  const growthRates: Record<UnitClass, Partial<Record<keyof Unit["stats"], number>>> = {
    Lord: { maxHp: 80, str: 55, mag: 10, skl: 55, spd: 60, def: 40, res: 30 },
    Mercenary: { maxHp: 75, str: 55, mag: 5, skl: 65, spd: 65, def: 35, res: 20 },
    Mage: { maxHp: 60, str: 0, mag: 70, skl: 50, spd: 55, def: 20, res: 45 },
    Cleric: { maxHp: 65, str: 0, mag: 65, skl: 45, spd: 50, def: 15, res: 60 },
    Knight: { maxHp: 85, str: 60, mag: 0, skl: 45, spd: 30, def: 70, res: 15 },
    Brigand: { maxHp: 85, str: 65, mag: 0, skl: 35, spd: 40, def: 30, res: 10 },
    Archer: { maxHp: 70, str: 55, mag: 0, skl: 65, spd: 55, def: 25, res: 20 }
  };
  const gains: Array<{ stat: keyof Unit["stats"]; gain: number; newValue: number }> = [];
  const rates = growthRates[unit.className];
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

function grantExp(state: GameState, unit: Unit, amount: number) {
  if (amount <= 0 || !unit.alive) {
    return;
  }
  unit.exp += amount;
  while (unit.exp >= EXP_PER_LEVEL) {
    unit.exp -= EXP_PER_LEVEL;
    unit.level += 1;
    const statGains = rollLevelUpStatGains(unit);
    state.latestLevelUpEvent = {
      unitId: unit.id,
      unitName: unit.name,
      className: unit.className,
      team: unit.team,
      newLevel: unit.level,
      expRemainder: unit.exp,
      statGains
    };
    pushLog(state, `${unit.name} reached level ${unit.level}!`);
  }
}

function resolveAttack(state: GameState, attacker: Unit, defender: Unit) {
  const defenderTerrainDefense = getTerrainDefense(state.map, defender.position);
  const attackerTerrainDefense = getTerrainDefense(state.map, attacker.position);

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
      grantExp(state, attacker, 50);
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
  if (healer.className === "Cleric") {
    grantExp(state, healer, CLERIC_HEAL_EXP);
  }
  pushLog(state, `${healer.name} healed ${target.name} for ${actualHeal} HP.`);
}

function checkWinState(state: GameState) {
  const livingPlayers = state.units.filter((unit) => unit.team === "player" && unit.alive);
  const livingEnemies = state.units.filter((unit) => unit.team === "enemy" && unit.alive);

  if (livingEnemies.length === 0) {
    if (state.chapter === 1) {
      // Keep battle map visible and let the DM advance after the victory moment.
      state.phase = "victory";
      state.status = "battle";
      state.winner = "player";
      pushLog(state, "Chapter 1 cleared! Awaiting the DM to advance to Base Camp.");
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
    if (!legal || unitAt(room.state, position)) {
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
    if (healer.className !== "Cleric" || target.team !== "player") {
      io.to(socket.id).emit("errorMessage", "Only clerics can heal allied units.");
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
    if (room.state.chapter !== 1 || room.state.phase !== "victory" || room.state.winner !== "player") {
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
    room.state.chapter += 1;
    resetBattleState(room.state);
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
