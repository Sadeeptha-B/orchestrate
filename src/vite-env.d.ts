/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** OAuth client ID for the Google Calendar (GIS) integration. May be empty when unconfigured. */
    readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
