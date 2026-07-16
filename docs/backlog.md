> **What is this?** Forward-looking feature proposals that are **not yet implemented**. Each item below is a candidate direction, not a committed plan.
>
> When an item ships: write the implementation plan into [history/](./history/) (e.g. `plan_v7.md`), append a narrative entry to [history/iterations.md](./history/iterations.md), update [synthesis.md](./synthesis.md) to reflect the new current state, and remove the item from this file.
>
> See [vision.md](./vision.md) for the durable "why", [synthesis.md](./synthesis.md) for the current state, and the most recent shipped plan: [history/plan_v6.3.md](./history/plan_v6.3.md).

# Orchestrate — Backlog

## Per-slice D1 snapshots (automatic point-in-time restore)

The standing answer to "backups are manual-only" ([backup_and_restore.md §6](./reference/backup_and_restore.md)); the file-sync alternative (old roadmap option B) was considered and **dropped** in its favour.

**The shape:**

- **Server**: in the existing `PUT /api/state/:key` handler ([functions/api/state/[key].ts](../functions/api/state/%5Bkey%5D.ts)), *before* the LWW upsert, copy the **current** row into `slice_snapshots(user_id, key, day, value, schema_version, updated_at)` with `day = date('now')` via `INSERT OR IGNORE` on `PRIMARY KEY (user_id, key, day)` — so the snapshot captures each slice's state as of the *start* of the day, exactly once, on the first push of that day. Prune opportunistically in the same request, only when the insert actually landed (`meta.changes > 0`): `DELETE … WHERE day < date('now', '-14 days')`.
- **Read side**: two small identity-guarded endpoints — `GET /api/state/snapshots` (list days: `SELECT day, COUNT(*), MAX(updated_at) … GROUP BY day`) and `GET /api/state/snapshots/:day` (the ≤4 rows).
- **Client**: a Settings → Data panel listing snapshot days. Restoring **synthesizes a `FullBackup`** from the four values (`settings`/`life`/`history` parsed, `plan` as `currentDay`) and feeds it through the existing import flow — `validateBackup` → provenance warnings → `RestoreConfirmModal` (with its backup-first opt-in) → `IMPORT_BACKUP` → sync push. No new restore machinery, and every §2 guard applies automatically.
- **Migration**: one `CREATE TABLE IF NOT EXISTS` appended to [db/schema.sql](../db/schema.sql), applied to local **and** remote explicitly ([persistence.md §4](./reference/persistence.md)).

**Current Cloudflare setup & free-plan implications (checked against the deployed config):**

- Everything lands in the **one existing D1 database** (`orchestrate-sync`, bound `SYNC_DB` in `wrangler.toml`) as a second table — no new binding, namespace, or dashboard step beyond the schema apply.
- **No scheduler exists, and none is needed.** The backend is Pages Functions only — request-driven; Pages has no cron triggers, and adding a separate scheduled Worker would be new deploy surface *and* break the architecture's "no unattended work" posture ([persistence.md §9](./reference/persistence.md)). Snapshot-on-first-write-of-day + prune-inside-the-PUT keeps the whole feature request-driven; the trade is that a day with no pushes gets no snapshot (fine — nothing changed).
- **Free-plan quotas** (approximate — verify in the dashboard, Cloudflare adjusts these): D1 allows ~5M row reads and ~100k row writes per day, with total storage in the low-GB range and a smaller per-database cap on free. Snapshotting adds **at most 4 writes per user per day** (one per slice, first push only) plus prune deletes; list/restore reads are user-initiated and tiny. Orders of magnitude inside quota — the binding constraint is storage, not operations.
- **Storage bound**: whatever fits in `slices` fits in `slice_snapshots` (same values). Worst case ≈ current slices footprint × retention days — with `life` at its ~1 MB worst case, 4 slices × 14 days is tens of MB per user. Fine at this scale; if it ever matters, dedupe by skipping the snapshot when `value` equals the newest stored snapshot for that slice.
- **Time Travel stays the operator path** (whole-DB, ~7-day window on free, wrangler/dashboard only, all users at once); snapshots are its user-facing, per-slice, per-user complement — restorable from Settings without touching wrangler.

## Modes, rituals, recovery (sketched in plan_v5)

Targeted for **v7** — the next iteration after v6.2's intentions backlog. See [history/plan_v5.md](./history/plan_v5.md) "v7 — Modes, Rituals, Recovery" for the sketch:
- `DayPlan.mode: 'focus' | 'maintenance' | 'recovery' | 'shutdown' | 'review'`.
- Mode switcher card on Dashboard (manual; signal-driven suggestions in v8).
- `RitualPlayer` for state transitions, with seed templates (morning launch, shutdown, recovery reset, weekly review prep).
- "Apply Minimum Viable Day" one-click reduced template.

## Reviews, drift detection, hierarchical views (sketched in plan_v5)

Targeted for **v8**. See [history/plan_v5.md](./history/plan_v5.md) "v8 — Reviews, Drift Detection, Hierarchical Views":
- `useDriftSignals()` hook aggregating missed check-ins, repeated reschedules, low completion, sleep deficit.
- `/review` route with weekly + seasonal flows; persists to `LifeContext.reviews`.
- `/week` cadence view drawing from `history`.
- Expanded `/life` with current-week anchor cadence rollup and the Light Pool weekly cadence already shipped in v6.
