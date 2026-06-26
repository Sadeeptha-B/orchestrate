import { useNavigate } from 'react-router-dom';
import { WizardLayout } from './WizardLayout';
import { useDayPlan } from '../../hooks/useDayPlan';
import { playlists } from '../../data/playlists';
import { spotifyPlaylistId } from '../../lib/spotify';

/**
 * Closing wizard step. A calm "your day is ready" hand-off with the Start Work playlist
 * as a ramp-in on-ramp — so the user can ease in rather than be dumped straight onto the
 * dashboard. Primary launch into the dashboard, secondary jump into Focus Mode.
 */
export function Step5Launch() {
    const { plan, editingStep, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const isEditing = editingStep !== null || plan.setupComplete;
    const startPlaylist = playlists.find((p) => p.id === 'start-work') ?? playlists[0];
    const spId = spotifyPlaylistId(startPlaylist.spotifyUrl);

    const finish = (to: string) => {
        if (!plan.setupComplete) dispatch({ type: 'COMPLETE_SETUP' });
        dispatch({ type: 'SET_EDITING_STEP', step: null });
        navigate(to);
    };

    return (
        <WizardLayout hideNext>
            <div className="space-y-6 mt-4">
                <div>
                    <h2 className="text-2xl font-semibold mb-2 flex items-center gap-2">
                        <span aria-hidden>✓</span>
                        Your day is ready
                    </h2>
                    <p className="text-text-light text-sm">
                        {isEditing
                            ? 'Your plan is updated. Head back to the dashboard, or drop straight into Focus Mode.'
                            : 'Everything\'s in place. Ease in with the Start Work playlist, then head to the dashboard or drop straight into Focus Mode for your first session.'}
                    </p>
                </div>

                <div className="bg-card rounded-xl border border-border overflow-hidden">
                    <div className="p-5 pb-3 text-center">
                        <div className="text-4xl mb-2">{startPlaylist.emoji}</div>
                        <h3 className="font-semibold">{startPlaylist.name}</h3>
                        <p className="text-sm text-text-light mt-1">{startPlaylist.description}</p>
                    </div>

                    {/* Embedded Spotify player */}
                    {spId && (
                        <div className="px-4 pb-3">
                            <iframe
                                src={`https://open.spotify.com/embed/playlist/${spId}?utm_source=generator&theme=0`}
                                width="100%"
                                height="152"
                                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                                loading="lazy"
                                className="rounded-lg block"
                                title={`${startPlaylist.name} Spotify player`}
                            />
                        </div>
                    )}

                    <div className="px-5 pb-4">
                        <a
                            href={`spotify:playlist:${spId}`}
                            className="text-xs text-text-light hover:text-accent transition-colors"
                        >
                            Open in Spotify app &rarr;
                        </a>
                    </div>
                </div>

                <div className="flex flex-col items-center gap-3">
                    <button
                        onClick={() => finish('/')}
                        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors cursor-pointer text-sm"
                    >
                        <span>Go to Dashboard</span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                    </button>
                    <button
                        onClick={() => finish('/focus')}
                        className="text-sm text-text-light hover:text-accent transition-colors cursor-pointer"
                    >
                        ◎ Enter Focus Mode →
                    </button>
                </div>
            </div>
        </WizardLayout>
    );
}
