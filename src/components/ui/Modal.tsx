import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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

    // Portal to <body> so the overlay can't inherit an ancestor's `opacity`/transform (e.g. a
    // past-session card rendered at opacity-50), which would otherwise grey out the whole modal.
    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/30 backdrop-blur-sm"
                onClick={onClose}
                role="button"
                tabIndex={-1}
                aria-label="Close modal"
            />
            <div className="relative bg-card rounded-xl border border-border shadow-lg max-w-md w-full max-h-[calc(100vh-2rem)] flex flex-col animate-in fade-in">
                <button
                    onClick={onClose}
                    className="absolute top-3 right-3 z-10 text-text-light hover:text-text transition-colors cursor-pointer text-lg leading-none"
                    aria-label="Close"
                >
                    ✕
                </button>
                {title && (
                    <h3 className="text-lg font-semibold px-6 pt-6 pb-3 pr-12 flex-shrink-0">
                        {title}
                    </h3>
                )}
                <div className={`px-6 overflow-y-auto scrollbar-subtle ${title ? 'pb-6' : 'py-6'}`}>
                    {children}
                </div>
            </div>
        </div>,
        document.body,
    );
}
