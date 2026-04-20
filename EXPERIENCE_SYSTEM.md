# Experience System

## Overview

The experience system uses **level-difference scaling** inspired by Fire Emblem series games. This encourages players to face challenging enemies and naturally prevents grinding.

## Key Mechanics

### Experience Requirements
- **100 XP per level** (unchanged from previous system)
- Experience carries over between maps
- Maximum level: 20 (promotes to advanced class)

### Combat Experience

#### Killing an Enemy
```
XP = max(1, min(100, 30 + (Enemy Level - Player Level) × 5))
```

**Examples:**
| Scenario | Calculation | Result |
|----------|-------------|--------|
| Player Lv10 kills Enemy Lv12 | 30 + (2 × 5) = 40 | 40 XP |
| Player Lv10 kills Enemy Lv10 | 30 + (0 × 5) = 30 | 30 XP |
| Player Lv10 kills Enemy Lv8 | 30 + (-2 × 5) = 20 | 20 XP |
| Player Lv15 kills Enemy Lv3 | 30 + (-12 × 5) = -30 | 1 XP (minimum) |

#### Dealing Damage (no kill)
```
XP = max(1, 10 + (Enemy Level - Player Level) × 2)
```

**Examples:**
| Scenario | Calculation | Result |
|----------|-------------|--------|
| Player Lv10 hits Enemy Lv12 | 10 + (2 × 2) = 14 | 14 XP |
| Player Lv10 hits Enemy Lv10 | 10 + (0 × 2) = 10 | 10 XP |
| Player Lv10 hits Enemy Lv8 | 10 + (-2 × 2) = 6 | 6 XP |

#### Support Actions (Healing, Dancing, etc.)
- **Healing:** 15 XP per heal (no level scaling)
- Support actions help build unit experience without risk

## Design Principles

1. **Challenge Scaling** — Higher level enemies yield more experience, encouraging harder fights
2. **Grinding Prevention** — Weaker enemies yield minimal experience, making level grinding inefficient
3. **Simplicity** — Formulas use basic arithmetic, no complex divisors
4. **Fairness** — Kill XP caps at 100 per enemy so farming isn't overpowered

## Tuning Guide

If you want to adjust difficulty/progression:

### Make leveling faster:
- Increase base kill XP: `30` → `40`
- Increase level difference multiplier: `5` → `6`
- Decrease required XP per level: `100` → `80`

### Make leveling slower:
- Decrease base kill XP: `30` → `20`
- Decrease level difference multiplier: `5` → `3`
- Increase required XP per level: `100` → `120`

### Adjust hit XP:
- Base hit XP: `10`
- Level difference multiplier: `2`

## Implementation Details

- Calculated in `server/src/index.ts` functions: `calculateKillExp()` and `calculateHitExp()`
- Applied during `resolveAttack()` when combat resolves
- Only player units (not enemies) gain experience
- Experience grants level-ups on threshold, triggering stat growth and potential promotion
