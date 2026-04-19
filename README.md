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

The production server serves the built frontend from the same origin, so a single Node process can host the entire app.

## Deploy to Fly.io

This repo is set up for a single Fly.io machine with a mounted volume for SQLite persistence.

1. Install the Fly CLI and sign in.
2. Create the app: `fly apps create <your-app-name>`.
3. Update `app` in `fly.toml` to match the created app name.
4. Create a persistent volume: `fly volumes create data --size 1`.
5. Deploy: `fly deploy`.

Notes:

- The default `DATABASE_URL` in `fly.toml` points SQLite at `/data/fire-emblem-online.db` on the mounted volume.
- The server keeps active room state in memory, so run a single machine for correctness.
- By default the client uses the same origin in production, so `VITE_SERVER_URL` is not required for Fly.

## Current MVP scope

This build focuses on the design document's early phases:

- Multiplayer room flow
- Character creation
- Hardcoded tactical map
- Server-side movement/combat validation
- Shared synchronized battle state over WebSockets

It now includes account auth, saved profiles, room-state persistence, and reconnect recovery, but it still does not include base camp, shops, multi-map campaigns, or a map editor.
