// Processes the Google OAuth callback redirect (`?gcal=connected | error&reason=…`) wherever the
// callback lands — the Settings integrations tab or the onboarding flow. On success it re-checks
// the connection; either way it strips the one-shot params (capturing any error into state first,
// so the message survives the URL cleanup).

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGoogleCalendarActions } from './useGoogleCalendar';

const GCAL_CALLBACK_ERRORS: Record<string, string> = {
    access_denied: 'Google sign-in was cancelled.',
    exchange_failed: 'Google sign-in could not be completed. Please try again.',
    google_unreachable: 'Google could not be reached right now. Please try again shortly.',
    no_code: 'Google sign-in did not return an authorization code.',
    server_not_configured: 'The Cloudflare worker is missing its Google OAuth configuration.',
    state: 'The Google sign-in session expired or was invalid. Please try again.',
    storage_unavailable: 'Cloudflare KV is unavailable right now. Please try again shortly.',
    unauthorized: 'Your session expired during sign-in. Reload the page and try again.',
};

export function useGcalCallback(): { callbackError: string | null } {
    const { checkConnection } = useGoogleCalendarActions();
    const [, setSearchParams] = useSearchParams();

    // The redirect lands on a fresh mount, so capture the one-shot params at first render — the
    // error message then survives the URL cleanup below without a cascading setState.
    const [callback] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        const gcal = params.get('gcal');
        return gcal ? { gcal, reason: params.get('reason') ?? '' } : null;
    });
    const handledRef = useRef(false);

    useEffect(() => {
        if (!callback || handledRef.current) return;
        handledRef.current = true;

        if (callback.gcal === 'connected') void checkConnection();
        // Strip the one-shot params so a refresh doesn't re-trigger.
        const next = new URLSearchParams(window.location.search);
        if (next.has('gcal')) {
            next.delete('gcal');
            next.delete('reason');
            setSearchParams(next, { replace: true });
        }
    }, [callback, setSearchParams, checkConnection]);

    const callbackError = callback?.gcal === 'error'
        ? (GCAL_CALLBACK_ERRORS[callback.reason] ?? 'Sign-in failed. Please try connecting again.')
        : null;
    return { callbackError };
}
