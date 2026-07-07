// Settings → Integrations: the Todoist panel. Composes the reusable TodoistConnectCard (token
// entry / status / disconnect — also used by onboarding) with the settings-only habits-project
// configuration. Authentication is handled at the edge by Cloudflare Access; there is no in-app
// secret to enter.

import { useMemo, useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistActions, useTodoistData } from '../../hooks/useTodoist';
import { inputClass } from '../ui/formStyles';
import { TodoistConnectCard } from './TodoistConnectCard';

export function TodoistSetup() {
    const { settings, dispatch } = useDayPlan();
    const { isConfigured, projects } = useTodoistData();
    const { refreshProjects } = useTodoistActions();

    const [refreshingProjects, setRefreshingProjects] = useState(false);

    // v6.1: detect a stale default — settings reference a project that no longer exists.
    const habitsProjectId = settings.habitsTodoistProjectId;
    const defaultProjectIsStale = useMemo(
        () =>
            Boolean(
                habitsProjectId
                && projects.length > 0
                && !projects.some((p) => p.id === habitsProjectId),
            ),
        [habitsProjectId, projects],
    );

    const handleRefreshProjects = async () => {
        setRefreshingProjects(true);
        try {
            await refreshProjects({ force: true });
        } finally {
            setRefreshingProjects(false);
        }
    };

    const handleClearStaleDefault = () => {
        dispatch({ type: 'UPDATE_SETTINGS', settings: { habitsTodoistProjectId: undefined } });
    };

    return (
        <div className="space-y-6">
            <h3 className="text-sm font-semibold">Todoist</h3>

            <TodoistConnectCard />

            {/* Default Habits Project (v6.1) — only meaningful when Todoist is connected */}
            {isConfigured && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold">Default Habits Project</h4>
                        <button
                            type="button"
                            onClick={handleRefreshProjects}
                            disabled={refreshingProjects}
                            className="text-xs text-text-light hover:text-accent cursor-pointer disabled:opacity-50 disabled:cursor-default"
                            title="Re-fetch your Todoist project list"
                        >
                            {refreshingProjects ? 'Refreshing…' : '↻ Refresh projects'}
                        </button>
                    </div>
                    <p className="text-xs text-text-light mb-2">
                        Where new habits get synced as recurring tasks. Each habit can override
                        this from its own form. Leave on auto-create to use a project named "Habits"
                        (created lazily on first habit save).
                    </p>
                    {defaultProjectIsStale && (
                        <div className="mb-2 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs flex items-start justify-between gap-3">
                            <span className="text-amber-900 dark:text-amber-200">
                                The selected project no longer exists in Todoist. New habit syncs will
                                fall back to auto-create until you pick a different one.
                            </span>
                            <button
                                type="button"
                                onClick={handleClearStaleDefault}
                                className="text-accent hover:underline cursor-pointer flex-shrink-0"
                            >
                                Clear
                            </button>
                        </div>
                    )}
                    <select
                        className={inputClass}
                        value={defaultProjectIsStale ? '' : (settings.habitsTodoistProjectId ?? '')}
                        onChange={(e) =>
                            dispatch({
                                type: 'UPDATE_SETTINGS',
                                settings: { habitsTodoistProjectId: e.target.value || undefined },
                            })
                        }
                    >
                        <option value="">Auto-create "Habits" project</option>
                        {projects.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                </div>
            )}
        </div>
    );
}
