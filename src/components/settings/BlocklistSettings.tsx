import { useEffect, useRef, useState } from 'react';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useSessionCalendarSync } from '../../hooks/useSessionCalendarSync';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/formStyles';

/**
 * v7.7 Phase 3: manage the No Distraction blocklist suffix strings. Orchestrate only stores the
 * strings; the actual blocklists are configured in the extension. A suffix is appended to a session's
 * calendar event name (e.g. "Afternoon Session -ND") so No Distraction blocks during that event.
 */
export function BlocklistSettings() {
    const { settings, dispatch } = useDayPlan();
    const { sync } = useSessionCalendarSync();
    const blocklists = settings.blocklists ?? [];
    const [draft, setDraft] = useState('');
    const pendingSync = useRef(false);

    // After a delete cleans the live plan, re-sync so any affected calendar events lose the suffix
    // (no-ops when not connected). Runs once `blocklists` reflects the removal.
    useEffect(() => {
        if (!pendingSync.current) return;
        pendingSync.current = false;
        void sync();
    }, [settings.blocklists, sync]);

    const add = () => {
        const v = draft.trim();
        if (!v || blocklists.includes(v)) {
            setDraft('');
            return;
        }
        dispatch({ type: 'UPDATE_SETTINGS', settings: { blocklists: [...blocklists, v] } });
        setDraft('');
    };

    const remove = (s: string) => {
        // Clears the suffix from settings + today's sessions/locks (reducer), then re-syncs (effect).
        dispatch({ type: 'REMOVE_BLOCKLIST', suffix: s });
        pendingSync.current = true;
    };

    return (
        <div>
            <h3 className="text-sm font-semibold mb-2">No Distraction blocklists</h3>
            <p className="text-xs text-text-light mb-3">
                Suffix strings appended to a session's calendar event name so the{' '}
                <a
                    href="https://www.nodistraction.net"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                >
                    No Distraction
                </a>{' '}
                extension blocks sites during the session (e.g.{' '}
                <code className="text-xs bg-surface-dark px-1 py-0.5 rounded">-ND</code>). The blocklists
                themselves are managed in the extension — Orchestrate just stores the suffixes to append.
            </p>
            <div className="flex items-center gap-2 mb-2">
                <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
                    placeholder="e.g. -ND or -deepwork"
                    className={inputClass}
                />
                <Button size="sm" onClick={add} disabled={!draft.trim()}>Add</Button>
            </div>
            {blocklists.length === 0 ? (
                <p className="text-xs text-text-light">No blocklists yet.</p>
            ) : (
                <ul className="flex flex-wrap gap-1.5">
                    {blocklists.map((b) => (
                        <li
                            key={b}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border bg-card text-xs"
                        >
                            <code>{b}</code>
                            <button
                                type="button"
                                onClick={() => remove(b)}
                                aria-label={`Remove ${b}`}
                                className="text-text-light hover:text-red-500 cursor-pointer leading-none"
                            >
                                ✕
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
