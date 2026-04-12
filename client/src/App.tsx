import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CLASS_OPTIONS, TERRAIN_STYLE, type Position, type Unit } from "../../shared/game";
import { useAppStore } from "./store";

function tileKey(position: Position) {
  return `${position.x},${position.y}`;
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <div className="hero">
        <p className="eyebrow">Co-op Tactical RPG Prototype</p>
        <h1>Fire Emblem Online</h1>
        <p className="hero-copy">
          A multiplayer, server-authoritative tactics prototype built from your design doc. Create a room, recruit a
          squad, and clear the first map together in real time.
        </p>
      </div>
      {children}
    </div>
  );
}

function LandingScreen() {
  const [roomCode, setRoomCode] = useState("");
  const { connected, playerName, setPlayerName, createRoom, joinRoom, error, clearError } = useAppStore();

  return (
    <AppShell>
      <div className="panel auth-panel">
        <div className="status-row">
          <span className={connected ? "pill online" : "pill offline"}>{connected ? "Socket Live" : "Connecting"}</span>
        </div>
        <label className="field">
          <span>Commander Name</span>
          <input value={playerName} maxLength={20} onChange={(event) => setPlayerName(event.target.value)} />
        </label>
        <div className="actions">
          <button onClick={() => void createRoom()} disabled={!playerName.trim()}>
            Create Room
          </button>
        </div>
        <div className="join-block">
          <label className="field">
            <span>Join Code</span>
            <input value={roomCode} maxLength={6} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} />
          </label>
          <button className="secondary" onClick={() => void joinRoom(roomCode)} disabled={!playerName.trim() || roomCode.length < 6}>
            Join Room
          </button>
        </div>
        {error ? (
          <div className="error-banner" onClick={clearError}>
            {error}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function LobbyScreen() {
  const state = useAppStore((store) => store.state)!;
  const playerId = useAppStore((store) => store.playerId);
  const createCharacter = useAppStore((store) => store.createCharacter);
  const startBattle = useAppStore((store) => store.startBattle);
  const [name, setName] = useState("");
  const [className, setClassName] = useState(CLASS_OPTIONS[0]);
  const isHost = state.hostId === playerId;

  return (
    <AppShell>
      <div className="room-header panel">
        <div>
          <p className="eyebrow">Lobby</p>
          <h2>Room {state.roomCode}</h2>
        </div>
        <div className="room-meta">
          <span>{state.players.length} players</span>
          <span>{state.characterDrafts.length} heroes drafted</span>
        </div>
      </div>
      <div className="layout lobby-layout">
        <section className="panel">
          <h3>Party</h3>
          <div className="roster">
            {state.players.map((player) => {
              const drafts = state.characterDrafts.filter((draft) => draft.ownerId === player.id);
              return (
                <div key={player.id} className="roster-card">
                  <div className="roster-title">
                    <strong>{player.name}</strong>
                    <span className={player.connected ? "pill online" : "pill offline"}>{player.connected ? "Online" : "Away"}</span>
                  </div>
                  <ul>
                    {drafts.length > 0 ? drafts.map((draft) => <li key={draft.id}>{draft.name} • {draft.className}</li>) : <li>No units yet</li>}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <h3>Create Character</h3>
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={20} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span>Class</span>
            <select value={className} onChange={(event) => setClassName(event.target.value as typeof className)}>
              {CLASS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => {
              createCharacter(name, className);
              setName("");
            }}
            disabled={!name.trim()}
          >
            Recruit Unit
          </button>
          <button className="secondary" disabled={!isHost || state.characterDrafts.length === 0} onClick={startBattle}>
            {isHost ? "Begin Map" : "Host Starts Battle"}
          </button>
        </section>
        <BattleLog />
      </div>
    </AppShell>
  );
}

function unitCanAttack(unit: Unit, hoveredUnit: Unit | undefined) {
  if (!hoveredUnit || unit.team !== "player" || hoveredUnit.team !== "enemy") {
    return false;
  }
  const gap = Math.abs(unit.position.x - hoveredUnit.position.x) + Math.abs(unit.position.y - hoveredUnit.position.y);
  return gap <= unit.stats.range;
}

function BattleScreen() {
  const state = useAppStore((store) => store.state)!;
  const playerId = useAppStore((store) => store.playerId);
  const selectUnit = useAppStore((store) => store.selectUnit);
  const moveUnit = useAppStore((store) => store.moveUnit);
  const attackUnit = useAppStore((store) => store.attackUnit);
  const waitUnit = useAppStore((store) => store.waitUnit);
  const endTurn = useAppStore((store) => store.endTurn);
  const restartMap = useAppStore((store) => store.restartMap);
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);

  const selectedUnit = state.units.find((unit) => unit.id === state.selectedUnitId && unit.alive) ?? null;
  const hoveredUnit = state.units.find((unit) => unit.id === hoveredUnitId && unit.alive);
  const highlights = useMemo(() => new Set(state.highlights.map(tileKey)), [state.highlights]);
  const isHost = state.hostId === playerId;
  const canRestart = state.status === "complete" && state.winner === "enemy" && isHost;

  return (
    <AppShell>
      <div className="room-header panel">
        <div>
          <p className="eyebrow">Battlefield</p>
          <h2>Chapter 1: Border Skirmish</h2>
          <p className="phase-label">{state.phase === "player" ? `Player Phase • Turn ${state.turnCount}` : state.phase.toUpperCase()}</p>
        </div>
        <div className="room-meta">
          <span>Room {state.roomCode}</span>
          <span>{state.winner ? `${state.winner === "player" ? "Victory" : "Defeat"}` : "Objective: Rout the enemy"}</span>
        </div>
      </div>
      <div className="layout battle-layout">
        <section className="panel map-panel">
          <div className="grid-board" style={{ gridTemplateColumns: `repeat(${state.map.width}, 1fr)` }}>
            {state.map.tiles.flatMap((row, y) =>
              row.map((tile, x) => {
                const occupant = state.units.find((unit) => unit.alive && unit.position.x === x && unit.position.y === y);
                const isHighlighted = highlights.has(tileKey({ x, y }));
                const isSelected = occupant?.id === selectedUnit?.id;
                const isAttackTarget = selectedUnit ? unitCanAttack(selectedUnit, occupant) : false;
                return (
                  <button
                    key={`${x}-${y}`}
                    className={`tile ${isHighlighted ? "highlight" : ""} ${isSelected ? "selected" : ""} ${isAttackTarget ? "attack-target" : ""}`}
                    style={{ background: TERRAIN_STYLE[tile.type].color }}
                    title={TERRAIN_STYLE[tile.type].label}
                    onMouseEnter={() => setHoveredUnitId(occupant?.id ?? null)}
                    onClick={() => {
                      if (occupant) {
                        if (
                          selectedUnit &&
                          occupant.team === "enemy" &&
                          selectedUnit.ownerId === playerId &&
                          !selectedUnit.acted
                        ) {
                          attackUnit(selectedUnit.id, occupant.id);
                        } else if (occupant.team === "player" && occupant.ownerId === playerId && !occupant.acted) {
                          selectUnit(occupant.id);
                        }
                        return;
                      }
                      if (selectedUnit && highlights.has(tileKey({ x, y }))) {
                        moveUnit(selectedUnit.id, x, y);
                      }
                    }}
                  >
                    <span className="terrain-mark">{TERRAIN_STYLE[tile.type].icon}</span>
                    {occupant ? (
                      <motion.div
                        layout
                        className={`unit-chip ${occupant.team} ${occupant.acted ? "acted" : ""}`}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                      >
                        <span>{occupant.name.slice(0, 2).toUpperCase()}</span>
                        <small>{occupant.stats.hp}</small>
                      </motion.div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </section>
        <section className="stack">
          <section className="panel">
            <h3>Actions</h3>
            {selectedUnit ? (
              <div className="selected-card">
                <strong>
                  {selectedUnit.name} • {selectedUnit.className}
                </strong>
                <span>
                  HP {selectedUnit.stats.hp}/{selectedUnit.stats.maxHp} • MOV {selectedUnit.stats.mov} • RNG {selectedUnit.stats.range}
                </span>
                <span>{selectedUnit.moved ? "Movement spent this turn" : "Movement available"}</span>
                <button onClick={() => waitUnit(selectedUnit.id)}>Wait</button>
              </div>
            ) : (
              <p className="muted">Select one of your units, move onto a highlighted tile, then click an enemy to attack if they are in range.</p>
            )}
            <button className="secondary" onClick={endTurn} disabled={state.phase !== "player" || state.status !== "battle"}>
              End Player Phase
            </button>
            {canRestart ? (
              <button onClick={restartMap}>
                Restart Map
              </button>
            ) : null}
          </section>
          <section className="panel">
            <h3>Unit Detail</h3>
            {hoveredUnit ? (
              <div className="detail-card">
                <strong>
                  {hoveredUnit.name} • {hoveredUnit.className}
                </strong>
                <span>{hoveredUnit.team === "player" ? "Allied Unit" : "Enemy Unit"}</span>
                <span>
                  HP {hoveredUnit.stats.hp}/{hoveredUnit.stats.maxHp}
                </span>
                <span>
                  STR {hoveredUnit.stats.str} • MAG {hoveredUnit.stats.mag} • DEF {hoveredUnit.stats.def}
                </span>
              </div>
            ) : (
              <p className="muted">Hover a unit to inspect it.</p>
            )}
          </section>
          <BattleLog />
        </section>
      </div>
    </AppShell>
  );
}

function BattleLog() {
  const logs = useAppStore((store) => store.state?.logs ?? []);
  return (
    <section className="panel log-panel">
      <h3>Battle Log</h3>
      <div className="log-list">
        {logs.map((log) => (
          <div key={log.id} className="log-entry">
            {log.text}
          </div>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const connect = useAppStore((store) => store.connect);
  const state = useAppStore((store) => store.state);

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <AnimatePresence mode="wait">
      {!state ? (
        <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <LandingScreen />
        </motion.div>
      ) : state.status === "lobby" ? (
        <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <LobbyScreen />
        </motion.div>
      ) : (
        <motion.div key="battle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <BattleScreen />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
