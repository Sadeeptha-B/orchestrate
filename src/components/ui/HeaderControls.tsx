import { useEffect, useState, type MutableRefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from './Modal';
import { ThemeToggle } from './ThemeToggle';
import { AboutContent } from './AboutContent';
import { HabitSyncChip } from './HabitSyncChip';

interface HeaderControlsProps {
    /** Populate this ref with a function that opens the About modal from outside. */
    aboutTriggerRef?: MutableRefObject<(() => void) | null>;
}

/**
 * Shared top-right control cluster — About (?), Settings (⚙), ThemeToggle — plus the
 * About modal with a Settings integration hint. Owns its own modal state so it can be
 * dropped into any shell without further wiring.
 *
 * Every page should render this component (or compose around it) so the three controls
 * are always available. Pages may pass page-specific buttons alongside as siblings.
 */
export function HeaderControls({ aboutTriggerRef }: HeaderControlsProps) {
    const navigate = useNavigate();
    const [showAbout, setShowAbout] = useState(false);

    // Expose the trigger so external elements (e.g. Welcome's "Learn" link) can open About.
    // Assignment runs in an effect — mutating refs during render is a react-hooks/refs violation.
    useEffect(() => {
        if (!aboutTriggerRef) return;
        aboutTriggerRef.current = () => setShowAbout(true);
        return () => {
            aboutTriggerRef.current = null;
        };
    }, [aboutTriggerRef]);

    return (
        <>
            <div className="flex items-center gap-1.5">
                <HabitSyncChip />
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
                <p className="text-xs pt-1 border-t border-border mt-3 text-text-light">
                    Orchestrate plans from your Todoist tasks (required) and works best with Google
                    Calendar connected. Manage both in{' '}
                    <button
                        onClick={() => { setShowAbout(false); navigate('/settings?tab=integrations'); }}
                        className="text-accent hover:underline cursor-pointer"
                    >
                        Settings
                    </button>
                    .
                </p>
            </Modal>
        </>
    );
}
