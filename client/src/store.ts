import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  GameState,
  JoinRoomResponse,
  ServerToClientEvents,
  UnitClass
} from "../../shared/game";

type AppStore = {
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null;
  state: GameState | null;
  playerId: string | null;
  playerName: string;
  error: string | null;
  connected: boolean;
  connect: () => void;
  setPlayerName: (name: string) => void;
  createRoom: () => Promise<JoinRoomResponse>;
  joinRoom: (roomCode: string) => Promise<JoinRoomResponse>;
  resumeSession: () => Promise<JoinRoomResponse | null>;
  createCharacter: (name: string, className: UnitClass) => void;
  startBattle: () => void;
  selectUnit: (unitId: string) => void;
  moveUnit: (unitId: string, x: number, y: number) => void;
  attackUnit: (attackerId: string, targetId: string) => void;
  waitUnit: (unitId: string) => void;
  endTurn: () => void;
  restartMap: () => void;
  clearError: () => void;
};

const serverUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
const SESSION_KEY = "fire-emblem-online-session";

type SavedSession = {
  roomCode: string;
  playerId: string;
  playerName: string;
};

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

export const useAppStore = create<AppStore>((set, get) => ({
  socket: null,
  state: null,
  playerId: null,
  playerName: "",
  error: null,
  connected: false,
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
    socket.on("stateUpdated", (state) => set({ state }));
    socket.on("errorMessage", (message) => set({ error: message }));
    set({ socket });
  },
  setPlayerName: (name) => set({ playerName: name }),
  createRoom: () =>
    new Promise((resolve) => {
      const { socket, playerName } = get();
      socket?.emit("createRoom", { name: playerName }, (response) => {
        if (response.ok) {
          set({ playerId: response.playerId ?? null, error: null });
          if (response.playerId && response.roomCode) {
            writeSavedSession({ playerId: response.playerId, roomCode: response.roomCode, playerName });
          }
        } else {
          set({ error: response.message ?? "Could not create room." });
        }
        resolve(response);
      });
    }),
  joinRoom: (roomCode) =>
    new Promise((resolve) => {
      const { socket, playerName } = get();
      socket?.emit("joinRoom", { roomCode, name: playerName }, (response) => {
        if (response.ok) {
          set({ playerId: response.playerId ?? null, error: null });
          if (response.playerId && response.roomCode) {
            writeSavedSession({ playerId: response.playerId, roomCode: response.roomCode, playerName });
          }
        } else {
          set({ error: response.message ?? "Could not join room." });
        }
        resolve(response);
      });
    }),
  resumeSession: () =>
    new Promise((resolve) => {
      const saved = readSavedSession();
      const { socket, state } = get();
      if (!saved || !socket || state) {
        resolve(null);
        return;
      }

      set({ playerName: saved.playerName });
      socket.emit(
        "resumeSession",
        { roomCode: saved.roomCode, playerId: saved.playerId, name: saved.playerName },
        (response) => {
          if (response.ok) {
            set({ playerId: response.playerId ?? saved.playerId, error: null, playerName: saved.playerName });
            writeSavedSession({
              playerId: response.playerId ?? saved.playerId,
              roomCode: response.roomCode ?? saved.roomCode,
              playerName: saved.playerName
            });
          } else {
            clearSavedSession();
          }
          resolve(response);
        }
      );
    }),
  createCharacter: (name, className) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("createCharacter", { roomCode, name, className });
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
  waitUnit: (unitId) => {
    const roomCode = get().state?.roomCode;
    if (roomCode) {
      get().socket?.emit("waitUnit", { roomCode, unitId });
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
  clearError: () => set({ error: null })
}));
