import { useMemo, useState } from "react";
import type { CampaignEnemyRecord, CampaignMapRecord, CampaignRecord, TerrainType, UnitClass, Weapon } from "../../shared/game";
import { CLASS_OPTIONS, TERRAIN_STYLE, WEAPONS } from "../../shared/game";

type PaintMode = "terrain" | "player-start" | "objective" | "enemy";

const DEFAULT_WIDTH = 10;
const DEFAULT_HEIGHT = 10;

const CLASS_WEAPON_TYPES: Record<UnitClass, Weapon["type"][]> = {
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

function createId() {
  return Math.random().toString(36).slice(2, 10);
}

function cloneCampaign<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createTiles(width: number, height: number, fill: TerrainType = "grass") {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => fill));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createDefaultMap(index: number): CampaignMapRecord {
  return {
    id: createId(),
    name: `Map ${index + 1}`,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    tiles: createTiles(DEFAULT_WIDTH, DEFAULT_HEIGHT),
    playerStarts: [
      { x: 1, y: DEFAULT_HEIGHT - 1 },
      { x: 2, y: DEFAULT_HEIGHT - 1 },
      { x: 3, y: DEFAULT_HEIGHT - 1 }
    ],
    objective: { type: "route" },
    enemies: []
  };
}

export function createEmptyCampaign(): CampaignRecord {
  return {
    id: createId(),
    name: "",
    allowedPlayerUnits: 4,
    maps: [createDefaultMap(0)]
  };
}

function getWeaponsForClass(className: UnitClass) {
  const types = CLASS_WEAPON_TYPES[className] ?? [];
  return WEAPONS.filter((weapon) => types.includes(weapon.type));
}

function resizeMap(map: CampaignMapRecord, width: number, height: number): CampaignMapRecord {
  const nextWidth = clamp(width, 4, 16);
  const nextHeight = clamp(height, 4, 16);
  const tiles = Array.from({ length: nextHeight }, (_, y) =>
    Array.from({ length: nextWidth }, (_, x) => map.tiles[y]?.[x] ?? "grass")
  );
  const playerStarts = map.playerStarts.filter((start) => start.x < nextWidth && start.y < nextHeight);
  const enemies = map.enemies
    .filter((enemy) => enemy.position.x < nextWidth && enemy.position.y < nextHeight)
    .map((enemy) => ({ ...enemy }));
  const objective = { ...map.objective };
  if (objective.target && (objective.target.x >= nextWidth || objective.target.y >= nextHeight)) {
    delete objective.target;
  }
  return {
    ...map,
    width: nextWidth,
    height: nextHeight,
    tiles,
    playerStarts,
    enemies,
    objective
  };
}

function validateCampaign(campaign: CampaignRecord) {
  if (!campaign.name.trim()) {
    return "Campaign name is required.";
  }
  if (campaign.maps.length === 0) {
    return "Add at least one map to the campaign.";
  }
  for (const map of campaign.maps) {
    if (!map.name.trim()) {
      return "Each map needs a name.";
    }
    if (map.playerStarts.length === 0) {
      return `Add at least one player start to ${map.name}.`;
    }
    if (map.objective.type === "arrive" && !map.objective.target) {
      return `Set an arrival target for ${map.name}.`;
    }
    if (map.objective.type === "defend" && !map.objective.turnLimit) {
      return `Set a defend turn limit for ${map.name}.`;
    }
  }
  return null;
}

export function CampaignEditor({
  initialCampaign,
  onSave,
  onCancel
}: {
  initialCampaign: CampaignRecord;
  onSave: (campaign: CampaignRecord) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [campaign, setCampaign] = useState<CampaignRecord>(() => cloneCampaign(initialCampaign));
  const [selectedMapIndex, setSelectedMapIndex] = useState(0);
  const [selectedEnemyId, setSelectedEnemyId] = useState<string | null>(null);
  const [paintMode, setPaintMode] = useState<PaintMode>("terrain");
  const [selectedTerrain, setSelectedTerrain] = useState<TerrainType>("grass");
  const [draftWidth, setDraftWidth] = useState(String(initialCampaign.maps[0]?.width ?? DEFAULT_WIDTH));
  const [draftHeight, setDraftHeight] = useState(String(initialCampaign.maps[0]?.height ?? DEFAULT_HEIGHT));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selectedMap = campaign.maps[selectedMapIndex];
  const selectedEnemy = selectedMap?.enemies.find((enemy) => enemy.id === selectedEnemyId) ?? null;

  const tileOverlay = useMemo(() => {
    const starts = new Set(selectedMap?.playerStarts.map((start) => `${start.x},${start.y}`) ?? []);
    const enemies = new Map<string, number>();
    for (const enemy of selectedMap?.enemies ?? []) {
      const key = `${enemy.position.x},${enemy.position.y}`;
      enemies.set(key, (enemies.get(key) ?? 0) + 1);
    }
    const objectiveKey = selectedMap?.objective.target
      ? `${selectedMap.objective.target.x},${selectedMap.objective.target.y}`
      : null;
    return { starts, enemies, objectiveKey };
  }, [selectedMap]);

  function updateCampaign(updater: (draft: CampaignRecord) => void) {
    setCampaign((current) => {
      const next = cloneCampaign(current);
      updater(next);
      return next;
    });
  }

  function updateSelectedMap(updater: (map: CampaignMapRecord) => void) {
    updateCampaign((draft) => {
      const map = draft.maps[selectedMapIndex];
      if (!map) {
        return;
      }
      updater(map);
    });
  }

  function syncDraftDimensions(map: CampaignMapRecord) {
    setDraftWidth(String(map.width));
    setDraftHeight(String(map.height));
  }

  async function handleSave() {
    const error = validateCampaign(campaign);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    setIsSaving(true);
    try {
      const ok = await onSave(campaign);
      if (ok) {
        onCancel();
      }
    } finally {
      setIsSaving(false);
    }
  }

  function addMap() {
    updateCampaign((draft) => {
      draft.maps.push(createDefaultMap(draft.maps.length));
    });
    const nextIndex = campaign.maps.length;
    setSelectedMapIndex(nextIndex);
    const nextMap = createDefaultMap(nextIndex);
    syncDraftDimensions(nextMap);
    setSelectedEnemyId(null);
  }

  function removeMap(index: number) {
    if (campaign.maps.length === 1) {
      return;
    }
    updateCampaign((draft) => {
      draft.maps.splice(index, 1);
    });
    const nextIndex = Math.max(0, Math.min(index - 1, campaign.maps.length - 2));
    setSelectedMapIndex(nextIndex);
    setSelectedEnemyId(null);
  }

  function moveMap(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= campaign.maps.length) {
      return;
    }
    updateCampaign((draft) => {
      const [map] = draft.maps.splice(index, 1);
      draft.maps.splice(nextIndex, 0, map);
    });
    setSelectedMapIndex(nextIndex);
  }

  function applyTileAction(x: number, y: number) {
    updateSelectedMap((map) => {
      if (paintMode === "terrain") {
        map.tiles[y][x] = selectedTerrain;
        if (map.objective.type === "arrive" && map.objective.target?.x === x && map.objective.target.y === y) {
          map.tiles[y][x] = "goal";
        }
        return;
      }

      if (paintMode === "player-start") {
        const key = `${x},${y}`;
        const index = map.playerStarts.findIndex((start) => `${start.x},${start.y}` === key);
        if (index >= 0) {
          map.playerStarts.splice(index, 1);
        } else {
          map.playerStarts.push({ x, y });
        }
        return;
      }

      if (paintMode === "objective") {
        map.objective.target = { x, y };
        if (map.objective.type === "arrive") {
          map.tiles = map.tiles.map((row, rowIndex) =>
            row.map((tile, columnIndex) => {
              if (rowIndex === y && columnIndex === x) {
                return "goal";
              }
              if (tile === "goal") {
                return "grass";
              }
              return tile;
            })
          );
        }
        return;
      }

      if (paintMode === "enemy" && selectedEnemyId) {
        const enemy = map.enemies.find((entry) => entry.id === selectedEnemyId);
        if (enemy) {
          enemy.position = { x, y };
        }
      }
    });
  }

  function addEnemy() {
    const className: UnitClass = "Brigand";
    const weaponId = getWeaponsForClass(className)[0]?.id ?? WEAPONS[0].id;
    const enemyId = createId();
    updateSelectedMap((map) => {
      const enemy: CampaignEnemyRecord = {
        id: enemyId,
        name: `Enemy ${map.enemies.length + 1}`,
        className,
        level: 1,
        weaponId,
        position: { x: map.width - 1, y: 0 },
        turn: 1,
        behavior: "advance"
      };
      map.enemies.unshift(enemy);
    });
    setSelectedEnemyId(enemyId);
    setPaintMode("enemy");
  }

  return (
    <div className="campaign-editor-shell">
      <header className="campaign-editor-header panel">
        <div>
          <p className="eyebrow">Campaign Creator</p>
          <h2>{initialCampaign.name ? `Edit ${initialCampaign.name}` : "Create Campaign"}</h2>
          <p className="muted">Build maps, sequence them, and save the campaign to your commander profile.</p>
        </div>
        <div className="campaign-editor-actions">
          <button className="secondary" onClick={onCancel}>Back To Profile</button>
          <button onClick={() => void handleSave()} disabled={isSaving}>{isSaving ? "Saving..." : "Save Campaign"}</button>
        </div>
      </header>

      <div className="campaign-editor-layout">
        <aside className="panel campaign-editor-sidebar">
          <label className="field">
            <span>Campaign Name</span>
            <input
              value={campaign.name}
              maxLength={40}
              onChange={(event) => updateCampaign((draft) => {
                draft.name = event.target.value;
              })}
            />
          </label>
          <label className="field">
            <span>Allowed Player Units</span>
            <input
              type="number"
              min={1}
              max={12}
              value={campaign.allowedPlayerUnits}
              onChange={(event) => updateCampaign((draft) => {
                draft.allowedPlayerUnits = clamp(Number(event.target.value || 1), 1, 12);
              })}
            />
          </label>

          <div className="campaign-map-list">
            <div className="campaign-map-list-header">
              <h3>Maps</h3>
              <button className="secondary" onClick={addMap}>Add Map</button>
            </div>
            {campaign.maps.map((map, index) => (
              <article
                key={map.id}
                className={`campaign-map-item ${index === selectedMapIndex ? "is-active" : ""}`}
              >
                <button className="campaign-map-select" onClick={() => {
                  setSelectedMapIndex(index);
                  syncDraftDimensions(map);
                  setSelectedEnemyId(null);
                }}>
                  <strong>{index + 1}. {map.name}</strong>
                  <span>{map.enemies.length} enemies</span>
                </button>
                <div className="campaign-map-order-actions">
                  <button className="secondary" onClick={() => moveMap(index, -1)} disabled={index === 0}>Up</button>
                  <button className="secondary" onClick={() => moveMap(index, 1)} disabled={index === campaign.maps.length - 1}>Down</button>
                  <button className="secondary" onClick={() => removeMap(index)} disabled={campaign.maps.length === 1}>Remove</button>
                </div>
              </article>
            ))}
          </div>

          {validationError ? <div className="error-banner">{validationError}</div> : null}
        </aside>

        {selectedMap ? (
          <section className="panel campaign-editor-main">
            <div className="campaign-editor-meta-grid">
              <label className="field">
                <span>Map Name</span>
                <input
                  value={selectedMap.name}
                  maxLength={40}
                  onChange={(event) => updateSelectedMap((map) => {
                    map.name = event.target.value;
                  })}
                />
              </label>
              <div className="campaign-resize-row">
                <label className="field">
                  <span>Width</span>
                  <input type="number" min={4} max={16} value={draftWidth} onChange={(event) => setDraftWidth(event.target.value)} />
                </label>
                <label className="field">
                  <span>Height</span>
                  <input type="number" min={4} max={16} value={draftHeight} onChange={(event) => setDraftHeight(event.target.value)} />
                </label>
                <button className="secondary campaign-resize-button" onClick={() => updateSelectedMap((map) => {
                  const resized = resizeMap(map, Number(draftWidth || map.width), Number(draftHeight || map.height));
                  map.width = resized.width;
                  map.height = resized.height;
                  map.tiles = resized.tiles;
                  map.playerStarts = resized.playerStarts;
                  map.enemies = resized.enemies;
                  map.objective = resized.objective;
                  syncDraftDimensions(resized);
                })}>Resize Grid</button>
              </div>
            </div>

            <div className="campaign-tool-row">
              <div className="campaign-toggle-group">
                {(["terrain", "player-start", "objective", "enemy"] as PaintMode[]).map((mode) => (
                  <button
                    key={mode}
                    className={paintMode === mode ? "secondary is-active" : "secondary"}
                    onClick={() => setPaintMode(mode)}
                  >
                    {mode === "terrain" ? "Paint Terrain" : mode === "player-start" ? "Toggle Starts" : mode === "objective" ? "Set Objective" : "Place Enemy"}
                  </button>
                ))}
              </div>
              {paintMode === "terrain" ? (
                <div className="campaign-palette">
                  {(Object.keys(TERRAIN_STYLE) as TerrainType[]).map((terrain) => (
                    <button
                      key={terrain}
                      className={selectedTerrain === terrain ? "secondary is-active" : "secondary"}
                      onClick={() => setSelectedTerrain(terrain)}
                    >
                      {TERRAIN_STYLE[terrain].label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="campaign-grid-wrap">
              <div className="campaign-grid" style={{ gridTemplateColumns: `repeat(${selectedMap.width}, minmax(32px, 1fr))` }}>
                {selectedMap.tiles.flatMap((row, y) =>
                  row.map((tile, x) => {
                    const key = `${x},${y}`;
                    const terrain = TERRAIN_STYLE[tile];
                    const hasStart = tileOverlay.starts.has(key);
                    const enemyCount = tileOverlay.enemies.get(key) ?? 0;
                    const isObjective = tileOverlay.objectiveKey === key;
                    const isEnemyTile = selectedEnemy?.position.x === x && selectedEnemy.position.y === y;
                    return (
                      <button
                        key={key}
                        className={`campaign-grid-tile ${isObjective ? "is-objective" : ""} ${isEnemyTile ? "is-selected-enemy" : ""}`}
                        style={{ background: terrain.color }}
                        onClick={() => applyTileAction(x, y)}
                        title={`(${x + 1}, ${y + 1}) ${terrain.label}`}
                      >
                        <span>{terrain.icon}</span>
                        {hasStart ? <strong className="campaign-grid-marker campaign-grid-marker--start">P</strong> : null}
                        {isObjective ? <strong className="campaign-grid-marker campaign-grid-marker--objective">O</strong> : null}
                        {enemyCount > 0 ? <strong className="campaign-grid-marker campaign-grid-marker--enemy">E{enemyCount}</strong> : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="campaign-objective-panel">
              <label className="field">
                <span>Win Condition</span>
                <select value={selectedMap.objective.type} onChange={(event) => updateSelectedMap((map) => {
                  const nextType = event.target.value as CampaignMapRecord["objective"]["type"];
                  map.objective.type = nextType;
                  if (nextType !== "arrive") {
                    delete map.objective.target;
                  }
                  if (nextType !== "defend") {
                    delete map.objective.turnLimit;
                  } else if (!map.objective.turnLimit) {
                    map.objective.turnLimit = 10;
                  }
                })}>
                  <option value="route">Route Enemy</option>
                  <option value="arrive">Arrive At Objective</option>
                  <option value="defend">Defend Position</option>
                </select>
              </label>
              {selectedMap.objective.type === "arrive" ? (
                <div className="campaign-hint">
                  Arrival target: {selectedMap.objective.target ? `${selectedMap.objective.target.x + 1}, ${selectedMap.objective.target.y + 1}` : "click a tile in Set Objective mode"}
                </div>
              ) : null}
              {selectedMap.objective.type === "defend" ? (
                <label className="field">
                  <span>Defend Turns</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={selectedMap.objective.turnLimit ?? 10}
                    onChange={(event) => updateSelectedMap((map) => {
                      map.objective.turnLimit = clamp(Number(event.target.value || 1), 1, 50);
                    })}
                  />
                </label>
              ) : null}
            </div>
          </section>
        ) : null}

        {selectedMap ? (
          <aside className="panel campaign-editor-sidebar campaign-editor-sidebar--right">
            <div className="campaign-map-list-header">
              <h3>Enemy Units</h3>
              <button className="secondary" onClick={addEnemy}>Add Enemy</button>
            </div>
            <div className="campaign-enemy-list">
              {selectedMap.enemies.length > 0 ? (
                selectedMap.enemies.map((enemy) => {
                  const compatibleWeapons = getWeaponsForClass(enemy.className);
                  return (
                    <article key={enemy.id} className={`campaign-enemy-card ${selectedEnemyId === enemy.id ? "is-active" : ""}`}>
                      <div className="campaign-enemy-card-header">
                        <button className="campaign-map-select" onClick={() => {
                          setSelectedEnemyId(enemy.id);
                          setPaintMode("enemy");
                        }}>
                          <strong>{enemy.name || enemy.className}</strong>
                          <span>{enemy.className} Lv.{enemy.level} | T{enemy.turn} | {enemy.behavior === "hold" ? "Hold" : "Advance"}</span>
                        </button>
                        <button className="secondary" onClick={() => updateSelectedMap((map) => {
                          map.enemies = map.enemies.filter((entry) => entry.id !== enemy.id);
                          if (selectedEnemyId === enemy.id) {
                            setSelectedEnemyId(null);
                          }
                        })}>Remove</button>
                      </div>
                      <div className="campaign-enemy-compact-grid">
                        <label className="field campaign-field-compact">
                          <span>Name</span>
                          <input value={enemy.name} maxLength={20} onChange={(event) => updateSelectedMap((map) => {
                            const target = map.enemies.find((entry) => entry.id === enemy.id);
                            if (target) {
                              target.name = event.target.value;
                            }
                          })} />
                        </label>
                        <label className="field campaign-field-compact">
                          <span>Class</span>
                          <select value={enemy.className} onChange={(event) => updateSelectedMap((map) => {
                            const target = map.enemies.find((entry) => entry.id === enemy.id);
                            if (!target) {
                              return;
                            }
                            target.className = event.target.value as UnitClass;
                            const firstWeapon = getWeaponsForClass(target.className)[0];
                            target.weaponId = firstWeapon?.id ?? target.weaponId;
                          })}>
                            {CLASS_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field campaign-field-compact">
                          <span>Weapon</span>
                          <select value={enemy.weaponId} onChange={(event) => updateSelectedMap((map) => {
                            const target = map.enemies.find((entry) => entry.id === enemy.id);
                            if (target) {
                              target.weaponId = event.target.value;
                            }
                          })}>
                            {compatibleWeapons.map((weapon) => (
                              <option key={weapon.id} value={weapon.id}>{weapon.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field campaign-field-compact">
                          <span>Behavior</span>
                          <select value={enemy.behavior} onChange={(event) => updateSelectedMap((map) => {
                            const target = map.enemies.find((entry) => entry.id === enemy.id);
                            if (target) {
                              target.behavior = event.target.value as CampaignEnemyRecord["behavior"];
                            }
                          })}>
                            <option value="advance">Advance</option>
                            <option value="hold">Hold</option>
                          </select>
                        </label>
                        <label className="field campaign-field-compact">
                          <span>Level</span>
                          <input type="number" min={1} max={20} value={enemy.level} onChange={(event) => updateSelectedMap((map) => {
                            const target = map.enemies.find((entry) => entry.id === enemy.id);
                            if (target) {
                              target.level = clamp(Number(event.target.value || 1), 1, 20);
                            }
                          })} />
                        </label>
                        <label className="field campaign-field-compact">
                          <span>Turn</span>
                          <input type="number" min={1} max={50} value={enemy.turn} onChange={(event) => updateSelectedMap((map) => {
                            const target = map.enemies.find((entry) => entry.id === enemy.id);
                            if (target) {
                              target.turn = clamp(Number(event.target.value || 1), 1, 50);
                            }
                          })} />
                        </label>
                        <label className="field campaign-field-compact">
                          <span>X</span>
                          <input type="number" min={1} max={selectedMap.width} value={enemy.position.x + 1} onChange={(event) => updateSelectedMap((map) => {
                            const target = map.enemies.find((entry) => entry.id === enemy.id);
                            if (target) {
                              target.position.x = clamp(Number(event.target.value || 1) - 1, 0, selectedMap.width - 1);
                            }
                          })} />
                        </label>
                        <label className="field campaign-field-compact">
                          <span>Y</span>
                          <input type="number" min={1} max={selectedMap.height} value={enemy.position.y + 1} onChange={(event) => updateSelectedMap((map) => {
                            const target = map.enemies.find((entry) => entry.id === enemy.id);
                            if (target) {
                              target.position.y = clamp(Number(event.target.value || 1) - 1, 0, selectedMap.height - 1);
                            }
                          })} />
                        </label>
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className="muted">Add enemy units here, then click tiles in Place Enemy mode to position them on the map.</p>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

export default CampaignEditor;