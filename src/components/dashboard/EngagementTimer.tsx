import { useEffect, useState } from 'react';
import { formatClock, segmentSeconds } from '../../lib/engagement';
import type { EngagementSegment } from '../../types';

interface EngagementTimerProps {
    /** The segment to display. Live (ticking) when it has no `endedAt`. */
    segment: EngagementSegment;
    className?: string;
}

/**
 * v6.4: minutes:seconds readout for one engagement segment. Ticks once per second while the
 * segment is open (no `endedAt`); renders a static duration once closed. Shared by the
 * dashboard `HabitInstanceCard` rows, the `SessionTimeline` task rows, and the engagement-log
 * view so the format stays consistent everywhere. Each segment is a single Start→Stop period,
 * so the card timer naturally counts from 0:00 on every Start.
 */
export function EngagementTimer({ segment, className }: EngagementTimerProps) {
    const live = !segment.endedAt;
    const [nowMs, setNowMs] = useState(() => Date.now());

    useEffect(() => {
        if (!live) return;
        const id = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(id);
    }, [live]);

    return <span className={`tabular-nums ${className ?? ''}`}>{formatClock(segmentSeconds(segment, nowMs))}</span>;
}
