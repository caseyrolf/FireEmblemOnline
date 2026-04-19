import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BASE_CLASS_OPTIONS, CLASS_OPTIONS, TERRAIN_STYLE, canUnitAttackAtDistance, getDefaultPortrait, getClassImage, isStaffClass, isDancerClass, type Position, type Unit, calculateCombatPreview, type CombatPreview, getTerrainDefense, findPath, WEAPONS, ITEMS, CLASS_ATTACK_GIFS, CLASS_HEAL_GIF, CLASS_SKILLS, SKILLS, type SkillId, type TerrainTile } from "../../shared/game";
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

const LEVEL_UP_STAT_LABELS: Record<keyof Unit["stats"], string> = {
  hp: "HP",
  maxHp: "MAX HP",
  str: "STR",
  mag: "MAG",
  skl: "SKL",
  spd: "SPD",
  def: "DEF",
  res: "RES",
  mov: "MOV",
  range: "RNG"
};

const UNIT_DETAIL_STAT_ORDER: Array<keyof Unit["stats"]> = ["str", "mag", "skl", "spd", "def", "res", "mov", "range"];

const SHOP_TAB_STORAGE_KEY = "feo:basecamp:shop-tab";
const SHOP_AFFORDABLE_STORAGE_KEY = "feo:basecamp:affordable-only";
const SHOP_COMPAT_CLASS_STORAGE_KEY = "feo:basecamp:compat-class";
const BATTLE_TAB_STORAGE_KEY = "feo:battle:mobile-tab";
const CAMPAIGN_FINAL_CHAPTER = 7;

const CHAPTER_TITLES: Record<number, string> = {
  1: "Border Skirmish",
  2: "Mountain Pass",
  3: "Shadowed Grove",
  4: "Iron Bastion",
  5: "Last Redoubt",
  6: "Siege at Dawnwatch",
  7: "Breakout Path"
};

const CLASS_WEAPON_TYPES: Record<Unit["className"], string[]> = {
  Lord: ["Sword"],
  Mercenary: ["Sword"],
  Mage: ["Magic Tome"],
  Cleric: ["Staff"],
  Knight: ["Lance"],
  Brigand: ["Axe"],
  Archer: ["Bow"],
  Dancer: ["Sword"],
  "Great Lord": ["Sword"],
  Hero: ["Sword"],
  Sage: ["Magic Tome"],
  Bishop: ["Staff"],
  General: ["Lance"],
  Warrior: ["Axe"],
  Sniper: ["Bow"],
  Diva: ["Sword"]
};

function getCompatibleWeaponTypes(className: Unit["className"]): string[] {
  return CLASS_WEAPON_TYPES[className] ?? [];
}

function formatTabCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function getChapterTitle(chapter: number): string {
  return CHAPTER_TITLES[chapter] ?? `Chapter ${chapter}`;
}

function getObjectiveText(state: GameSnapshot): string {
  if (state.map.objective.type === "arrive") {
    return "Reach the goal";
  }
  if (state.map.objective.type === "defend") {
    return `Defend for ${state.map.objective.turnLimit ?? 0} turns`;
  }
  return "Rout the enemy";
}

function AppShell({
  children,
  showHero = true,
  shellClassName
}: {
  children: ReactNode;
  showHero?: boolean;
  shellClassName?: string;
}) {
  return (
    <div className={`app-shell${shellClassName ? ` ${shellClassName}` : ""}`}>
      {showHero ? (
        <div className="hero">
          <p className="eyebrow">Co-op Tactical RPG Prototype</p>
          <h1>Fire Emblem Online</h1>
          <p className="hero-copy">
            Sign in, keep a persistent commander profile, save favorite units, and run synchronized tactical battles with
            your party in real time.
          </p>
        </div>
      ) : null}
      {children}
    </div>
  );
}

function StatusStrip({
  items
}: {
  items: Array<{ label: string; value: string; tone?: "neutral" | "good" | "warn" }>;
}) {
  return (
    <section className="panel status-strip" aria-label="Current status">
      {items.map((item) => (
        <div key={item.label} className={`status-chip ${item.tone ?? "neutral"}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </section>
  );
}

function GameTopBanner({ label }: { label: string }) {
  return (
    <header className="game-top-banner" aria-label="Current game view">
      <h1>
        Fire Emblem
        <span>{label}</span>
      </h1>
    </header>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path
          d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6zm10 4a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M3.3 2 2 3.3l3 3C3.1 7.8 2 9.9 2 12c0 0 3.5 6 10 6 2.1 0 3.9-.5 5.4-1.3l3.3 3.3 1.3-1.3L3.3 2zm8.7 6a4 4 0 0 1 4 4c0 .7-.2 1.4-.5 2L9.9 8.5c.6-.3 1.3-.5 2.1-.5zm10 4s-3.5-6-10-6c-1.5 0-2.9.3-4.1.8l1.7 1.7c.4-.2.9-.4 1.4-.4a4 4 0 0 1 4 4c0 .5-.2 1-.4 1.4l1.6 1.6c1.7-1.2 2.8-3.1 2.8-3.1z"
        fill="currentColor"
      />
    </svg>
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
  const [showPassword, setShowPassword] = useState(false);
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
          <div className="password-input-wrap">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
            >
              <EyeIcon open={showPassword} />
            </button>
          </div>
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
  const commanderPortrait = profileCharacters[0]?.portraitUrl ?? getDefaultPortrait("player", "Lord");

  return (
    <AppShell showHero={false} shellClassName="home-shell">
      <header className="home-top-banner" aria-label="Profile overview">
        <h1>
          Fire Emblem
          <span>Online</span>
        </h1>
      </header>
      <div className="home-dashboard">
        <aside className="home-sidebar">
          <div className="home-avatar-wrap">
            <img className="home-avatar" src={commanderPortrait} alt={`${authUser.displayName} profile portrait`} />
          </div>
          <div className="home-profile-meta">
            <h2>{authUser.displayName}</h2>
            <span>{authUser.email}</span>
            <span>
              Record: {authUser.wins}W / {authUser.losses}L
            </span>
          </div>
          <span className={connected ? "pill online" : "pill offline"}>{connected ? "Socket Live" : "Connecting"}</span>
          <div className="home-sidebar-actions">
            <button className="home-btn home-btn-quiet" onClick={() => void logout()}>
              Sign Out
            </button>
            <button className="home-btn" onClick={() => void createRoom()}>
              Create Room
            </button>
            <input
              className="home-code-input"
              value={roomCode}
              maxLength={6}
              placeholder="Join Code"
              onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
            />
            <button className="home-btn home-btn-quiet" onClick={() => void joinRoom(roomCode)} disabled={roomCode.length < 6}>
              Join Room
            </button>
          </div>
          {error ? (
            <div className="error-banner" onClick={clearError}>
              {error}
            </div>
          ) : null}
        </aside>
        <section className="home-games-panel" aria-label="Active games">
          <h3>Active Games</h3>
          <div className="home-games-grid">
            {activeGames.length > 0 ? (
              activeGames.map((game) => (
                <article key={`${game.roomCode}-${game.playerId}`} className="home-game-card">
                  <div className="home-game-code">
                    <span>{game.phase === "player" ? "PLAYER" : game.phase.toUpperCase()}</span>
                    <strong>{game.roomCode}</strong>
                  </div>
                  <h4>{authUser.displayName} Squad</h4>
                  <p>{game.objective}</p>
                  <div className="home-game-meta">
                    <span>Turn {game.turnCount}</span>
                    <span>{game.playerCount} Players</span>
                  </div>
                  <div className="home-game-actions">
                    <button className="home-btn" onClick={() => void returnToGame(game)}>
                      Return to Game
                    </button>
                    {!game.isHost ? (
                      <button className="home-btn home-btn-quiet" onClick={() => void removeActiveGame(game.roomCode)}>
                        Remove
                      </button>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <p className="muted">Any room you join will appear here so you can jump back into it later.</p>
            )}
          </div>
        </section>
        <section className="home-units-panel" aria-label="Saved profile units">
          <div className="home-units-header">
            <h3>Saved Profile Units</h3>
          </div>
          <div className="home-units-list">
            {profileCharacters.length > 0 ? (
              profileCharacters.map((character) => (
                <article key={character.id} className="home-unit-card">
                  <img
                    className="portrait-preview"
                    src={character.portraitUrl ?? getDefaultPortrait("player", character.className)}
                    alt={`${character.name} portrait`}
                  />
                  <div className="home-unit-meta">
                    <strong>{character.name}</strong>
                    <span>{character.className}</span>
                  </div>
                  <button className="home-btn home-btn-quiet" onClick={() => void deleteProfileCharacter(character.id)}>
                    Remove
                  </button>
                </article>
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
  const connected = useAppStore((store) => store.connected);
  const authUser = useAppStore((store) => store.authUser)!;
  const profileCharacters = useAppStore((store) => store.profileCharacters);
  const createCharacter = useAppStore((store) => store.createCharacter);
  const saveProfileCharacter = useAppStore((store) => store.saveProfileCharacter);
  const startBattle = useAppStore((store) => store.startBattle);
  const endGame = useAppStore((store) => store.endGame);
  const exitCurrentGame = useAppStore((store) => store.exitCurrentGame);
  const [name, setName] = useState("");
  const [className, setClassName] = useState(BASE_CLASS_OPTIONS[0]);
  const [portraitUrl, setPortraitUrl] = useState<string | undefined>(undefined);
  const [skillId, setSkillId] = useState<SkillId>(CLASS_SKILLS[BASE_CLASS_OPTIONS[0]][0]);
  const isHost = state.hostId === playerId;
  const statusItems = [
    { label: "Socket", value: connected ? "Live" : "Connecting", tone: connected ? "good" as const : "warn" as const },
    { label: "Room", value: state.roomCode },
    { label: "Players", value: `${state.players.length}` },
    { label: "Drafted", value: `${state.characterDrafts.length}` }
  ];

  function resetDraftForm() {
    setName("");
    setPortraitUrl(undefined);
    setSkillId(CLASS_SKILLS[className][0]);
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
    <AppShell showHero={false} shellClassName="game-shell">
      <GameTopBanner label="War Room" />
      <StatusStrip items={statusItems} />
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
            <select value={className} onChange={(event) => {
              const next = event.target.value as typeof className;
              setClassName(next);
              setSkillId(CLASS_SKILLS[next][0]);
            }}>
              {BASE_CLASS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="field">
            <legend>Skill</legend>
            {CLASS_SKILLS[className].map((sid) => {
              const skill = SKILLS[sid];
              return (
                <label key={sid} className="skill-option">
                  <input
                    type="radio"
                    name="skill"
                    value={sid}
                    checked={skillId === sid}
                    onChange={() => setSkillId(sid)}
                  />
                  <span className="skill-name">{skill.name}</span>
                  <span className="skill-desc muted">{skill.description}</span>
                </label>
              );
            })}
          </fieldset>
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
                createCharacter(name, className, portraitUrl, skillId);
                resetDraftForm();
              }}
              disabled={!name.trim()}
            >
              Recruit Unit
            </button>
            <button className="secondary" onClick={() => void saveProfileCharacter(name, className, portraitUrl, skillId)} disabled={!name.trim()}>
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
                  <button onClick={() => createCharacter(character.name, character.className, character.portraitUrl, character.skillId)}>
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
        <GameChatPanel messages={state.chatMessages} />
      </div>
    </AppShell>
  );
}

function AttackAnimation() {
  const combatAnimation = useAppStore((store) => store.combatAnimation);
  const clearCombatAnimation = useAppStore((store) => store.clearCombatAnimation);

  useEffect(() => {
    if (!combatAnimation) return;
    const timer = setTimeout(() => {
      clearCombatAnimation();
    }, 2000);
    return () => clearTimeout(timer);
  }, [combatAnimation, clearCombatAnimation]);

  const animGif = combatAnimation
    ? combatAnimation.type === 'heal'
      ? CLASS_HEAL_GIF
      : CLASS_ATTACK_GIFS[combatAnimation.className]
    : null;

  return (
    <AnimatePresence>
      {combatAnimation && animGif ? (
        <motion.div
          key={combatAnimation.unitId + combatAnimation.type}
          className="attack-animation-overlay"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.3 }}
        >
          <motion.img
            src={animGif}
            alt="Combat animation"
            className="attack-animation-sprite"
            initial={{ opacity: 0, y: 50, scale: 2 }}
            animate={{ opacity: 1, y: 0, scale: 2 }}
            exit={{ opacity: 0, y: -50, scale: 2 }}
            transition={{ duration: 0.4 }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function PhaseAnnouncementOverlay() {
  const phaseAnnouncement = useAppStore((store) => store.phaseAnnouncement);
  const clearPhaseAnnouncement = useAppStore((store) => store.clearPhaseAnnouncement);

  const phaseLabel =
    phaseAnnouncement === "player"
      ? "Player Phase"
      : phaseAnnouncement === "enemy"
        ? "Enemy Phase"
        : phaseAnnouncement === "victory"
          ? "Victory"
          : "Defeat";

  useEffect(() => {
    if (!phaseAnnouncement) return;
    const timer = window.setTimeout(() => {
      clearPhaseAnnouncement();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [phaseAnnouncement, clearPhaseAnnouncement]);

  return (
    <AnimatePresence>
      {phaseAnnouncement ? (
        <motion.div
          key={phaseAnnouncement}
          className={`phase-announcement-overlay phase-announcement-overlay--${phaseAnnouncement}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <motion.div
            className="phase-announcement-banner"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            exit={{ scaleX: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <span className="phase-announcement-label">
              {phaseLabel}
            </span>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function LevelUpOverlay() {
  const levelUpEvent = useAppStore((store) => store.levelUpEvent);
  const clearLevelUpEvent = useAppStore((store) => store.clearLevelUpEvent);

  useEffect(() => {
    if (!levelUpEvent) {
      return;
    }
    const timer = window.setTimeout(() => {
      clearLevelUpEvent();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [levelUpEvent, clearLevelUpEvent]);

  return (
    <AnimatePresence>
      {levelUpEvent ? (
        <motion.div
          key={`${levelUpEvent.unitId}-${levelUpEvent.newLevel}`}
          className="level-up-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="level-up-modal"
            initial={{ scale: 0.92, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: -16, opacity: 0 }}
            transition={{ duration: 0.24 }}
          >
            <p className="eyebrow">Level Up</p>
            <h3>{levelUpEvent.unitName} reached Lv {levelUpEvent.newLevel}</h3>
            <p className="muted level-up-subtitle">{levelUpEvent.className} - EXP {levelUpEvent.expRemainder}/100</p>
            <div className="level-up-stats">
              {levelUpEvent.statGains.length > 0 ? (
                levelUpEvent.statGains.map((gain) => (
                  <div key={`${gain.stat}-${gain.newValue}`} className="level-up-stat-row">
                    <span>{LEVEL_UP_STAT_LABELS[gain.stat]}</span>
                    <strong>+{gain.gain}</strong>
                    <span>{gain.newValue}</span>
                  </div>
                ))
              ) : (
                <p className="muted">No stats increased this level.</p>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function PromotionOverlay() {
  const promotionEvent = useAppStore((store) => store.promotionEvent);
  const clearPromotionEvent = useAppStore((store) => store.clearPromotionEvent);

  useEffect(() => {
    if (!promotionEvent) {
      return;
    }
    const timer = window.setTimeout(() => {
      clearPromotionEvent();
    }, 3400);
    return () => window.clearTimeout(timer);
  }, [promotionEvent, clearPromotionEvent]);

  return (
    <AnimatePresence>
      {promotionEvent ? (
        <motion.div
          key={`${promotionEvent.unitId}-${promotionEvent.newClassName}-${promotionEvent.newLevel}`}
          className="level-up-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="level-up-modal promotion-modal"
            initial={{ scale: 0.92, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: -16, opacity: 0 }}
            transition={{ duration: 0.24 }}
          >
            <p className="eyebrow">Promotion</p>
            <h3>{promotionEvent.unitName} promoted!</h3>
            <p className="muted level-up-subtitle">
              {promotionEvent.oldClassName} -&gt; {promotionEvent.newClassName}
            </p>
            <div className="level-up-stats">
              {promotionEvent.statGains.length > 0 ? (
                promotionEvent.statGains.map((gain) => (
                  <div key={`${gain.stat}-${gain.newValue}`} className="level-up-stat-row">
                    <span>{LEVEL_UP_STAT_LABELS[gain.stat]}</span>
                    <strong>+{gain.gain}</strong>
                    <span>{gain.newValue}</span>
                  </div>
                ))
              ) : (
                <p className="muted">No stat changes from promotion.</p>
              )}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function BattleOutcomeOverlay({
  winner,
  show,
  isHost,
  chapter,
  onAdvanceToBaseCamp,
  onExitGame
}: {
  winner: "player" | "enemy" | null;
  show: boolean;
  isHost: boolean;
  chapter: number;
  onAdvanceToBaseCamp: () => void;
  onExitGame: () => void;
}) {
  const canAdvanceToBaseCamp = show && winner === "player" && chapter < CAMPAIGN_FINAL_CHAPTER;
  const canExitToMainScreen =
    show && (winner === "enemy" || (winner === "player" && chapter >= CAMPAIGN_FINAL_CHAPTER));

  return (
    <AnimatePresence>
      {show && winner ? (
        <motion.div
          className="battle-outcome-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className={`battle-outcome-card ${winner}`}
            initial={{ scale: 0.92, y: 18 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <p className="eyebrow">Battle Result</p>
            <h2>{winner === "player" ? "Victory" : "Defeat"}</h2>
            <p>{winner === "player" ? "Your objective is complete." : "Your party has fallen in battle."}</p>
            {canAdvanceToBaseCamp ? (
              isHost ? (
                <button className="battle-outcome-action" onClick={onAdvanceToBaseCamp}>
                  Advance To Base Camp
                </button>
              ) : (
                <p className="muted">Waiting for the DM to advance to Base Camp.</p>
              )
            ) : null}
            {canExitToMainScreen ? (
              <button className="battle-outcome-action" onClick={onExitGame}>
                Return To Main Screen
              </button>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function unitCanAttack(unit: Unit, hoveredUnit: Unit | undefined) {
  if (!hoveredUnit || unit.team !== "player" || hoveredUnit.team !== "enemy" || isStaffClass(unit.className)) {
    return false;
  }
  const gap = Math.abs(unit.position.x - hoveredUnit.position.x) + Math.abs(unit.position.y - hoveredUnit.position.y);
  return canUnitAttackAtDistance(unit, gap);
}

function unitCanHeal(unit: Unit, hoveredUnit: Unit | undefined) {
  if (!hoveredUnit || unit.team !== "player" || hoveredUnit.team !== "player" || !isStaffClass(unit.className)) {
    return false;
  }
  const gap = Math.abs(unit.position.x - hoveredUnit.position.x) + Math.abs(unit.position.y - hoveredUnit.position.y);
  return gap <= unit.stats.range;
}

function unitCanDance(unit: Unit, hoveredUnit: Unit | undefined) {
  if (!hoveredUnit || !isDancerClass(unit.className) || hoveredUnit.id === unit.id) {
    return false;
  }
  if (hoveredUnit.team !== "player" || !hoveredUnit.acted) {
    return false;
  }
  const gap = Math.abs(unit.position.x - hoveredUnit.position.x) + Math.abs(unit.position.y - hoveredUnit.position.y);
  return gap === 1;
}

function enemyMovementRange(state: GameSnapshot, unit: Unit) {
  const frontier: Array<{ position: Position; cost: number }> = [{ position: unit.position, cost: 0 }];
  const bestCost = new Map<string, number>([[tileKey(unit.position), 0]]);
  const reachable = new Set<string>();

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    const neighbors: Position[] = [
      { x: current.position.x + 1, y: current.position.y },
      { x: current.position.x - 1, y: current.position.y },
      { x: current.position.x, y: current.position.y + 1 },
      { x: current.position.x, y: current.position.y - 1 }
    ];

    for (const next of neighbors) {
      if (next.x < 0 || next.y < 0 || next.x >= state.map.width || next.y >= state.map.height) {
        continue;
      }
      const tile = state.map.tiles[next.y]?.[next.x];
      if (!tile || tile.type === "mountain") {
        continue;
      }
      const occupant = state.units.find(
        (candidate) => candidate.alive && candidate.position.x === next.x && candidate.position.y === next.y
      );
      if (occupant && occupant.id !== unit.id && occupant.team !== unit.team) {
        continue;
      }

      const nextCost = current.cost + tile.moveCost;
      if (nextCost > unit.stats.mov) {
        continue;
      }

      const nextKey = tileKey(next);
      const knownCost = bestCost.get(nextKey);
      if (knownCost !== undefined && knownCost <= nextCost) {
        continue;
      }

      bestCost.set(nextKey, nextCost);
      if (!occupant || occupant.id === unit.id) {
        reachable.add(nextKey);
      }
      frontier.push({ position: next, cost: nextCost });
    }
  }

  return reachable;
}

function BaseCampScreen({ state }: { state: GameSnapshot }) {
  const playerId = useAppStore((store) => store.playerId);
  const buyWeapon = useAppStore((store) => store.buyWeapon);
  const buyItem = useAppStore((store) => store.buyItem);
  const advanceToChapter = useAppStore((store) => store.advanceToChapter);
  const exitCurrentGame = useAppStore((store) => store.exitCurrentGame);
  const isHost = state.hostId === playerId;
  const [shopTab, setShopTab] = useState<"all" | "weapons" | "items">(() => {
    const stored = typeof window !== "undefined" ? window.sessionStorage.getItem(SHOP_TAB_STORAGE_KEY) : null;
    return stored === "weapons" || stored === "items" || stored === "all" ? stored : "all";
  });
  const [affordableOnly, setAffordableOnly] = useState<boolean>(() => {
    const stored = typeof window !== "undefined" ? window.sessionStorage.getItem(SHOP_AFFORDABLE_STORAGE_KEY) : null;
    return stored === "true";
  });
  const [compatibleClass, setCompatibleClass] = useState<"all" | Unit["className"]>(() => {
    const stored = typeof window !== "undefined" ? window.sessionStorage.getItem(SHOP_COMPAT_CLASS_STORAGE_KEY) : null;
    if (!stored || stored === "all") {
      return "all";
    }
    return CLASS_OPTIONS.includes(stored as Unit["className"]) ? (stored as Unit["className"]) : "all";
  });

  const player = state.players.find(p => p.id === playerId);
  const playerUnits = state.units.filter(u => u.ownerId === playerId && u.alive);
  const gold = player?.gold ?? 0;
  const filteredWeapons = WEAPONS.filter((weapon) => {
    if (!weapon.price) {
      return false;
    }
    const passesGold = !affordableOnly || weapon.price <= gold;
    if (!passesGold) {
      return false;
    }
    if (compatibleClass === "all") {
      return true;
    }
    return getCompatibleWeaponTypes(compatibleClass).includes(weapon.type);
  });
  const filteredItems = ITEMS.filter((item) => {
    if (!item.price) {
      return false;
    }
    return !affordableOnly || item.price <= gold;
  });
  const statusItems = [
    { label: "Room", value: state.roomCode },
    { label: "Gold", value: `${gold}` },
    { label: "Units", value: `${playerUnits.length}` },
    { label: "DM", value: isHost ? "You" : "Waiting", tone: isHost ? "good" as const : "neutral" as const }
  ];
  const activeFilterCount = (shopTab !== "all" ? 1 : 0) + (affordableOnly ? 1 : 0) + (compatibleClass !== "all" ? 1 : 0);

  useEffect(() => {
    window.sessionStorage.setItem(SHOP_TAB_STORAGE_KEY, shopTab);
  }, [shopTab]);

  useEffect(() => {
    window.sessionStorage.setItem(SHOP_AFFORDABLE_STORAGE_KEY, String(affordableOnly));
  }, [affordableOnly]);

  useEffect(() => {
    window.sessionStorage.setItem(SHOP_COMPAT_CLASS_STORAGE_KEY, compatibleClass);
  }, [compatibleClass]);

  return (
    <AppShell showHero={false} shellClassName="game-shell">
      <GameTopBanner label="Base Camp" />
      <StatusStrip items={statusItems} />
      <div className="room-header panel">
        <div>
          <p className="eyebrow">Base Camp</p>
          <h2>Chapter {state.chapter} Complete</h2>
          <p className="phase-label">PREPARING FOR NEXT CHAPTER</p>
        </div>
        <div className="room-meta">
          <span>Room {state.roomCode}</span>
          <span>Base Camp</span>
          {isHost ? (
            <button onClick={advanceToChapter}>
              Advance to Chapter {state.chapter + 1}
            </button>
          ) : null}
          <button className="secondary" onClick={() => void exitCurrentGame()}>
            Exit Chapter View
          </button>
        </div>
      </div>
      <div className="layout basecamp-log-layout">
        <BattleLog logs={state.logs} />
        <GameChatPanel messages={state.chatMessages} />
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
          <div className="shop-title-row">
            <h3>Shop</h3>
            {activeFilterCount > 0 ? <span className="shop-active-indicator">{activeFilterCount} filters active</span> : null}
          </div>
          <div>
            <strong>Your Gold: {player?.gold ?? 0}</strong>
          </div>
          <div className="shop-filter-bar" role="group" aria-label="Shop filters">
            <div className="shop-tab-group">
              <button className={shopTab === "all" ? "secondary is-active" : "secondary"} onClick={() => setShopTab("all")}>All</button>
              <button className={shopTab === "weapons" ? "secondary is-active" : "secondary"} onClick={() => setShopTab("weapons")}>Weapons</button>
              <button className={shopTab === "items" ? "secondary is-active" : "secondary"} onClick={() => setShopTab("items")}>Items</button>
            </div>
            <button
              className={affordableOnly ? "secondary is-active" : "secondary"}
              onClick={() => setAffordableOnly((current) => !current)}
            >
              {affordableOnly ? "Showing Affordable" : "Show Affordable Only"}
            </button>
            <label className="shop-compat-filter">
              <span>Class Compatibility</span>
              <select value={compatibleClass} onChange={(event) => setCompatibleClass(event.target.value as "all" | Unit["className"])}>
                <option value="all">All Classes</option>
                {CLASS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {shopTab === "all" || shopTab === "weapons" ? (
            <div className="shop-section">
              <h4>Weapons</h4>
              <div className="shop-items">
                {filteredWeapons.length > 0 ? filteredWeapons.map((weapon) => (
                <div key={weapon.id} className="shop-item">
                  <div>
                    <strong>{weapon.name}</strong> - {weapon.price} gold
                  </div>
                  <div>Might: {weapon.might}, Type: {weapon.type}</div>
                  <div className="button-group">
                    {playerUnits.map((unit) => (
                      <button
                        key={unit.id}
                        className="secondary small-button"
                        onClick={() => buyWeapon(playerId!, weapon.id, unit.id)}
                        disabled={gold < (weapon.price ?? 0)}
                      >
                        Buy for {unit.name}
                      </button>
                    ))}
                  </div>
                </div>
                )) : <p className="muted">No weapons match your current filters.</p>}
              </div>
            </div>
          ) : null}
          {shopTab === "all" || shopTab === "items" ? (
            <div className="shop-section">
              <h4>Items</h4>
              <div className="shop-items">
                {filteredItems.length > 0 ? filteredItems.map((item) => (
                <div key={item.id} className="shop-item">
                  <div>
                    <strong>{item.name}</strong> - {item.price} gold
                  </div>
                  <div>Type: {item.type}</div>
                  <div className="button-group">
                    {playerUnits.map((unit) => (
                      <button
                        key={unit.id}
                        className="secondary small-button"
                        onClick={() => buyItem(playerId!, item.id, unit.id)}
                        disabled={gold < (item.price ?? 0)}
                      >
                        Buy for {unit.name}
                      </button>
                    ))}
                  </div>
                </div>
                )) : <p className="muted">No items match your current filters.</p>}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}

function BattleScreen({ state }: { state: GameSnapshot }) {
  const playerId = useAppStore((store) => store.playerId);
  const combatAnimation = useAppStore((store) => store.combatAnimation);
  const levelUpEvent = useAppStore((store) => store.levelUpEvent);
  const phaseAnnouncement = useAppStore((store) => store.phaseAnnouncement);
  const connected = useAppStore((store) => store.connected);
  const selectUnit = useAppStore((store) => store.selectUnit);
  const moveUnit = useAppStore((store) => store.moveUnit);
  const attackUnit = useAppStore((store) => store.attackUnit);
  const healUnit = useAppStore((store) => store.healUnit);
  const danceUnit = useAppStore((store) => store.danceUnit);
  const waitUnit = useAppStore((store) => store.waitUnit);
  const cancelMove = useAppStore((store) => store.cancelMove);
  const equipWeapon = useAppStore((store) => store.equipWeapon);
  const useItem = useAppStore((store) => store.useItem);
  const advanceToBaseCamp = useAppStore((store) => store.advanceToBaseCamp);
  const sendChatMessage = useAppStore((store) => store.sendChatMessage);
  const endTurn = useAppStore((store) => store.endTurn);
  const restartMap = useAppStore((store) => store.restartMap);
  const endGame = useAppStore((store) => store.endGame);
  const exitCurrentGame = useAppStore((store) => store.exitCurrentGame);
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);
  const [hoveredTile, setHoveredTile] = useState<{ x: number; y: number; tile: TerrainTile } | null>(null);
  const [animatedPositions, setAnimatedPositions] = useState<Record<string, Position>>({});
  const [animationState, setAnimationState] = useState<Record<string, { path: Position[]; startedAt: number }>>({});
  const [activeMobileTab, setActiveMobileTab] = useState<"map" | "actions" | "detail" | "log" | "chat">(() => {
    const stored = typeof window !== "undefined" ? window.sessionStorage.getItem(BATTLE_TAB_STORAGE_KEY) : null;
    return stored === "actions" || stored === "detail" || stored === "log" || stored === "chat" || stored === "map" ? stored : "map";
  });
  const [statsOpen, setStatsOpen] = useState(true);

  const selectedUnit = state.units.find((unit) => unit.id === state.selectedUnitId && unit.alive) ?? null;
  const hoveredUnit = state.units.find((unit) => unit.id === hoveredUnitId && unit.alive);
  const highlights = useMemo(() => new Set(state.highlights.map(tileKey)), [state.highlights]);
  const isHost = state.hostId === playerId;
  const canRestart = isHost;
  const canEndGame = state.status !== "complete" && isHost;
  const hasBattleOutcome = state.phase === "victory" || state.phase === "defeat" || state.status === "complete";
  const showOutcomeOverlay = hasBattleOutcome && !combatAnimation && !levelUpEvent && !phaseAnnouncement;
  const selectedHint = selectedUnit
    ? `${selectedUnit.name} ${selectedUnit.acted ? "ready" : "active"}`
    : "No unit selected";
  const statusItems = [
    { label: "Socket", value: connected ? "Live" : "Connecting", tone: connected ? "good" as const : "warn" as const },
    { label: "Phase", value: state.phase === "player" ? `Player ${state.turnCount}` : state.phase.toUpperCase() },
    { label: "Objective", value: state.winner ? (state.winner === "player" ? "Victory" : "Defeat") : getObjectiveText(state) },
    { label: "Selected", value: selectedHint }
  ];
  const actionCount = selectedUnit
    ? (selectedUnit.inventory.items.length + selectedUnit.inventory.weapons.length + (selectedUnit.moved && !selectedUnit.acted ? 1 : 0) + 1)
    : 0;
  const detailCount = hoveredUnit ? 1 : 0;
  const chatCount = state.chatMessages.length;
  const actionBadgeHint = selectedUnit
    ? `Actions include ${selectedUnit.inventory.weapons.length} weapons, ${selectedUnit.inventory.items.length} items, wait, and conditional cancel move.`
    : "No unit selected, so no actions are available.";

  useEffect(() => {
    window.sessionStorage.setItem(BATTLE_TAB_STORAGE_KEY, activeMobileTab);
  }, [activeMobileTab]);

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

  const hoveredEnemyMovementTiles = useMemo(() => {
    if (!hoveredUnit || hoveredUnit.team !== "enemy") {
      return new Set<string>();
    }
    return enemyMovementRange(state, hoveredUnit);
  }, [state, hoveredUnit]);

  return (
    <AppShell showHero={false} shellClassName="game-shell">
      <GameTopBanner label="Battle" />
      <AttackAnimation />
      <PhaseAnnouncementOverlay />
      <LevelUpOverlay />
      <PromotionOverlay />
      <BattleOutcomeOverlay
        winner={state.winner}
        show={showOutcomeOverlay}
        isHost={isHost}
        chapter={state.chapter}
        onAdvanceToBaseCamp={advanceToBaseCamp}
        onExitGame={() => void exitCurrentGame()}
      />
      <StatusStrip items={statusItems} />
      <div className="room-header panel">
        <div>
          <p className="eyebrow">Battlefield</p>
          <h2>Chapter {state.chapter}: {getChapterTitle(state.chapter)}</h2>
          <p className="phase-label">{state.phase === "player" ? `Player Phase - Turn ${state.turnCount}` : state.phase.toUpperCase()}</p>
        </div>
        <div className="room-meta">
          <span>Room {state.roomCode}</span>
          <span>{state.winner ? (state.winner === "player" ? "Victory" : "Defeat") : `Objective: ${getObjectiveText(state)}`}</span>
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
            <button className="secondary" onClick={() => void exitCurrentGame()}>
              Exit Chapter View
            </button>
          </div>
        </div>
      </div>
      <div className="panel battle-tab-bar" role="tablist" aria-label="Battle panels">
        <button className={activeMobileTab === "map" ? "secondary is-active" : "secondary"} onClick={() => setActiveMobileTab("map")} role="tab" aria-selected={activeMobileTab === "map"}>Map</button>
        <button
          className={activeMobileTab === "actions" ? "secondary is-active" : "secondary"}
          onClick={() => setActiveMobileTab("actions")}
          role="tab"
          aria-selected={activeMobileTab === "actions"}
          title={actionBadgeHint}
        >
          Actions <span className="tab-badge">{formatTabCount(actionCount)}</span>
        </button>
        <button className={activeMobileTab === "detail" ? "secondary is-active" : "secondary"} onClick={() => setActiveMobileTab("detail")} role="tab" aria-selected={activeMobileTab === "detail"}>Detail <span className="tab-badge">{detailCount}</span></button>
        <button className={activeMobileTab === "log" ? "secondary is-active" : "secondary"} onClick={() => setActiveMobileTab("log")} role="tab" aria-selected={activeMobileTab === "log"}>Log <span className="tab-badge">{formatTabCount(state.logs.length)}</span></button>
        <button className={activeMobileTab === "chat" ? "secondary is-active" : "secondary"} onClick={() => setActiveMobileTab("chat")} role="tab" aria-selected={activeMobileTab === "chat"}>Chat <span className="tab-badge">{formatTabCount(chatCount)}</span></button>
      </div>
      <div className="layout battle-layout">
        <section className={`panel map-panel battle-pane ${activeMobileTab === "map" ? "is-active" : "is-inactive"}`}>
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
                const isSelected = Boolean(selectedUnit && occupant && occupant.id === selectedUnit.id);
                const isAttackTarget = selectedUnit ? unitCanAttack(selectedUnit, occupant) : false;
                const isHealTarget = selectedUnit ? unitCanHeal(selectedUnit, occupant) : false;
                const isDanceTarget = selectedUnit ? unitCanDance(selectedUnit, occupant) : false;
                const isEnemyMovementTile = hoveredEnemyMovementTiles.has(tileKey({ x, y }));

                return (
                  <button
                    key={`${x}-${y}`}
                    className={`tile ${isHighlighted ? "highlight" : ""} ${isSelected ? "selected" : ""} ${isAttackTarget ? "attack-target" : ""} ${isHealTarget ? "heal-target" : ""} ${isDanceTarget ? "dance-target" : ""} ${isEnemyMovementTile ? "enemy-range" : ""}`}
                    style={{ backgroundImage: `url(${getTerrainImage(tile.type)})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                    title={TERRAIN_STYLE[tile.type]?.label || tile.type}
                    onMouseEnter={() => { setHoveredUnitId(occupant?.id ?? null); setHoveredTile({ x, y, tile }); }}
                    onMouseLeave={() => setHoveredTile(null)}
                    onClick={() => {
                      if (occupant) {
                        if (selectedUnit && occupant.team === "enemy" && selectedUnit.ownerId === playerId && !selectedUnit.acted && unitCanAttack(selectedUnit, occupant)) {
                          attackUnit(selectedUnit.id, occupant.id);
                        } else if (selectedUnit && occupant.team === "player" && selectedUnit.ownerId === playerId && !selectedUnit.acted && occupant.id !== selectedUnit.id && unitCanHeal(selectedUnit, occupant)) {
                          healUnit(selectedUnit.id, occupant.id);
                        } else if (selectedUnit && occupant.team === "player" && selectedUnit.ownerId === playerId && !selectedUnit.acted && occupant.id !== selectedUnit.id && unitCanDance(selectedUnit, occupant)) {
                          danceUnit(selectedUnit.id, occupant.id);
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
                        <img src={getClassImage(occupant.className)} alt={occupant.className} className="unit-chip-image" />
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
        <section className={`panel battle-pane actions-panel ${activeMobileTab === "actions" ? "is-active" : "is-inactive"}`}>
          <h3>Actions</h3>
          {selectedUnit ? (
            <div className="selected-card">
              <div className="actions-unit-header">
                <img className="actions-unit-portrait" src={selectedUnit.portraitUrl} alt={`${selectedUnit.name} portrait`} />
                <div className="actions-unit-meta">
                  <strong>{selectedUnit.name}</strong>
                  <span>{selectedUnit.className}</span>
                  <span>Lv {selectedUnit.level} · EXP {selectedUnit.exp}/100</span>
                  <span>HP {selectedUnit.stats.hp}/{selectedUnit.stats.maxHp}</span>
                  <div className="health-bar detail-health-bar">
                    <div className="health-bar-fill" style={{ width: `${healthPercent(selectedUnit)}%` }} />
                  </div>
                  <span className="muted">{selectedUnit.moved ? "Movement spent" : "Movement available"}</span>
                </div>
              </div>
              <div className="collapsible-section">
                <button className="collapsible-toggle secondary" onClick={() => setStatsOpen((o) => !o)}>
                  Stats {statsOpen ? "▲" : "▼"}
                </button>
                {statsOpen ? (
                  <div className="actions-stat-grid">
                    {UNIT_DETAIL_STAT_ORDER.map((statKey) => (
                      <div key={statKey} className="detail-stat">
                        <span>{LEVEL_UP_STAT_LABELS[statKey]}</span>
                        <strong>{selectedUnit.stats[statKey]}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="unit-inventory">
                <h4>Inventory</h4>
                {selectedUnit.inventory.weapons.length === 0 && selectedUnit.inventory.items.length === 0 ? (
                  <span className="muted">No items</span>
                ) : null}
                {selectedUnit.inventory.weapons.length > 0 ? (
                  <div className="inventory-list">
                    {selectedUnit.inventory.weapons.map((weapon) => (
                      <div key={weapon.id} className="inventory-item">
                        <div className="inventory-item-info">
                          <span>{weapon.name}{selectedUnit.equippedWeapon?.id === weapon.id ? " (E)" : ""}</span>
                          <small className="muted">{weapon.type} · {weapon.might} might</small>
                        </div>
                        {selectedUnit.equippedWeapon?.id === weapon.id ? (
                          <button className="small-button" onClick={() => equipWeapon(selectedUnit.id, null)}>Unequip</button>
                        ) : (
                          <button className="small-button" onClick={() => equipWeapon(selectedUnit.id, weapon.id)}>Equip</button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                {selectedUnit.inventory.items.length > 0 ? (
                  <div className="inventory-list">
                    {selectedUnit.inventory.items.map((item) => (
                      <div key={item.id} className="inventory-item">
                        <div className="inventory-item-info">
                          <span>{item.name}</span>
                        </div>
                        <button className="small-button" onClick={() => useItem(selectedUnit.id, item.id)}>
                          Use
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="actions-footer">
                {selectedUnit.moved && !selectedUnit.acted ? (
                  <button className="small-button" onClick={() => cancelMove(selectedUnit.id)}>Return</button>
                ) : null}
                {isDancerClass(selectedUnit.className) && !selectedUnit.acted ? (
                  <span className="muted" style={{ fontSize: "0.8em" }}>Click an adjacent acted ally on the map to Dance</span>
                ) : null}
                <button className="small-button" onClick={() => waitUnit(selectedUnit.id)}>Wait</button>
              </div>
            </div>
          ) : (
            <p className="muted">Select one of your units, move onto a highlighted tile, then click an enemy to attack if in range.</p>
          )}
        </section>
        <section className={`panel unit-detail-panel battle-pane ${activeMobileTab === "detail" ? "is-active" : "is-inactive"}`}>
          <h3>Unit Detail</h3>
          {hoveredTile && (
            <div className="terrain-info-card">
              <strong>{TERRAIN_STYLE[hoveredTile.tile.type]?.label ?? hoveredTile.tile.type}</strong>
              <div className="terrain-info-stats">
                <span>DEF <strong>+{hoveredTile.tile.defense}</strong></span>
                <span>AVO <strong>+{hoveredTile.tile.avoid}</strong></span>
                <span>Move Cost <strong>{hoveredTile.tile.moveCost === 99 ? "—" : hoveredTile.tile.moveCost}</strong></span>
              </div>
            </div>
          )}
          {hoveredUnit && hoveredUnit.team === "enemy" ? (
            <div className="detail-card">
              <div className="detail-overview">
                <div className="detail-main">
                  <img className="unit-portrait" src={hoveredUnit.portraitUrl} alt={`${hoveredUnit.name} portrait`} />
                  <div className="detail-main-meta">
                    <strong>
                      {hoveredUnit.name} - {hoveredUnit.className}
                    </strong>
                    <span className="detail-meta-line">Lv {hoveredUnit.level} | EXP {hoveredUnit.exp}</span>
                    <span>Enemy Unit</span>
                    <span>
                      HP {hoveredUnit.stats.hp}/{hoveredUnit.stats.maxHp}
                    </span>
                    <div className="health-bar detail-health-bar">
                      <div className="health-bar-fill" style={{ width: `${healthPercent(hoveredUnit)}%` }} />
                    </div>
                  </div>
                </div>
                <div className="detail-stat-grid">
                  {UNIT_DETAIL_STAT_ORDER.map((statKey) => (
                    <div key={statKey} className="detail-stat">
                      <span>{LEVEL_UP_STAT_LABELS[statKey]}</span>
                      <strong>{hoveredUnit.stats[statKey]}</strong>
                    </div>
                  ))}
                </div>
              </div>
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
            <p className="muted">Hover an enemy unit to inspect it and see a combat preview.</p>
          )}
        </section>
      </div>
      <BattleLog logs={state.logs} className={`battle-footer-log battle-pane ${activeMobileTab === "log" ? "is-active" : "is-inactive"}`} />
      <GameChatPanel
        messages={state.chatMessages}
        onSend={sendChatMessage}
        localPlayerId={playerId}
        className={`battle-footer-chat battle-pane ${activeMobileTab === "chat" ? "is-active" : "is-inactive"}`}
      />
    </AppShell>
  );
}

function GameChatPanel({
  messages,
  onSend,
  localPlayerId,
  className
}: {
  messages: GameSnapshot["chatMessages"];
  onSend?: (text: string) => void;
  localPlayerId?: string | null;
  className?: string;
}) {
  const sendChatMessage = useAppStore((store) => store.sendChatMessage);
  const [text, setText] = useState("");
  const submitMessage = (onSend ?? sendChatMessage);

  function submit() {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      return;
    }
    submitMessage(trimmed);
    setText("");
  }

  function getTimeLabel(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return "--:--";
    }
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <section className={`panel game-chat-panel ${className ?? ""}`}>
      <h3>Room Chat</h3>
      <div className="game-chat-messages" role="log" aria-live="polite" aria-label="Room chat messages">
        {messages.length > 0 ? (
          messages.map((message) => {
            const isOwn = localPlayerId ? message.playerId === localPlayerId : false;
            return (
              <article key={message.id} className={`game-chat-message${isOwn ? " own" : ""}`}>
                <div className="game-chat-meta">
                  <strong>{message.playerName}</strong>
                  <span>{getTimeLabel(message.createdAt)}</span>
                </div>
                <p>{message.text}</p>
              </article>
            );
          })
        ) : (
          <p className="muted">No chat messages yet. Say hello to your party.</p>
        )}
      </div>
      <div className="game-chat-input-row">
        <input
          value={text}
          maxLength={240}
          placeholder="Type a room message"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button onClick={submit} disabled={!text.trim()}>
          Send
        </button>
      </div>
    </section>
  );
}

function BattleLog({ logs, className }: { logs: GameSnapshot["logs"]; className?: string }) {
  return (
    <section className={`panel log-panel ${className ?? ""}`}>
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
