// D1 sync sidecar — the client half of the whole-slice cloud mirror (server: functions/api/state/*).
//
// localStorage stays the offline-first working store. This module adds two things on top of the four
// existing persist effects in DayPlanContext:
//   1. pull-and-merge on cold start (before the provider mounts, via SyncGate) — last-write-wins per
//      slice by a device-local `updatedAt` stamp kept in `orchestrate-sync-meta`.
//   2. a debounced push per slice whenever a genuine mutation changes it, flushed on pagehide.
//
// Conflict model is deliberately coarse: whole-slice snapshots, last-write-wins by wall-clock ms.
// For a single user across a couple of devices this is sufficient (see docs/roadmap/
// persistence_and_backend_migration.md §4). There is no field-level merge.

import { getStoredUser, setStoredUser } from './identity';
import { SCHEMA_VERSION, MIN_SUPPORTED_SCHEMA, isSupportedSchemaVersion } from './schema';

export type SliceKey = 'plan' | 'settings' | 'history' | 'life';

/** The localStorage key each synced slice is persisted under (mirrors DayPlanContext). */
export const SLICE_STORAGE_KEYS: Record<SliceKey, string> = {
    plan: 'orchestrate-day-plan',
    settings: 'orchestrate-settings',
    history: 'orchestrate-history',
    life: 'orchestrate-life-context',
};

const SLICE_KEYS: SliceKey[] = ['plan', 'settings', 'history', 'life'];

/** Device-local bookkeeping: the last-known `updatedAt` (ms) per slice. Never included in a backup. */
const META_KEY = 'orchestrate-sync-meta';
/** Explicit local clears that should beat the remote snapshot on the next cold-start merge. */
const RESET_PENDING_KEY = 'orchestrate-sync-reset-pending';

const PUSH_DEBOUNCE_MS = 2500;
const PULL_TIMEOUT_MS = 2000;

// ─── Module state (single-user, single instance) ────────────────────────────────

/** Slices whose persist effect has fired at least once this session (skip-first-fire tracking). */
const seen = new Set<SliceKey>();
/** Slices an init-time event (rollover, bootstrap, local-newer) marked as needing a push. */
const initChanged = new Set<SliceKey>();
/** Slices the server holds at a *newer* schema than this build understands — never adopt, never push. */
const noPush = new Set<SliceKey>();
/** Slices with an unpushed local change (survives failed pushes for retry). */
const dirty = new Set<SliceKey>();
/** Last serialized value we acted on, to no-op string-equal re-fires (incl. StrictMode double-fire). */
const lastKnown = new Map<SliceKey, string>();
const timers = new Map<SliceKey, ReturnType<typeof setTimeout>>();

let pullPromise: Promise<void> | null = null;
let hasPulled = false;

// ─── Meta helpers ───────────────────────────────────────────────────────────────

function readMeta(): Partial<Record<SliceKey, number>> {
    try {
        const raw = localStorage.getItem(META_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function metaOf(slice: SliceKey): number {
    return readMeta()[slice] ?? 0;
}

function setMeta(slice: SliceKey, updatedAt: number): void {
    try {
        const meta = readMeta();
        meta[slice] = updatedAt;
        localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {
        // ignore storage failures (private mode, quota)
    }
}

function readPendingResets(): Partial<Record<SliceKey, boolean>> {
    try {
        const raw = localStorage.getItem(RESET_PENDING_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function hasPendingReset(slice: SliceKey): boolean {
    return readPendingResets()[slice] === true;
}

function setPendingReset(slice: SliceKey, pending: boolean): void {
    try {
        const resets = readPendingResets();
        if (pending) resets[slice] = true;
        else delete resets[slice];
        localStorage.setItem(RESET_PENDING_KEY, JSON.stringify(resets));
    } catch {
        // ignore storage failures (private mode, quota)
    }
}

// ─── Identity-switch guard ──────────────────────────────────────────────────────

/** Todoist cache key (owned by TodoistContext) — cleared alongside the slices on a user switch. */
const TODOIST_CACHE_KEY = 'orchestrate-todoist-cache';

/**
 * localStorage is per browser profile, not per Access identity. If a different account signs in on
 * this machine, the previous user's local slices must not merge into (or push over) the new user's
 * cloud data — clear all local app state first, so the merge below adopts the new user's snapshot.
 */
function guardIdentitySwitch(remoteUser: string): void {
    const previous = getStoredUser();
    if (previous && previous !== remoteUser) {
        try {
            for (const key of Object.values(SLICE_STORAGE_KEYS)) localStorage.removeItem(key);
            localStorage.removeItem(META_KEY);
            localStorage.removeItem(RESET_PENDING_KEY);
            localStorage.removeItem(TODOIST_CACHE_KEY);
        } catch {
            // ignore storage failures
        }
    }
    setStoredUser(remoteUser);
}

// ─── HTTP ────────────────────────────────────────────────────────────────────────

interface RemoteSlice {
    value: string;
    schemaVersion: number;
    updatedAt: number;
}

// ─── Public API (called by SyncGate / DayPlanContext / ErrorBoundary) ────────────

/**
 * Cold-start merge. Fetch the remote snapshot and, per slice, decide winner by `updatedAt` and write
 * the winning remote value straight into localStorage (so the existing loaders migrate/validate it
 * like any persisted value). Resolves silently on offline / any fetch failure — sync then stays
 * passive this session, but genuine local mutations still push. Memoized (StrictMode-safe).
 */
export function pullAndMerge(timeoutMs = PULL_TIMEOUT_MS): Promise<void> {
    if (hasPulled) return Promise.resolve();
    if (pullPromise) return pullPromise;
    pullPromise = doPullAndMerge(timeoutMs)
        .then((didPull) => {
            if (didPull) hasPulled = true;
        })
        .finally(() => {
            pullPromise = null;
        });
    return pullPromise;
}

async function doPullAndMerge(timeoutMs: number): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

    let slices: Partial<Record<SliceKey, RemoteSlice>>;
    try {
        const res = await fetch('/api/state', {
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return false;
        const body = (await res.json()) as {
            user?: string;
            slices?: Partial<Record<SliceKey, RemoteSlice>>;
        };
        if (typeof body.user === 'string' && body.user) guardIdentitySwitch(body.user.toLowerCase());
        slices = body.slices ?? {};
    } catch {
        return false; // timeout / network / non-JSON / expired session — passive this session
    }

    for (const slice of SLICE_KEYS) {
        const remote = slices[slice];
        const localMeta = metaOf(slice);
        const hasLocal = localStorage.getItem(SLICE_STORAGE_KEYS[slice]) != null;
        const pendingReset = hasPendingReset(slice);

        if (!remote) {
            // Server has nothing for this slice. If we hold data, bootstrap it up on first change.
            if (hasLocal || pendingReset) markInitChange(slice);
            continue;
        }
        if (remote.schemaVersion > SCHEMA_VERSION) {
            // Server is ahead of this build — don't adopt data we can't parse, and don't clobber it.
            noPush.add(slice);
            continue;
        }
        if (!isSupportedSchemaVersion(remote.schemaVersion) || remote.schemaVersion < MIN_SUPPORTED_SCHEMA) {
            // Below the floor — ignore remote; let local overwrite it.
            markInitChange(slice);
            continue;
        }
        if (remote.updatedAt > localMeta) {
            // Remote wins — adopt it. Meta takes the *remote* stamp (not now) so we don't re-push it.
            try {
                localStorage.setItem(SLICE_STORAGE_KEYS[slice], remote.value);
                setMeta(slice, remote.updatedAt);
                setPendingReset(slice, false);
            } catch {
                // ignore storage failures
            }
        } else if (localMeta > remote.updatedAt) {
            // Local wins — push on first change (also self-heals a push that failed last session).
            if (hasLocal || pendingReset) {
                markInitChange(slice);
            } else {
                // A missing local slice plus a stale meta timestamp is not real local data; otherwise a
                // manual clear / partial storage loss could overwrite a valid remote snapshot with defaults.
                try {
                    localStorage.setItem(SLICE_STORAGE_KEYS[slice], remote.value);
                    setMeta(slice, remote.updatedAt);
                } catch {
                    // ignore storage failures
                }
            }
        }
        // tie → no-op, no mark
    }

    return true;
}

/** Mark a slice so its first persist-effect fire this session bumps `updatedAt` and pushes. */
export function markInitChange(slice: SliceKey): void {
    initChanged.add(slice);
}

/**
 * v7.11: the newest change stamp across the four slices (0 when unknown). The meta clock is
 * bumped on every genuine local mutation AND set to the remote stamp when a merge adopts cloud
 * data — so this reflects the age of whatever data a backup restore would displace, even on a
 * freshly-synced device. Used by the import flow's "older backup" warning.
 */
export function latestLocalChangeMs(): number {
    const meta = readMeta();
    return Math.max(0, ...Object.values(meta).filter((v): v is number => typeof v === 'number'));
}

/**
 * Force a slice's local state to win the next merge (meta = now), without pushing here. Used by the
 * ErrorBoundary "Reset Day & Reload" path so the cleared plan isn't re-adopted from the cloud on reload.
 */
export function markLocalReset(slice: SliceKey): void {
    setPendingReset(slice, true);
    setMeta(slice, Date.now());
}

/**
 * Called by each persist effect *after* it writes localStorage. Bumps `updatedAt` + schedules a push
 * only for genuine mutations — the first (mount) fire of unchanged state is skipped unless an init
 * event marked the slice. String-equal re-fires (incl. StrictMode's double effect) are no-ops.
 */
export function notifyChanged(slice: SliceKey, serialized: string): void {
    if (noPush.has(slice)) return;

    if (!seen.has(slice)) {
        seen.add(slice);
        lastKnown.set(slice, serialized);
        if (!initChanged.has(slice)) return; // first mount fire of unchanged state — baseline only
    } else {
        if (lastKnown.get(slice) === serialized) return; // no-op re-persist / StrictMode 2nd fire
        lastKnown.set(slice, serialized);
    }

    setPendingReset(slice, false);
    setMeta(slice, Date.now());
    dirty.add(slice);
    schedulePush(slice);
}

/** Immediately flush all dirty slices with keepalive — for pagehide / tab-hidden. Fire-and-forget. */
export function flushPending(): void {
    for (const slice of dirty) {
        const timer = timers.get(slice);
        if (timer) {
            clearTimeout(timer);
            timers.delete(slice);
        }
        void doPush(slice, true);
    }
}

// ─── Push path ───────────────────────────────────────────────────────────────────

function schedulePush(slice: SliceKey): void {
    const existing = timers.get(slice);
    if (existing) clearTimeout(existing);
    timers.set(
        slice,
        setTimeout(() => {
            timers.delete(slice);
            void doPush(slice, false);
        }, PUSH_DEBOUNCE_MS),
    );
}

async function doPush(slice: SliceKey, keepalive: boolean): Promise<void> {
    if (noPush.has(slice)) return; // keep dirty; retry on next change / focus / online

    const value = localStorage.getItem(SLICE_STORAGE_KEYS[slice]);
    if (value == null) {
        dirty.delete(slice);
        return;
    }
    const updatedAt = metaOf(slice);

    try {
        const res = await fetch(`/api/state/${slice}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value, schemaVersion: SCHEMA_VERSION, updatedAt }),
            keepalive,
        });
        if (res.ok || res.status === 409) {
            // 409 = the server holds a newer snapshot; don't retry-loop — the next cold-start merge
            // reconciles authoritatively. Either way this local change is no longer "dirty".
            dirty.delete(slice);
        }
        // other statuses (401 / 5xx) → stay dirty for the retry hooks
    } catch {
        // network error → stay dirty
    }
}

function retryDirty(): void {
    for (const slice of dirty) schedulePush(slice);
}

// ─── Lifecycle hooks (registered once) ───────────────────────────────────────────

if (typeof window !== 'undefined') {
    window.addEventListener('online', retryDirty);
    window.addEventListener('pagehide', flushPending);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushPending();
        else retryDirty();
    });
}
