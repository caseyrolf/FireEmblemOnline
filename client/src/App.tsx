import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CLASS_OPTIONS, TERRAIN_STYLE, getDefaultPortrait, getClassImage, type Position, type Unit, calculateCombatPreview, type CombatPreview, getTerrainDefense, findPath, WEAPONS, ITEMS } from "../../shared/game";
import { useAppStore } from "./store";

type GameSnapshot = NonNullable<ReturnType<typeof useAppStore.getState>["state"]>;

function tileKey(position: Position) {
  return `${position.x},${position.y}`;
}

function getTerrainImage(type: string): string {
  const mapping: Record<string, string> = {
    grass: "Grass.PNG",
    forest: "Forest.PNG",
    fort: "fort.PNG",
    mountain: "Mountain.PNG",
    goal: "goal.PNG"
  };
  return `/terrain/${mapping[type] || "Grass.PNG"}`;
}

function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <div className="hero">
        <p className="eyebrow">Co-op Tactical RPG Prototype</p>
        <h1>Fire Emblem Online</h1>
        <p className="hero-copy">
          Sign in, keep a persistent commander profile, save favorite units, and run synchronized tactical battles with
          your party in real time.
        </p>
      </div>
      {children}
    </div>
  );
}

function AuthScreen() {
  const register = useAppStore((store) => store.register);
  const login = useAppStore((store) => store.login);
  const connected = useAppStore((store) => store.connected);
  const error = useAppStore((store) => store.error);
  const clearError = useAppStore((store) => store.clearError);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  async function submit() {
    if (mode === "login") {
      await login({ email, password });
      return;
    }
    await register({ email, password, displayName });
  }

  return (
    <AppShell>
      <div className="panel auth-panel">
        <div className="status-row">
          <span className={connected ? "pill online" : "pill offline"}>{connected ? "Socket Live" : "Connecting"}</span>
          <div className="mode-toggle">
            <button className={mode === "login" ? "" : "secondary"} onClick={() => setMode("login")}>
              Sign In
            </button>
            <button className={mode === "register" ? "" : "secondary"} onClick={() => setMode("register")}>
              Register
            </button>
          </div>
        </div>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {mode === "register" ? (
          <label className="field">
            <span>Commander Name</span>
            <input value={displayName} maxLength={20} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
        ) : null}
        <button onClick={() => void submit()} disabled={!email.trim() || !password.trim() || (mode === "register" && !displayName.trim())}>
          {mode === "login" ? "Enter War Room" : "Create Account"}
        </button>
        {error ? (
          <div className="error-banner" onClick={clearError}>
            {error}
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function LandingScreen() {
  const [roomCode, setRoomCode] = useState("");
  const authUser = useAppStore((store) => store.authUser)!;
  const connected = useAppStore((store) => store.connected);
  const createRoom = useAppStore((store) => store.createRoom);
  const joinRoom = useAppStore((store) => store.joinRoom);
  const logout = useAppStore((store) => store.logout);
  const profileCharacters = useAppStore((store) => store.profileCharacters);
  const activeGames = useAppStore((store) => store.activeGames);
  const returnToGame = useAppStore((store) => store.returnToGame);
  const removeActiveGame = useAppStore((store) => store.removeActiveGame);
  const deleteProfileCharacter = useAppStore((store) => store.deleteProfileCharacter);
  const error = useAppStore((store) => store.error);
  const clearError = useAppStore((store) => store.clearError);

  return (
    <AppShell>
      <div className="layout home-layout">
        <div className="panel auth-panel">
          <div className="status-row">
            <span className={connected ? "pill online" : "pill offline"}>{connected ? "Socket Live" : "Connecting"}</span>
            <button className="secondary" onClick={() => void logout()}>
              Sign Out
            </button>
          </div>
          <div className="profile-summary">
            <strong>{authUser.displayName}</strong>
            <span>{authUser.email}</span>
            <span>
              Record {authUser.wins}W / {authUser.losses}L
            </span>
          </div>
          <div className="actions">
            <button onClick={() => void createRoom()}>Create Room</button>
          </div>
          <div className="join-block">
            <label className="field">
              <span>Join Code</span>
              <input value={roomCode} maxLength={6} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} />
            </label>
            <button className="secondary" onClick={() => void joinRoom(roomCode)} disabled={roomCode.length < 6}>
              Join Room
            </button>
          </div>
          {error ? (
            <div className="error-banner" onClick={clearError}>
              {error}
            </div>
          ) : null}
        </div>
        <section className="panel">
          <h3>Active Games</h3>
          <div className="roster">
            {activeGames.length > 0 ? (
              activeGames.map((game) => (
                <div key={`${game.roomCode}-${game.playerId}`} className="roster-card">
                  <div className="roster-title">
                    <strong>Room {game.roomCode}</strong>
                    <span>{game.status === "lobby" ? "Lobby" : game.phase}</span>
                  </div>
                  <span>
                    {game.playerCount} players • Turn {game.turnCount}
                  </span>
                  <span>{game.objective}</span>
                  <div className="button-group">
                    <button onClick={() => void returnToGame(game)}>Return To Game</button>
                    {!game.isHost ? (
                      <button className="secondary" onClick={() => void removeActiveGame(game.roomCode)}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Any room you join will appear here so you can jump back into it later.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h3>Saved Profile Units</h3>
          <div className="roster">
            {profileCharacters.length > 0 ? (
              profileCharacters.map((character) => (
                <div key={character.id} className="roster-card">
                  <img
                    className="portrait-preview"
                    src={character.portraitUrl ?? getDefaultPortrait("player", character.className)}
                    alt={`${character.name} portrait`}
                  />
                  <div className="roster-title">
                    <strong>{character.name}</strong>
                    <span>{character.className}</span>
                  </div>
                  <button className="secondary" onClick={() => void deleteProfileCharacter(character.id)}>
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">Saved profile units appear here and can be recruited from the lobby.</p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function LobbyScreen({ state }: { state: GameSnapshot }) {
  const playerId = useAppStore((store) => store.playerId);
  const authUser = useAppStore((store) => store.authUser)!;
  const profileCharacters = useAppStore((store) => store.profileCharacters);
  const createCharacter = useAppStore((store) => store.createCharacter);
  const saveProfileCharacter = useAppStore((store) => store.saveProfileCharacter);
  const startBattle = useAppStore((store) => store.startBattle);
  const endGame = useAppStore((store) => store.endGame);
  const exitCurrentGame = useAppStore((store) => store.exitCurrentGame);
  const [name, setName] = useState("");
  const [className, setClassName] = useState(CLASS_OPTIONS[0]);
  const [portraitUrl, setPortraitUrl] = useState<string | undefined>(undefined);
  const isHost = state.hostId === playerId;

  function resetDraftForm() {
    setName("");
    setPortraitUrl(undefined);
  }

  function onPortraitSelected(file: File | undefined) {
    if (!file) {
      setPortraitUrl(undefined);
      return;
    }
    if (!file.type.startsWith("image/")) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPortraitUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <AppShell>
      <div className="room-header panel">
        <div>
          <p className="eyebrow">Lobby</p>
          <h2>Room {state.roomCode}</h2>
        </div>
        <div className="room-meta">
          <span>{authUser.displayName}</span>
          <span>{state.players.length} players</span>
          <span>{state.characterDrafts.length} heroes drafted</span>
          <div className="button-group">
            <button className="secondary" onClick={() => void exitCurrentGame()}>
              Exit Chapter View
            </button>
            {isHost ? (
              <button className="secondary" onClick={() => void endGame()}>
                End Game
              </button>
            ) : null}
          </div>
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
                    {drafts.length > 0 ? drafts.map((draft) => <li key={draft.id}>{draft.name} - {draft.className}</li>) : <li>No units yet</li>}
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
          <label className="field">
            <span>Portrait Override</span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => onPortraitSelected(event.target.files?.[0])}
            />
          </label>
          <div className="portrait-preview-card">
            <img
              className="portrait-preview"
              src={portraitUrl ?? getDefaultPortrait("player", className)}
              alt={`${className} portrait preview`}
            />
            <span>{portraitUrl ? "Custom portrait selected" : "Using class default portrait"}</span>
          </div>
          <div className="stack-actions">
            <button
              onClick={() => {
                createCharacter(name, className, portraitUrl);
                resetDraftForm();
              }}
              disabled={!name.trim()}
            >
              Recruit Unit
            </button>
            <button className="secondary" onClick={() => void saveProfileCharacter(name, className, portraitUrl)} disabled={!name.trim()}>
              Save To Profile
            </button>
            <button className="secondary" disabled={!isHost || state.characterDrafts.length === 0} onClick={startBattle}>
              {isHost ? "Begin Map" : "Host Starts Battle"}
            </button>
          </div>
        </section>
        <section className="panel">
          <h3>Profile Units</h3>
          <div className="roster">
            {profileCharacters.length > 0 ? (
              profileCharacters.map((character) => (
                <div key={character.id} className="roster-card">
                  <img
                    className="portrait-preview"
                    src={character.portraitUrl ?? getDefaultPortrait("player", character.className)}
                    alt={`${character.name} portrait`}
                  />
                  <div className="roster-title">
                    <strong>{character.name}</strong>
                    <span>{character.className}</span>
                  </div>
                  <button onClick={() => createCharacter(character.name, character.className, character.portraitUrl)}>
                    Recruit From Profile
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">Save a unit build here to reuse it across campaigns.</p>
            )}
          </div>
        </section>
        <BattleLog logs={state.logs} />
      </div>
    </AppShell>
  );
}

function AttackAnimation() {
  const [isVisible, setIsVisible] = useState(false);
  const attackingUnitId = useAppStore((store) => store.attackingUnitId);
  const clearAttackAnimation = useAppStore((store) => store.clearAttackAnimation);

  useEffect(() => {
    if (attackingUnitId) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        clearAttackAnimation();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [attackingUnitId, clearAttackAnimation]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="attack-animation-overlay"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.3 }}
        >
          <motion.img
            src="/classes/lord_attack.gif"
            alt="Lord Attack"
            className="attack-animation-sprite"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            transition={{ duration: 0.4 }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function unitCanAttack(unit: Unit, hoveredUnit: Unit | undefined) {
  if (!hoveredUnit || unit.team !== "player" || hoveredUnit.team !== "enemy" || unit.className === "Cleric") {
    return false;
  }
  const gap = Math.abs(unit.position.x - hoveredUnit.position.x) + Math.abs(unit.position.y - hoveredUnit.position.y);
  return gap <= unit.stats.range;
}

function unitCanHeal(unit: Unit, hoveredUnit: Unit | undefined) {
  if (!hoveredUnit || unit.team !== "player" || hoveredUnit.team !== "player" || unit.className !== "Cleric") {
    return false;
  }
  const gap = Math.abs(unit.position.x - hoveredUnit.position.x) + Math.abs(unit.position.y - hoveredUnit.position.y);
  return gap <= unit.stats.range;
}

function BaseCampScreen({ state }: { state: GameSnapshot }) {
  const playerId = useAppStore((store) => store.playerId);
  const buyWeapon = useAppStore((store) => store.buyWeapon);
  const buyItem = useAppStore((store) => store.buyItem);
  const advanceToChapter = useAppStore((store) => store.advanceToChapter);
  const exitCurrentGame = useAppStore((store) => store.exitCurrentGame);
  const isHost = state.hostId === playerId;

  const player = state.players.find(p => p.id === playerId);
  const playerUnits = state.units.filter(u => u.ownerId === playerId && u.alive);

  return (
    <AppShell>
      <div className="room-header panel">
        <div>
          <p className="eyebrow">Base Camp</p>
          <h2>Chapter {state.chapter} Complete</h2>
          <p className="phase-label">PREPARING FOR NEXT CHAPTER</p>
        </div>
        <div className="room-meta">
          <span>Room {state.roomCode}</span>
          <span>Base Camp</span>
          <button className="secondary" onClick={() => void exitCurrentGame()}>
            Exit Chapter View
          </button>
        </div>
      </div>
      <div className="layout basecamp-layout">
        <section className="panel">
          <h3>Your Units</h3>
          <div className="roster">
            {playerUnits.map((unit) => (
              <div key={unit.id} className="roster-card">
                <img
                  className="portrait-preview"
                  src={unit.portraitUrl}
                  alt={`${unit.name} portrait`}
                />
                <div className="roster-title">
                  <strong>{unit.name}</strong>
                  <span>{unit.className} Lv.{unit.level}</span>
                </div>
                <div>
                  <strong>HP:</strong> {unit.stats.hp}/{unit.stats.maxHp}
                </div>
                <div>
                  <strong>Inventory:</strong>
                  <ul>
                    {unit.inventory.weapons.map((weapon) => (
                      <li key={weapon.id}>{weapon.name} ({weapon.might})</li>
                    ))}
                    {unit.inventory.items.map((item) => (
                      <li key={item.id}>{item.name}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <h3>Shop</h3>
          <div>
            <strong>Your Gold: {player?.gold ?? 0}</strong>
          </div>
          <div className="shop-section">
            <h4>Weapons</h4>
            <div className="shop-items">
              {WEAPONS.filter(w => w.price).map((weapon) => (
                <div key={weapon.id} className="shop-item">
                  <div>
                    <strong>{weapon.name}</strong> - {weapon.price} gold
                  </div>
                  <div>Might: {weapon.might}, Type: {weapon.type}</div>
                  <div className="button-group">
                    {playerUnits.map((unit) => (
                      <button
                        key={unit.id}
                        className="secondary small"
                        onClick={() => buyWeapon(playerId!, weapon.id, unit.id)}
                        disabled={(player?.gold ?? 0) < weapon.price}
                      >
                        Buy for {unit.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="shop-section">
            <h4>Items</h4>
            <div className="shop-items">
              {ITEMS.filter(i => i.price).map((item) => (
                <div key={item.id} className="shop-item">
                  <div>
                    <strong>{item.name}</strong> - {item.price} gold
                  </div>
                  <div>Type: {item.type}</div>
                  <div className="button-group">
                    {playerUnits.map((unit) => (
                      <button
                        key={unit.id}
                        className="secondary small"
                        onClick={() => buyItem(playerId!, item.id, unit.id)}
                        disabled={(player?.gold ?? 0) < item.price}
                      >
                        Buy for {unit.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        {isHost && (
          <section className="panel">
            <h3>DM Controls</h3>
            <button onClick={advanceToChapter}>
              Advance to Chapter {state.chapter + 1}
            </button>
          </section>
        )}
        <BattleLog logs={state.logs} />
      </div>
    </AppShell>
  );
}

function BattleScreen({ state }: { state: GameSnapshot }) {
  const playerId = useAppStore((store) => store.playerId);
  const selectUnit = useAppStore((store) => store.selectUnit);
  const moveUnit = useAppStore((store) => store.moveUnit);
  const attackUnit = useAppStore((store) => store.attackUnit);
  const healUnit = useAppStore((store) => store.healUnit);
  const waitUnit = useAppStore((store) => store.waitUnit);
  const cancelMove = useAppStore((store) => store.cancelMove);
  const equipWeapon = useAppStore((store) => store.equipWeapon);
  const useItem = useAppStore((store) => store.useItem);
  const endTurn = useAppStore((store) => store.endTurn);
  const restartMap = useAppStore((store) => store.restartMap);
  const endGame = useAppStore((store) => store.endGame);
  const exitCurrentGame = useAppStore((store) => store.exitCurrentGame);
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);
  const [animatedPositions, setAnimatedPositions] = useState<Record<string, Position>>({});
  const [animationState, setAnimationState] = useState<Record<string, { path: Position[]; startedAt: number }>>({});

  const selectedUnit = state.units.find((unit) => unit.id === state.selectedUnitId && unit.alive) ?? null;
  const hoveredUnit = state.units.find((unit) => unit.id === hoveredUnitId && unit.alive);
  const highlights = useMemo(() => new Set(state.highlights.map(tileKey)), [state.highlights]);
  const isHost = state.hostId === playerId;
  const canRestart = state.status === "complete" && state.winner === "enemy" && isHost;
  const canEndGame = state.status !== "complete" && isHost;

  const healthPercent = (unit: Unit) => Math.max(0, Math.min(100, Math.round((unit.stats.hp / unit.stats.maxHp) * 100)));

  useEffect(() => {
    setAnimatedPositions((current) => {
      const next = { ...current };
      for (const unit of state.units) {
        if (!unit.alive) {
          delete next[unit.id];
          continue;
        }
        if (!next[unit.id]) {
          next[unit.id] = unit.position;
        }
      }
      return next;
    });
  }, [state.units]);

  useEffect(() => {
    setAnimationState((current) => {
      const next = { ...current };
      for (const unit of state.units) {
        if (!unit.alive) {
          delete next[unit.id];
          continue;
        }

        const displayed = animatedPositions[unit.id] ?? unit.position;
        if (displayed.x === unit.position.x && displayed.y === unit.position.y) {
          delete next[unit.id];
          continue;
        }

        if (next[unit.id]) {
          continue;
        }

        const blockedPositions = new Set<string>();
        for (const other of state.units) {
          if (other.alive && other.id !== unit.id && other.team !== unit.team) {
            blockedPositions.add(`${other.position.x},${other.position.y}`);
          }
        }

        const path = findPath(displayed, unit.position, state.map, blockedPositions);
        if (path.length > 0) {
          next[unit.id] = { path, startedAt: Date.now() };
        }
      }
      return next;
    });
  }, [state.units, state.map, animatedPositions]);

  useEffect(() => {
    const SECONDS_PER_CELL = 0.2;
    const MS_PER_CELL = SECONDS_PER_CELL * 1000;
    let timeoutId: number | null = null;

    const tick = () => {
      setAnimationState((current) => {
        const next = { ...current };
        let hasActive = false;

        setAnimatedPositions((displayed) => {
          const updated = { ...displayed };

          for (const [unitId, { path, startedAt }] of Object.entries(current)) {
            const elapsed = Date.now() - startedAt;
            const index = Math.min(path.length - 1, Math.floor(elapsed / MS_PER_CELL));
            updated[unitId] = path[index];

            if (index < path.length - 1) {
              hasActive = true;
            } else {
              delete next[unitId];
            }
          }

          return updated;
        });

        if (hasActive) {
          timeoutId = window.setTimeout(tick, 16);
        }

        return next;
      });
    };

    if (Object.keys(animationState).length > 0) {
      timeoutId = window.setTimeout(tick, 16);
    }

    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [animationState]);

  const combatPreview = useMemo(() => {
    if (!selectedUnit || !hoveredUnit || !unitCanAttack(selectedUnit, hoveredUnit)) {
      return null;
    }
    const attackerTerrain = getTerrainDefense(state.map, selectedUnit.position);
    const defenderTerrain = getTerrainDefense(state.map, hoveredUnit.position);
    return calculateCombatPreview(selectedUnit, hoveredUnit, attackerTerrain, defenderTerrain);
  }, [selectedUnit, hoveredUnit, state.map]);

  return (
    <AppShell>
      <AttackAnimation />
      <div className="room-header panel">
        <div>
          <p className="eyebrow">Battlefield</p>
          <h2>Chapter {state.chapter}: {state.chapter === 1 ? "Border Skirmish" : "Mountain Pass"}</h2>
          <p className="phase-label">{state.phase === "player" ? `Player Phase - Turn ${state.turnCount}` : state.phase.toUpperCase()}</p>
        </div>
        <div className="room-meta">
          <span>Room {state.roomCode}</span>
          <span>{state.winner ? (state.winner === "player" ? "Victory" : "Defeat") : "Objective: Rout the enemy"}</span>
          <button className="secondary" onClick={() => void exitCurrentGame()}>
            Exit Chapter View
          </button>
        </div>
      </div>
      <div className="layout battle-layout">
        <BattleLog logs={state.logs} />
        <section className="panel map-panel">
          <div className="grid-board" style={{ gridTemplateColumns: `repeat(${state.map.width}, 1fr)` }}>
            {state.map.tiles.flatMap((row, y) =>
              row.map((tile, x) => {
                // Use animated position when available, otherwise use the unit's actual position.
                const occupant = state.units.find((unit) => {
                  if (!unit.alive) return false;
                  const displayPos = animatedPositions[unit.id] ?? unit.position;
                  return displayPos.x === x && displayPos.y === y;
                });
                const isHighlighted = highlights.has(tileKey({ x, y }));
                const isSelected = occupant?.id === selectedUnit?.id;
                const isAttackTarget = selectedUnit ? unitCanAttack(selectedUnit, occupant) : false;
                const isHealTarget = selectedUnit ? unitCanHeal(selectedUnit, occupant) : false;

                return (
                  <button
                    key={`${x}-${y}`}
                    className={`tile ${isHighlighted ? "highlight" : ""} ${isSelected ? "selected" : ""} ${isAttackTarget ? "attack-target" : ""} ${isHealTarget ? "heal-target" : ""}`}
                    style={{ backgroundImage: `url(${getTerrainImage(tile.type)})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                    title={TERRAIN_STYLE[tile.type]?.label || tile.type}
                    onMouseEnter={() => setHoveredUnitId(occupant?.id ?? null)}
                    onClick={() => {
                      if (occupant) {
                        if (selectedUnit && occupant.team === "enemy" && selectedUnit.ownerId === playerId && !selectedUnit.acted && unitCanAttack(selectedUnit, occupant)) {
                          attackUnit(selectedUnit.id, occupant.id);
                        } else if (selectedUnit && occupant.team === "player" && selectedUnit.ownerId === playerId && !selectedUnit.acted && unitCanHeal(selectedUnit, occupant)) {
                          healUnit(selectedUnit.id, occupant.id);
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
                    {occupant ? (
                      <motion.div
                        layout
                        className={`unit-chip ${occupant.team} ${occupant.acted ? "acted" : ""}`}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                      >
                        <div className="unit-chip-main">
                          <img src={getClassImage(occupant.className)} alt={occupant.className} className="unit-chip-image" />
                          <div className="unit-chip-info">
                            <span>{occupant.name.slice(0, 2).toUpperCase()}</span>
                            <small>{occupant.stats.hp}</small>
                          </div>
                        </div>
                        <div className="health-bar">
                          <div className="health-bar-fill" style={{ width: `${healthPercent(occupant)}%` }} />
                        </div>
                      </motion.div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </section>
        <section className="panel">
          <h3>Actions</h3>
          {selectedUnit ? (
            <div className="selected-card">
              <div className="unit-stats">
                <strong>{selectedUnit.name}</strong>
                <span>{selectedUnit.className}</span>
                <span>HP {selectedUnit.stats.hp}/{selectedUnit.stats.maxHp}</span>
                <span>MOV {selectedUnit.stats.mov} - RNG {selectedUnit.stats.range}</span>
                <div className="health-bar detail-health-bar">
                  <div className="health-bar-fill" style={{ width: `${healthPercent(selectedUnit)}%` }} />
                </div>
                <span>{selectedUnit.moved ? "Movement spent this turn" : "Movement available"}</span>
              </div>
              <div className="unit-equipment">
                <h4>Equipment</h4>
                <span>{selectedUnit.equippedWeapon ? `Equipped: ${selectedUnit.equippedWeapon.name}` : "No weapon equipped"}</span>
                {selectedUnit.inventory.weapons.length > 0 ? (
                  <div className="button-group">
                    {selectedUnit.inventory.weapons.map((weapon) => (
                      <button
                        key={weapon.id}
                        className="small-button"
                        onClick={() => equipWeapon(selectedUnit.id, weapon.id)}
                        disabled={selectedUnit.equippedWeapon?.id === weapon.id}
                      >
                        Equip {weapon.name}
                      </button>
                    ))}
                    {selectedUnit.equippedWeapon && (
                      <button className="small-button" onClick={() => equipWeapon(selectedUnit.id, null)}>Unequip</button>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="unit-inventory">
                <h4>Inventory</h4>
                {selectedUnit.inventory.items.length > 0 ? (
                  <div className="button-group">
                    {selectedUnit.inventory.items.map((item) => (
                      <button key={item.id} className="small-button" onClick={() => useItem(selectedUnit.id, item.id)}>
                        Use {item.name}
                      </button>
                    ))}
                  </div>
                ) : <span>No items</span>}
              </div>
              <div className="unit-actions">
                <h4>Actions</h4>
                <div className="button-group">
                  {selectedUnit.moved && !selectedUnit.acted ? (
                    <button className="small-button" onClick={() => cancelMove(selectedUnit.id)}>Cancel Move</button>
                  ) : null}
                  <button className="small-button" onClick={() => waitUnit(selectedUnit.id)}>Wait</button>
                </div>
              </div>
            </div>
          ) : (
            <p className="muted">Select one of your units, move onto a highlighted tile, then click an enemy to attack if they are in range.</p>
          )}
          <div className="turn-actions">
            <h4>Turn Actions</h4>
            <div className="button-group">
              <button className="secondary" onClick={endTurn} disabled={state.phase !== "player" || state.status !== "battle"}>
                End Player Phase
              </button>
              {canRestart ? <button onClick={restartMap}>Restart Map</button> : null}
              {canEndGame ? (
                <button className="secondary" onClick={() => void endGame()}>
                  End Game
                </button>
              ) : null}
            </div>
          </div>
        </section>
        <section className="panel">
          <h3>Unit Detail</h3>
          {hoveredUnit ? (
            <div className="detail-card">
              <img className="unit-portrait" src={hoveredUnit.portraitUrl} alt={`${hoveredUnit.name} portrait`} />
              <strong>
                {hoveredUnit.name} - {hoveredUnit.className}
              <span style={{ display: "block", fontSize: "0.95em", color: "var(--muted)", marginTop: "0.2em" }}>
                Lv {hoveredUnit.level} | EXP {hoveredUnit.exp}
              </span>
              </strong>
              <span>{hoveredUnit.team === "player" ? "Allied Unit" : "Enemy Unit"}</span>
              <span>
                HP {hoveredUnit.stats.hp}/{hoveredUnit.stats.maxHp}
              </span>
              <div className="health-bar detail-health-bar">
                <div className="health-bar-fill" style={{ width: `${healthPercent(hoveredUnit)}%` }} />
              </div>
              <span>
                STR {hoveredUnit.stats.str} - MAG {hoveredUnit.stats.mag} - DEF {hoveredUnit.stats.def} - RES {hoveredUnit.stats.res}
              </span>
              <span>Equipped Weapon: {hoveredUnit.equippedWeapon ? `${hoveredUnit.equippedWeapon.name} (${hoveredUnit.equippedWeapon.might} might)` : "None"}</span>
              {hoveredUnit.inventory.weapons.length > 0 ? (
                <div>
                  <h4>Weapons</h4>
                  <ul>
                    {hoveredUnit.inventory.weapons.map((weapon) => (
                      <li key={weapon.id}>
                        {weapon.name} ({weapon.type}, {weapon.might} might)
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {hoveredUnit.inventory.items.length > 0 ? (
                <div>
                  <h4>Items</h4>
                  <ul>
                    {hoveredUnit.inventory.items.map((item) => (
                      <li key={item.id}>
                        {item.name} ({item.type})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {combatPreview ? (
                <div className="combat-preview">
                  <h4>Combat Preview</h4>
                  <div className="preview-row">
                    <span>{selectedUnit!.name} attacks:</span>
                    <span>{combatPreview.baseAttackerDamage} dmg {combatPreview.doubles ? '(x2)' : ''}</span>
                    <span>HP: {hoveredUnit.stats.hp} → {combatPreview.defenderRemainingHp}</span>
                  </div>
                  {combatPreview.canCounter ? (
                    <div className="preview-row">
                      <span>{hoveredUnit.name} counters:</span>
                      <span>{combatPreview.defenderDamage} dmg</span>
                      <span>HP: {selectedUnit!.stats.hp} → {combatPreview.attackerRemainingHp}</span>
                    </div>
                  ) : (
                    <div className="preview-row">
                      <span>{hoveredUnit.name} cannot counter</span>
                    </div>
                  )}
                  <div className="preview-row">
                    <span>Hit: {combatPreview.hitChance}%</span>
                    <span>Crit: {combatPreview.critChance}%</span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="muted">Hover a unit to inspect it.</p>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function BattleLog({ logs }: { logs: GameSnapshot["logs"] }) {
  return (
    <section className="panel log-panel">
      <h3>Battle Log</h3>
      <div className="log-list">
        {logs.map((log, index) => (
          <div
            key={log.id}
            className={`log-entry${index === 0 ? " newest" : ""}`}
          >
            {log.text}
          </div>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const connect = useAppStore((store) => store.connect);
  const hydrateAuth = useAppStore((store) => store.hydrateAuth);
  const authReady = useAppStore((store) => store.authReady);
  const authUser = useAppStore((store) => store.authUser);
  const state = useAppStore((store) => store.state);
  const view = useAppStore((store) => store.view);

  useEffect(() => {
    connect();
    void hydrateAuth();
  }, [connect, hydrateAuth]);

  if (!authReady) {
    return (
      <AppShell>
        <div className="panel auth-panel">
          <p className="muted">Loading commander profile...</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {!authUser ? (
        <motion.div key="auth" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <AuthScreen />
        </motion.div>
      ) : view === "home" ? (
        <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <LandingScreen />
        </motion.div>
      ) : !state ? (
        <motion.div key="game-loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <AppShell>
            <div className="panel auth-panel">
              <p className="muted">Loading chapter state...</p>
            </div>
          </AppShell>
        </motion.div>
      ) : state.status === "lobby" ? (
        <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <LobbyScreen state={state} />
        </motion.div>
      ) : state.phase === "basecamp" ? (
        <motion.div key="basecamp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <BaseCampScreen state={state} />
        </motion.div>
      ) : (
        <motion.div key="battle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <BattleScreen state={state} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
