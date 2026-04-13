import { useNavigate } from 'react-router-dom';
import { WizardLayout } from './WizardLayout';
import { useDayPlan } from '../../context/DayPlanContext';
import { playlists } from '../../data/playlists';

/** Extract the Spotify playlist ID from an open.spotify.com URL */
function spotifyPlaylistId(url: string): string {
    const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
    return match?.[1] ?? '';
}

export function Step5StartMusic() {
    const { plan, editingStep, dispatch } = useDayPlan();
    const navigate = useNavigate();
    const startPlaylist = playlists.find((p) => p.id === 'start-work')!;
    const spId = spotifyPlaylistId(startPlaylist.spotifyUrl);
    const canSkip = editingStep !== null || plan.setupComplete;

    const finish = () => {
        if (!plan.setupComplete) dispatch({ type: 'COMPLETE_SETUP' });
        dispatch({ type: 'SET_EDITING_STEP', step: null });
        navigate('/');
    };

    return (
        <WizardLayout hideNext>
            <div className="space-y-6 mt-4">
                <div>
                    <h2 className="text-2xl font-semibold mb-2">You're ready to start</h2>
                    <p className="text-text-light text-sm">
                        Kick off your session with the Start Work playlist. Play it for 5–10 minutes to
                        overcome inertia, then switch to a task-specific playlist from the dashboard.
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

                    <div className="px-5 pb-5 flex items-center justify-between">
                        <a
                            href={`spotify:playlist:${spId}`}
                            className="text-xs text-text-light hover:text-accent transition-colors"
                        >
                            Open in Spotify app &rarr;
                        </a>
                        <button
                            onClick={finish}
                            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors cursor-pointer text-sm"
                        >
                            <span>Go to Dashboard</span>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                        </button>
                    </div>
                </div>

                <button
                    onClick={finish}
                    className="w-full text-center text-sm text-text-light hover:text-accent transition-colors cursor-pointer"
                >
                    {canSkip ? 'Back to dashboard' : 'Skip and go to dashboard'}
                </button>

                <div className="bg-surface-dark rounded-lg p-4 text-xs text-text-light space-y-2">
                    <p className="font-medium text-text">Music Protocol Tips</p>
                    <ul className="space-y-1 list-disc list-inside">
                        <li>Start Work playlist is just a ramp — switch after 5–10 min</li>
                        <li>Coding → Deep Focus &nbsp;|&nbsp; Lectures → Lo-Fi Beats</li>
                        <li>Restless → Brain Food &nbsp;|&nbsp; Low energy → Peaceful Piano</li>
                        <li>Turn music off for deep reading or when fully locked in</li>
                    </ul>
                </div>
            </div>
        </WizardLayout>
    );
}
