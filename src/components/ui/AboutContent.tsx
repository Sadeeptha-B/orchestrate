export function AboutContent() {
    return (
        <div className="space-y-3 text-sm text-text-light">
            <p>
                Orchestrate is a <strong className="text-text">daily contextualization companion</strong> — not a
                replacement for your task manager or calendar, but a layer that sits alongside them. Its job is to
                reduce the friction between "I have a list of things to do" and "I know exactly what I'm doing today
                and why."
            </p>
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
                <strong className="text-text">Habits</strong> are recurring stabilizers (sleep, gym, deep work blocks)
                that auto-inject into your daily intentions so the things that matter most are never crowded out by
                the urgent.
            </p>
            <p>
                Together, they counter <strong className="text-text">task blindness and time blindness</strong>:{' '}
                the tendency to open a todo list on a fresh day and feel lost, or to reach evening having been
                busy but not purposeful.
            </p>
        </div>
    );
}
