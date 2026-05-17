# Orchestrate — Agent Instructions

## Start here

For the current state of the app — purpose, feature set, data model essentials — read [docs/synthesis.md](./docs/synthesis.md). It is the canonical entry point.

Deeper references:
- [docs/vision.md](./docs/vision.md) — the durable "why": problem, approach, constraints, core vocabulary
- [docs/backlog.md](./docs/backlog.md) — forward-looking proposals not yet built
- [docs/data-model.md](./docs/data-model.md) — entity semantics, invariants, reducer actions, migration chain, localStorage shape

Frozen historical artifacts live in [docs/history/](./docs/history/) — implementation plans (`plan*.md`) and the iteration narrative (`iterations.md`). They are useful for understanding *how* the app got here, but **do not treat them as current state**.

Requirement sketches live in [docs/roadmap/](./docs/roadmap/) — aspirational requirements and framing that haven't been consolidated into the backlog yet. **Agents: ignore these unless the user explicitly directs you to them.**

## Key conventions

- **Types live in code, not docs.** For current type definitions, read [`src/types/index.ts`](./src/types/index.ts) directly. `data-model.md` describes semantics, invariants, lifecycle rules, and relationships — not type shapes. Do not add type mirrors to docs.
- **The in-app user guide** ([`src/components/guide/UserGuide.tsx`](./src/components/guide/UserGuide.tsx)) is the single source for user-facing mental model documentation. There is no separate markdown mirror.
- **Version tracking uses git**, not manual headers. Do not add or maintain "Last updated:", "Reflects:", or schema-version headers in docs. Use `git blame` or `git log` when you need to know when a doc was last touched. Note: older commits may not include a version number in the message — check `_schemaVersion` in `src/context/DayPlanContext.tsx` for the current schema version.

## Documentation discipline

When making changes that affect long-term context, update the relevant doc(s) **in the same commit** as the code change:

| Change touches... | Update... |
|---|---|
| Entity semantics, invariants, reducer actions, migration chain, localStorage shape | `docs/data-model.md` (describe semantics and rules — do **not** mirror type definitions) |
| Provider tree, routing, integrations, persistence layer, user-visible feature set or current-state summary | `docs/synthesis.md` |
| User-facing mental model (habits, intentions, tasks, Light Pool, True Rest, capacity) | [`src/components/guide/UserGuide.tsx`](./src/components/guide/UserGuide.tsx) — the in-app guide at `/guide` |
| Durable "why" / principles / constraints | `docs/vision.md` |
| New forward-looking proposals | `docs/backlog.md` |
| A backlog item ships | Remove from `docs/backlog.md`; drop the implementation plan into `docs/history/plan_v{N}.md` |

When in doubt, update `synthesis.md` — it is the document agents read first, so stale state there is the highest-cost staleness.

When a change is large enough to warrant a written-up implementation plan (e.g. a new "iteration"), put the plan in `docs/history/plan_v{N}.md` once the work lands. The living docs above describe the *result*; `history/` preserves the *narrative*.

## Build & test commands

- `npm run dev` — Vite dev server
- `npm run build` — TypeScript build + Vite bundle
- `npm run lint` — ESLint
