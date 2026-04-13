import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useDayPlan } from '../../context/DayPlanContext';
import { useCurrentSession } from '../../hooks/useCurrentSession';
import { useTodoist } from '../../hooks/useTodoist';
import { getPlaylistForWorkType, playlists } from '../../data/playlists';
import type { WorkType, CheckIn } from '../../types';

const FEELINGS = [
    { value: 'great', label: 'Great', emoji: '\u{1F31F}' },
    { value: 'okay', label: 'Okay', emoji: '\u{1F44C}' },
    { value: 'struggling', label: 'Struggling', emoji: '\u{1F62E}\u200D\u{1F4A8}' },
    { value: 'stuck', label: 'Stuck', emoji: '\u{1F9F1}' },
] as const;

const WORK_TYPES: { value: WorkType; label: string }[] = [
    { value: 'coding', label: 'Coding / Problem Solving' },
    { value: 'lecture', label: 'Lectures / Light Work' },
    { value: 'reading', label: 'Reading / Writing' },
    { value: 'restless', label: 'Restless / High Energy' },
    { value: 'low-energy', label: 'Foggy / Low Energy' },
];

interface CheckInModalProps {
    open: boolean;
    onClose: () => void;
    onRecontextualize?: () => void;
}

export function CheckInModal({ open, onClose, onRecontextualize }: CheckInModalProps) {
    const { plan, settings, dispatch } = useDayPlan();
    const { currentSession } = useCurrentSession(settings.sessionSlots);
    const { taskMap } = useTodoist();
    const [feeling, setFeeling] = useState<CheckIn['feeling'] | null>(null);
    const [workType, setWorkType] = useState<WorkType | null>(null);
    const [notes, setNotes] = useState('');

    const suggestedPlaylist = workType ? getPlaylistForWorkType(workType) : undefined;

    // Background nudges for the current session
    const bgNudges = currentSession
        ? (plan.taskSessions[currentSession.id] ?? [])
            .map((id) => plan.linkedTasks.find((lt) => lt.todoistId === id))
            .filter((lt) => lt && lt.type === 'background' && !lt.completed)
        : [];

    const buildCheckIn = (): CheckIn | null => {
        if (!feeling || !workType) return null;
        return {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            feeling,
            currentWorkType: workType,
            playlistSuggested: suggestedPlaylist?.id ?? playlists[0].id,
            notes,
        };
    };

    const resetForm = () => {
        setFeeling(null);
        setWorkType(null);
        setNotes('');
    };

    const handleSubmit = () => {
        const checkIn = buildCheckIn();
        if (!checkIn) return;
        dispatch({ type: 'ADD_CHECKIN', checkIn });
        resetForm();
        onClose();
    };

    const handleRecontextualize = () => {
        const checkIn = buildCheckIn();
        if (checkIn) {
            dispatch({ type: 'ADD_CHECKIN', checkIn });
        }
        resetForm();
        onClose();
        onRecontextualize?.();
    };

    return (
        <Modal open={open} onClose={onClose} title="How's your session going?">
            <div className="space-y-5">
                {/* Feeling */}
                <div>
                    <p className="text-sm text-text-light mb-2">How are you feeling?</p>
                    <div className="flex gap-2">
                        {FEELINGS.map((f) => (
                            <button
                                key={f.value}
                                onClick={() => setFeeling(f.value)}
                                className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-lg border transition-colors cursor-pointer ${feeling === f.value
                                    ? 'bg-accent-subtle border-accent/30'
                                    : 'border-border hover:bg-surface-dark/50'
                                    }`}
                            >
                                <span className="text-xl">{f.emoji}</span>
                                <span className="text-[11px] text-text-light">{f.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Background nudges for current session */}
                {bgNudges.length > 0 && (
                    <div className="px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-300">
                        <span className="font-medium">Background intentions for this session:</span>{' '}
                        {bgNudges.map((lt) => taskMap.get(lt!.todoistId)?.content ?? 'Unknown task').join(', ')}
                    </div>
                )}

                {/* Work type */}
                <div>
                    <p className="text-sm text-text-light mb-2">What kind of work are you doing?</p>
                    <div className="space-y-1.5">
                        {WORK_TYPES.map((wt) => (
                            <button
                                key={wt.value}
                                onClick={() => setWorkType(wt.value)}
                                className={`w-full text-left px-3 py-2 text-sm rounded-lg border transition-colors cursor-pointer ${workType === wt.value
                                    ? 'bg-accent-subtle border-accent/30 text-accent'
                                    : 'border-border hover:bg-surface-dark/50'
                                    }`}
                            >
                                {wt.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Playlist suggestion */}
                {suggestedPlaylist && (
                    <div className="bg-accent-subtle rounded-lg p-3 flex items-center gap-3">
                        <span className="text-lg">{suggestedPlaylist.emoji}</span>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">
                                Try: {suggestedPlaylist.workLabel}
                            </p>
                            <p className="text-xs text-text-light truncate">
                                {suggestedPlaylist.name} — {suggestedPlaylist.description}
                            </p>
                        </div>
                        <a
                            href={`spotify:playlist:${suggestedPlaylist.spotifyUrl.match(/playlist\/([a-zA-Z0-9]+)/)?.[1] ?? ''}`}
                            className="text-xs text-accent hover:underline flex-shrink-0"
                        >
                            Open
                        </a>
                    </div>
                )}

                {/* Notes */}
                <div>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Any notes? (optional)"
                        rows={2}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-card text-text focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-none transition-colors"
                    />
                </div>

                {/* Recontextualize nudge */}
                {onRecontextualize && (
                    <div className="px-3 py-2.5 rounded-lg bg-accent-subtle border border-accent/20 text-xs text-text-light">
                        <p className="font-medium text-text mb-1.5">Need to reschedule?</p>
                        <p className="mb-2">
                            If things have shifted, you can recontextualize your remaining sessions.
                        </p>
                        <Button variant="secondary" size="sm" onClick={handleRecontextualize}>
                            Reschedule Sessions
                        </Button>
                    </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        Dismiss
                    </Button>
                    <Button
                        size="sm"
                        disabled={!feeling || !workType}
                        onClick={handleSubmit}
                    >
                        Log Check-In
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
