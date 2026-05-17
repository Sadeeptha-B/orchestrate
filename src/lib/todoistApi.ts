// In dev, route through the Vite proxy to dodge CORS; in prod, hit Todoist directly.
export const API_BASE = import.meta.env.DEV
    ? '/api/todoist/api/v1'
    : 'https://api.todoist.com/api/v1';

/** Validate a Todoist API token by hitting the projects endpoint. */
export async function validateTodoistToken(token: string): Promise<boolean> {
    try {
        const res = await fetch(`${API_BASE}/projects`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            console.warn(`Todoist token validation failed: ${res.status} ${res.statusText}`);
        }
        return res.ok;
    } catch (err) {
        console.error('Todoist token validation error:', err);
        return false;
    }
}
