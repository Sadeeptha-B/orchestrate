import { useTheme } from '../../hooks/useTheme';

interface ThemeToggleProps {
    /** `sm` → p-1.5 (default, used in headers); `md` → p-2 (used on Welcome). */
    size?: 'sm' | 'md';
}

export function ThemeToggle({ size = 'sm' }: ThemeToggleProps) {
    const { theme, toggle } = useTheme();
    const padding = size === 'md' ? 'p-2' : 'p-1.5';
    return (
        <button
            type="button"
            onClick={toggle}
            className={`${padding} rounded-lg text-text-light hover:bg-surface-dark transition-colors cursor-pointer`}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
        >
            {theme === 'dark' ? '☀️' : '🌙'}
        </button>
    );
}
