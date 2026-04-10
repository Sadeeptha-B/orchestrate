# Orchestrate

A daily task contextualization web app that walks you through a morning planning wizard, then serves as a persistent dashboard with Spotify music integration and hourly check-ins. No backend — all data lives in localStorage.

## Features

- **6-step morning wizard** — brain-dump priorities, sync with external todolist, categorize (main/background), schedule into time sessions, start with music
- **Persistent dashboard** — current session view, digital clock, inline task editing with drag-and-drop reordering, completion tracking
- **Spotify integration** — embedded players for 6 context-aware playlists, "Open in Spotify app" deep links
- **Hourly check-ins** — feeling + work-type tracker with playlist suggestions, browser notification support
- **Save/restore** — named day plan snapshots stored in localStorage, accessible from both wizard and dashboard
- **Non-linear wizard** — revisit any step from the dashboard; step pills for direct navigation

## Tech Stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4
- React Router v7
- date-fns v4
- Web Notifications API

## Getting Started

```bash
npm install
npm run dev
```

## Build & Preview

```bash
npm run build
npm run preview
```

## Deployment

Deployed to GitHub Pages via GitHub Actions. Every push to `main` triggers a build and deploy.

## License

MIT
