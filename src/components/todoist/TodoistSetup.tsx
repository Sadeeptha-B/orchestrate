import { useMemo, useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useTodoistActions, useTodoistData } from '../../hooks/useTodoist';
import { getStoredSecret, hasStoredSecret, setStoredSecret } from '../../lib/appSecret';
import { disconnectTodoist, storeTodoistToken } from '../../lib/todoistApi';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/formStyles';

const SAVE_TOKEN_ERRORS: Record<string, string> = {
    app_secret: 'The app secret was rejected — check it above.',
    invalid_token: 'Invalid token — please check and try again.',
    missing_token: 'Please paste a token.',
};

export function TodoistSetup() {
    const { settings, dispatch } = useDayPlan();
    const { isConfigured, projects, authFailed } = useTodoistData();
    const { refreshProjects, refreshConnection } = useTodoistActions();

    const [token, setToken] = useState('');
    const [testing, setTesting] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [refreshingProjects, setRefreshingProjects] = useState(false);

    const [hasSecret, setHasSecret] = useState(() => hasStoredSecret());
    const [secretDraft, setSecretDraft] = useState('');
    const [editingSecret, setEditingSecret] = useState(false);

    const isConnected = isConfigured;

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

    /** Clear any legacy in-browser encrypted token (the token now lives server-side in KV). */
    const clearLegacyToken = () => {
        if (settings.todoistToken || settings.todoistTokenIV || settings.todoistTokenKey) {
            dispatch({
                type: 'UPDATE_SETTINGS',
                settings: { todoistToken: undefined, todoistTokenIV: undefined, todoistTokenKey: undefined },
            });
        }
    };

    const handleSaveSecret = async () => {
        const value = secretDraft.trim();
        if (!value) return;
        setStoredSecret(value);
        setHasSecret(true);
        setSecretDraft('');
        setEditingSecret(false);
        await refreshConnection();
    };

    const handleSaveToken = async () => {
        if (!token.trim()) return;
        setTesting(true);
        setStatus('idle');
        setErrorMsg(null);

        const result = await storeTodoistToken(token.trim());
        if (!result.ok) {
            setStatus('error');
            setErrorMsg(SAVE_TOKEN_ERRORS[result.error ?? ''] ?? 'Could not save the token.');
            setTesting(false);
            return;
        }

        clearLegacyToken();
        setToken('');
        setStatus('success');
        setTesting(false);
        await refreshConnection();
        void refreshProjects({ force: true });
    };

    const handleDisconnect = async () => {
        await disconnectTodoist();
        clearLegacyToken();
        setStatus('idle');
        await refreshConnection();
    };

    return (
        <div className="space-y-6">
            <h3 className="text-sm font-semibold">Todoist</h3>

            {/* Shared app-secret entry (same secret as the Google Calendar panel). */}
            {(!hasSecret || editingSecret) ? (
                <div className="space-y-2">
                    <p className="text-xs text-text-light">
                        Enter the <strong>app secret</strong> (the{' '}
                        <code className="text-xs bg-surface-dark px-1 py-0.5 rounded">APP_SHARED_SECRET</code> from your
                        Cloudflare deployment). It's shared with Google Calendar and authorizes access to your tokens.
                    </p>
                    <div className="flex items-center gap-2">
                        <input
                            type="password"
                            value={secretDraft}
                            onChange={(e) => setSecretDraft(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveSecret()}
                            placeholder={getStoredSecret() ? '••••••••  (set — enter to replace)' : 'App secret'}
                            className={inputClass}
                        />
                        <Button size="sm" onClick={handleSaveSecret} disabled={!secretDraft.trim()}>
                            Save
                        </Button>
                        {hasSecret && (
                            <Button variant="ghost" size="sm" onClick={() => setEditingSecret(false)}>
                                Cancel
                            </Button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Auth-failure banner — flips when any Todoist call returns 401. */}
                    {authFailed && (
                        <div className="rounded-lg border border-red-400/50 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-sm">
                            <p className="font-medium text-red-700 dark:text-red-300">
                                Todoist authentication failed
                            </p>
                            <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-1">
                                The app secret or the stored token may be wrong/expired. Re-enter the app secret, or
                                disconnect and paste a fresh token.
                            </p>
                        </div>
                    )}

                    <div className="flex items-center gap-3 text-xs">
                        <span className="text-text-light">App secret saved.</span>
                        <button
                            type="button"
                            onClick={() => setEditingSecret(true)}
                            className="text-text-light hover:text-accent cursor-pointer"
                        >
                            Change
                        </button>
                    </div>

                    {/* Todoist token */}
                    <div>
                        <h4 className="text-sm font-semibold mb-2">API Token</h4>
                        {isConnected ? (
                            <div className="flex items-center gap-3">
                                <span className={`text-sm ${authFailed ? 'text-red-500' : 'text-success'}`}>
                                    {authFailed ? 'Token rejected' : 'Connected'}
                                </span>
                                <Button variant="ghost" size="sm" onClick={() => void handleDisconnect()}>
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
                                    . It's validated and stored on the server — never in this browser.
                                </p>
                                <div className="flex gap-2">
                                    <input
                                        type="password"
                                        value={token}
                                        onChange={(e) => setToken(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSaveToken()}
                                        placeholder="Paste token here"
                                        className={inputClass}
                                    />
                                    <Button size="sm" onClick={() => void handleSaveToken()} disabled={testing || !token.trim()}>
                                        {testing ? 'Testing…' : 'Test & Save'}
                                    </Button>
                                </div>
                                {status === 'error' && (
                                    <p className="text-xs text-red-500">{errorMsg}</p>
                                )}
                                {status === 'success' && (
                                    <p className="text-xs text-success">Token saved on the server.</p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Default Habits Project (v6.1) — only meaningful when Todoist is connected */}
                    {isConnected && (
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
            )}
        </div>
    );
}
