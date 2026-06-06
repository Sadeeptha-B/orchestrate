import { useState, type ReactNode } from 'react';

interface CollapsibleSectionProps {
    /** Uppercase disclosure label shown next to the chevron. */
    title: string;
    /** Whether the section starts expanded (default: collapsed). */
    defaultOpen?: boolean;
    /** Rendered only while open — pass content with its own top margin. */
    children: ReactNode;
}

/**
 * Shared disclosure: a chevron + uppercase label that toggles its children. Used for the
 * dashboard Task Manager / Calendar panels and the Focus Mode music panel so the trigger
 * markup lives in one place.
 */
export function CollapsibleSection({ title, defaultOpen = false, children }: CollapsibleSectionProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div>
            <button
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-2 text-sm font-semibold text-text-light uppercase tracking-wider hover:text-accent transition-colors cursor-pointer"
            >
                <svg
                    className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                {title}
            </button>
            {open && children}
        </div>
    );
}
