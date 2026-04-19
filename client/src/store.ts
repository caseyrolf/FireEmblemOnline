import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import type {
  ActiveGameSummary,
  AuthUser,
  ClientToServerEvents,
  GameState,
  JoinRoomResponse,
  LevelUpEvent,
  PromotionEvent,
  ProfileCharacterRecord,
  ServerToClientEvents,
  SkillId,
  TurnPhase,
  UnitClass
} from "../../shared/game";

type SavedSession = {
  roomCode: string;
  playerId: string;
  playerName: string;
  userId?: string;
};

type PhaseAnnouncement = Extract<TurnPhase, "player" | "enemy" | "victory" | "defeat">;

type AppStore = {
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null;
  state: GameState | null;
  view: "home" | "game";
  playerId: string | null;
  playerName: string;
  error: string | null;
  connected: boolean;
  authReady: boolean;
  authToken: string | null;
  authUser: AuthUser | null;
  profileCharacters: ProfileCharacterRecord[];
  activeGames: ActiveGameSummary[];
  attackingUnitId?: never;
  combatAnimation: { unitId: string; className: UnitClass; type: 'attack' | 'heal'; blocksUpdates: boolean } | null;
  levelUpEvent: LevelUpEvent | null;
  shownLevelUpKey: string | null;
  promotionEvent: PromotionEvent | null;
  shownPromotionKey: string | null;
  phaseAnnouncement: PhaseAnnouncement | null;
  resolvedPhase: TurnPhase | null;
  pendingEnemyStates: GameState[];
  connect: () => void;
  hydrateAuth: () => Promise<void>;
  register: (input: { email: string; password: string; displayName: string }) => Promise<boolean>;
  login: (input: { email: string; password: string }) => Promise<boolean>;
  logout: () => Promise<void>;
  createRoom: () => Promise<JoinRoomResponse>;
  joinRoom: (roomCode: string) => Promise<JoinRoomResponse>;
  resumeSession: () => Promise<JoinRoomResponse | null>;
  returnToGame: (game: ActiveGameSummary) => Promise<JoinRoomResponse>;
  exitCurrentGame: () => Promise<void>;
  createCharacter: (name: string, className: UnitClass, portraitUrl?: string, skillId?: string) => void;
  startBattle: () => void;
  selectUnit: (unitId: string) => void;
  moveUnit: (unitId: string, x: number, y: number) => void;
  attackUnit: (attackerId: string, targetId: string) => void;
  healUnit: (healerId: string, targetId: string) => void;
  waitUnit: (unitId: string) => void;
  cancelMove: (unitId: string) => void;
  equipWeapon: (unitId: string, weaponId: string | null) => void;
  useItem: (unitId: string, itemId: string) => void;
  endTurn: () => void;
  restartMap: () => void;
  endGame: () => void;
  buyWeapon: (playerId: string, weaponId: string, unitId: string) => void;
  buyItem: (playerId: string, itemId: string, unitId: string) => void;
  advanceToBaseCamp: () => void;
  advanceToChapter: () => void;
  sendChatMessage: (text: string) => void;
  removeActiveGame: (roomCode: string) => Promise<void>;
  clearCombatAnimation: () => void;
  clearLevelUpEvent: () => void;
  clearPromotionEvent: () => void;
  clearPhaseAnnouncement: () => void;
  refreshProfileCharacters: () => Promise<void>;
  refreshActiveGames: () => Promise<void>;
  saveProfileCharacter: (name: string, className: UnitClass, portraitUrl?: string, skillId?: SkillId) => Promise<boolean>;
  deleteProfileCharacter: (id: string) => Promise<void>;
  clearError: () => void;
};

const serverUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const SESSION_KEY = "fire-emblem-online-session";
const AUTH_KEY = "fire-emblem-online-auth";
const ANNOUNCED_PHASES = new Set<PhaseAnnouncement>(["player", "enemy", "victory", "defeat"]);

function buildCombatAnimation(state: GameState) {
  if (!state.latestCombatEvent) {
    return null;
  }

  const { attackerId, type } = state.latestCombatEvent;
  const attacker = state.units.find((unit) => unit.id === attackerId);
  if (!attacker) {
    return null;
  }

  return {
    unitId: attacker.id,
    className: attacker.className,
    type,
    blocksUpdates: state.phase === "enemy"
  };
}

function getPhaseAnnouncement(resolvedPhase: TurnPhase | null, nextPhase: TurnPhase): PhaseAnnouncement | null {
  if (!resolvedPhase || resolvedPhase === nextPhase || !ANNOUNCED_PHASES.has(nextPhase as PhaseAnnouncement)) {
    return null;
  }

  return nextPhase as PhaseAnnouncement;
}

function getLevelUpEventKey(levelUpEvent: LevelUpEvent | null) {
  if (!levelUpEvent) {
    return null;
  }

  return `${levelUpEvent.unitId}-${levelUpEvent.newLevel}`;
}

function getPromotionEventKey(promotionEvent: PromotionEvent | null) {
  if (!promotionEvent) {
    return null;
  }

  return `${promotionEvent.unitId}-${promotionEvent.newClassName}-${promotionEvent.newLevel}`;
}

function presentStateUpdate(set: (partial: Partial<AppStore>) => void, get: () => AppStore, nextState: GameState) {
  const combatAnimation = buildCombatAnimation(nextState);
  if (combatAnimation) {
    set({
      state: nextState,
      combatAnimation,
      levelUpEvent: null,
      promotionEvent: null,
      phaseAnnouncement: null
    });
    return true;
  }

  const levelUpKey = getLevelUpEventKey(nextState.latestLevelUpEvent);
  if (nextState.latestLevelUpEvent && levelUpKey) {
    if (get().shownLevelUpKey !== levelUpKey) {
      set({
        state: nextState,
        combatAnimation: null,
        levelUpEvent: nextState.latestLevelUpEvent,
        promotionEvent: null,
        shownLevelUpKey: levelUpKey,
        phaseAnnouncement: null
      });
      return true;
    }
  }

  const promotionKey = getPromotionEventKey(nextState.latestPromotionEvent);
  if (nextState.latestPromotionEvent && promotionKey) {
    if (get().shownPromotionKey !== promotionKey) {
      set({
        state: nextState,
        combatAnimation: null,
        levelUpEvent: null,
        promotionEvent: nextState.latestPromotionEvent,
        shownPromotionKey: promotionKey,
        phaseAnnouncement: null
      });
      return true;
    }
  }

  const phaseAnnouncement = getPhaseAnnouncement(get().resolvedPhase, nextState.phase);
  if (phaseAnnouncement) {
    set({
      state: nextState,
      combatAnimation: null,
      levelUpEvent: null,
      promotionEvent: null,
      phaseAnnouncement
    });
    return true;
  }

  set({
    state: nextState,
    combatAnimation: null,
    levelUpEvent: null,
    promotionEvent: null,
    phaseAnnouncement: null,
    resolvedPhase: nextState.phase
  });
  return false;
}

function flushPendingStates(set: (partial: Partial<AppStore>) => void, get: () => AppStore) {
  while (get().pendingEnemyStates.length > 0) {
    const [nextState, ...rest] = get().pendingEnemyStates;
    set({ pendingEnemyStates: rest });
    if (presentStateUpdate(set, get, nextState)) {
      return;
    }
  }
}

function readSavedSession() {
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SavedSession;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function writeSavedSession(session: SavedSession) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSavedSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

function readSavedToken() {
  return window.localStorage.getItem(AUTH_KEY);
}

function writeSavedToken(token: string) {
  window.localStorage.setItem(AUTH_KEY, token);
}

function clearSavedToken() {
  window.localStorage.removeItem(AUTH_KEY);
}

async function apiRequest<T>(path: string, init?: RequestInit, token?: string | null): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers
  });

  const data = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(data.message ?? "Request failed.");
  }
  return data;
}

export const useAppStore = create<AppStore>((set, get) => ({
  socket: null,
  state: null,
  view: "home",
  playerId: null,
  playerName: "",
  error: null,
  connected: false,
  authReady: false,
  authToken: null,
  authUser: null,
  profileCharacters: [],
  activeGames: [],
  attackingUnitId: null as never,
  combatAnimation: null,
  levelUpEvent: null,
  shownLevelUpKey: null,
  promotionEvent: null,
  shownPromotionKey: null,
  phaseAnnouncement: null,
  resolvedPhase: null,
  pendingEnemyStates: [],
  connect: () => {
    if (get().socket) {
      return;
    }

    const socket = io(serverUrl, { transports: ["websocket"] });
    socket.on("connect", async () => {
      set({ connected: true });
      await get().resumeSession();
    });
    socket.on("disconnect", () => set({ connected: false }));
    socket.on("stateUpdated", (newState) => {
      if (get().view === "game") {
        const { combatAnimation, levelUpEvent, promotionEvent, phaseAnnouncement, pendingEnemyStates } = get();
        if (combatAnimation || levelUpEvent || promotionEvent || phaseAnnouncement) {
          set({ pendingEnemyStates: [...pendingEnemyStates, newState] });
          return;
        }
        presentStateUpdate(set, get, newState);
      }
    });
    socket.on("errorMessage", (message) => set({ error: message }));
    set({ socket });
  },
  hydrateAuth: async () => {
    const token = readSavedToken();
    if (!token) {
      set({ authReady: true, authToken: null, authUser: null, profileCharacters: [] });
      return;
    }

    try {
      const auth = await apiRequest<{ user: AuthUser }>("/api/auth/me", { method: "GET" }, token);
      set({
        authReady: true,
        authToken: token,
        authUser: auth.user,
        playerName: auth.user.displayName
      });
      await get().refreshProfileCharacters();
      await get().refreshActiveGames();
    } catch {
      clearSavedToken();
      clearSavedSession();
      set({ authReady: true, authToken: null, authUser: null, profileCharacters: [], activeGames: [], playerId: null, state: null, view: "home" });
    }
  },
  register: async ({ email, password, displayName }) => {
    try {
      const response = await apiRequest<{ token: string; user: AuthUser }>(
        "/api/auth/register",
        {
          method: "POST",
          body: JSON.stringify({ email, password, displayName })
        }
      );
      writeSavedToken(response.token);
      set({
        authToken: response.token,
        authUser: response.user,
        playerName: response.user.displayName,
        authReady: true,
        error: null
      });
      await get().refreshProfileCharacters();
      await get().refreshActiveGames();
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Registration failed." });
      return false;
    }
  },
  login: async ({ email, password }) => {
    try {
      const response = await apiRequest<{ token: string; user: AuthUser }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ email, password })
        }
      );
      writeSavedToken(response.token);
      set({
        authToken: response.token,
        authUser: response.user,
        playerName: response.user.displayName,
        authReady: true,
        error: null
      });
      await get().refreshProfileCharacters();
      await get().refreshActiveGames();
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Login failed." });
      return false;
    }
  },
  logout: async () => {
    const token = get().authToken;
    try {
      if (token) {
        await apiRequest("/api/auth/logout", { method: "POST" }, token);
      }
    } catch {
      // Best-effort logout.
    }

    clearSavedToken();
    clearSavedSession();
      set({
        authToken: null,
        authUser: null,
        authReady: true,
        profileCharacters: [],
        activeGames: [],
        playerId: null,
        playerName: "",
        state: null,
        view: "home",
        combatAnimation: null,
        levelUpEvent: null,
        shownLevelUpKey: null,
        phaseAnnouncement: null,
        resolvedPhase: null,
        pendingEnemyStates: [],
        error: null
      });
  },
  createRoom: () =>
    new Promise((resolve) => {
      const { socket, playerName, authUser } = get();
      socket?.emit("createRoom", { name: playerName, userId: authUser?.id }, (response) => {
        if (response.ok) {
          set({ playerId: response.playerId ?? null, error: null, view: "game" });
          if (response.playerId && response.roomCode) {
            writeSavedSession({
              playerId: response.playerId,
              roomCode: response.roomCode,
              playerName,
              userId: authUser?.id
            });
          }
        } else {
          set({ error: response.message ?? "Could not create room." });
        }
        void get().refreshActiveGames();
        resolve(response);
      });
    }),
  joinRoom: (roomCode) =>
    new Promise((resolve) => {
      const { socket, playerName, authUser } = get();
      socket?.emit("joinRoom", { roomCode, name: playerName, userId: authUser?.id }, (response) => {
        if (response.ok) {
          set({ playerId: response.playerId ?? null, error: null, view: "game" });
          if (response.playerId && response.roomCode) {
            writeSavedSession({
              playerId: response.playerId,
              roomCode: response.roomCode,
              playerName,
              userId: authUser?.id
            });
          }
        } else {
          set({ error: response.message ?? "Could not join room." });
        }
        void get().refreshActiveGames();
        resolve(response);
      });
    }),
  resumeSession: () =>
    new Promise((resolve) => {
      const saved = readSavedSession();
      const { socket, state, authUser } = get();
      if (!saved || !socket || state) {
        resolve(null);
        return;
      }

      socket.emit(
        "resumeSession",
        {
          roomCode: saved.roomCode,
          playerId: saved.playerId,
          name: saved.playerName,
          userId: authUser?.id ?? saved.userId
        },
        (response) => {
          if (response.ok) {
            set({ playerId: response.playerId ?? saved.playerId, error: null, playerName: saved.playerName, view: "game" });
            writeSavedSession({
              playerId: response.playerId ?? saved.playerId,
              roomCode: response.roomCode ?? saved.roomCode,
              playerName: saved.playerName,
              userId: authUser?.id ?? saved.userId
            });
            void get().refreshActiveGames();
          } else {
            clearSavedSession();
            void get().refreshActiveGames();
          }
          resolve(response);
        }
      );
    }),
  returnToGame: (game) =>
    new Promise((resolve) => {
      const { socket, authUser } = get();
      socket?.emit(
        "resumeSession",
        {
          roomCode: game.roomCode,
          playerId: game.playerId,
          name: game.playerName,
          userId: authUser?.id
        },
        (response) => {
          if (response.ok) {
            set({ playerId: response.playerId ?? game.playerId, playerName: game.playerName, error: null, view: "game" });
            writeSavedSession({
              roomCode: response.roomCode ?? game.roomCode,
              playerId: response.playerId ?? game.playerId,
              playerName: game.playerName,
              userId: authUser?.id
            });
          } else {
            set({ error: response.message ?? "Could not rejoin that game." });
          }
          void get().refreshActiveGames();
          resolve(response);
        }
      );
    }),
  exitCurrentGame: async () => {
    const { socket, state } = get();
    if (state?.roomCode) {
      await new Promise<void>((resolve) => {
        socket?.emit("leaveRoom", { roomCode: state.roomCode }, () => resolve());
        if (!socket) {
          resolve();
        }
      });
    }
    clearSavedSession();
    set({
      state: null,
      playerId: null,
      view: "home",
      combatAnimation: null,
      levelUpEvent: null,
      shownLevelUpKey: null,
      phaseAnnouncement: null,
      resolvedPhase: null,
      pendingEnemyStates: []
    });
    await get().refreshActiveGames();
  },
  endGame: () => {
    const roomCode = get().state?.roomCode;
    if (!roomCode) {
      return;
    }
    get().socket?.emit("endGame", { roomCode });
  },
  removeActiveGame: async (roomCode) => {
    const token = get().authToken;
    if (!token) {
      return;
    }
    try {
      await apiRequest(`/api/profile/games/${roomCode}`, { method: "DELETE" }, token);
      const saved = readSavedSession();
      if (saved?.roomCode === roomCode) {
        clearSavedSession();
      }
      await get().refreshActiveGames();
      set({ error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not remove active game." });
    }
  },
  createCharacter: (name, className, portraitUrl, skillId) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("createCharacter", { roomCode, name, className, portraitUrl, skillId: skillId as import("../../shared/game").SkillId | undefined });
    }
  },
  startBattle: () => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("startBattle", { roomCode });
    }
  },
  selectUnit: (unitId) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("selectUnit", { roomCode, unitId });
    }
  },
  moveUnit: (unitId, x, y) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("moveUnit", { roomCode, unitId, position: { x, y } });
    }
  },
  attackUnit: (attackerId, targetId) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("attackUnit", { roomCode, attackerId, targetId });
    }
  },
  healUnit: (healerId, targetId) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("healUnit", { roomCode, healerId, targetId });
    }
  },
  waitUnit: (unitId) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("waitUnit", { roomCode, unitId });
    }
  },
  cancelMove: (unitId) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("cancelMove", { roomCode, unitId });
    }
  },
  equipWeapon: (unitId, weaponId) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("equipWeapon", { roomCode, unitId, weaponId });
    }
  },
  useItem: (unitId, itemId) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      set({ combatAnimation: null });
      get().socket?.emit("useItem", { roomCode, unitId, itemId });
    }
  },
  endTurn: () => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("endTurn", { roomCode });
    }
  },
  restartMap: () => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("restartMap", { roomCode });
    }
  },
  buyWeapon: (playerId, weaponId, unitId) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("buyWeapon", { roomCode, playerId, weaponId, unitId });
    }
  },
  buyItem: (playerId, itemId, unitId) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("buyItem", { roomCode, playerId, itemId, unitId });
    }
  },
  advanceToBaseCamp: () => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("advanceToBaseCamp", { roomCode });
    }
  },
  advanceToChapter: () => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("advanceToChapter", { roomCode });
    }
  },
  sendChatMessage: (text) => {
    const roomCode = get().state?.roomCode;
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!roomCode || !trimmed) {
      return;
    }
    get().socket?.emit("sendChatMessage", { roomCode, text: trimmed.slice(0, 240) });
  },
  refreshProfileCharacters: async () => {
    const token = get().authToken;
    if (!token) {
      set({ profileCharacters: [] });
      return;
    }
    try {
      const response = await apiRequest<{ characters: ProfileCharacterRecord[] }>(
        "/api/profile/characters",
        { method: "GET" },
        token
      );
      set({ profileCharacters: response.characters, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not load profile characters." });
    }
  },
  refreshActiveGames: async () => {
    const token = get().authToken;
    if (!token) {
      set({ activeGames: [] });
      return;
    }
    try {
      const response = await apiRequest<{ games: ActiveGameSummary[] }>(
        "/api/profile/games",
        { method: "GET" },
        token
      );
      set({ activeGames: response.games, error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not load active games." });
    }
  },
  saveProfileCharacter: async (name, className, portraitUrl, skillId) => {
    const token = get().authToken;
    if (!token) {
      set({ error: "Sign in to save profile characters." });
      return false;
    }
    try {
      await apiRequest<{ character: ProfileCharacterRecord }>(
        "/api/profile/characters",
        {
          method: "POST",
          body: JSON.stringify({ name, className, portraitUrl, skillId })
        },
        token
      );
      await get().refreshProfileCharacters();
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not save profile character." });
      return false;
    }
  },
  deleteProfileCharacter: async (id) => {
    const token = get().authToken;
    if (!token) {
      return;
    }
    try {
      await apiRequest(`/api/profile/characters/${id}`, { method: "DELETE" }, token);
      await get().refreshProfileCharacters();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Could not delete profile character." });
    }
  },
  clearCombatAnimation: () => {
    const currentState = get().state;
    if (!currentState) {
      set({ combatAnimation: null });
      flushPendingStates(set, get);
      return;
    }

    const levelUpKey = getLevelUpEventKey(currentState.latestLevelUpEvent);
    if (currentState.latestLevelUpEvent && levelUpKey && get().shownLevelUpKey !== levelUpKey) {
      set({
        combatAnimation: null,
        levelUpEvent: currentState.latestLevelUpEvent,
        promotionEvent: null,
        shownLevelUpKey: levelUpKey
      });
      return;
    }

    const promotionKey = getPromotionEventKey(currentState.latestPromotionEvent);
    if (currentState.latestPromotionEvent && promotionKey && get().shownPromotionKey !== promotionKey) {
      set({
        combatAnimation: null,
        levelUpEvent: null,
        promotionEvent: currentState.latestPromotionEvent,
        shownPromotionKey: promotionKey
      });
      return;
    }

    const phaseAnnouncement = getPhaseAnnouncement(get().resolvedPhase, currentState.phase);
    if (phaseAnnouncement) {
      set({ combatAnimation: null, phaseAnnouncement });
      return;
    }

    set({ combatAnimation: null, resolvedPhase: currentState.phase });
    flushPendingStates(set, get);
  },
  clearLevelUpEvent: () => {
    const currentState = get().state;
    if (!currentState) {
      set({ levelUpEvent: null });
      flushPendingStates(set, get);
      return;
    }

    const promotionKey = getPromotionEventKey(currentState.latestPromotionEvent);
    if (currentState.latestPromotionEvent && promotionKey && get().shownPromotionKey !== promotionKey) {
      set({
        levelUpEvent: null,
        promotionEvent: currentState.latestPromotionEvent,
        shownPromotionKey: promotionKey,
        resolvedPhase: currentState.phase
      });
      return;
    }

    const phaseAnnouncement = getPhaseAnnouncement(get().resolvedPhase, currentState.phase);
    if (phaseAnnouncement) {
      set({ levelUpEvent: null, promotionEvent: null, phaseAnnouncement });
      return;
    }

    set({ levelUpEvent: null, promotionEvent: null, resolvedPhase: currentState.phase });
    flushPendingStates(set, get);
  },
  clearPromotionEvent: () => {
    const currentState = get().state;
    if (!currentState) {
      set({ promotionEvent: null });
      flushPendingStates(set, get);
      return;
    }

    const phaseAnnouncement = getPhaseAnnouncement(get().resolvedPhase, currentState.phase);
    if (phaseAnnouncement) {
      set({ promotionEvent: null, phaseAnnouncement });
      return;
    }

    set({ promotionEvent: null, resolvedPhase: currentState.phase });
    flushPendingStates(set, get);
  },
  clearPhaseAnnouncement: () => {
    set({
      phaseAnnouncement: null,
      resolvedPhase: get().state?.phase ?? get().resolvedPhase
    });
    flushPendingStates(set, get);
  },
  clearError: () => set({ error: null })
}));
