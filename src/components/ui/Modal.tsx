import { useEffect, type ReactNode } from 'react';

interface ModalProps {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    title?: string;
}

export function Modal({ open, onClose, children, title }: ModalProps) {
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/30 backdrop-blur-sm"
                onClick={onClose}
                role="button"
                tabIndex={-1}
                aria-label="Close modal"
            />
            <div className="relative bg-card rounded-xl border border-border shadow-lg max-w-md w-full p-6 animate-in fade-in">
                {title && <h3 className="text-lg font-semibold mb-4">{title}</h3>}
                {children}
            </div>
        </div>
    );
}
