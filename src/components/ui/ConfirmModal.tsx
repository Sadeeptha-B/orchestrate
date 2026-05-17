import { type ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmModalProps {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void | Promise<void>;
    title: string;
    children: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
}

export function ConfirmModal({
    open,
    onClose,
    onConfirm,
    title,
    children,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
}: ConfirmModalProps) {
    return (
        <Modal open={open} onClose={onClose} title={title}>
            {children}
            <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={onClose}>
                    {cancelLabel}
                </Button>
                <Button
                    size="sm"
                    onClick={async () => {
                        onClose();
                        await onConfirm();
                    }}
                >
                    {confirmLabel}
                </Button>
            </div>
        </Modal>
    );
}
