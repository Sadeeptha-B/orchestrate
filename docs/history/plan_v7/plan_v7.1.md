# Orchestrate v7.1 — Per-day sessions, drag-calendar, and session templates

## Context

Until now a user's work **sessions** were a single global list (`AppSettings.sessionSlots`, defaults in `src/data/sessions.ts`) — the same four fixed blocks (early morning, morning, afternoon, night) applied to every day. But a real day varies: some start early, some are evening-heavy. The fixed list forced the user's day into a shape that often didn't match reality.

v7.1 makes sessions **per-day**, defined by the user during planning, with reusable presets:

1. **Seeding** — each new day's sessions seed from the **last-used day's** sessions; first-run falls back to the built-in defaults. The common case (today looks like yesterday) needs zero edits.
2. **Templates replace the global list** — named **Session Templates** live in the Life section as quick-apply presets. Sessions are no longer sourced live from `settings.sessionSlots`; that field is retained only as a seed/reset fallback.
3. **A new wizard step** — inserted after Refine and before Schedule: a **full drag-calendar** editor for shaping the day's sessions.

Outcome: the day owns its authoritative session list (`DayPlan.sessionSlots`); every downstream surface reads from it; templates make recurring day-shapes one click.

## What shipped

### Data model

- **`DayPlan.sessionSlots: SessionSlot[]`** (required) — the authoritative per-day session list. Every downstream surface (dashboard timeline + carousel, check-ins, capacity, focus nudge, the Schedule step) reads this instead of `settings.sessionSlots`.
- **`SessionTemplate { id, name, slots, createdAt }`** + **`LifeContext.sessionTemplates`** — reusable presets, persisted in `orchestrate-life-context`.
- `AppSettings.sessionSlots` is kept but no longer read live: it's the seed/reset fallback and the source for the one-time template migration.

### Seeding & migrations (`src/context/DayPlanContext.tsx`)

- `freshPlan(seed?)` + `seedSessionSlots(prevPlan, settings)` — new days seed from the previous plan's slots → `settings.sessionSlots` → `defaultSessionSlots`, always with **fresh ids** (days stay independent).
- `migratePlan` **backfills** `sessionSlots` for pre-7.1 persisted plans (`raw.sessionSlots` or `defaultSessionSlots`). `RESTORE_DAY` routes through it, so saved days are covered.
- **Wizard step `4 → 5`**: a new "Sessions" step is inserted at position 3, so any persisted step `>= 3` shifts up by 1. The legacy 5-step → 4-step rung and this new rung are both **schema-gated** (`_schemaVersion < 7.1`) — critical because the *old* layout was also 5 steps, so `_wizardSteps` alone can't disambiguate. The final clamp was raised `4 → 5`.
- `seedSessionTemplates` — one-time: a customized legacy `settings.sessionSlots` is preserved as a single `"My sessions"` template (else `[]`).
- `SCHEMA_VERSION` → `7.1`, `WIZARD_STEPS_COUNT` → `5`.

### Reducer actions

- Per-day, **id-stable** so assignments survive a Back-edit: `ADD_DAY_SESSION`, `UPDATE_DAY_SESSION` (rename/resize/move), `REMOVE_DAY_SESSION` (prunes `taskSessions[id]` + every `assignedSessions` entry), `APPLY_SESSION_TEMPLATE` (replaces slots with fresh-id copies and clears all assignments — UI confirms when assignments exist).
- Template CRUD (mirrors Habit/RestCue): `ADD_/UPDATE_/DELETE_SESSION_TEMPLATE`. `IMPORT_BACKUP` merges `sessionTemplates` by id.

### UI

- **`src/lib/timeline.ts`** — extracted the time⇆position geometry (`formatHour`, `minutesToPct`/`pctToMinutes`, `minutesToClock`) so the read-only `SessionTimelineBar` and the new editor share one source of truth. Midnight end-of-day serializes as `"24:00"` (→1440), never `"00:00"` (which would render negative width).
- **`SessionEditorTimeline.tsx`** — the drag-calendar (Pointer Events + `setPointerCapture`): drag empty track to create, drag a block to move, drag edges to resize, click to rename/delete. 15-min snapping, 15-min minimum, advisory overlap tint. A controlled component (`slots` + `onAdd/onUpdate/onRemove`) so the wizard wires it to plan dispatches and the template manager to local draft state. Commits only on pointer-up.
- **`Step3Sessions.tsx`** — the new wizard step: intro, template quick-apply chips (confirm-on-apply when assignments exist), the drag editor, and a "Save as template" affordance.
- **`SessionTemplatesManager.tsx`** (`/session-templates`) — Life-section CRUD: list templates, inline editor (name + drag-calendar on a local draft), Apply to today, Edit, Delete. Linked from a new card on `/life`.

### Downstream readers switched to `plan.sessionSlots`

`Step3Schedule`, dashboard `SessionTimeline` (carousel + bar), `Dashboard` (hourly check-in + current session), `CheckInModal`, `useFocusNudge`. `Dashboard`'s "Recontextualize" now targets step 4 (Schedule moved from 3 → 4).

## Notes / trade-offs

- **Required `DayPlan.sessionSlots`** (not optional) — forces every constructor to set it and avoids `?? []` at every reader. The build surfaces any missed literal.
- **A pre-7.1 *same-day* reload** shows default sessions rather than the old customized global ones (the pure plan migrator has no `settings`) — but those customized slots are preserved as the seeded `"My sessions"` template, one click to re-apply.
- **No test runner** exists in the repo (no vitest); the wizard-step migration was verified by reasoning + the manual flow rather than by introducing a test framework.
- Cross-midnight sessions are out of scope (single-day model). Overlaps are allowed (tolerated everywhere) but tinted as a hint.
