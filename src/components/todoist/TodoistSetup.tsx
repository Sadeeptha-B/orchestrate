import { useState } from 'react';
import { useDayPlan } from '../../context/DayPlanContext';
import { encryptToken } from '../../lib/crypto';
import { validateTodoistToken } from '../../hooks/useTodoist';
import { Button } from '../ui/Button';

export function TodoistSetup() {
    const { settings, dispatch } = useDayPlan();
    const [token, setToken] = useState('');
    const [calendarId, setCalendarId] = useState(settings.googleCalendarId ?? '');
    const [testing, setTesting] = useState(false);
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const isConnected = Boolean(settings.todoistToken);

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

    const handleSaveCalendar = () => {
        dispatch({
            type: 'UPDATE_SETTINGS',
            settings: { googleCalendarId: calendarId.trim() || undefined },
        });
    };

    return (
        <div className="space-y-6">
            {/* Todoist token */}
            <div>
                <h3 className="text-sm font-semibold mb-2">Todoist API Token</h3>
                {isConnected ? (
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-success">Connected</span>
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

            {/* Google Calendar ID */}
            <div>
                <h3 className="text-sm font-semibold mb-2">Google Calendar</h3>
                <p className="text-xs text-text-light mb-2">
                    Enter your calendar ID to show a read-only weekly view. Use{' '}
                    <code className="text-xs bg-surface-dark px-1 py-0.5 rounded">primary</code> or
                    your email address.
                </p>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={calendarId}
                        onChange={(e) => setCalendarId(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveCalendar()}
                        placeholder="primary"
                        className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-card text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                    />
                    <Button variant="secondary" size="sm" onClick={handleSaveCalendar}>
                        Save
                    </Button>
                </div>
            </div>
        </div>
    );
}
