import { useState } from 'react';
import { useDayPlan } from '../../context/DayPlanContext';
import { encryptToken } from '../../lib/crypto';
import { validateTodoistToken } from '../../hooks/useTodoist';
import { Button } from '../ui/Button';
import type { GoogleCalendarEntry } from '../../types';

// Google Calendar embed accepted color palette
const GCAL_COLORS: { hex: string; label: string }[] = [
    { hex: '#039BE5', label: 'Blue' },
    { hex: '#7986CB', label: 'Lavender' },
    { hex: '#33B679', label: 'Sage' },
    { hex: '#8E24AA', label: 'Grape' },
    { hex: '#E67C73', label: 'Flamingo' },
    { hex: '#F6BF26', label: 'Banana' },
    { hex: '#F4511E', label: 'Tangerine' },
    { hex: '#009688', label: 'Teal' },
    { hex: '#0B8043', label: 'Basil' },
    { hex: '#3F51B5', label: 'Blueberry' },
    { hex: '#D50000', label: 'Tomato' },
    { hex: '#E4C441', label: 'Citron' },
    { hex: '#795548', label: 'Cocoa' },
    { hex: '#616161', label: 'Graphite' },
    { hex: '#A79B8E', label: 'Birch' },
];

export function TodoistSetup() {
    const { settings, dispatch } = useDayPlan();
    const [token, setToken] = useState('');
    const [calendarEntries, setCalendarEntries] = useState<GoogleCalendarEntry[]>(settings.googleCalendarIds ?? []);
    const [newCalendarId, setNewCalendarId] = useState('');
    const [newCalendarName, setNewCalendarName] = useState('');
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

    const handleAddCalendar = () => {
        const id = newCalendarId.trim();
        if (!id || calendarEntries.some((e) => e.id === id)) return;
        const name = newCalendarName.trim() || undefined;
        const updated = [...calendarEntries, { id, name }];
        setCalendarEntries(updated);
        setNewCalendarId('');
        setNewCalendarName('');
        dispatch({
            type: 'UPDATE_SETTINGS',
            settings: { googleCalendarIds: updated },
        });
    };

    const handleRenameCalendar = (id: string, name: string | undefined) => {
        const updated = calendarEntries.map((e) => (e.id === id ? { ...e, name } : e));
        setCalendarEntries(updated);
        dispatch({
            type: 'UPDATE_SETTINGS',
            settings: { googleCalendarIds: updated },
        });
    };

    const handleRemoveCalendar = (id: string) => {
        const updated = calendarEntries.filter((e) => e.id !== id);
        setCalendarEntries(updated);
        dispatch({
            type: 'UPDATE_SETTINGS',
            settings: { googleCalendarIds: updated.length > 0 ? updated : undefined },
        });
    };

    const handleSetCalendarColor = (id: string, color: string | undefined) => {
        const updated = calendarEntries.map((e) => (e.id === id ? { ...e, color } : e));
        setCalendarEntries(updated);
        dispatch({
            type: 'UPDATE_SETTINGS',
            settings: { googleCalendarIds: updated },
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

            {/* Google Calendar IDs */}
            <div>
                <h3 className="text-sm font-semibold mb-2">Google Calendars</h3>
                <p className="text-xs text-text-light mb-2">
                    Add calendar IDs to overlay in the weekly view. Use{' '}
                    <code className="text-xs bg-surface-dark px-1 py-0.5 rounded">primary</code>,
                    your email, or a calendar ID from Google Calendar settings.
                </p>
                {calendarEntries.length > 0 && (
                    <ul className="space-y-1.5 mb-2">
                        {calendarEntries.map((entry) => (
                            <li key={entry.id} className="flex items-center gap-2 text-sm">
                                <span
                                    className="w-3 h-3 rounded-sm flex-shrink-0 border border-border"
                                    style={{ backgroundColor: entry.color ?? 'transparent' }}
                                />
                                <input
                                    type="text"
                                    value={entry.name ?? ''}
                                    onChange={(e) => handleRenameCalendar(entry.id, e.target.value || undefined)}
                                    placeholder={entry.id}
                                    className="flex-1 min-w-0 text-sm bg-transparent text-text border-0 border-b border-transparent hover:border-border focus:border-accent focus:outline-none transition-colors truncate"
                                    title={entry.id}
                                />
                                <select
                                    value={entry.color ?? ''}
                                    onChange={(e) => handleSetCalendarColor(entry.id, e.target.value || undefined)}
                                    className="text-xs px-1.5 py-0.5 rounded border border-border bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent/30 cursor-pointer"
                                    style={entry.color ? { color: entry.color } : undefined}
                                >
                                    <option value="" style={{ color: 'inherit' }}>Default</option>
                                    {GCAL_COLORS.map((c) => (
                                        <option key={c.hex} value={c.hex} style={{ color: c.hex }}>
                                            ● {c.label}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    onClick={() => handleRemoveCalendar(entry.id)}
                                    className="text-xs text-red-500 hover:text-red-400 cursor-pointer"
                                    title="Remove"
                                >
                                    ✕
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="space-y-1.5">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newCalendarId}
                            onChange={(e) => setNewCalendarId(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddCalendar()}
                            placeholder="Calendar ID"
                            className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-card text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                        />
                        <input
                            type="text"
                            value={newCalendarName}
                            onChange={(e) => setNewCalendarName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddCalendar()}
                            placeholder="Name (optional)"
                            className="w-32 px-3 py-2 text-sm rounded-lg border border-border bg-card text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
                        />
                        <Button variant="secondary" size="sm" onClick={handleAddCalendar} disabled={!newCalendarId.trim()}>
                            Add
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
