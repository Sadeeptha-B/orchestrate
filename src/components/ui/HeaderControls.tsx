import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './Modal';
import { ThemeToggle } from './ThemeToggle';
import { AboutContent } from './AboutContent';
import { SettingsModal } from '../settings/SettingsModal';

interface HeaderControlsProps {
    /**
     * Optional handler for the "Open Saved Sessions →" hint inside SettingsModal after a
     * sessions import. When omitted (default), we navigate to /setup with `fromWelcome: true`
     * so the saved-sessions sidebar (which lives in the Wizard chrome) becomes reachable.
     */
    onShowSavedSessions?: () => void;
}

/**
 * v6: shared top-right control cluster — About (?), Settings (⚙), ThemeToggle — plus the
 * About and Settings modals. Owns its own modal state so it can be dropped into any shell
 * (LifeShell, UserGuide, future read-only routes) without further wiring.
 *
 * Dashboard, Welcome, and WizardLayout still inline their own Settings/About wiring because
 * they have surface-specific behaviors (saved-sessions sidebar toggle, modal-to-modal
 * navigation). Don't replace those without checking the call sites.
 */
export function HeaderControls({ onShowSavedSessions }: HeaderControlsProps = {}) {
    const navigate = useNavigate();
    const [showAbout, setShowAbout] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    const defaultShowSavedSessions = () => {
        setShowSettings(false);
        navigate('/setup', { state: { fromWelcome: true } });
    };

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
                    onClick={() => setShowSettings(true)}
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

            <SettingsModal
                open={showSettings}
                onClose={() => setShowSettings(false)}
                onShowSavedSessions={onShowSavedSessions ?? defaultShowSavedSessions}
            />
        </>
    );
}
