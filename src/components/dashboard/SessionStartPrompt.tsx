import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useDayPlan } from '../../hooks/useDayPlan';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { useSessionCalendarSync } from '../../hooks/useSessionCalendarSync';

/**
 * v7.7 Phase 3: when a session becomes current (and blocklists are configured), prompt once to
 * confirm its No Distraction blocklist. Confirming records the choice (locking it until the session
 * ends) and Syncs so the calendar event carries the suffix. Skipping dismisses it for this load.
 *
 * Mounted on the dashboard. Uses the "store previous value, adjust during render" pattern (not an
 * effect) to react to the time-derived current-session change.
 */
export function SessionStartPrompt() {
    const { plan, settings, dispatch } = useDayPlan();
    const { sync } = useSessionCalendarSync();
    const { currentSession } = useCurrentSession(plan.sessionSlots);
    const blocklists = settings.blocklists ?? [];

    const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
    const [draftChoices, setDraftChoices] = useState<Record<string, string>>({});
    const pendingSync = useRef(false);

    const session = currentSession
        && blocklists.length > 0
        && !plan.sessionStarts?.[currentSession.id]
        && !dismissed.has(currentSession.id)
        ? currentSession
        : null;
    const choice = session ? (draftChoices[session.id] ?? session.blocklist ?? '') : '';

    // Sync after the confirmation lands in state, so the event picks up the locked suffix.
    useEffect(() => {
        if (!pendingSync.current) return;
        pendingSync.current = false;
        void sync();
    }, [plan.sessionStarts, sync]);

    if (!session) return null;

    const confirm = () => {
        dispatch({
            type: 'CONFIRM_SESSION_START',
            sessionId: session.id,
            blocklist: choice || null,
            now: new Date().toISOString(),
        });
        pendingSync.current = true;
    };

    const skip = () => {
        setDismissed((prev) => new Set(prev).add(session.id));
    };

    return (
        <Modal open onClose={skip} title="Start session?">
            <div className="space-y-4">
                <p className="text-sm text-text-light">
                    <span className="font-medium text-text">{session.name}</span>{' '}
                    <span className="tabular-nums">({session.startTime}–{session.endTime})</span> is starting.
                    Confirm its blocklist — once confirmed it's locked until the session ends, and the
                    session's calendar event gets the suffix so No Distraction enforces it.
                </p>
                <div>
                    <label className="block text-xs font-medium text-text-light mb-1" htmlFor="start-blocklist">
                        Blocklist
                    </label>
                    <select
                        id="start-blocklist"
                        value={choice}
                        onChange={(e) => setDraftChoices((prev) => ({ ...prev, [session.id]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                    >
                        <option value="">None</option>
                        {blocklists.map((b) => (
                            <option key={b} value={b}>{b}</option>
                        ))}
                    </select>
                </div>
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={skip}>Skip</Button>
                    <Button size="sm" onClick={confirm}>Confirm &amp; lock</Button>
                </div>
            </div>
        </Modal>
    );
}
