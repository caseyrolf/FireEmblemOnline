export type TerrainType = "grass" | "forest" | "fort" | "wall" | "goal";
export type UnitTeam = "player" | "enemy";
export type UnitClass = "Lord" | "Mercenary" | "Mage" | "Cleric" | "Knight" | "Brigand" | "Archer";
export type TurnPhase = "player" | "enemy" | "victory" | "defeat";

export type Position = {
  x: number;
  y: number;
};

export type Stats = {
  hp: number;
  maxHp: number;
  str: number;
  mag: number;
  skl: number;
  spd: number;
  def: number;
  res: number;
  mov: number;
  range: number;
};

export type TerrainTile = {
  type: TerrainType;
  moveCost: number;
  defense: number;
  avoid: number;
};

export type Unit = {
  id: string;
  name: string;
  className: UnitClass;
  team: UnitTeam;
  ownerId?: string;
  portraitUrl: string;
  position: Position;
  originalPosition: Position;
  stats: Stats;
  acted: boolean;
  moved: boolean;
  level: number;
  exp: number;
  alive: boolean;
};

export type PlayerPresence = {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  userId?: string;
};

export type CharacterDraft = {
  id: string;
  ownerId: string;
  name: string;
  className: UnitClass;
  portraitUrl?: string;
};

export type CombatLogEntry = {
  id: string;
  text: string;
};

export type GameMap = {
  width: number;
  height: number;
  tiles: TerrainTile[][];
  playerStarts: Position[];
  objective: {
    type: "route" | "arrive";
    target?: Position;
  };
};

export type GameState = {
  roomCode: string;
  status: "lobby" | "battle" | "complete";
  hostId: string;
  phase: TurnPhase;
  turnCount: number;
  activePlayerId: string | null;
  players: PlayerPresence[];
  characterDrafts: CharacterDraft[];
  map: GameMap;
  units: Unit[];
  selectedUnitId: string | null;
  highlights: Position[];
  logs: CombatLogEntry[];
  winner: UnitTeam | null;
  outcomeRecorded: boolean;
};

export type ServerToClientEvents = {
  stateUpdated: (state: GameState) => void;
  errorMessage: (message: string) => void;
};

export type ClientToServerEvents = {
  createRoom: (payload: { name: string; userId?: string }, callback: (response: JoinRoomResponse) => void) => void;
  joinRoom: (payload: { roomCode: string; name: string; userId?: string }, callback: (response: JoinRoomResponse) => void) => void;
  resumeSession: (
    payload: { roomCode: string; playerId: string; name: string; userId?: string },
    callback: (response: JoinRoomResponse) => void
  ) => void;
  createCharacter: (payload: { roomCode: string; name: string; className: UnitClass; portraitUrl?: string }) => void;
  startBattle: (payload: { roomCode: string }) => void;
  selectUnit: (payload: { roomCode: string; unitId: string }) => void;
  moveUnit: (payload: { roomCode: string; unitId: string; position: Position }) => void;
  attackUnit: (payload: { roomCode: string; attackerId: string; targetId: string }) => void;
  waitUnit: (payload: { roomCode: string; unitId: string }) => void;
  cancelMove: (payload: { roomCode: string; unitId: string }) => void;
  endTurn: (payload: { roomCode: string }) => void;
  restartMap: (payload: { roomCode: string }) => void;
  leaveRoom: (payload: { roomCode: string }, callback: (response: { ok: boolean }) => void) => void;
};

export type JoinRoomResponse = {
  ok: boolean;
  roomCode?: string;
  playerId?: string;
  resumed?: boolean;
  message?: string;
};

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  wins: number;
  losses: number;
};

export type ProfileCharacterRecord = {
  id: string;
  name: string;
  className: UnitClass;
  portraitUrl?: string;
};

export type ActiveGameSummary = {
  roomCode: string;
  status: GameState["status"];
  phase: TurnPhase;
  turnCount: number;
  playerId: string;
  playerName: string;
  isHost: boolean;
  playerCount: number;
  objective: string;
};

export const CLASS_TEMPLATES: Record<UnitClass, Stats> = {
  Lord: { hp: 22, maxHp: 22, str: 7, mag: 0, skl: 8, spd: 8, def: 6, res: 3, mov: 5, range: 1 },
  Mercenary: { hp: 24, maxHp: 24, str: 8, mag: 0, skl: 9, spd: 9, def: 6, res: 2, mov: 5, range: 1 },
  Mage: { hp: 18, maxHp: 18, str: 0, mag: 8, skl: 7, spd: 7, def: 3, res: 7, mov: 5, range: 2 },
  Cleric: { hp: 19, maxHp: 19, str: 0, mag: 6, skl: 6, spd: 6, def: 2, res: 8, mov: 5, range: 1 },
  Knight: { hp: 27, maxHp: 27, str: 9, mag: 0, skl: 6, spd: 4, def: 11, res: 1, mov: 4, range: 1 },
  Brigand: { hp: 26, maxHp: 26, str: 8, mag: 0, skl: 5, spd: 5, def: 5, res: 1, mov: 5, range: 1 },
  Archer: { hp: 21, maxHp: 21, str: 7, mag: 0, skl: 8, spd: 6, def: 4, res: 2, mov: 5, range: 2 }
};

export const CLASS_OPTIONS = Object.keys(CLASS_TEMPLATES) as UnitClass[];

export const TERRAIN_STYLE: Record<TerrainType, { label: string; color: string; icon: string }> = {
  grass: { label: "Grass", color: "#5e9b50", icon: "." },
  forest: { label: "Forest", color: "#2f6e3f", icon: "^" },
  fort: { label: "Fort", color: "#8f6b42", icon: "H" },
  wall: { label: "Wall", color: "#4f5563", icon: "#" },
  goal: { label: "Goal", color: "#c69c2d", icon: "*" }
};

const PORTRAIT_STYLE: Record<UnitClass, { fill: string; accent: string; mark: string }> = {
  Lord: { fill: "#2f5ea8", accent: "#c6a24a", mark: "L" },
  Mercenary: { fill: "#5b6b74", accent: "#dba45e", mark: "M" },
  Mage: { fill: "#5f4bb6", accent: "#8fe6ff", mark: "Mg" },
  Cleric: { fill: "#d2d6da", accent: "#8bc58f", mark: "C" },
  Knight: { fill: "#47515d", accent: "#d8dee8", mark: "K" },
  Brigand: { fill: "#7b3f2f", accent: "#f0b56c", mark: "B" },
  Archer: { fill: "#406e39", accent: "#d7cc7e", mark: "A" }
};

export const CLASS_IMAGES: Record<UnitClass, string> = {
  Lord: "/classes/Lord.PNG",
  Mercenary: "/classes/mercenary.PNG",
  Mage: "/classes/mage.PNG",
  Cleric: "/classes/cleric.PNG",
  Knight: "/classes/knight.PNG",
  Brigand: "/classes/brigand.PNG",
  Archer: "/classes/archer.PNG"
};

function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function getDefaultPortrait(team: UnitTeam, className: UnitClass) {
  const style = PORTRAIT_STYLE[className];
  const banner = team === "player" ? "#2d7dd2" : "#b94d42";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
      <rect width="96" height="96" rx="16" fill="${style.fill}"/>
      <rect x="6" y="6" width="84" height="16" rx="8" fill="${banner}"/>
      <circle cx="48" cy="42" r="18" fill="${style.accent}"/>
      <path d="M20 86c3-18 16-28 28-28s25 10 28 28" fill="${style.accent}"/>
      <text x="48" y="18" text-anchor="middle" font-size="10" font-family="Arial, sans-serif" fill="#ffffff">${team.toUpperCase()}</text>
      <text x="48" y="51" text-anchor="middle" font-size="14" font-weight="700" font-family="Arial, sans-serif" fill="#17202b">${style.mark}</text>
    </svg>
  `;
  return svgToDataUrl(svg);
}

export function getClassImage(className: UnitClass): string {
  return CLASS_IMAGES[className];
}

export function getPortraitForUnit(team: UnitTeam, className: UnitClass, portraitUrl?: string) {
  if (portraitUrl && (portraitUrl.startsWith("data:image/") || portraitUrl.startsWith("http"))) {
    return portraitUrl;
  }
  return getClassImage(className);
}

export function distance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function getTerrainDefense(map: GameMap, position: Position): number {
  const tile = map.tiles[position.y]?.[position.x];
  return tile?.defense ?? 0;
}

export function calculateDamage(attacker: Unit, defender: Unit, terrainDefense: number): number {
  const power = attacker.stats.str || attacker.stats.mag;
  const defense = (attacker.stats.mag > attacker.stats.str ? defender.stats.res : defender.stats.def) + terrainDefense;
  return Math.max(1, power + Math.floor(attacker.level / 2) - defense);
}

export function calculateHitChance(attacker: Unit, defender: Unit): number {
  // Simplified: skill * 2 + some base
  const baseHit = 70;
  const attackerHit = attacker.stats.skl * 2;
  const defenderAvoid = defender.stats.spd + defender.stats.skl;
  return Math.min(100, Math.max(0, baseHit + attackerHit - defenderAvoid));
}

export function calculateCritChance(attacker: Unit, defender: Unit): number {
  // Simplified: skill / 4
  return Math.min(100, Math.max(0, attacker.stats.skl / 4));
}

export function checkIfDoubles(attacker: Unit, defender: Unit): boolean {
  return attacker.stats.spd >= defender.stats.spd + 4;
}

export type CombatPreview = {
  baseAttackerDamage: number;
  attackerDamage: number;
  defenderDamage: number;
  attackerRemainingHp: number;
  defenderRemainingHp: number;
  hitChance: number;
  critChance: number;
  doubles: boolean;
  canCounter: boolean;
};

export function calculateCombatPreview(attacker: Unit, defender: Unit, attackerTerrainDefense: number, defenderTerrainDefense: number): CombatPreview {
  const baseAttackerDamage = calculateDamage(attacker, defender, defenderTerrainDefense);
  const defenderDamage = calculateDamage(defender, attacker, attackerTerrainDefense);
  const hitChance = calculateHitChance(attacker, defender);
  const critChance = calculateCritChance(attacker, defender);
  const doubles = checkIfDoubles(attacker, defender);
  const canCounter = distance(attacker.position, defender.position) <= defender.stats.range;

  const attackerDamage = doubles ? baseAttackerDamage * 2 : baseAttackerDamage;
  const attackerRemainingHp = Math.max(0, attacker.stats.hp - (canCounter ? defenderDamage : 0));
  const defenderRemainingHp = Math.max(0, defender.stats.hp - attackerDamage);

  return {
    baseAttackerDamage,
    attackerDamage,
    defenderDamage,
    attackerRemainingHp,
    defenderRemainingHp,
    hitChance,
    critChance,
    doubles,
    canCounter
  };
}

/**
 * Finds the shortest path between two positions using BFS.
 * Does not account for terrain costs, only passability.
 */
export function findPath(start: Position, end: Position, map: GameMap, blockedPositions: Set<string> = new Set()): Position[] {
  if (start.x === end.x && start.y === end.y) {
    return [start];
  }

  const positionKey = (pos: Position) => `${pos.x},${pos.y}`;
  const queue: Array<{ position: Position; path: Position[] }> = [{ position: start, path: [start] }];
  const visited = new Set<string>([positionKey(start)]);

  function getNeighbors(pos: Position): Position[] {
    return [
      { x: pos.x + 1, y: pos.y },
      { x: pos.x - 1, y: pos.y },
      { x: pos.x, y: pos.y + 1 },
      { x: pos.x, y: pos.y - 1 }
    ].filter((neighbor) => {
      if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= map.width || neighbor.y >= map.height) {
        return false;
      }
      const tile = map.tiles[neighbor.y]?.[neighbor.x];
      if (!tile || tile.type === "wall") {
        return false;
      }
      if (blockedPositions.has(positionKey(neighbor))) {
        return false;
      }
      return true;
    });
  }

  while (queue.length > 0) {
    const { position, path } = queue.shift()!;

    if (position.x === end.x && position.y === end.y) {
      return path;
    }

    for (const neighbor of getNeighbors(position)) {
      const key = positionKey(neighbor);
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ position: neighbor, path: [...path, neighbor] });
      }
    }
  }

  return [];
}
