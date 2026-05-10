import type { LifeContext, Season } from '../types';

export function findActiveSeason(life: LifeContext): Season | null {
    if (life.activeSeasonId) {
        const selectedSeason = life.seasons.find((season) => season.id === life.activeSeasonId);
        if (selectedSeason) return selectedSeason;
    }

    return life.seasons.find((season) => season.active) ?? null;
}

export interface SeasonProgress {
    weekNumber: number;   // 1-indexed; 1 = first week
    totalWeeks: number;
    percentDone: number;  // 0..1, clamped
}

/**
 * Compute "Week N of M" progress for a season. Returns null when the season
 * has no endDate (open-ended) or dates are malformed.
 *
 * Dates parsed as local-calendar (mirrors habitMatchesDate) to avoid TZ off-by-one.
 */
export function getSeasonProgress(season: Season, todayISO: string): SeasonProgress | null {
    if (!season.endDate) return null;
    const start = parseLocalDate(season.startDate);
    const end = parseLocalDate(season.endDate);
    const today = parseLocalDate(todayISO);
    if (!start || !end || !today) return null;
    if (end.getTime() <= start.getTime()) return null;

    const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
    const totalWeeks = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / MS_PER_WEEK));
    const elapsedMs = today.getTime() - start.getTime();
    const weekNumber = Math.min(totalWeeks, Math.max(1, Math.floor(elapsedMs / MS_PER_WEEK) + 1));
    const percentDone = Math.min(1, Math.max(0, elapsedMs / (end.getTime() - start.getTime())));

    return { weekNumber, totalWeeks, percentDone };
}

function parseLocalDate(iso: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    const [, y, mo, d] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d));
}
