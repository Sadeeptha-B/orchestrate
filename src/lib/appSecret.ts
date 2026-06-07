// The single shared secret guarding every Cloudflare Worker endpoint — both the Google OAuth flow
// (functions/api/auth/google/*) and the Todoist proxy (functions/api/todoist*). Entered once in
// Settings, stored on this device, and sent as the `X-App-Secret` header on each request. Must equal
// the Worker's `APP_SHARED_SECRET`.

const SECRET_KEY = 'orchestrate-cf-secret';
const listeners = new Set<() => void>();

function notifyListeners(): void {
    listeners.forEach((listener) => listener());
}

export function getStoredSecret(): string {
    try {
        return localStorage.getItem(SECRET_KEY) ?? '';
    } catch {
        return '';
    }
}

export function setStoredSecret(secret: string): void {
    try {
        if (secret) localStorage.setItem(SECRET_KEY, secret);
        else localStorage.removeItem(SECRET_KEY);
    } catch {
        // ignore storage failures (private mode, etc.)
    }
    notifyListeners();
}

export function hasStoredSecret(): boolean {
    return getStoredSecret().length > 0;
}

export function subscribeToStoredSecret(listener: () => void): () => void {
    listeners.add(listener);

    if (typeof window === 'undefined') {
        return () => {
            listeners.delete(listener);
        };
    }

    const handleStorage = (event: StorageEvent) => {
        if (event.key === SECRET_KEY) listener();
    };

    window.addEventListener('storage', handleStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', handleStorage);
    };
}
