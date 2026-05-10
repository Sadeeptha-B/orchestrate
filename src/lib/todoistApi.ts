// In dev, route through the Vite proxy to dodge CORS; in prod, hit Todoist directly.
export const API_BASE = import.meta.env.DEV
    ? '/api/todoist/api/v1'
    : 'https://api.todoist.com/api/v1';
