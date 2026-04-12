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
  position: Position;
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
};

export type CharacterDraft = {
  id: string;
  ownerId: string;
  name: string;
  className: UnitClass;
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
};

export type ServerToClientEvents = {
  stateUpdated: (state: GameState) => void;
  errorMessage: (message: string) => void;
};

export type ClientToServerEvents = {
  createRoom: (payload: { name: string }, callback: (response: JoinRoomResponse) => void) => void;
  joinRoom: (payload: { roomCode: string; name: string }, callback: (response: JoinRoomResponse) => void) => void;
  resumeSession: (
    payload: { roomCode: string; playerId: string; name: string },
    callback: (response: JoinRoomResponse) => void
  ) => void;
  createCharacter: (payload: { roomCode: string; name: string; className: UnitClass }) => void;
  startBattle: (payload: { roomCode: string }) => void;
  selectUnit: (payload: { roomCode: string; unitId: string }) => void;
  moveUnit: (payload: { roomCode: string; unitId: string; position: Position }) => void;
  attackUnit: (payload: { roomCode: string; attackerId: string; targetId: string }) => void;
  waitUnit: (payload: { roomCode: string; unitId: string }) => void;
  endTurn: (payload: { roomCode: string }) => void;
  restartMap: (payload: { roomCode: string }) => void;
};

export type JoinRoomResponse = {
  ok: boolean;
  roomCode?: string;
  playerId?: string;
  resumed?: boolean;
  message?: string;
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
  grass: { label: "Grass", color: "#5e9b50", icon: "·" },
  forest: { label: "Forest", color: "#2f6e3f", icon: "♣" },
  fort: { label: "Fort", color: "#8f6b42", icon: "▣" },
  wall: { label: "Wall", color: "#4f5563", icon: "■" },
  goal: { label: "Goal", color: "#c69c2d", icon: "◎" }
};
