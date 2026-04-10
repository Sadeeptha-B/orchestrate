import { playlists } from '../../data/playlists';
import { useDayPlan } from '../../context/DayPlanContext';
import { useState, useCallback, createContext, useContext, type ReactNode } from 'react';

const ACTIVE_PLAYLIST_KEY = 'orchestrate-active-playlist';

function loadActivePlaylist(): string {
    try {
        const stored = localStorage.getItem(ACTIVE_PLAYLIST_KEY);
        if (stored && playlists.some((p) => p.id === stored)) return stored;
    } catch { /* ignore */ }
    return 'start-work';
}

/** Extract the Spotify playlist ID from an open.spotify.com URL */
function spotifyPlaylistId(url: string): string {
    const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
    return match?.[1] ?? '';
}

// Shared state context for playlist selection
interface MusicState {
    activeId: string;
    setActiveId: (id: string) => void;
    suggestedId: string | undefined;
}

const MusicContext = createContext<MusicState | null>(null);

function useMusicState(): MusicState {
    const ctx = useContext(MusicContext);
    if (!ctx) throw new Error('Music components must be used within MusicProvider');
    return ctx;
}

export function MusicProvider({ children }: { children: ReactNode }) {
    const { plan } = useDayPlan();
    const [activeId, setActiveIdRaw] = useState<string>(loadActivePlaylist);

    const setActiveId = useCallback((id: string) => {
        setActiveIdRaw(id);
        try { localStorage.setItem(ACTIVE_PLAYLIST_KEY, id); } catch { /* ignore */ }
    }, []);

    const lastCheckIn = plan.checkIns[plan.checkIns.length - 1];
    const suggestedId = lastCheckIn?.playlistSuggested;

    return (
        <MusicContext.Provider value={{ activeId, setActiveId, suggestedId }}>
            {children}
        </MusicContext.Provider>
    );
}

export function PlaylistSelector() {
    const { activeId, setActiveId, suggestedId } = useMusicState();

    return (
        <div className="flex gap-2 flex-wrap">
            {playlists.map((pl) => {
                const isActive = activeId === pl.id;
                const isSuggested = suggestedId === pl.id;

                return (
                    <button
                        key={pl.id}
                        onClick={() => setActiveId(pl.id)}
                        title={pl.description}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left cursor-pointer transition-colors text-sm ${isActive
                            ? 'bg-accent-subtle border-accent/30 ring-1 ring-accent/20'
                            : isSuggested
                                ? 'bg-accent-subtle/50 border-accent/20'
                                : 'bg-card border-border hover:bg-surface-dark/50'
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
    );
}

export function SpotifyPlayer() {
    const { activeId } = useMusicState();
    const activePl = playlists.find((p) => p.id === activeId) ?? playlists[0];
    const activeSpId = spotifyPlaylistId(activePl.spotifyUrl);

    if (!activeSpId) return null;

    return (
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
    );
}

/** Convenience wrapper: renders both selector + player together (used outside dashboard) */
export function MusicPanel() {
    return (
        <MusicProvider>
            <div className="space-y-3">
                <PlaylistSelector />
                <SpotifyPlayer />
            </div>
        </MusicProvider>
    );
}
