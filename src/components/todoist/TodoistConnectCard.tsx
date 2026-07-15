// Reusable Todoist connect/status card — the token entry, validation, connected badge and
// disconnect affordance. Mounted by the Settings integrations panel (inside TodoistSetup, which
// adds the habits-project config around it) and by the onboarding flow's required Todoist step.

import { useState } from 'react';
import { useTodoistActions, useTodoistData } from '../../hooks/useTodoist';
import { disconnectTodoist, storeTodoistToken } from '../../lib/todoistApi';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/formStyles';

const TODOIST_CONNECTION_ERRORS: Record<string, string> = {
    invalid_token: 'Invalid token — please check and try again.',
    missing_token: 'Please paste a token.',
    server_not_configured: 'The Cloudflare worker is missing its configuration.',
    storage_unavailable: 'Cloudflare KV is unavailable right now. Try again shortly.',
    todoist_unreachable: 'Todoist could not be reached right now. Try again shortly.',
    unauthorized: 'Your session expired — reload the page and try again.',
    disconnect_failed: 'Todoist could not be disconnected right now. Try again shortly.',
};

export function TodoistConnectCard() {
    const { isConfigured, authFailed } = useTodoistData();
    const { refreshProjects, refreshConnection } = useTodoistActions();

    const [token, setToken] = useState('');
    const [testing, setTesting] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const handleSaveToken = async () => {
        if (!token.trim()) return;
        setTesting(true);
        setStatus('idle');
        setErrorMsg(null);

        const result = await storeTodoistToken(token.trim());
        if (!result.ok) {
            setStatus('error');
            setErrorMsg(TODOIST_CONNECTION_ERRORS[result.error ?? ''] ?? 'Could not save the token.');
            setTesting(false);
            return;
        }

        setToken('');
        setStatus('success');
        setTesting(false);
        await refreshConnection();
        void refreshProjects({ force: true });
    };

    const handleDisconnect = async () => {
        setErrorMsg(null);
        const result = await disconnectTodoist();
        if (!result.ok) {
            setStatus('error');
            setErrorMsg(TODOIST_CONNECTION_ERRORS[result.error ?? ''] ?? 'Could not disconnect the token.');
            await refreshConnection();
            return;
        }

        setStatus('idle');
        await refreshConnection();
    };

    return (
        <div className="space-y-3">
            {/* Auth-failure banner — flips when any Todoist call returns 401. */}
            {authFailed && (
                <div className="rounded-lg border border-red-400/50 bg-red-50 dark:bg-red-900/20 px-3 py-2.5 text-sm">
                    <p className="font-medium text-red-700 dark:text-red-300">
                        Todoist authentication failed
                    </p>
                    <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-1">
                        The stored token may be wrong or revoked — disconnect and paste a fresh one.
                        If your session expired instead, reload the page to sign in again.
                    </p>
                </div>
            )}

            {isConfigured ? (
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
                    {status === 'success' && (
                        <p className="text-xs text-success">Token saved on the server.</p>
                    )}
                </div>
            )}

            {status === 'error' && errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}
        </div>
    );
}
