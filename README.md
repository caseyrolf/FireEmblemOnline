# FireEmblemOnline

A multiplayer Fire Emblem-inspired web tactics prototype built from `GameDesign.docx`.

## What is included

- React + Vite + TypeScript frontend
- Express + Socket.io authoritative multiplayer server
- SQLite-backed room persistence for recovery
- Account authentication with persistent sessions
- Saved commander profiles with reusable unit presets
- Shared TypeScript game model for client/server sync
- Room creation and join-code flow
- Lobby with per-player character drafting
- Playable first battle map with movement, attacks, wait, enemy AI, and win/loss states
- Session resume and reconnect recovery

## Run locally

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

## Production build

```bash
npm run build
```

## Current MVP scope

This build focuses on the design document's early phases:

- Multiplayer room flow
- Character creation
- Hardcoded tactical map
- Server-side movement/combat validation
- Shared synchronized battle state over WebSockets

It now includes account auth, saved profiles, room-state persistence, and reconnect recovery, but it still does not include base camp, shops, multi-map campaigns, or a map editor.
