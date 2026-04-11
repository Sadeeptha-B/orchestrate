import { useDayPlan } from '../../context/DayPlanContext';

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
    const { settings } = useDayPlan();
    const calendarIds = settings.googleCalendarIds;

    if (!calendarIds || calendarIds.length === 0) {
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

    const srcParams = calendarIds.map((id) => `src=${encodeURIComponent(id)}`).join('&');
    const src = `https://calendar.google.com/calendar/embed?${srcParams}&mode=week&showTitle=0&showNav=1&showPrint=0&showTabs=0&showCalendars=0`;

    return (
        <div
            className={`rounded-lg border border-border overflow-hidden ${className}`}
            style={{ height }}
        >
            <iframe
                src={src}
                title="Google Calendar"
                className="w-full h-full border-0"
                sandbox="allow-same-origin allow-scripts allow-popups"
            />
        </div>
    );
}
