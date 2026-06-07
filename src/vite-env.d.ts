/// <reference types="vite/client" />

// Google Calendar OAuth no longer uses a build-time client ID — the client ID + secret now live
// server-side in the Cloudflare Worker (see functions/api/auth/google). The browser holds only a
// runtime shared secret in localStorage. So there are no app-specific VITE_* env vars to declare.
