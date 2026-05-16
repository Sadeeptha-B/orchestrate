import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './Modal';
import { ThemeToggle } from './ThemeToggle';
import { AboutContent } from './AboutContent';

/**
 * v6: shared top-right control cluster — About (?), Settings (⚙), ThemeToggle — plus the
 * About modal. Owns its own modal state so it can be dropped into any shell
 * (LifeShell, UserGuide, future read-only routes) without further wiring.
 *
 * Settings now navigates to /settings instead of opening a modal.
 */
export function HeaderControls() {
    const navigate = useNavigate();
    const [showAbout, setShowAbout] = useState(false);

    return (
        <>
            <div className="flex items-center gap-1.5">
                <button
                    onClick={() => setShowAbout(true)}
                    className="p-1.5 rounded-lg text-text-light hover:bg-surface-dark transition-colors cursor-pointer text-sm"
                    title="About Orchestrate"
                >
                    ?
                </button>
                <button
                    onClick={() => navigate('/settings')}
                    className="p-1.5 rounded-lg text-text-light hover:bg-surface-dark transition-colors cursor-pointer text-sm"
                    title="Settings"
                >
                    ⚙
                </button>
                <ThemeToggle />
            </div>

            <Modal open={showAbout} onClose={() => setShowAbout(false)} title="About Orchestrate">
                <AboutContent
                    onOpenGuide={() => {
                        setShowAbout(false);
                        navigate('/guide');
                    }}
                />
            </Modal>
        </>
    );
}
