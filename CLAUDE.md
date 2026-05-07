# Orchestrate — Agent Instructions

## Start here

For the current state of the app — purpose, feature set, data model essentials — read [docs/synthesis.md](./docs/synthesis.md). It is the canonical entry point.

Deeper references:
- [docs/vision.md](./docs/vision.md) — the durable "why": problem, approach, constraints, core vocabulary
- [docs/backlog.md](./docs/backlog.md) — forward-looking proposals not yet built
- [docs/architecture.md](./docs/architecture.md) — provider tree, routing, integrations, persistence layer
- [docs/data-model.md](./docs/data-model.md) — types, reducer actions, migration chain, localStorage shape

Frozen historical artifacts live in [docs/history/](./docs/history/) — implementation plans (`plan*.md`) and the iteration narrative (`iterations.md`). They are useful for understanding *how* the app got here, but **do not treat them as current state**.

## Documentation discipline

When making changes that affect long-term context, update the relevant doc(s) **in the same commit** as the code change:

| Change touches... | Update... |
|---|---|
| Provider tree, routing, integrations, persistence layer | `docs/architecture.md` |
| Type definitions, reducer actions, migration chain, localStorage shape | `docs/data-model.md` |
| User-visible feature set or current-state summary | `docs/synthesis.md` (and bump `Last updated:` + `Reflects:` in the header) |
| Durable "why" / principles / constraints | `docs/vision.md` |
| New forward-looking proposals | `docs/backlog.md` |
| A backlog item ships | Remove from `docs/backlog.md`; append a narrative entry to `docs/history/iterations.md`; drop the implementation plan into `docs/history/plan_v{N}.md` |

When in doubt, update `synthesis.md` — it is the document agents read first, so stale state there is the highest-cost staleness.

When a change is large enough to warrant a written-up implementation plan (e.g. a new "iteration"), put the plan in `docs/history/plan_v{N}.md` once the work lands. The living docs above describe the *result*; `history/` preserves the *narrative*.

## Build & test commands

- `npm run dev` — Vite dev server
- `npm run build` — TypeScript build + Vite bundle
- `npm run lint` — ESLint
