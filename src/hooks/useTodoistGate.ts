import { useTodoistData } from './useTodoist';

/**
 * The app-wide Todoist connection-health gate. Single source of truth so the persistent gate banner,
 * the `/setup` route guard, and the disabled write-controls all agree on one expression.
 *
 * Two thresholds, both keyed on `statusResolved` so an in-flight `/status` check never reads as
 * "allowed" (it renders neutrally instead of flashing a block):
 *  - `planningBlocked` — Todoist is definitively unconfigured. Planning is Todoist-driven, so the
 *    planning *entry points* (wizard route, Quick start, Welcome CTA) are hard-blocked.
 *  - `writesBlocked` — unconfigured *or* the token was revoked (`authFailed`). Drives the banner and
 *    disables Todoist-*writing* controls on the otherwise-soft Dashboard/Focus surfaces.
 */
export interface TodoistGate {
    planningBlocked: boolean;
    writesBlocked: boolean;
    isConfigured: boolean;
    authFailed: boolean;
    statusResolved: boolean;
}

export function useTodoistGate(): TodoistGate {
    const { isConfigured, authFailed, statusResolved } = useTodoistData();
    return {
        planningBlocked: statusResolved && !isConfigured,
        writesBlocked: statusResolved && (!isConfigured || authFailed),
        isConfigured,
        authFailed,
        statusResolved,
    };
}
