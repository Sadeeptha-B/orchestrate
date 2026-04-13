import { useMemo } from 'react';
import { useDayPlan } from '../../context/DayPlanContext';
import type { CalendarViewMode } from '../../types';

const VIEW_MODE_LABELS: Record<CalendarViewMode, string> = {
    week: 'Week',
    month: 'Month',
    agenda: 'Agenda',
};

const MODE_PARAM: Record<CalendarViewMode, string> = {
    week: 'WEEK',
    month: 'MONTH',
    agenda: 'AGENDA',
};

interface GoogleCalendarEmbedProps {
    className?: string;
    height?: number;
    onSetup?: () => void;
}

export function GoogleCalendarEmbed({
    className = '',
    height = 400,
    onSetup,
}: GoogleCalendarEmbedProps) {
    const { settings, dispatch } = useDayPlan();
    const calendarEntries = settings.googleCalendarIds;
    const viewMode: CalendarViewMode = settings.calendarViewMode ?? 'week';

    const src = useMemo(() => {
        if (!calendarEntries || calendarEntries.length === 0) return null;

        const srcParams = calendarEntries
            .map((entry) => {
                let param = `src=${encodeURIComponent(entry.id)}`;
                if (entry.color) param += `&color=${encodeURIComponent(entry.color)}`;
                return param;
            })
            .join('&');
        return `https://calendar.google.com/calendar/embed?${srcParams}&mode=${MODE_PARAM[viewMode] ?? 'WEEK'}&showTitle=0&showNav=1&showPrint=0&showTabs=0&showCalendars=0`;
    }, [calendarEntries, viewMode]);

    if (!calendarEntries || calendarEntries.length === 0) {
        return (
            <div
                className={`flex flex-col items-center justify-center border border-border rounded-lg bg-card text-center p-6 ${className}`}
                style={{ height }}
            >
                <p className="text-sm text-text-light mb-2">
                    No Google Calendar configured.
                </p>
                {onSetup ? (
                    <button
                        onClick={onSetup}
                        className="text-sm text-accent hover:underline cursor-pointer"
                    >
                        Open Settings →
                    </button>
                ) : (
                    <p className="text-xs text-text-light">
                        Go to Settings → Integrations to add your calendars.
                    </p>
                )}
            </div>
        );
    }

    const handleViewChange = (mode: CalendarViewMode) => {
        dispatch({ type: 'UPDATE_SETTINGS', settings: { calendarViewMode: mode } });
    };

    return (
        <div className={className}>
            {/* View mode tabs + open link */}
            <div className="flex items-center gap-1 mb-2">
                {(Object.keys(VIEW_MODE_LABELS) as CalendarViewMode[]).map((mode) => (
                    <button
                        key={mode}
                        onClick={() => handleViewChange(mode)}
                        className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${viewMode === mode
                            ? 'bg-accent text-white'
                            : 'text-text-light hover:bg-surface-dark'
                            }`}
                    >
                        {VIEW_MODE_LABELS[mode]}
                    </button>
                ))}
                <a
                    href="https://calendar.google.com/calendar/r"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-xs text-accent hover:underline"
                >
                    Open in Google Calendar ↗
                </a>
            </div>
            <p className="text-[10px] text-text-light mb-1.5">
                Private or imported calendars (e.g. Todoist sync) may not appear here due to browser cookie restrictions. Make them <strong>public</strong> in Google Calendar settings, or use the link above.
            </p>
            <div
                className="rounded-lg border border-border overflow-hidden"
                style={{ height }}
            >
                <iframe
                    src={src!}
                    title="Google Calendar"
                    className="w-full h-full border-0"
                />
            </div>
        </div>
    );
}
