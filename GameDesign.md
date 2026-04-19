# Project Design: Multiplayer Fire Emblem-Inspired Web Game

> **Implementation Key:** ✅ Implemented | 🔶 Partial | ❌ Not Yet Implemented

---

## 1. High-Level Overview

The game is a cooperative, turn-based tactical RPG where 2–8 players control a shared party of characters against AI-controlled enemies on grid-based maps. Maps are chained into campaigns with persistent character progression (levels, stats, inventory). A designated "DM/Host" starts maps and advances the campaign; initially maps are hardcoded JSON, later user-created via an in-app editor.

**Core loop:**
Lobby → Character creation → Map start → Real-time turns (players act in any order, can pass) → Enemy AI phase → Win condition → Base Camp (shop & prep) → Next map.

All clients stay perfectly synchronized via WebSockets. Game logic (validation, enemy AI, stat calculations, level-ups) runs on the server to prevent cheating.

---

## 2. Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript, Tailwind CSS + shadcn/ui + Radix primitives, Zustand (or Jotai) for local UI state, Socket.io-client, React Router v7, Framer Motion (animations), react-hot-toast | Fast dev experience, great DX, real-time updates, accessible UI components |
| Game Rendering | CSS Grid (8×8 to 16×16 maps) with `grid-template-columns` + absolute-positioned unit tokens (PNG/SVG sprites). Optional upgrade path: PixiJS v8 + @pixi/react for smoother animations later | Simple & performant enough for tactical grid; easy hit detection with pointer events |
| Backend | Node.js + NestJS (TypeScript) or Express + TypeScript, Socket.io (rooms per game), Prisma + PostgreSQL, Redis (optional, for active game sessions & rate limiting) | Type-safe, scalable, easy WebSocket integration, relational data for characters/inventories |
| Auth | JWT + httpOnly cookies (or Clerk/Supabase Auth if you want faster MVP) | Secure, works with WebSockets |
| Database | PostgreSQL (via Prisma) | Strong relations: User ↔ Characters ↔ Games ↔ Maps ↔ Inventory |
| Real-time | Socket.io (with Redis adapter for horizontal scaling) | Rooms, events (`playerMoved`, `turnEnded`, `gameStateUpdated`) |
| Assets | PNG sprite sheets (units, terrain, items) hosted on Cloudinary or static `/public`. Map data as JSON (initially) | Fire-Emblem-style pixel art |
| Deployment | Frontend: Vercel, Backend: Railway / Render / AWS, DB: Neon / Supabase Postgres | Free tier friendly for development |
| Testing | Vitest + React Testing Library (unit), Playwright (E2E multiplayer simulation) | Critical for turn validation |

---

## 3. Data Models (Prisma Schema)

```prisma
model User { id String @id ... games Game[] characters Character[] }

model Game {
  id          String   @id @default(cuid())
  hostId      String
  status      GameStatus
  currentMap  Int
  players     Player[] // join table with character
  mapData     Json     // or separate Map model for editor later
  gameState   Json     // serialized full state for quick sync
}

model Character {
  id           String
  userId       String
  gameId       String?
  name         String
  class        String
  level        Int
  exp          Int
  stats        Json   // {str, mag, skl, spd, ...}
  growthRates  Json
  inventory    Item[]
  // promotion, skills, etc.
}
```

---

## 4. User Stories — Incremental Development (MVP → Full)

### Phase 0 — Foundation ✅
- ✅ As a guest, I can register/login.
- ✅ As a logged-in user, I can create a private game room and get a 6-character join code.
- ✅ As a player, I can join a room with the code and see connected players in real time.

### Phase 1 — Character & Lobby ✅
- ✅ As a player in a room, I can create up to N characters (configurable per game) choosing name + base class.
- ✅ As host, I can start the campaign once all players have characters (or minimum players met).

### Phase 2 — First Map (Hardcoded) ✅
- ✅ Render 2D grid with terrain tiles (grass, mountain, wall, house, chest…)
- ✅ Show player characters at starting positions; players click a tile from their starting pool to place their unit(s).
- ✅ Host clicks "Begin Map".
- ✅ Real-time turn system:
  - ✅ "My Turn / Ally Turn / Enemy Turn" banner visible to all.
  - ✅ Click own unit → highlight movement range (BFS respecting terrain & movement type).
  - ✅ Click valid tile → move (server validates).
  - ✅ After move, show action menu: Attack / Heal / Trade / Wait.
  - ✅ All actions broadcast instantly; every client re-renders grid + unit stats.
- ✅ Enemy AI phase (simple: greedy attack highest threat, fallback to move toward objective).
- 🔶 Win conditions:
  - ✅ "Route" (defeat all enemies)
  - ❌ "Defend X turns"
  - ❌ "Arrive" (any player reaches tile) — tile is rendered but win check is not implemented

### Phase 3 — Persistence & Progression ✅
- ✅ Characters keep level/exp/stats/inventory across maps.
- ✅ Level-up logic + growth rolls (server-side random, per-class growth rate tables).
- ❌ Promotion at level 20 (class → advanced class with new stats/growths/weapons).
- ✅ End-of-map → Base Camp screen (shop UI with gold earned from map).

### Phase 4 — Polish & Multi-Map ✅
- ✅ Chain 3–5 hardcoded maps with different win conditions and starting positions (5 chapter campaign implemented).
- ✅ Pass turn button (any player can end their turn).
- 🔶 Trade / item usage / chest & house interactions — item usage via potions implemented; trading between units not yet implemented.
- ✅ Full game state saved in DB after every major action (reconnecting players get current state).

### Phase 5 — DM Tools & Future-Proofing ❌
- ❌ In-app map editor (drag-and-drop terrain, place enemies, set win condition).
- ❌ Export/import map JSON.

---

## 5. Core Game Flow (Client ↔ Server Events)

| Step | Event | Status |
|---|---|---|
| 1 | `joinGame(roomId)` → server adds to Socket.io room | ✅ |
| 2 | `placeCharacter(characterId, startTile)` → validated & broadcast | ✅ |
| 3 | `selectUnit(unitId)` → server sends movement/attack ranges | ✅ |
| 4 | `moveUnit(unitId, targetTile)` → path validation + animation trigger on all clients | ✅ |
| 5 | `performAction(payload)` (attack/heal/trade) → server resolves combat → broadcasts new game state | ✅ (attack/heal); ❌ (trade) |
| 6 | When all players have acted or passed → `endPlayerPhase()` → server runs enemy phase → broadcasts updated state | ✅ |
| 7 | Win condition met → `mapComplete()` → transition to Base Camp | ✅ |

**All implemented socket events (Client → Server):** `createRoom`, `joinRoom`, `resumeSession`, `createCharacter`, `startBattle`, `selectUnit`, `moveUnit`, `attackUnit`, `healUnit`, `waitUnit`, `cancelMove`, `equipWeapon`, `useItem`, `endTurn`, `restartMap`, `endGame`, `buyWeapon`, `buyItem`, `advanceToBaseCamp`, `advanceToChapter`, `leaveRoom`

**State Synchronization Strategy:**
- Authoritative server holds full game state (grid occupancy, unit stats, turn order, etc.).
- On any change → `emit('gameStateUpdate', serializedState)` to room.
- Clients use Zustand + `useEffect` on socket events to keep a `useGameStore()` mirror.
- Optimistic UI for movement (show ghost unit, rollback only on rare server rejection).

---

## 6. Implemented Features (Detailed)

### Combat System ✅
- Damage formula: `weapon might + STR/MAG + level bonus − DEF/RES − terrain defense`
- Hit chance: `70 + skl*2 − (defender_spd + defender_skl)`
- Crit chance: `skl / 4`; crits deal 2× damage
- Double attacks: attacker with ≥4 SPD advantage attacks twice before counter
- Counter-attack: defender retaliates if they can reach attacker's range
- Archer minimum range enforced (range 2 only, no melee)
- Combat preview (pre-attack forecast) computed client-side

### Character System ✅
- 7 classes with unique stats/growths/weapon types
- Per-class growth rate tables for probabilistic level-up stat gains
- All 7 stats can grow: HP, STR, MAG, SKL, SPD, DEF, RES
- Profile system: save up to 12 characters to account, recruit in future sessions

### Map & Terrain ✅
- 10×10 tile grid
- 5 fully hand-crafted chapter maps
- Terrain types: `grass`, `forest`, `fort`, `mountain`, `goal`
- Terrain effects: move cost, defense bonus, avoid bonus

### Campaign ✅
- 5-chapter campaign: Border Skirmish → Last Redoubt
- Enemy stat scaling per chapter; crowd penalty for large rosters
- Chapter carryover: stats, level, EXP, inventory all preserved; HP restored

### Base Camp / Shop ✅
- 1000 gold awarded per chapter completion
- Sells Iron/Steel weapons for all 7 weapon types, and Potions
- Filters: by weapon type, affordable, class-compatible

### Quality of Life ✅
- Combat log (last 24 events)
- Phase announcement overlay
- W/L record tracked and displayed on dashboard
- Connection status (Online/Away) per player
- State persistence to DB on every mutating event; rooms survive server restarts
- `cancelMove` — undo move before committing action
- `restartMap` — host can restart after defeat

---

## 7. Remaining Features & Ideas

### High Priority (Core Gaps)
| Feature | Notes |
|---|---|
| ❌ "Arrive" win condition | Goal tile exists, no detection logic in `checkWinState` |
| ❌ "Defend X turns" win condition | Entirely unimplemented |
| ❌ Weapon triangle advantage | `WeaponType` defined but no hit/damage modifier applied |
| ❌ Class promotion (level 20) | No mechanic exists |
| ❌ Unit trading | Trade event not implemented |
| ❌ Weapon durability | Weapons have infinite uses |

### Medium Priority (Enhancements)
| Feature | Notes |
|---|---|
| ❌ More weapon tiers | Only Iron and Steel; no Silver, legendary, or magic variants beyond 2 tomes |
| ❌ More item types | Only Potion; no Vulnerary, Elixir, Antidote, Status items |
| ❌ More spells per class | Mage/Cleric limited to 2 weapon picks |
| ❌ Skill system | "Miracle", "Vantage", activation-condition skills |
| ❌ Support / pair-up mechanics | Classic Fire Emblem feel |
| ❌ Fog of war / vision range | Adds tension |
| ❌ In-game text chat | |
| ❌ Spectator mode | All connected sockets currently join as players |
| ❌ Turn timer | No time limit per player turn |
| ❌ Undo last move | Before action committed |

### Low Priority / Post-MVP
| Feature | Notes |
|---|---|
| ❌ In-app map editor | Drag-and-drop terrain, enemy placement, win condition |
| ❌ Export/import map JSON | |
| ❌ Procedural map generator | Endless mode |
| ❌ Public lobbies / matchmaking | Currently invite-only via join code |
| ❌ Sound effects & music | Howler.js |
| ❌ Mobile touch controls | |
| ❌ Ranked leaderboards | Fastest campaign clears / arena scores |
| ❌ Cosmetic skins / UI themes | |
| ❌ Seasonal events | |
| ❌ Replace CSS Grid with PixiJS | For maps > 12×12 or heavy animations |
| ❌ Analytics (PostHog) | Drop-off tracking |
| ❌ Single-player AI practice mode | Minimax or simple ML |

---

## 8. Potential Challenges & Mitigations

| Challenge | Mitigation |
|---|---|
| Turn-order fairness | ✅ "Pass" implemented; live "who still needs to act" list |
| Cheating | ✅ All combat/exp/movement on server; clients only receive results |
| Latency | ✅ Optimistic updates + server reconciliation |
| Balance | Provide admin dashboard to tweak enemy stats or growth rates per campaign |
| Performance | Limit grid to ≤ 16×16; use memoized React components for each tile |
