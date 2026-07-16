# Plan v7.11 — Duplicate-free data transfers: account fingerprints, durable markers, and a consent-gated self-heal

One iteration, one theme: **moving Orchestrate data between installations without minting duplicate
side-effects in the connected Todoist/Google accounts** — and making every destructive flow
(restore, reset) informed and reversible. Written up post-implementation; the living result is
[reference/backup_and_restore.md](../../reference/backup_and_restore.md) (the scenario catalog this
iteration effectively built the mechanisms for) and [reference/persistence.md §5.6](../../reference/persistence.md).

---

## Problem

App-state moved faithfully across installations (sync for same-database devices, backup files for
everything else), but the **external IDs inside that state only resolve against the account that
minted them** — and nothing checked. Three concrete failure classes:

1. **Wrong account, mass creation.** Importing a backup (or switching the connected Todoist
   account) made every habit read as `missing-in-todoist`; the next automatic reconcile pass
   re-created all of them in whatever account was connected — the "populated store meets foreign
   account" hazard, with no warning at import time either.
2. **Same account, registry-less store, duplication.** A fresh store on the *same* account (local
   dev, post-reset) had no `todoistTaskId` registry, so same habits meant duplicate tasks; only the
   *containers* (Orchestrate calendar, "Habits" project) had idempotent same-named reuse.
3. **Same account, resurrect (R4).** A task deliberately deleted in Todoist was indistinguishable
   from accidental loss — the self-heal recreated it on the next pass.

Secondary problems found by the review that kicked this off: restore could silently skip
confirmation on "pristine" installs (via an incomplete `hasLocalData` predicate), offered no
escape hatch, gave misleading errors for wrong file types; a manual habit save could race the
identity fetch; the calendar adoption ladder preferred a name match over the durable marker;
`_backupVersion` was written but never read; Full Backup dropped a `currentDay` that had only
non-intention state; reset reported Todoist cleanup as successful regardless of outcome.

---

## A. The two guards

**Account fingerprints — cross-account gate (schema 7.6 → 7.7, additive).**
`settings.todoistAccount` (Todoist user id+email via the proxy's `GET /user`; `TodoistContext` now
resolves `accountId`/`accountEmail`/`accountResolved` per connection) and `settings.googleAccount`
(the primary calendar's id = the account email). Stamped once at connect when absent; riding
`settings` means they travel through sync *and* backups automatically. One shared hook,
[`useAccountFingerprint`](../../../src/hooks/useAccountFingerprint.ts), owns the whole cycle for
both integrations — stamp-when-absent, mismatch object, adopt action — and exposes the pure
**`fingerprintVerdict`**: `ok` (no fingerprint / match / *failed* identity fetch degrades ungated),
`wait` (fingerprint stored, identity fetch pending — writers hold instead of racing it), `blocked`
(mismatch). Every auto-writer gates on it: `triggerReconcile`, `useSyncHabit` (manual saves too),
Google's settings-prune / calendar auto-provision. A mismatch surfaces the shared
[`AccountMismatchBanner`](../../../src/components/ui/AccountMismatchBanner.tsx) (Habits page red
banner + `HabitSyncChip` state; Google notice in Settings) whose only write path is an explicit
*adopt this account* action.

**Durable markers — same-account adoption.** Written into the external objects themselves, so a
registry-less store can recognize them:

- **Habit tasks carry two markers, split by role**: the shared **`orchestrate-habit` label**
  (*class* — "ours"; one label, write-once, preserving user labels) and the
  **`[orchestrate:habit:<uuid>]` description token** (*instance* — which habit; corrected in place,
  preserving user text). The split is deliberate: per-habit labels would mint permanent,
  never-GC'd personal labels, and a token alone leaves no fallback when a description is
  hand-edited. Backups carry habit uuids, so backup-seeded stores pair **exactly by token**,
  surviving renames and project moves.
- **The Orchestrate calendar** carries `orchestrate:managed-calendar` in its description
  (stamped at create, re-stamped on rename, session-backfilled; best-effort under the narrow
  `calendar.app.created` scope).

**The resolution ladder everywhere: id → marker adoption → create.** For tasks, adoption is
`findAdoptableTask`'s two exact-first rungs (uuid token anywhere → label + exact name in the
target project; both skip checked/claimed tasks). For the calendar, the **marker outranks a name
match** (fixed mid-iteration — name-first would let a coincidentally "Orchestrate"-named calendar
shadow the renamed real one and double-stamp the marker). Backfill: the reconcile pass Phase 1.5
stamps both task markers onto pre-v7.11 linked tasks; `GoogleCalendarContext` backfills the
calendar marker once per session.

## B. R4 defused — the consent-gated self-heal

A dangling `todoistTaskId` is three-way ambiguous (deliberate deletion / accidental loss / foreign
account) and all three read as `!taskMap.has(id)`. The account case is the fingerprint's; within
the same account, **automatic passes are now adopt-only for previously-linked habits** —
`syncHabitToTodoist` gained `allowCreate`, and `triggerReconcile` passes it only for
`never-synced` habits (creation is the feature there) or when called with `recreateMissing: true`.
Re-creation is explicit at both granularities on the Habits page: the bulk **Re-sync** button, or
the per-habit **recreate** action on each missing habit's banner chip (`recreateHabitTask`, sharing
the pass's inflight guard). Declining is per-habit too: deactivate or delete the habit. The banner
copy states that missing tasks are never recreated automatically.

## C. Backup / restore / reset overhaul

- **One backup builder** ([`lib/backup.ts`](../../../src/lib/backup.ts)) shared by the Export
  button, the Reset Everything opt-in, and the new restore escape hatch. `currentDay` inclusion
  uses a broad has-meaningful-state predicate (habits/check-ins/sessions/wizard progress — not just
  intentions). `_backupVersion` retired (never read; `_schemaVersion` is the only stamp);
  `_exportedAt` / `_originHost` provenance added.
- **Import always confirms** — `hasLocalData` deleted. `validateBackup` returns discriminated
  rejection reasons (sessions-file / not-a-backup / unsupported-schema / malformed), so a wrong
  file type gets a pointed message. Provenance warnings in the confirm: different Todoist/Google
  account, different origin host, backup >~5 min older than the newest local change (via the sync
  meta clock, which carries adopted-remote stamps — `latestLocalChangeMs`). The shared
  [`RestoreConfirmModal`](../../../src/components/RestoreConfirmModal.tsx) (Settings + Welcome
  `RestoreModal`, previously duplicated JSX) carries a default-on **"download a Full Backup of this
  device's current data first"** opt-in — restore is always one file away from reversible. The
  Todoist cache is cleared at commit.
- **Reset honesty**: `deleteTask` returns a success flag; Reset Everything reports full / partial /
  zero deletion accurately (failures noted as marker-carrying orphans, re-adoptable later); the
  modal copy now describes adoption instead of the stale "will add duplicates" claim.
  `TodoistPanel` unlinks plan tasks only after a delete actually lands.

---

## Residuals (stated in [backup_and_restore.md §2](../../reference/backup_and_restore.md))

**R1** cross-store renames *without a shared uuid* (hand-recreated habits) still create fresh
tasks; **R2** pre-v7.11 objects get one unguarded first meeting (self-resolving via stamp +
backfill); **R3** markers are strippable and the identity fetch fallible (graceful degradation);
R4 is defused. Still open: backups are manual-only — the standing answer is **per-slice D1
snapshots** (design settled in [backlog.md](../../backlog.md); file-sync considered and dropped).

## Trade-offs & notes

- The gate degrades *ungated* (not locked) on a failed identity fetch — availability over strictness
  for a single-user tool; `wait` covers only the pending window.
- Adopt-only autos mean an accidentally-deleted task needs one click to come back (visible in the
  banner) — accepted cost of never resurrecting a deliberate deletion.
- Marker writes are best-effort everywhere; a failed backfill retries next pass.
- One-time live verifications flagged (not yet run): Todoist auto-creates the `orchestrate-habit`
  label on task create; `GET /api/v1/user` shape through the proxy; description round-trip.
  Scenario-keyed Vitest tests (pure targets: `fingerprintVerdict`, `findAdoptableTask`,
  `withHabitIdToken`, `validateBackup`) deferred until after this lands.

## Verification

`npm run lint` + `npm run build` clean throughout. Docs updated in the same iteration:
[backup_and_restore.md](../../reference/backup_and_restore.md) (guards/ladder/residuals rewritten;
§5 scenario catalog compressed to a table under the mermaid decision tree),
[persistence.md §5.6](../../reference/persistence.md), [data-model.md](../../data-model.md)
(schema 7.7 entry, Habit sync ladder, backup shape), [synthesis.md](../../synthesis.md)
(persistence/backup bullets, hooks table, directory tree), and the backlog (D1 snapshots entry with
free-plan analysis).
