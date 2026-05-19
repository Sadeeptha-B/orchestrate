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
import { habitMatchesDate } from './habits';
import { timeToMinutes } from './time';

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
 * Resolve (or lazily create) the user's default Todoist project for stabilizer habit-tasks.
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
 * Sync a stabilizer Habit to Todoist as a recurring task. Caller resolves the target
 * project id (via `ensureHabitsProject` + `resolveHabitProjectId`) so a batch operation
 * can resolve once and reuse the id across iterations.
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
    if (habit.kind !== 'stabilizer') return null;

    const dueString = buildDueString(habit);
    const duration = habit.targetDurationMinutes;

    const existing = habit.todoistTaskId ? taskMap.get(habit.todoistTaskId) : undefined;
    if (existing) {
        if (existing.project_id !== projectId) {
            const moved = await actions.moveTask(existing.id, projectId);
            if (!moved) return null;
        }
        await actions.updateTask(existing.id, {
            content: habit.name,
            due_string: dueString,
            due_lang: 'en',
            ...(duration ? { duration, duration_unit: 'minute' } : {}),
        });
        return existing.id;
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
 * v6.3: compute today's stabilizer habit instances.
 *
 * Filters active stabilizer habits to those whose:
 *  - recurrence matches `plan.date`
 *  - season scope matches the active season (or is season-agnostic)
 *  - linked Todoist task exists, is due today, and is unchecked
 *  - `windowBehavior !== 'strict'` OR the current time is still inside the target window
 *
 * Idempotent against habits already present in `plan.todaysHabits` (caller passes the full plan;
 * the reducer's `REFRESH_TODAYS_HABITS` further dedupes by `habitId`).
 *
 * Each emitted instance gets a fresh uuid, `status: 'planned'`, and `targetTime` derived from the
 * Todoist `due` time-of-day if set, else the habit's `targetTime`. No session assignment.
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
    const activeSeasonId = life.activeSeasonId;
    const existingHabitIds = new Set(plan.todaysHabits.map((i) => i.habitId));
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const out: TodaysHabitInstance[] = [];

    for (const habit of life.habits) {
        if (!habit.active) continue;
        if (habit.kind !== 'stabilizer') continue;
        if (!habit.todoistTaskId) continue;
        if (existingHabitIds.has(habit.id)) continue;
        if (!habitMatchesDate(habit, dateISO)) continue;
        if (habit.seasonIds.length > 0 && (!activeSeasonId || !habit.seasonIds.includes(activeSeasonId))) continue;

        const task = taskMap.get(habit.todoistTaskId);
        if (!task || task.checked) continue;
        if (!task.due) continue;
        // Todoist's recurring task carries the *next* due date — check it's today.
        const taskDueDate = task.due.date.slice(0, 10);
        if (taskDueDate !== dateISO) continue;

        // Window-behavior gate: 'strict' hides the instance if its window has passed.
        const durationMinutes = habit.targetDurationMinutes ?? taskCaps.stabilizer;
        if (habit.windowBehavior === 'strict' && habit.targetTime) {
            const windowEnd = timeToMinutes(habit.targetTime) + durationMinutes;
            if (nowMinutes > windowEnd) continue;
        }

        const dueTime = dueTimeOfDay(task.due.date);
        const targetTime = dueTime ?? habit.targetTime;

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

