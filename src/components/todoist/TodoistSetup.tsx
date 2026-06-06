import { useMemo, useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistActions, useTodoistData } from '../../hooks/useTodoist';
import { encryptToken } from '../../lib/crypto';
import { validateTodoistToken } from '../../lib/todoistApi';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/formStyles';

export function TodoistSetup() {
    const { settings, dispatch } = useDayPlan();
    const { projects, authFailed } = useTodoistData();
    const { refreshProjects } = useTodoistActions();
    const [token, setToken] = useState('');
    const [testing, setTesting] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [refreshingProjects, setRefreshingProjects] = useState(false);

    const isConnected = Boolean(settings.todoistToken);

    // v6.1: detect a stale default — settings reference a project that no longer exists.
    // We only consider this "stale" once projects have loaded (empty list could just mean cache miss).
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
        dispatch({
            type: 'UPDATE_SETTINGS',
            settings: { habitsTodoistProjectId: undefined },
        });
    };

    const handleSaveToken = async () => {
        if (!token.trim()) return;
        setTesting(true);
        setStatus('idle');

        const valid = await validateTodoistToken(token.trim());
        if (!valid) {
            setStatus('error');
            setTesting(false);
            return;
        }

        const { encrypted, iv, key } = await encryptToken(token.trim());
        dispatch({
            type: 'UPDATE_SETTINGS',
            settings: {
                todoistToken: encrypted,
                todoistTokenIV: iv,
                todoistTokenKey: key,
            },
        });
        setToken('');
        setStatus('success');
        setTesting(false);
    };

    const handleDisconnect = () => {
        dispatch({
            type: 'UPDATE_SETTINGS',
            settings: {
                todoistToken: undefined,
                todoistTokenIV: undefined,
                todoistTokenKey: undefined,
            },
        });
        setStatus('idle');
    };

    return (
        <div className="space-y-6">
            {/* Auth-failure banner — flips when any Todoist call returns 401 (revoked/expired token). */}
            {authFailed && isConnected && (
                <div className="rounded-lg border border-red-400/50 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-sm">
                    <p className="font-medium text-red-700 dark:text-red-300">
                        Todoist authentication failed
                    </p>
                    <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-1">
                        Your token may have been revoked or expired. Disconnect below, then paste a fresh
                        token from Todoist Settings → Integrations → Developer.
                    </p>
                </div>
            )}

            {/* Todoist token */}
            <div>
                <h3 className="text-sm font-semibold mb-2">Todoist API Token</h3>
                {isConnected ? (
                    <div className="flex items-center gap-3">
                        <span className={`text-sm ${authFailed ? 'text-red-500' : 'text-success'}`}>
                            {authFailed ? 'Token rejected' : 'Connected'}
                        </span>
                        <Button variant="ghost" size="sm" onClick={handleDisconnect}>
                            Disconnect
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <p className="text-xs text-text-light">
                            Paste your personal API token from{' '}
                            <a
                                href="https://app.todoist.com/app/settings/integrations/developer"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent hover:underline"
                            >
                                Todoist Settings → Integrations → Developer
                            </a>
                        </p>
                        <div className="flex gap-2">
                            <input
                                type="password"
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveToken()}
                                placeholder="Paste token here"
                                className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-card text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                            />
                            <Button size="sm" onClick={handleSaveToken} disabled={testing || !token.trim()}>
                                {testing ? 'Testing…' : 'Test & Save'}
                            </Button>
                        </div>
                        {status === 'error' && (
                            <p className="text-xs text-red-500">
                                Invalid token — please check and try again.
                            </p>
                        )}
                        {status === 'success' && (
                            <p className="text-xs text-success">Token saved and encrypted.</p>
                        )}
                    </div>
                )}
            </div>

            {/* Default Habits Project (v6.1) — only meaningful when Todoist is connected */}
            {isConnected && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold">Default Habits Project</h3>
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
