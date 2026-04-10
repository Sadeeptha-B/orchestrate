interface ProgressBarProps {
    current: number;
    total: number;
}

export function ProgressBar({ current, total }: ProgressBarProps) {
    const pct = Math.round((current / total) * 100);
    return (
        <div className="w-full">
            <div className="flex justify-between text-xs text-text-light mb-1.5">
                <span>Step {current} of {total}</span>
                <span>{pct}%</span>
            </div>
            <div className="h-1.5 bg-surface-dark rounded-full overflow-hidden">
                <div
                    className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}
