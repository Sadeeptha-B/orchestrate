# Orchestrate

A browser-based daily contextualization companion that walks you through a structured morning planning ritual, then serves as a persistent dashboard throughout the day — with Spotify music cues, hourly check-ins, and a multi-layer habit scaffolding system. No backend; all data lives in localStorage.

## What it does

Orchestrate sits alongside your existing Todoist and Google Calendar — it doesn't replace them. Instead, it solves the gap between "I have a task list" and "I know what I'm doing today":

1. **Morning wizard (4 steps)** — write down today's intentions, map them to Todoist tasks, categorize and estimate each task, assign to time sessions, then kick off with a Spotify playlist.
2. **Dashboard** — current session view, task completion tracking with drag-and-drop reordering, embedded Spotify player, live capacity indicators, and a Light Pool of micro-gap activities.
3. **Hourly check-ins** — feeling + work-type tracker that suggests context-specific playlists and surfaces recovery cues when you're struggling.
4. **Life scaffolding** — seasons (medium-horizon focus periods), habits (stabilizer rituals + light-coherent micro-practices), and anchor protection across all of it.

## Features

**Planning**
- 4-step wizard: intentions → task mapping → categorize & estimate → schedule → start music
- Todoist integration (encrypted API token, full CRUD, stale-while-revalidate cache)
- Google Calendar embed (multi-calendar, week/month/agenda views)
- Season focus banner in the wizard — supporting goals become one-click intentions
- Non-linear wizard — revisit any step from the dashboard

**Execution**
- Live session tracking with current-session detection (polls every 60s)
- Drag-to-reorder tasks within sessions, inline completion with confetti
- 6-playlist Spotify music protocol mapped to work types (coding, lectures, reading, restless, low-energy)
- Advisory session capacity arithmetic — badges at 100%+, banners at 150%+, never blocks

**Habits & Seasons**
- **Stabilizer habits** — recurring rituals (meditation, gym, shutdown) that auto-inject as intentions each day
- **Light-coherent habits** — small resumable micro-gap fillers (flashcards, reading) surfaced in the Light Pool, logged-only
- **Anchor protection** — foundational habits can't be deleted while active
- **Seasons** — named focus periods with themes, goals, non-goals, and capacity budgets; habits can be scoped to seasons
- **True Rest** — static catalog of non-task recovery cues (walk, breathe, gaze) surfaced contextually

**Persistence**
- Auto-resets the day plan daily; settings, seasons, and habits are durable
- Save/restore named day-plan snapshots
- Full backup export/import (settings + life context + history as a single JSON)
- Schema migration chain (v1–v6) for forward compatibility of saved sessions

## Tech Stack

- React 19 + TypeScript + Vite 8
- Tailwind CSS v4 (CSS custom properties via `@theme`)
- React Router v7
- Web Crypto API (AES-256-GCM for Todoist token encryption)
- PWA with service worker (network-first caching)
- date-fns, canvas-confetti

## Getting Started

```bash
npm install
npm run dev
```

## Build & Deploy

```bash
npm run build    # TypeScript check + Vite bundle
npm run lint     # ESLint
npm run preview  # Preview production build locally
```

Deployed to GitHub Pages via GitHub Actions on every push to `main`.

## Documentation

- [docs/synthesis.md](docs/synthesis.md) — start here: purpose, current feature set, operating model
- [docs/user-guide.md](docs/user-guide.md) — mental model and how-to for habits, intentions, tasks, and the rest
- [docs/architecture.md](docs/architecture.md) — provider tree, routing, integrations, persistence
- [docs/data-model.md](docs/data-model.md) — types, reducer actions, migration chain
- [docs/vision.md](docs/vision.md) — the durable "why"
- [docs/backlog.md](docs/backlog.md) — forward-looking proposals (modes, rituals, reviews)

## License

MIT
