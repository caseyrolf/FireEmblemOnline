import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import type {
  ActiveGameSummary,
  AuthUser,
  ClientToServerEvents,
  GameState,
  JoinRoomResponse,
  ProfileCharacterRecord,
  ServerToClientEvents,
  UnitClass
} from "../../shared/game";

type SavedSession = {
  roomCode: string;
  playerId: string;
  playerName: string;
  userId?: string;
};

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
  attackingUnitId: string | null;
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
  createCharacter: (name: string, className: UnitClass, portraitUrl?: string) => void;
  startBattle: () => void;
  selectUnit: (unitId: string) => void;
  moveUnit: (unitId: string, x: number, y: number) => void;
  attackUnit: (attackerId: string, targetId: string) => void;
  waitUnit: (unitId: string) => void;
  cancelMove: (unitId: string) => void;
  equipWeapon: (unitId: string, weaponId: string | null) => void;
  useItem: (unitId: string, itemId: string) => void;
  endTurn: () => void;
  restartMap: () => void;
  clearAttackAnimation: () => void;
  refreshProfileCharacters: () => Promise<void>;
  refreshActiveGames: () => Promise<void>;
  saveProfileCharacter: (name: string, className: UnitClass, portraitUrl?: string) => Promise<boolean>;
  deleteProfileCharacter: (id: string) => Promise<void>;
  clearError: () => void;
};

const serverUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const SESSION_KEY = "fire-emblem-online-session";
const AUTH_KEY = "fire-emblem-online-auth";

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
  attackingUnitId: null,
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
    socket.on("stateUpdated", (state) => {
      if (get().view === "game") {
        set({ state });
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
    set({ state: null, playerId: null, view: "home" });
    await get().refreshActiveGames();
  },
  createCharacter: (name, className, portraitUrl) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("createCharacter", { roomCode, name, className, portraitUrl });
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
    const attackingUnit = get().state?.units.find((u) => u.id === attackerId);
    if (roomCode) {
      if (attackingUnit?.className === "Lord") {
        set({ attackingUnitId: attackerId });
      }
      get().socket?.emit("attackUnit", { roomCode, attackerId, targetId });
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
  saveProfileCharacter: async (name, className, portraitUrl) => {
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
          body: JSON.stringify({ name, className, portraitUrl })
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
  clearAttackAnimation: () => set({ attackingUnitId: null }),
  clearError: () => set({ error: null })
}));
