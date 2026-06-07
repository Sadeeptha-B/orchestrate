// The single shared secret guarding every Cloudflare Worker endpoint — both the Google OAuth flow
// (functions/api/auth/google/*) and the Todoist proxy (functions/api/todoist*). Entered once in
// Settings, stored on this device, and sent as the `X-App-Secret` header on each request. Must equal
// the Worker's `APP_SHARED_SECRET`.

const SECRET_KEY = 'orchestrate-cf-secret';

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
}

export function hasStoredSecret(): boolean {
    return getStoredSecret().length > 0;
}
