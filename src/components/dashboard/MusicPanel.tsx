import { playlists } from '../../data/playlists';
import { useDayPlan } from '../../context/DayPlanContext';
import { useState, useCallback, createContext, useContext, type ReactNode } from 'react';

const ACTIVE_PLAYLIST_KEY = 'orchestrate-active-playlist';
const CUSTOM_URLS_KEY = 'orchestrate-custom-playlist-urls';

function loadActivePlaylist(): string {
    try {
        const stored = localStorage.getItem(ACTIVE_PLAYLIST_KEY);
        if (stored && playlists.some((p) => p.id === stored)) return stored;
    } catch { /* ignore */ }
    return 'start-work';
}

function loadCustomUrls(): Record<string, string> {
    try {
        const raw = localStorage.getItem(CUSTOM_URLS_KEY);
        if (raw) return JSON.parse(raw) as Record<string, string>;
    } catch { /* ignore */ }
    return {};
}

function saveCustomUrls(urls: Record<string, string>) {
    try { localStorage.setItem(CUSTOM_URLS_KEY, JSON.stringify(urls)); } catch { /* ignore */ }
}

/** Extract the Spotify playlist ID from an open.spotify.com URL */
function spotifyPlaylistId(url: string): string {
    const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
    return match?.[1] ?? '';
}

function isValidSpotifyUrl(url: string): boolean {
    return /^https:\/\/open\.spotify\.com\/playlist\/[a-zA-Z0-9]+/.test(url.trim());
}

// Shared state context for playlist selection
interface MusicState {
    activeId: string;
    setActiveId: (id: string) => void;
    suggestedId: string | undefined;
    customUrls: Record<string, string>;
    setCustomUrl: (playlistId: string, url: string) => void;
    resolveUrl: (playlistId: string) => string;
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
    const [customUrls, setCustomUrls] = useState<Record<string, string>>(loadCustomUrls);

    const setActiveId = useCallback((id: string) => {
        setActiveIdRaw(id);
        try { localStorage.setItem(ACTIVE_PLAYLIST_KEY, id); } catch { /* ignore */ }
    }, []);

    const setCustomUrl = useCallback((playlistId: string, url: string) => {
        setCustomUrls((prev) => {
            const next = { ...prev };
            const trimmed = url.trim();
            if (!trimmed || !isValidSpotifyUrl(trimmed)) {
                delete next[playlistId];
            } else {
                next[playlistId] = trimmed;
            }
            saveCustomUrls(next);
            return next;
        });
    }, []);

    const resolveUrl = useCallback((playlistId: string) => {
        if (customUrls[playlistId]) return customUrls[playlistId];
        return playlists.find((p) => p.id === playlistId)?.spotifyUrl ?? '';
    }, [customUrls]);

    const lastCheckIn = plan.checkIns[plan.checkIns.length - 1];
    const suggestedId = lastCheckIn?.playlistSuggested;

    return (
        <MusicContext.Provider value={{ activeId, setActiveId, suggestedId, customUrls, setCustomUrl, resolveUrl }}>
            {children}
        </MusicContext.Provider>
    );
}

export function PlaylistSelector() {
    const { activeId, setActiveId, suggestedId, customUrls } = useMusicState();

    return (
        <div className="flex gap-2 flex-wrap">
            {playlists.map((pl) => {
                const isActive = activeId === pl.id;
                const isSuggested = suggestedId === pl.id;
                const isCustom = !!customUrls[pl.id];

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
                        {isCustom && (
                            <span className="w-1.5 h-1.5 rounded-full bg-accent/60 flex-shrink-0" title="Custom playlist" />
                        )}
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
    const { activeId, resolveUrl, customUrls, setCustomUrl } = useMusicState();
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState('');

    const activePl = playlists.find((p) => p.id === activeId) ?? playlists[0];
    const resolvedUrl = resolveUrl(activeId);
    const activeSpId = spotifyPlaylistId(resolvedUrl);
    const isCustom = !!customUrls[activeId];

    const startEditing = () => {
        setEditValue(isCustom ? customUrls[activeId] : '');
        setEditing(true);
    };

    const commitEdit = () => {
        setCustomUrl(activeId, editValue);
        setEditing(false);
    };

    if (!activeSpId) return null;

    return (
        <div className="rounded-lg border border-border overflow-hidden bg-black/5">
            <iframe
                key={activeSpId}
                src={`https://open.spotify.com/embed/playlist/${activeSpId}?utm_source=generator&theme=0`}
                width="100%"
                height="152"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
                className="block"
                title={`${activePl.name} Spotify player`}
            />
            <div className="px-3 py-1.5">
                {editing ? (
                    <div className="flex items-center gap-2">
                        <input
                            type="url"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
                            placeholder={activePl.spotifyUrl}
                            className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-border bg-card text-text focus:outline-none focus:ring-1 focus:ring-accent/30 focus:border-accent transition-colors"
                            autoFocus
                        />
                        <button
                            onClick={commitEdit}
                            className="text-[11px] text-accent hover:text-accent/80 transition-colors cursor-pointer flex-shrink-0"
                        >
                            Save
                        </button>
                        <button
                            onClick={() => setEditing(false)}
                            className="text-[11px] text-text-light hover:text-text transition-colors cursor-pointer flex-shrink-0"
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-text-light">
                            {activePl.name} — {activePl.description}
                            {isCustom && <span className="ml-1.5 text-accent/60">(custom)</span>}
                        </span>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                            <button
                                onClick={startEditing}
                                className="text-[11px] text-text-light hover:text-accent transition-colors cursor-pointer"
                                title="Use your own Spotify playlist URL"
                            >
                                Edit URL
                            </button>
                            <a
                                href={`spotify:playlist:${activeSpId}`}
                                className="text-[11px] text-text-light hover:text-accent transition-colors"
                            >
                                Open in Spotify app &rarr;
                            </a>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
