import type {
    AppSettings,
    DayPlan,
    Habit,
    LifeContext,
    TaskCapDefaults,
    TodaysHabitInstance,
} from '../types';
import type { TodoistActionsValue } from '../context/TodoistContext';
import type { TodoistProject, TodoistTask } from '../hooks/useTodoist';
import { habitsInScopeForDate } from './habits';
import { minutesOfDay, timeToMinutes } from './time';

const HABITS_PROJECT_NAME = 'Habits';
const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Translate a Habit's recurrence + targetTime into a Todoist `due_string`.
 * Examples: "every day at 7:00", "every weekday", "every mon, wed, fri at 18:30".
 */
export function buildDueString(habit: Habit): string {
    const { recurrence, targetTime } = habit;
    let base: string;
    switch (recurrence.kind) {
        case 'daily':
            base = 'every day';
            break;
        case 'weekdays':
            base = 'every weekday';
            break;
        case 'weekly':
        case 'custom': {
            const days = recurrence.daysOfWeek
                ?.filter((d) => d >= 0 && d <= 6)
                .map((d) => DOW_NAMES[d]);
            base = days && days.length > 0 ? `every ${days.join(', ')}` : 'every day';
            break;
        }
    }
    return targetTime ? `${base} at ${targetTime}` : base;
}

/**
 * Resolve (or lazily create) the user's default Todoist project for habit-tasks.
 *
 * Priority: cached `AppSettings.habitsTodoistProjectId` (if it still exists in `projects`) →
 * existing project literally named "Habits" → newly created "Habits" project.
 *
 * Persists the resolved id back to settings via `onUpdateSettings` so future calls short-circuit.
 * **Always invoke this once per batch** (e.g. before a migrate loop) to avoid a stale-closure
 * race that would otherwise re-create the project on every iteration.
 */
export async function ensureHabitsProject(args: {
    actions: TodoistActionsValue;
    settings: AppSettings;
    projects: TodoistProject[];
    onUpdateSettings: (updates: Partial<AppSettings>) => void;
}): Promise<string | null> {
    const { actions, settings, projects, onUpdateSettings } = args;
    const cachedId = settings.habitsTodoistProjectId;
    if (cachedId && projects.some((p) => p.id === cachedId)) return cachedId;

    // Fall back: look for an existing project named "Habits" (e.g. user created one manually).
    const existing = projects.find((p) => p.name === HABITS_PROJECT_NAME);
    if (existing) {
        onUpdateSettings({ habitsTodoistProjectId: existing.id });
        return existing.id;
    }

    const created = await actions.createProject(HABITS_PROJECT_NAME);
    if (!created) return null;
    onUpdateSettings({ habitsTodoistProjectId: created.id });
    return created.id;
}

/**
 * Resolve which Todoist project a habit's task should live in.
 * Per-habit `todoistProjectId` overrides the workspace default, but only when the project
 * still exists (otherwise we silently fall back to the default to avoid orphan references).
 */
export function resolveHabitProjectId(
    habit: Habit,
    defaultProjectId: string,
    projects: TodoistProject[],
): string {
    if (habit.todoistProjectId && projects.some((p) => p.id === habit.todoistProjectId)) {
        return habit.todoistProjectId;
    }
    return defaultProjectId;
}

/**
 * Sync a 'habit'-kind Habit to Todoist as a recurring task (v6.7: micro-gaps never sync —
 * early-returns null for them). Timed habits carry a time-of-day via `buildDueString`; untimed
 * habits are "every day". Caller resolves the target project id (via `ensureHabitsProject` +
 * `resolveHabitProjectId`) so a batch operation can resolve once and reuse the id across iterations.
 *
 * - If the habit has no `todoistTaskId`: creates a new recurring task in `projectId`.
 * - If a task exists but in a different project: moves it via the Sync API.
 * - Always pushes the latest content / due_string / duration onto the existing task.
 *
 * Returns the resulting todoistTaskId on success; null on failure.
 */
export async function syncHabitToTodoist(args: {
    habit: Habit;
    projectId: string;
    actions: TodoistActionsValue;
    taskMap: Map<string, TodoistTask>;
}): Promise<string | null> {
    const { habit, projectId, actions, taskMap } = args;
    if (habit.kind !== 'habit') return null; // v6.7: micro-gaps never sync to Todoist.

    const dueString = buildDueString(habit);
    const duration = habit.targetDurationMinutes;

    const existing = habit.todoistTaskId ? taskMap.get(habit.todoistTaskId) : undefined;
    if (existing) {
        if (existing.project_id !== projectId) {
            const moved = await actions.moveTask(existing.id, projectId);
            if (!moved) return null;
        }
        const updated = await actions.updateTask(existing.id, {
            content: habit.name,
            due_string: dueString,
            due_lang: 'en',
            ...(duration ? { duration, duration_unit: 'minute' } : {}),
        });
        return updated?.id ?? null;
    }

    const created = await actions.createTask(habit.name, {
        project_id: projectId,
        due_string: dueString,
        due_lang: 'en',
        ...(duration ? { duration, duration_unit: 'minute' } : {}),
    });
    return created?.id ?? null;
}

/** Extract "HH:mm" from a Todoist `due.date` value, which may be "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss". */
function dueTimeOfDay(dueDate: string): string | null {
    const tIdx = dueDate.indexOf('T');
    if (tIdx === -1) return null;
    const hhmm = dueDate.slice(tIdx + 1, tIdx + 6);
    return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

/**
 * v6.4: extract a user-local YYYY-MM-DD from a Todoist `due` value.
 *
 * Todoist's `due.date` can be:
 *   - "YYYY-MM-DD" (date-only) → already user-local
 *   - "YYYY-MM-DDTHH:mm:ss" (floating; `due.timezone === null`) → prefix IS user-local
 *   - "YYYY-MM-DDTHH:mm:ssZ" or "...±HH:MM" (fixed TZ) → parse and reformat in user TZ
 *
 * Orchestrate-synced habits are floating (created via `due_string: 'every day at 7:00'`),
 * so the slice is correct for the common case. The fixed-TZ branch handles tasks the user
 * edited externally with explicit timezone — without it, a UTC-stored time near the day
 * boundary could appear as "tomorrow" to Orchestrate while the user sees it as "today".
 */
function dueDateLocal(due: { date: string; timezone: string | null }): string {
    const d = due.date;
    if (d.length === 10) return d;
    const hasExplicitTz = d.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(d) || due.timezone !== null;
    if (!hasExplicitTz) return d.slice(0, 10);
    const parsed = new Date(d);
    if (Number.isNaN(parsed.getTime())) return d.slice(0, 10);
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * v6.8: "surface anyway" rescue predicate. A *timed*, *lenient* habit whose target time has
 * already elapsed for `nowMinutes`. When such a habit is created (or edited) after its time has
 * passed, Todoist anchors its recurring task's *next* occurrence to tomorrow — today's slot is
 * gone — so the "due today" gate would silently drop it. `windowBehavior: 'lenient'` ("surface
 * anyway") means the user still wants to see it today, so this is the single source of truth for
 * that rescue: shared by `computeTodaysHabitInstances` (to emit the instance against a tomorrow-
 * dated task) and `findStaleTodaysHabitInstances` (to NOT prune that instance back out). Keeping
 * one predicate stops the read + prune paths from disagreeing and flickering the row.
 *
 * Only meaningful for a future-dated task: an *overdue* (past-dated) task is bumped to today by
 * the reconcile pass, and a *today*-dated task surfaces through the normal gate.
 */
function isLenientPastWindow(habit: Habit, targetTime: string | undefined, nowMinutes: number): boolean {
    return habit.windowBehavior !== 'strict'
        && targetTime !== undefined
        && timeToMinutes(targetTime) <= nowMinutes;
}

/**
 * v6.3: compute today's habit instances. v6.7: **'habit' kind only** — micro-gaps go through
 * `computeTodaysMicroGapInstances` (no Todoist).
 *
 * Filters active 'habit'-kind entries to those whose:
 *  - recurrence matches `plan.date`
 *  - season scope matches the active season (or is season-agnostic)
 *  - linked Todoist task exists and is unchecked
 *  - is due today — OR (v6.8) is a timed, lenient ("surface anyway") habit whose target time has
 *    elapsed, which Todoist rolled to tomorrow but the user still wants surfaced today (skipped if
 *    already completed/skipped today, so an in-app check-off isn't resurrected)
 *
 * v6.8: a due-today timed habit is **always** emitted regardless of `windowBehavior` — `strict` no
 * longer drops it once past the window. Instead the row stays a `planned`, actionable instance and
 * the surfaces present it as "missed" (greyed) via `isHabitInstanceMissed`, so the day's record is
 * preserved and the habit remains completable even if done before planning.
 *
 * Re-emits every matching habit on each call (including ones already in `plan.todaysHabits`) so
 * habit-form edits propagate — the reducer's `REFRESH_TODAYS_HABITS` dedupes by `habitId` and
 * value-stably merges the refreshed fields into the existing planned instance.
 *
 * Each emitted instance gets a fresh uuid, `status: 'planned'`, and a `targetTime` derived from the
 * Todoist `due` time-of-day if set, else the habit's `targetTime` (absent → "anytime"). No session assignment.
 */
export function computeTodaysHabitInstances(args: {
    life: LifeContext;
    plan: DayPlan;
    taskMap: Map<string, TodoistTask>;
    now: Date;
    taskCaps: TaskCapDefaults;
}): TodaysHabitInstance[] {
    const { life, plan, taskMap, now, taskCaps } = args;
    const dateISO = plan.date;
    const nowMinutes = minutesOfDay(now);
    const out: TodaysHabitInstance[] = [];

    for (const habit of habitsInScopeForDate({ life, dateISO, kind: 'habit' })) {
        if (!habit.todoistTaskId) continue;

        const task = taskMap.get(habit.todoistTaskId);
        if (!task || task.checked) continue;
        if (!task.due) continue;

        const durationMinutes = habit.targetDurationMinutes ?? taskCaps.habit;
        // Timed habits carry a target time (from the Todoist due, else the habit). Untimed habits
        // ("anytime") have no target time. Window-behavior gates only apply to timed habits.
        const dueTime = dueTimeOfDay(task.due.date);
        const targetTime = dueTime ?? habit.targetTime;

        // Todoist's recurring task carries the *next* due date.
        const taskDueDate = dueDateLocal(task.due);
        if (taskDueDate !== dateISO) {
            // Not due today. Normally "not for today" — EXCEPT a timed, lenient habit whose target
            // time already elapsed: Todoist rolled the next occurrence to tomorrow, but the user
            // asked to still see it today (see `isLenientPastWindow`). Surface it unless it was
            // already completed/skipped today — a habit checked off in the Todoist app *also* rolls
            // to tomorrow, and we must not resurrect it as a fresh `planned` row.
            const rescuable =
                taskDueDate > dateISO && isLenientPastWindow(habit, targetTime, nowMinutes);
            const settledToday = plan.todaysHabits.some(
                (i) => i.habitId === habit.id && (i.status === 'completed' || i.status === 'skipped'),
            );
            if (!rescuable || settledToday) continue;
        }
        // v6.8: due-today habits are always emitted. A strict habit past its window is no longer
        // hidden — it surfaces as a `planned` row that the UI greys out as "missed"
        // (see `isHabitInstanceMissed`), keeping it on the record and still completable.

        out.push({
            id: crypto.randomUUID(),
            habitId: habit.id,
            todoistTaskId: habit.todoistTaskId,
            titleSnapshot: task.content || habit.name,
            durationMinutes,
            ...(targetTime ? { targetTime } : {}),
            status: 'planned',
        });
    }
    return out;
}

/**
 * Find `planned` 'habit'-kind instances on `plan.todaysHabits` that have gone **stale** — their
 * backing Todoist task was completed (or moved off today) out-of-band (e.g. checked off directly
 * in the Todoist app). `computeTodaysHabitInstances` stops *emitting* such a habit, but
 * `REFRESH_TODAYS_HABITS` never *removes* an already-surfaced instance, so without this the row
 * would linger as `planned` in the Habits card / timeline for the rest of the day.
 *
 * Returns the instance ids to drop. Deliberately narrow so we only prune what's genuinely gone:
 *  - `status === 'planned'` only — engaged/completed/skipped are user-meaningful and preserved.
 *  - `todoistTaskId` present — micro-gaps (no Todoist) are never touched here.
 *  - task **missing** from `taskMap` → left alone (cold cache or deleted-in-Todoist, which the
 *    reconcile pass recreates; not our concern).
 *  - stale ⇔ the task is `checked` OR its due date is no longer today. An unchecked task still
 *    due today is **not** stale — including a strict habit past its window, which v6.8 keeps
 *    surfaced as a (greyed) "missed" `planned` row rather than dropping it.
 *  - v6.8: a timed, lenient ("surface anyway") habit past its window is deliberately surfaced
 *    today against a *tomorrow*-dated task (see `isLenientPastWindow`). That instance is **not**
 *    stale — mirror the compute-side predicate so the read + prune paths agree, otherwise the row
 *    would be surfaced and immediately pruned each tick.
 */
export function findStaleTodaysHabitInstances(args: {
    plan: DayPlan;
    life: LifeContext;
    taskMap: Map<string, TodoistTask>;
    now: Date;
}): string[] {
    const { plan, life, taskMap, now } = args;
    const dateISO = plan.date;
    const nowMinutes = minutesOfDay(now);
    const out: string[] = [];
    for (const inst of plan.todaysHabits) {
        if (inst.status !== 'planned') continue;
        if (!inst.todoistTaskId) continue;
        const task = taskMap.get(inst.todoistTaskId);
        if (!task) continue;
        if (task.checked) { out.push(inst.id); continue; }
        if (!task.due) continue;
        if (dueDateLocal(task.due) === dateISO) continue; // still due today → not stale
        // Due date has moved off today — usually completed/advanced out-of-band (stale). But don't
        // prune a lenient past-window habit we deliberately surface against a tomorrow-dated task.
        const habit = life.habits.find((h) => h.id === inst.habitId);
        if (habit && isLenientPastWindow(habit, inst.targetTime, nowMinutes)) continue;
        out.push(inst.id);
    }
    return out;
}

export interface OverdueHabitInfo {
    habit: Habit;
    task: TodoistTask;
}

export type NeedsSyncReason = 'never-synced' | 'missing-in-todoist';

export interface NeedsSyncHabitInfo {
    habit: Habit;
    reason: NeedsSyncReason;
}

/**
 * v6.5: detect active habits that need a (re-)sync to Todoist (v6.6: both kinds). Two failure
 * modes are surfaced under one umbrella so callers can drive both the "needs attention"
 * count and the reconcile action from a single source:
 *
 *  - `'never-synced'`: habit was saved but `todoistTaskId` was never set (first-sync
 *    failed offline, a pre-v6.1 holdover, or a pre-v6.6 light-coherent habit that never synced).
 *  - `'missing-in-todoist'`: habit had a `todoistTaskId`, but the linked task is no
 *    longer present in `taskMap` (deleted out-of-band in Todoist). The check is gated
 *    by explicit `tasksHydrated` so a not-yet-hydrated cache doesn't false-positive every
 *    habit during cold boot, while an intentionally empty hydrated task list still counts.
 *
 * Pure read-only helper — the actual fix (create/update via `syncHabitToTodoist`) is
 * the caller's responsibility. Used by the central `ReconciliationProvider` for both
 * the count display and the batched repair pass.
 */
export function findNeedsSyncHabits(args: {
    life: LifeContext;
    taskMap: Map<string, TodoistTask>;
    tasksHydrated: boolean;
}): NeedsSyncHabitInfo[] {
    const { life, taskMap, tasksHydrated } = args;
    const out: NeedsSyncHabitInfo[] = [];
    for (const habit of life.habits) {
        if (!habit.active) continue;
        if (habit.kind !== 'habit') continue; // v6.7: micro-gaps don't sync to Todoist.
        if (!habit.todoistTaskId) {
            out.push({ habit, reason: 'never-synced' });
            continue;
        }
        if (tasksHydrated && !taskMap.has(habit.todoistTaskId)) {
            out.push({ habit, reason: 'missing-in-todoist' });
        }
    }
    return out;
}

/**
 * v6.4: find active habits whose Todoist task is overdue (due before `dateISO`), unchecked,
 * and whose recurrence rule + season scope match today (v6.6: both kinds). Todoist's recurrence
 * engine only advances on completion, so a missed habit sits stuck at yesterday's date —
 * `computeTodaysHabitInstances` filters it out by the "due today" gate, and the habit
 * silently disappears. This helper surfaces those for the reconcile step to bump forward.
 *
 * Filter chain mirrors `computeTodaysHabitInstances` except the date gate: here we want
 * `task.due.date < dateISO` (strictly before).
 */
export function findOverdueHabits(args: {
    life: LifeContext;
    taskMap: Map<string, TodoistTask>;
    dateISO: string;
}): OverdueHabitInfo[] {
    const { life, taskMap, dateISO } = args;
    const out: OverdueHabitInfo[] = [];

    for (const habit of habitsInScopeForDate({ life, dateISO, kind: 'habit' })) {
        if (!habit.todoistTaskId) continue;

        const task = taskMap.get(habit.todoistTaskId);
        if (!task || task.checked) continue;
        if (!task.due) continue;
        const taskDueDate = dueDateLocal(task.due);
        // Lexical comparison works for YYYY-MM-DD. Skip if already due today/future.
        if (taskDueDate >= dateISO) continue;

        out.push({ habit, task });
    }
    return out;
}

/**
 * v6.4: bump overdue habit Todoist tasks to `dateISO`, preserving the recurrence
 * rule (v6.6: both kinds). Returns a patch map (todoistTaskId → updated task) populated from
 * Todoist's actual server responses, so the caller can recompute today's instances immediately
 * against authoritative state.
 *
 *  - Timed tasks → `due_datetime: '<dateISO>T<HH:mm:ss>'` (floating, user TZ).
 *  - Untimed tasks → `due_date: '<dateISO>'`.
 *
 * Always re-passes the existing `due_string` + `due_lang` so Todoist's recurrence engine
 * has unambiguous semantics: "rule unchanged, next occurrence is this date". Earlier
 * versions omitted both and observed silent failures on multi-day-overdue recurring
 * tasks — the v1 API behavior in that combination is underspecified.
 *
 * `updateTask` now returns `TodoistTask | null` (v6.4); a null return means the API call
 * failed and was already logged + surfaced to the UI via `handleApiError`. We additionally
 * sanity-check the response's due date against what we asked for and log if it diverges,
 * so post-hoc debugging is possible without instrumentation.
 */
export async function reconcileOverdueHabits(args: {
    overdue: OverdueHabitInfo[];
    actions: TodoistActionsValue;
    dateISO: string;
}): Promise<Map<string, TodoistTask>> {
    const { overdue, actions, dateISO } = args;
    const patched = new Map<string, TodoistTask>();

    for (const { habit, task } of overdue) {
        const hasTime = Boolean(task.due && task.due.date.includes('T'));
        const newDueDate = hasTime
            ? `${dateISO}T${task.due!.date.slice(task.due!.date.indexOf('T') + 1)}`
            : dateISO;
        const updates = {
            // Re-affirm the existing rule so Todoist's recurrence engine knows we're
            // only shifting the next occurrence, not changing the cadence.
            ...(task.due?.string ? { due_string: task.due.string } : {}),
            due_lang: task.due?.lang || 'en',
            ...(hasTime ? { due_datetime: newDueDate } : { due_date: newDueDate }),
        };
        const updated = await actions.updateTask(task.id, updates);
        if (!updated) {
            console.error(
                `[habits] reconcile: updateTask returned null for habit ${habit.id} `
                + `(taskId=${task.id}). See prior [Todoist] error for the underlying cause.`,
            );
            continue;
        }
        if (updated.due && dueDateLocal(updated.due) !== dateISO) {
            console.warn(
                `[habits] reconcile: Todoist returned unexpected due date for habit ${habit.id} `
                + `(taskId=${task.id}): expected ${dateISO}, got "${updated.due.date}". `
                + `The instance may not surface until the next reconcile.`,
            );
        }
        patched.set(task.id, updated);
    }
    return patched;
}
