import { Modal } from '../ui/Modal';
import { TodoistSetup } from '../todoist/TodoistSetup';
import { DataManagement } from './DataManagement';

interface SettingsModalProps {
    open: boolean;
    onClose: () => void;
    /** Optional handler to surface the Saved Sessions sidebar after an import. */
    onShowSavedSessions?: () => void;
}

export function SettingsModal({ open, onClose, onShowSavedSessions }: SettingsModalProps) {
    return (
        <Modal open={open} onClose={onClose} title="Settings">
            <div className="space-y-6">
                <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-text uppercase tracking-wider">
                        Integrations
                    </h3>
                    <TodoistSetup />
                </section>
                <section className="space-y-3 pt-5 border-t border-border">
                    <h3 className="text-sm font-semibold text-text uppercase tracking-wider">
                        Data
                    </h3>
                    <DataManagement onShowSavedSessions={onShowSavedSessions} />
                </section>
            </div>
        </Modal>
    );
}
