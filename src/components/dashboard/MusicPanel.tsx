import { playlists } from '../../data/playlists';
import { useDayPlan } from '../../context/DayPlanContext';
import { useState } from 'react';

/** Extract the Spotify playlist ID from an open.spotify.com URL */
function spotifyPlaylistId(url: string): string {
    const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
    return match?.[1] ?? '';
}

export function MusicPanel() {
    const { plan } = useDayPlan();
    const [activeId, setActiveId] = useState<string | null>(null);

    // Determine suggested playlist from last check-in
    const lastCheckIn = plan.checkIns[plan.checkIns.length - 1];
    const suggestedId = lastCheckIn?.playlistSuggested;

    const activePl = activeId ? playlists.find((p) => p.id === activeId) : null;
    const activeSpId = activePl ? spotifyPlaylistId(activePl.spotifyUrl) : '';

    return (
        <div className="space-y-3">
            {/* Horizontal compact cards */}
            <div className="flex gap-2 flex-wrap">
                {playlists.map((pl) => {
                    const isActive = activeId === pl.id;
                    const isSuggested = suggestedId === pl.id;

                    return (
                        <button
                            key={pl.id}
                            onClick={() => setActiveId(isActive ? null : pl.id)}
                            title={pl.description}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left cursor-pointer transition-colors text-sm ${
                                isActive
                                    ? 'bg-accent-subtle border-accent/30 ring-1 ring-accent/20'
                                    : isSuggested
                                        ? 'bg-accent-subtle/50 border-accent/20'
                                        : 'bg-white border-border hover:bg-surface-dark/50'
                            }`}
                        >
                            <span className="text-base">{pl.emoji}</span>
                            <span className="font-medium truncate">{pl.workLabel}</span>
                            {isSuggested && (
                                <span className="text-[9px] font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded-full flex-shrink-0">
                                    Suggested
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Expanded embed for active card */}
            {activePl && activeSpId && (
                <div className="rounded-lg border border-border overflow-hidden bg-black/5">
                    <iframe
                        src={`https://open.spotify.com/embed/playlist/${activeSpId}?utm_source=generator&theme=0`}
                        width="100%"
                        height="152"
                        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                        loading="lazy"
                        className="block"
                        title={`${activePl.name} Spotify player`}
                    />
                    <div className="px-3 py-1.5 flex items-center justify-between">
                        <span className="text-xs text-text-light">
                            {activePl.name} — {activePl.description}
                        </span>
                        <a
                            href={`spotify:playlist:${activeSpId}`}
                            className="text-[11px] text-text-light hover:text-accent transition-colors flex-shrink-0 ml-3"
                        >
                            Open in Spotify app &rarr;
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
}
