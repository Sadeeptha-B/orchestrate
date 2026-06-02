interface AboutContentProps {
    /**
     * Called when the user clicks "Open user guide". The caller is expected to close
     * the surrounding About modal and navigate to /guide. Kept as a prop so each
     * surface (Dashboard / Welcome / Wizard) can clean up its own modal state.
     */
    onOpenGuide?: () => void;
}

export function AboutContent({ onOpenGuide }: AboutContentProps = {}) {
    return (
        <div className="space-y-3 text-sm text-text-light">
            <div className="rounded-lg bg-accent-subtle border-l-4 border-accent p-4">
                <p className="text-sm text-text leading-relaxed">
                    Orchestrate is a <strong className="text-accent">daily contextualization companion</strong> — not a
                    replacement for your task manager or calendar, but a layer that sits alongside them. Its job is to
                    reduce the friction between "I have a list of things to do" and "I know exactly what I'm doing today
                    and why."
                </p>
            </div>
            <p>
                Each morning, a short wizard walks you through setting <strong className="text-text">intentions</strong>{' '}
                (today-scoped focus areas), mapping them to specific tasks from Todoist, estimating and scheduling
                those tasks into sessions, and locking into a working state with a music cue. Through the day,
                hourly check-ins ask how you're doing and suggest a playlist — keeping you connected rather than
                letting the day drift.
            </p>
            <p>
                Beneath the daily flow sits a <strong className="text-text">life scaffolding layer</strong> that holds
                the <em>why</em> across days, weeks, and months.{' '}
                <strong className="text-text">Seasons</strong> are medium-horizon focus periods — a theme, supporting
                goals, and an optional capacity budget that shape what you take on each day.{' '}
                <strong className="text-text">Habits</strong> come in two kinds by <em>lifecycle</em>: a plain
                <em> habit</em> (sleep, gym, deep-work rituals) syncs to Todoist as a recurring task and is done once a
                day — timed on the timeline or "anytime"; a <em>micro-gap</em> is a light, <strong className="text-text">repeatable</strong> filler
                (flashcards, a quick drill) with no Todoist task, pulled from its own panel whenever you have a gap.
            </p>
            <p>
                Together, they counter <strong className="text-text">task blindness and time blindness</strong>:{' '}
                the tendency to open a todo list on a fresh day and feel lost, or to reach evening having been
                busy but not purposeful.
            </p>
            {onOpenGuide && (
                <div className="pt-2 border-t border-border">
                    <button
                        onClick={onOpenGuide}
                        className="text-accent hover:underline cursor-pointer text-sm"
                    >
                        Open user guide →
                    </button>
                    <p className="text-xs mt-1">
                        Mental model + how-to for habits, intentions, anytime habits, True Rest, and capacity.
                    </p>
                </div>
            )}
        </div>
    );
}
