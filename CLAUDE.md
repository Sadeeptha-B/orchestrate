# Orchestrate — Agent Instructions

## Start here

For the current state of the app — purpose, feature set, data model essentials — read [docs/synthesis.md](./docs/synthesis.md). It is the canonical entry point.

Deeper references:
- [docs/vision.md](./docs/vision.md) — the durable "why": problem, approach, constraints, core vocabulary
- [docs/backlog.md](./docs/backlog.md) — forward-looking proposals not yet built
- [docs/data-model.md](./docs/data-model.md) — entity semantics, invariants, reducer actions, migration chain, localStorage shape

Frozen historical artifacts live in [docs/history/](./docs/history/) — implementation plans (`plan*.md`) and the iteration narrative (`iterations.md`). They are useful for understanding *how* the app got here, but **do not treat them as current state**.

**`iterations.md` is frozen — do not add or edit entries.** It accumulated unnecessary ceremony; the per-iteration `plan_v{N}.md` docs plus the living docs are the record going forward. Leave `iterations.md` as-is unless the user explicitly asks.

Requirement sketches live in [docs/roadmap/](./docs/roadmap/) — aspirational requirements and framing that haven't been consolidated into the backlog yet. **Agents: ignore these unless the user explicitly directs you to them.**

## Key conventions

- **Types live in code, not docs.** For current type definitions, read [`src/types/index.ts`](./src/types/index.ts) directly. `data-model.md` describes semantics, invariants, lifecycle rules, and relationships — not type shapes. Do not add type mirrors to docs.
- **The in-app user guide** ([`src/components/guide/UserGuide.tsx`](./src/components/guide/UserGuide.tsx)) is the single source for user-facing mental model documentation. There is no separate markdown mirror.
- **Version tracking uses git**, not manual headers. Do not add or maintain "Last updated:", "Reflects:", or schema-version headers in docs. Use `git blame` or `git log` when you need to know when a doc was last touched. Note: older commits may not include a version number in the message — check `SCHEMA_VERSION` in `src/lib/schema.ts` for the current schema version.
- **Schema changes — non-additive is fine; don't contort to stay additive.** This is a single-user app; we do **not** carry deep backward-compat. The schema posture is a **supported floor** (`MIN_SUPPORTED_SCHEMA`) up to the current `SCHEMA_VERSION`, both in `src/lib/schema.ts` (pure helpers; the loaders in `src/context/DayPlanContext.tsx` and the import path in `DataManagement.tsx` both consume them). Data stamped within that range is accepted and **migrated forward** at the `migrateToCurrent` seam; data below the floor is rejected (fresh start) / refused on import. To make a **non-additive** change: bump `SCHEMA_VERSION` and add a single forward step (7.1→7.2, etc.) at the seam — no deep chain. We keep compat from the floor upward only; when an old step gets expensive, **raise `MIN_SUPPORTED_SCHEMA`** and delete the dead steps (as the v1→7.1 chain was deleted in `plan_v7.3`). Prefer additive when the shape already fits, but a bump is cheap and expected when the correct shape requires it. The numeric gate `isSupportedSchemaVersion` is shared by the loaders and the import path — keep them aligned. See `docs/synthesis.md` §6.1.

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

### Narrative/result split — enforce it in the living docs

The living docs (`synthesis.md`, `data-model.md`, `vision.md`, and the `reference/` pages) describe **what is true now, in present tense.** The design story — "why we changed X", "this iteration turns Y into Z", the path taken — belongs in `docs/history/plan_v{N}.md`, not the living docs. Concretely:

- **No changelog prose in living docs.** Do not write "**v7.6 —** this iteration reworks…" paragraphs in synthesis/data-model/vision. State the resulting behavior directly. If you're narrating a change, that text belongs in the iteration's `plan_v{N}.md`.
- **Version tags are light provenance only.** A terse `(v7.6)` after a feature name is fine as a "when did this land" breadcrumb (git is the real record). Multi-sentence version storylines are not — they're the narrative, and they drift.
- **`synthesis.md` is a map, not an encyclopedia.** Keep each subsystem to a summary paragraph plus a pointer; push deep, evolving detail into a `reference/{subsystem}.md` page (as with [`reference/focus-mode.md`](./docs/reference/focus-mode.md), [`reference/habits-sync.md`](./docs/reference/habits-sync.md)). When a synthesis section grows past ~a screen and starts stacking version notes, that's the signal to extract it.
- **One home per fact.** A term/behavior is defined authoritatively in one doc; others link to it rather than restating. `data-model.md` owns entity semantics and vocabulary; `synthesis.md` §4 is a glossary that defers to it. Duplicated definitions are how the durable docs go stale (e.g. a `kind` enum renamed in one place but not another).

New to the docs? Read [`docs/README.md`](./docs/README.md) — the map of what every doc and folder owns.

## Build & test commands

- `npm run dev` — Vite dev server
- `npm run build` — TypeScript build + Vite bundle
- `npm run lint` — ESLint
