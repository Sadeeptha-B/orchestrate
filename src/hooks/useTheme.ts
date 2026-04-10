import { useCallback, useSyncExternalStore } from 'react';

const THEME_KEY = 'orchestrate-theme';
type Theme = 'light' | 'dark';

function getSnapshot(): Theme {
    return (localStorage.getItem(THEME_KEY) as Theme) || 'light';
}

function getServerSnapshot(): Theme {
    return 'light';
}

function subscribe(callback: () => void): () => void {
    // Listen for changes from other tabs
    const handler = (e: StorageEvent) => {
        if (e.key === THEME_KEY) callback();
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
}

function apply(theme: Theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    // Update meta theme-color for PWA
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#121212' : '#3d9970');
}

// Apply on initial load (before React mounts)
apply(getSnapshot());

export function useTheme() {
    const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const toggle = useCallback(() => {
        const next: Theme = theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(THEME_KEY, next);
        apply(next);
        // Force re-render via storage event workaround
        window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY }));
    }, [theme]);

    return { theme, toggle } as const;
}
