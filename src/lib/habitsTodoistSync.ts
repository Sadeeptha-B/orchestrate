import type {
    AppSettings,
    DayPlan,
    Habit,
    HabitTaskInjection,
    LifeContext,
    SessionSlot,
    TaskCapDefaults,
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
 * Resolve (or lazily create) the dedicated "Habits" Todoist project that all
 * stabilizer habit-tasks live under. Returns the project ID, or null on failure.
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
 * Sync a stabilizer Habit to Todoist as a recurring task.
 * - If the habit has no `todoistTaskId`: creates a new recurring task in the Habits project.
 * - If it already has one and the task exists in cache: updates due_string / content / duration.
 * - If the cached task is missing (deleted in Todoist): creates a fresh task.
 *
 * Returns the resulting todoistTaskId (existing or new) on success; null on failure.
 */
export async function syncHabitToTodoist(args: {
    habit: Habit;
    actions: TodoistActionsValue;
    settings: AppSettings;
    projects: TodoistProject[];
    taskMap: Map<string, TodoistTask>;
    onUpdateSettings: (updates: Partial<AppSettings>) => void;
}): Promise<string | null> {
    const { habit, actions, settings, projects, taskMap, onUpdateSettings } = args;
    if (habit.kind !== 'stabilizer') return null;

    const dueString = buildDueString(habit);
    const duration = habit.targetDurationMinutes;

    const existing = habit.todoistTaskId ? taskMap.get(habit.todoistTaskId) : undefined;
    if (existing) {
        await actions.updateTask(existing.id, {
            content: habit.name,
            due_string: dueString,
            due_lang: 'en',
            ...(duration ? { duration, duration_unit: 'minute' } : {}),
        });
        return existing.id;
    }

    const projectId = await ensureHabitsProject({ actions, settings, projects, onUpdateSettings });
    if (!projectId) return null;

    const created = await actions.createTask(habit.name, {
        project_id: projectId,
        due_string: dueString,
        due_lang: 'en',
        ...(duration ? { duration, duration_unit: 'minute' } : {}),
    });
    return created?.id ?? null;
}

/**
 * Determine which SessionSlot (if any) contains a given "HH:mm" time.
 * Handles slots that don't cross midnight; multi-day spans are not supported.
 */
function resolveSessionForTime(time: string, slots: SessionSlot[]): string | undefined {
    const m = timeToMinutes(time);
    for (const slot of slots) {
        const start = timeToMinutes(slot.startTime);
        const end = timeToMinutes(slot.endTime);
        if (m >= start && m < end) return slot.id;
    }
    return undefined;
}

/** Extract "HH:mm" from a Todoist `due.date` value, which may be "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss". */
function dueTimeOfDay(dueDate: string): string | null {
    const tIdx = dueDate.indexOf('T');
    if (tIdx === -1) return null;
    const hhmm = dueDate.slice(tIdx + 1, tIdx + 6);
    return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

/**
 * v6.1: compute the list of habit-tasks to inject for today.
 *
 * Filters active stabilizer habits to those whose:
 *  - recurrence matches `dateISO`
 *  - season scope matches the active season (or is season-agnostic)
 *  - linked Todoist task exists, is due today, and is unchecked
 *  - `windowBehavior !== 'strict'` OR the current time is still inside the target window
 * Idempotent against habits already present in `plan.linkedTasks` (caller can pass the full list).
 */
export function computeHabitTasksToInject(args: {
    life: LifeContext;
    plan: DayPlan;
    taskMap: Map<string, TodoistTask>;
    sessionSlots: SessionSlot[];
    now: Date;
    taskCaps: TaskCapDefaults;
}): HabitTaskInjection[] {
    const { life, plan, taskMap, sessionSlots, now, taskCaps } = args;
    const dateISO = plan.date;
    const activeSeasonId = life.activeSeasonId;
    const existingHabitIds = new Set(
        plan.linkedTasks
            .map((lt) => lt.sourceHabitId)
            .filter((id): id is string => Boolean(id)),
    );
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const out: HabitTaskInjection[] = [];

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

        // Window-behavior gate: 'strict' hides the task if its window has passed.
        if (habit.windowBehavior === 'strict' && habit.targetTime) {
            const windowEnd = timeToMinutes(habit.targetTime) + (habit.targetDurationMinutes ?? taskCaps.stabilizer);
            if (nowMinutes > windowEnd) continue;
        }

        // Auto-assign session via Todoist `due.date` time-of-day if present, else habit's targetTime.
        const dueTime = dueTimeOfDay(task.due.date);
        const anchorTime = dueTime ?? habit.targetTime;
        const sessionId = anchorTime ? resolveSessionForTime(anchorTime, sessionSlots) : undefined;

        out.push({
            habitId: habit.id,
            todoistId: habit.todoistTaskId,
            name: task.content || habit.name,
            estimatedMinutes: habit.targetDurationMinutes ?? taskCaps.stabilizer,
            ...(sessionId ? { sessionId } : {}),
        });
    }
    return out;
}

