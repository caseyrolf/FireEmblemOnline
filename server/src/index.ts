import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  CLASS_TEMPLATES,
  type CharacterDraft,
  type ClientToServerEvents,
  type CombatLogEntry,
  type GameMap,
  type GameState,
  type JoinRoomResponse,
  type PlayerPresence,
  type Position,
  type ServerToClientEvents,
  type TerrainTile,
  type Unit,
  type UnitClass
} from "../../shared/game.js";
import { ensureDatabase, loadRoomState, saveRoomState } from "./db.js";

type Room = {
  state: GameState;
  sockets: Map<string, string>;
};

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: "*"
  }
});

const rooms = new Map<string, Room>();
const PLAYER_LIMIT = 8;
const CHARACTER_LIMIT = 2;

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
    case "wall":
      return { type, moveCost: 99, defense: 0, avoid: 0 };
    case "goal":
      return { type, moveCost: 1, defense: 0, avoid: 0 };
    default:
      return { type: "grass", moveCost: 1, defense: 0, avoid: 0 };
  }
}

function createMap(): GameMap {
  const layout = [
    ["grass", "grass", "forest", "grass", "grass", "forest", "grass", "goal"],
    ["grass", "wall", "wall", "grass", "forest", "grass", "grass", "grass"],
    ["fort", "grass", "grass", "grass", "grass", "forest", "wall", "grass"],
    ["grass", "forest", "grass", "wall", "grass", "grass", "wall", "grass"],
    ["grass", "grass", "grass", "wall", "grass", "forest", "grass", "grass"],
    ["grass", "forest", "grass", "grass", "grass", "grass", "grass", "fort"],
    ["grass", "grass", "wall", "forest", "wall", "grass", "grass", "grass"],
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
    players: [{ id: hostId, name: hostName, connected: true, isHost: true }],
    characterDrafts: [],
    map: createMap(),
    units: [],
    selectedUnitId: null,
    highlights: [],
    logs: [{ id: cryptoRandomId(), text: `${hostName} opened room ${roomCode}.` }],
    winner: null
  };
}

function getRoom(roomCode: string) {
  return rooms.get(roomCode.toUpperCase());
}

async function emitState(room: Room) {
  await saveRoomState(room.state);
  io.to(room.state.roomCode).emit("stateUpdated", clone(room.state));
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
      if (!tile || tile.type === "wall") {
        continue;
      }
      const occupant = unitAt(state, next);
      if (occupant && occupant.id !== unit.id) {
        continue;
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
      reachable.push(next);
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
    return gap <= unit.stats.range;
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
    }
  }
}

function resetEnemyActions(state: GameState) {
  for (const unit of state.units) {
    if (unit.team === "enemy" && unit.alive) {
      unit.acted = false;
      unit.moved = false;
    }
  }
}

function distance(a: Position, b: Position) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function seededEnemyStats(className: UnitClass) {
  const base = clone(CLASS_TEMPLATES[className]);
  base.hp += 4;
  base.maxHp += 4;
  base.str += 1;
  base.mag += 1;
  return base;
}

function spawnUnits(state: GameState) {
  const playerUnits: Unit[] = state.characterDrafts.map((draft, index) => ({
    id: draft.id,
    name: draft.name,
    className: draft.className,
    team: "player",
    ownerId: draft.ownerId,
    position: state.map.playerStarts[index] ?? { x: 0, y: 7 - index },
    stats: clone(CLASS_TEMPLATES[draft.className]),
    acted: false,
    moved: false,
    level: 1,
    exp: 0,
    alive: true
  }));

  const enemies: Array<{ name: string; className: UnitClass; position: Position }> = [
    { name: "Bandit Axer", className: "Brigand", position: { x: 6, y: 1 } },
    { name: "Outlaw Shot", className: "Archer", position: { x: 7, y: 2 } },
    { name: "Fort Guard", className: "Knight", position: { x: 5, y: 5 } }
  ];

  const enemyUnits: Unit[] = enemies.map((enemy) => ({
    id: cryptoRandomId(),
    name: enemy.name,
    className: enemy.className,
    team: "enemy",
    position: enemy.position,
    stats: seededEnemyStats(enemy.className),
    acted: false,
    moved: false,
    level: 1,
    exp: 0,
    alive: true
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
  spawnUnits(state);
}

function resolveAttack(state: GameState, attacker: Unit, defender: Unit) {
  const terrain = getTile(state.map, defender.position);
  const power = attacker.stats.str || attacker.stats.mag;
  const defense = (attacker.stats.mag > attacker.stats.str ? defender.stats.res : defender.stats.def) + (terrain?.defense ?? 0);
  const damage = Math.max(1, power + Math.floor(attacker.level / 2) - defense);
  defender.stats.hp = Math.max(0, defender.stats.hp - damage);
  attacker.acted = true;
  state.selectedUnitId = null;
  state.highlights = [];
  pushLog(state, `${attacker.name} hit ${defender.name} for ${damage} damage.`);

  if (defender.stats.hp === 0) {
    defender.alive = false;
    pushLog(state, `${defender.name} was defeated.`);
    if (attacker.team === "player") {
      attacker.exp += 30;
    }
  } else {
    const retaliateDistance = distance(attacker.position, defender.position);
    if (retaliateDistance <= defender.stats.range) {
      const counterPower = defender.stats.str || defender.stats.mag;
      const counterDefense =
        (defender.stats.mag > defender.stats.str ? attacker.stats.res : attacker.stats.def) +
        (getTile(state.map, attacker.position)?.defense ?? 0);
      const counterDamage = Math.max(1, counterPower - counterDefense);
      attacker.stats.hp = Math.max(0, attacker.stats.hp - counterDamage);
      pushLog(state, `${defender.name} countered for ${counterDamage}.`);
      if (attacker.stats.hp === 0) {
        attacker.alive = false;
        pushLog(state, `${attacker.name} fell in battle.`);
      }
    }
  }
}

function checkWinState(state: GameState) {
  const livingPlayers = state.units.filter((unit) => unit.team === "player" && unit.alive);
  const livingEnemies = state.units.filter((unit) => unit.team === "enemy" && unit.alive);

  if (livingEnemies.length === 0) {
    state.phase = "victory";
    state.status = "complete";
    state.winner = "player";
    pushLog(state, "The squad cleared the map.");
  } else if (livingPlayers.length === 0) {
    state.phase = "defeat";
    state.status = "complete";
    state.winner = "enemy";
    pushLog(state, "The party was wiped out.");
  }
}

function takeEnemyPhase(state: GameState) {
  state.phase = "enemy";
  state.activePlayerId = null;
  resetEnemyActions(state);
  pushLog(state, "Enemy phase begins.");

  for (const enemy of state.units.filter((unit) => unit.team === "enemy" && unit.alive)) {
    const livingPlayers = state.units.filter((unit) => unit.team === "player" && unit.alive);
    if (livingPlayers.length === 0) {
      break;
    }
    const target = [...livingPlayers].sort((a, b) => distance(enemy.position, a.position) - distance(enemy.position, b.position))[0];
    if (distance(enemy.position, target.position) > enemy.stats.range) {
      const options = movementRange(state, enemy)
        .filter((option) => !unitAt(state, option))
        .sort((a, b) => distance(a, target.position) - distance(b, target.position));
      if (options[0]) {
        enemy.position = options[0];
        enemy.moved = true;
      }
    }
    const victim = attackableTargets(state, enemy).sort((a, b) => a.stats.hp - b.stats.hp)[0];
    if (victim) {
      resolveAttack(state, enemy, victim);
    } else {
      enemy.acted = true;
    }
  }

  checkWinState(state);
  if (state.status !== "complete") {
    state.phase = "player";
    state.turnCount += 1;
    resetPlayerActions(state);
    pushLog(state, `Turn ${state.turnCount} begins.`);
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

io.on("connection", (socket) => {
  let playerId = "";

  socket.on("createRoom", async ({ name }, callback) => {
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
    room.sockets.set(playerId, socket.id);
    rooms.set(roomCode, room);
    socket.join(roomCode);
    callback({ ok: true, roomCode, playerId } satisfies JoinRoomResponse);
    await emitState(room);
  });

  socket.on("joinRoom", async ({ roomCode, name }, callback) => {
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
      isHost: false
    };
    room.state.players.push(player);
    room.sockets.set(playerId, socket.id);
    socket.join(room.state.roomCode);
    pushLog(room.state, `${trimmedName} joined the room.`);
    callback({ ok: true, roomCode: room.state.roomCode, playerId });
    await emitState(room);
  });

  socket.on("resumeSession", async ({ roomCode, playerId: requestedPlayerId, name }, callback) => {
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
    room.sockets.set(playerId, socket.id);
    socket.join(room.state.roomCode);
    pushLog(room.state, `${player.name} rejoined the battle.`);
    callback({ ok: true, roomCode: room.state.roomCode, playerId, resumed: true });
    await emitState(room);
  });

  socket.on("createCharacter", async ({ roomCode, name, className }) => {
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
      className
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
    checkWinState(room.state);
    if (room.state.status !== "complete" && allPlayerUnitsActed(room.state)) {
      takeEnemyPhase(room.state);
    }
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
      takeEnemyPhase(room.state);
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
    takeEnemyPhase(room.state);
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
