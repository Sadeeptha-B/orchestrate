# Orchestrate docs — map

The index to everything under `docs/`. If you read one file first, read **[synthesis.md](./synthesis.md)** — it's the canonical current-state document and links out to the rest.

The docs are tiered by *purpose and volatility*: the **living docs** describe the current state (present-tense — no changelog narrative), **reference/** holds deep subsystem walkthroughs, and **history/** freezes the design narrative. See the "Documentation discipline" rules in the repo-root [CLAUDE.md](../CLAUDE.md) before editing.

## Living docs (current state — keep these current)

| Doc | What it owns |
|---|---|
| [synthesis.md](./synthesis.md) | **Start here.** Purpose, tech stack, provider tree, routing, lifecycle, state, integrations, persistence — the map. Links out to reference/ for depth. |
| [vision.md](./vision.md) | The durable *why*: problem, approach, intentional constraints, core vocabulary. Version-agnostic. |
| [data-model.md](./data-model.md) | **Authoritative** entity semantics, invariants, lifecycle rules, reducer action catalog, schema/migration chain, localStorage shape. Type *shapes* live in code, not here. |
| [backlog.md](./backlog.md) | Forward-looking proposals **not yet built**. |
| [deployment.md](./deployment.md) | Click-by-click setup (Google Cloud, Cloudflare, Zero Trust). |
| [graphify.md](./graphify.md) | The repo's knowledge graph (tooling): building, querying, agent integration, maintenance. Artifacts live in `graphify-out/` (gitignored, per-machine). |

## reference/ — subsystem walkthroughs

Deep dives on one subsystem each. Present-tense; the design narrative behind them lives in history/.

| Doc | Subsystem |
|---|---|
| [reference/backend.md](./reference/backend.md) | The Cloudflare serverless backend: Access, KV credential vault, OAuth flows, Pages Functions. |
| [reference/persistence.md](./reference/persistence.md) | Where data lives and how copies stay consistent: localStorage working store, D1 sync sidecar, caches. |
| [reference/backup_and_restore.md](./reference/backup_and_restore.md) | Full Backup scope, restore flow, account-provenance fingerprints, durable markers. |
| [reference/focus-mode.md](./reference/focus-mode.md) | The `/focus` execution surface: state machine, engagement timeline, Pomodoro/ramp, note gates. |
| [reference/habits-sync.md](./reference/habits-sync.md) | Habit ⇄ Todoist sync: sync/delete/day-of/reconcile layers, overdue bump, skip/reschedule. |

## history/ — frozen narrative (do not treat as current state)

Per-iteration implementation plans (`plan_v{N}.md`) preserving *how* the app got here. `iterations.md` is frozen — do not edit it. When a backlog item ships, its plan lands here; the living docs above are updated to describe the result.

- [history/](./history/) — `plan.md`, `plan_v2`–`plan_v5`, `plan_v6/`, `plan_v7/`, and the frozen `iterations.md`.

## roadmap/ — aspirational sketches

Requirement sketches and framing not yet consolidated into the backlog. **Agents: ignore these unless explicitly directed to them.**

- [roadmap/](./roadmap/) — persistence/backend migration analysis, engagement-record strategy, habits-ecosystem analysis, music routine, life-migration spec.

## problem-space/ — source material

The frozen problem-analysis and raw source docs the product was synthesized from. Background, not current state.

- [problem-space/](./problem-space/) — conceptual framework, operating manual, and `source-docs/`.

---

**User-facing mental model** (habits, intentions, Light Pool, capacity, etc.) is **not** in these docs — its single source is the in-app guide at `/guide`, [`src/components/guide/UserGuide.tsx`](../src/components/guide/UserGuide.tsx). **Type definitions** live in [`src/types/index.ts`](../src/types/index.ts).
