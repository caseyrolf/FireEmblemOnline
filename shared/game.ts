export type TerrainType = "grass" | "forest" | "fort" | "mountain" | "goal";
export type UnitTeam = "player" | "enemy";
export type BaseUnitClass = "Lord" | "Mercenary" | "Mage" | "Cleric" | "Knight" | "Brigand" | "Archer";
export type PromotedUnitClass = "Great Lord" | "Hero" | "Sage" | "Bishop" | "General" | "Warrior" | "Sniper";
export type UnitClass = BaseUnitClass | PromotedUnitClass;
export type TurnPhase = "player" | "enemy" | "victory" | "defeat" | "basecamp";

export type WeaponType = "Sword" | "Lance" | "Axe" | "Bow" | "Magic Tome" | "Staff";
export type ItemType = "Potion";

export type Weapon = {
  id: string;
  name: string;
  type: WeaponType;
  might: number;
  price?: number;
};

export type Item = {
  id: string;
  name: string;
  type: ItemType;
  price?: number;
};

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

export type LevelUpStatGain = {
  stat: keyof Stats;
  gain: number;
  newValue: number;
};

export type LevelUpEvent = {
  unitId: string;
  unitName: string;
  className: UnitClass;
  team: UnitTeam;
  newLevel: number;
  expRemainder: number;
  statGains: LevelUpStatGain[];
};

export type PromotionEvent = {
  unitId: string;
  unitName: string;
  oldClassName: BaseUnitClass;
  newClassName: PromotedUnitClass;
  team: UnitTeam;
  newLevel: number;
  statGains: LevelUpStatGain[];
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
  inventory: {
    weapons: Weapon[];
    items: Item[];
  };
  equippedWeapon: Weapon | null;
};

export type PlayerPresence = {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  userId?: string;
  gold: number;
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

export type ChatMessage = {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  createdAt: string;
};

export type GameMap = {
  width: number;
  height: number;
  tiles: TerrainTile[][];
  playerStarts: Position[];
  objective: {
    type: "route" | "arrive" | "defend";
    target?: Position;
    turnLimit?: number;
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
  chatMessages: ChatMessage[];
  winner: UnitTeam | null;
  outcomeRecorded: boolean;
  chapter: number;
  latestCombatEvent: { attackerId: string; type: 'attack' | 'heal' } | null;
  latestLevelUpEvent: LevelUpEvent | null;
  latestPromotionEvent: PromotionEvent | null;
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
  healUnit: (payload: { roomCode: string; healerId: string; targetId: string }) => void;
  waitUnit: (payload: { roomCode: string; unitId: string }) => void;
  cancelMove: (payload: { roomCode: string; unitId: string }) => void;
  equipWeapon: (payload: { roomCode: string; unitId: string; weaponId: string | null }) => void;
  useItem: (payload: { roomCode: string; unitId: string; itemId: string }) => void;
  endTurn: (payload: { roomCode: string }) => void;
  restartMap: (payload: { roomCode: string }) => void;
  endGame: (payload: { roomCode: string }) => void;
  buyWeapon: (payload: { roomCode: string; playerId: string; weaponId: string; unitId: string }) => void;
  buyItem: (payload: { roomCode: string; playerId: string; itemId: string; unitId: string }) => void;
  advanceToBaseCamp: (payload: { roomCode: string }) => void;
  advanceToChapter: (payload: { roomCode: string }) => void;
  sendChatMessage: (payload: { roomCode: string; text: string }) => void;
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
  Archer: { hp: 21, maxHp: 21, str: 7, mag: 0, skl: 8, spd: 6, def: 4, res: 2, mov: 5, range: 2 },
  "Great Lord": { hp: 28, maxHp: 28, str: 10, mag: 2, skl: 11, spd: 10, def: 8, res: 6, mov: 6, range: 1 },
  Hero: { hp: 30, maxHp: 30, str: 11, mag: 0, skl: 12, spd: 11, def: 8, res: 4, mov: 6, range: 1 },
  Sage: { hp: 23, maxHp: 23, str: 0, mag: 12, skl: 9, spd: 9, def: 5, res: 10, mov: 6, range: 2 },
  Bishop: { hp: 24, maxHp: 24, str: 0, mag: 10, skl: 8, spd: 8, def: 4, res: 12, mov: 6, range: 1 },
  General: { hp: 33, maxHp: 33, str: 12, mag: 0, skl: 8, spd: 6, def: 14, res: 4, mov: 5, range: 1 },
  Warrior: { hp: 31, maxHp: 31, str: 12, mag: 0, skl: 8, spd: 8, def: 7, res: 3, mov: 6, range: 1 },
  Sniper: { hp: 27, maxHp: 27, str: 10, mag: 0, skl: 12, spd: 9, def: 6, res: 4, mov: 6, range: 2 }
};

export const BASE_CLASS_OPTIONS: BaseUnitClass[] = ["Lord", "Mercenary", "Mage", "Cleric", "Knight", "Brigand", "Archer"];
export const PROMOTED_CLASS_OPTIONS: PromotedUnitClass[] = ["Great Lord", "Hero", "Sage", "Bishop", "General", "Warrior", "Sniper"];
export const CLASS_OPTIONS: UnitClass[] = [...BASE_CLASS_OPTIONS, ...PROMOTED_CLASS_OPTIONS];

export const PROMOTION_CLASS_MAP: Record<BaseUnitClass, PromotedUnitClass> = {
  Lord: "Great Lord",
  Mercenary: "Hero",
  Mage: "Sage",
  Cleric: "Bishop",
  Knight: "General",
  Brigand: "Warrior",
  Archer: "Sniper"
};

export const BASE_CLASS_BY_PROMOTED: Record<PromotedUnitClass, BaseUnitClass> = {
  "Great Lord": "Lord",
  Hero: "Mercenary",
  Sage: "Mage",
  Bishop: "Cleric",
  General: "Knight",
  Warrior: "Brigand",
  Sniper: "Archer"
};

export const PROMOTION_BONUSES: Record<BaseUnitClass, Partial<Record<keyof Stats, number>>> = {
  Lord: { maxHp: 4, str: 2, mag: 1, skl: 2, spd: 2, def: 2, res: 2, mov: 1 },
  Mercenary: { maxHp: 4, str: 2, skl: 2, spd: 2, def: 1, res: 1, mov: 1 },
  Mage: { maxHp: 3, mag: 3, skl: 1, spd: 1, def: 1, res: 2, mov: 1 },
  Cleric: { maxHp: 3, mag: 2, skl: 1, spd: 1, def: 1, res: 3, mov: 1 },
  Knight: { maxHp: 5, str: 2, skl: 1, spd: 1, def: 3, res: 2, mov: 1 },
  Brigand: { maxHp: 5, str: 3, skl: 1, spd: 1, def: 2, res: 1, mov: 1 },
  Archer: { maxHp: 4, str: 2, skl: 3, spd: 2, def: 1, res: 1, mov: 1 }
};

export const CLASS_GROWTH_RATES: Record<UnitClass, Partial<Record<keyof Stats, number>>> = {
  Lord: { maxHp: 80, str: 55, mag: 10, skl: 55, spd: 60, def: 40, res: 30 },
  Mercenary: { maxHp: 75, str: 55, mag: 5, skl: 65, spd: 65, def: 35, res: 20 },
  Mage: { maxHp: 60, str: 0, mag: 70, skl: 50, spd: 55, def: 20, res: 45 },
  Cleric: { maxHp: 65, str: 0, mag: 65, skl: 45, spd: 50, def: 15, res: 60 },
  Knight: { maxHp: 85, str: 60, mag: 0, skl: 45, spd: 30, def: 70, res: 15 },
  Brigand: { maxHp: 85, str: 65, mag: 0, skl: 35, spd: 40, def: 30, res: 10 },
  Archer: { maxHp: 70, str: 55, mag: 0, skl: 65, spd: 55, def: 25, res: 20 },
  "Great Lord": { maxHp: 90, str: 65, mag: 20, skl: 65, spd: 65, def: 50, res: 40 },
  Hero: { maxHp: 85, str: 65, mag: 10, skl: 75, spd: 75, def: 45, res: 30 },
  Sage: { maxHp: 70, str: 0, mag: 80, skl: 60, spd: 65, def: 30, res: 55 },
  Bishop: { maxHp: 75, str: 0, mag: 75, skl: 55, spd: 60, def: 25, res: 70 },
  General: { maxHp: 95, str: 70, mag: 0, skl: 55, spd: 40, def: 80, res: 25 },
  Warrior: { maxHp: 95, str: 75, mag: 0, skl: 45, spd: 50, def: 40, res: 20 },
  Sniper: { maxHp: 80, str: 65, mag: 0, skl: 75, spd: 65, def: 35, res: 30 }
};

export const WEAPONS: Weapon[] = [
  { id: "iron-sword", name: "Iron Sword", type: "Sword", might: 5, price: 500 },
  { id: "steel-sword", name: "Steel Sword", type: "Sword", might: 8, price: 1000 },
  { id: "iron-lance", name: "Iron Lance", type: "Lance", might: 5, price: 500 },
  { id: "steel-lance", name: "Steel Lance", type: "Lance", might: 8, price: 1000 },
  { id: "iron-axe", name: "Iron Axe", type: "Axe", might: 5, price: 500 },
  { id: "steel-axe", name: "Steel Axe", type: "Axe", might: 8, price: 1000 },
  { id: "iron-bow", name: "Iron Bow", type: "Bow", might: 5, price: 500 },
  { id: "steel-bow", name: "Steel Bow", type: "Bow", might: 8, price: 1000 },
  { id: "fire-tome", name: "Fire Tome", type: "Magic Tome", might: 5, price: 500 },
  { id: "thunder-tome", name: "Thunder Tome", type: "Magic Tome", might: 8, price: 1000 },
  { id: "heal-staff", name: "Heal Staff", type: "Staff", might: 5, price: 500 },
  { id: "mend-staff", name: "Mend Staff", type: "Staff", might: 10, price: 1000 },
];

export const ITEMS: Item[] = [
  { id: "potion", name: "Potion", type: "Potion", price: 300 },
];

export const TERRAIN_STYLE: Record<TerrainType, { label: string; color: string; icon: string }> = {
  grass: { label: "Grass", color: "#5e9b50", icon: "." },
  forest: { label: "Forest", color: "#2f6e3f", icon: "^" },
  fort: { label: "Fort", color: "#8f6b42", icon: "H" },
  mountain: { label: "mountain", color: "#4f5563", icon: "#" },
  goal: { label: "Goal", color: "#c69c2d", icon: "*" }
};

const PORTRAIT_STYLE: Record<UnitClass, { fill: string; accent: string; mark: string }> = {
  Lord: { fill: "#2f5ea8", accent: "#c6a24a", mark: "L" },
  Mercenary: { fill: "#5b6b74", accent: "#dba45e", mark: "M" },
  Mage: { fill: "#5f4bb6", accent: "#8fe6ff", mark: "Mg" },
  Cleric: { fill: "#d2d6da", accent: "#8bc58f", mark: "C" },
  Knight: { fill: "#47515d", accent: "#d8dee8", mark: "K" },
  Brigand: { fill: "#7b3f2f", accent: "#f0b56c", mark: "B" },
  Archer: { fill: "#406e39", accent: "#d7cc7e", mark: "A" },
  "Great Lord": { fill: "#224576", accent: "#f0cc6f", mark: "GL" },
  Hero: { fill: "#3d4952", accent: "#f2bb71", mark: "H" },
  Sage: { fill: "#483696", accent: "#b8f0ff", mark: "Sg" },
  Bishop: { fill: "#bcc2cb", accent: "#aedbb2", mark: "Bp" },
  General: { fill: "#323a45", accent: "#f1f5ff", mark: "Gn" },
  Warrior: { fill: "#5f3024", accent: "#ffd19c", mark: "W" },
  Sniper: { fill: "#2f5429", accent: "#f1e89a", mark: "Sn" }
};

export const CLASS_IMAGES: Record<UnitClass, string> = {
  Lord: "/classes/lord.png",
  Mercenary: "/classes/mercenary.png",
  Mage: "/classes/mage.png",
  Cleric: "/classes/cleric.png",
  Knight: "/classes/knight.png",
  Brigand: "/classes/brigand.png",
  Archer: "/classes/archer.png",
  "Great Lord": "/classes/lord.png",
  Hero: "/classes/mercenary.png",
  Sage: "/classes/mage.png",
  Bishop: "/classes/cleric.png",
  General: "/classes/knight.png",
  Warrior: "/classes/brigand.png",
  Sniper: "/classes/archer.png"
};

export const CLASS_ATTACK_GIFS: Record<UnitClass, string | null> = {
  Lord: "/classes/lord_attack.gif",
  Mercenary: "/classes/mercenary_attack.gif",
  Mage: "/classes/mage_attack.gif",
  Cleric: null,
  Knight: "/classes/knight_attack.gif",
  Brigand: "/classes/brigand_attack.gif",
  Archer: "/classes/archer_attack.gif",
  "Great Lord": "/classes/lord_attack.gif",
  Hero: "/classes/mercenary_attack.gif",
  Sage: "/classes/mage_attack.gif",
  Bishop: null,
  General: "/classes/knight_attack.gif",
  Warrior: "/classes/brigand_attack.gif",
  Sniper: "/classes/archer_attack.gif",
};

export const CLASS_HEAL_GIF = "/classes/cleric_heal.gif";

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

export function canUnitAttackAtDistance(unit: Unit, gap: number): boolean {
  if (unit.className === "Archer" || unit.className === "Sniper") {
    return gap === 2;
  }
  return gap <= unit.stats.range;
}

export function isStaffClass(className: UnitClass): boolean {
  return className === "Cleric" || className === "Bishop";
}

export function isPromotedClass(className: UnitClass): className is PromotedUnitClass {
  return Object.prototype.hasOwnProperty.call(BASE_CLASS_BY_PROMOTED, className);
}

export function getPromotedClass(className: UnitClass): PromotedUnitClass | null {
  if (isPromotedClass(className)) {
    return null;
  }
  return PROMOTION_CLASS_MAP[className];
}

export function getTerrainDefense(map: GameMap, position: Position): number {
  const tile = map.tiles[position.y]?.[position.x];
  return tile?.defense ?? 0;
}

export function calculateDamage(attacker: Unit, defender: Unit, terrainDefense: number): number {
  let power = 0;
  if (attacker.equippedWeapon) {
    power += attacker.equippedWeapon.might;
    if (attacker.equippedWeapon.type === "Magic Tome") {
      power += attacker.stats.mag;
    } else {
      power += attacker.stats.str;
    }
  } else {
    power = attacker.stats.str || attacker.stats.mag;
  }
  const defense = (attacker.equippedWeapon?.type === "Magic Tome" ? defender.stats.res : defender.stats.def) + terrainDefense;
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
  const canCounter = canUnitAttackAtDistance(defender, distance(attacker.position, defender.position));

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
      if (!tile || tile.type === "mountain") {
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
