import { useCallback, useEffect, useMemo } from 'react';
import { useDayPlan } from './useDayPlan';
import type { ExternalAccountRef } from '../types';

/**
 * v7.11: the connected external account differs from the account this store's registry was
 * minted against (the fingerprint in settings). All auto-writes into that account are gated
 * off while set — the user resolves it by adopting the current account or reconnecting the
 * original.
 */
export interface AccountMismatch {
    /** The fingerprint stamped in settings — the account the registry belongs to. */
    stored: ExternalAccountRef;
    /** The account currently connected. */
    current: ExternalAccountRef;
}

/**
 * The write gate's answer, per render:
 * - `'ok'` — no fingerprint (legacy/fresh store; it will be stamped on connect), a matching
 *   account, or a *failed* identity fetch (documented degrade-to-ungated).
 * - `'wait'` — a fingerprint is stored but the live identity hasn't settled yet; never write
 *   while the verdict is out (a write must not race the identity fetch).
 * - `'blocked'` — the live identity disagrees with the fingerprint; writing would mint
 *   side-effects in the wrong account.
 */
export type FingerprintVerdict = 'ok' | 'wait' | 'blocked';

/** Pure verdict — shared by the provider gates and `useSyncHabit`'s direct-caller guard. */
export function fingerprintVerdict(args: {
    stored: ExternalAccountRef | undefined;
    currentId: string | null;
    resolved: boolean;
}): FingerprintVerdict {
    const { stored, currentId, resolved } = args;
    if (!stored) return 'ok';
    if (!resolved) return 'wait';
    if (currentId && stored.id !== currentId) return 'blocked';
    return 'ok';
}

/**
 * The account-fingerprint cycle, shared by both integrations (Todoist:
 * `ReconciliationProvider`; Google: `GoogleCalendarProvider`):
 *
 * 1. **Stamp when absent** — the first time a connected account's identity is known and no
 *    fingerprint is stored, stamp it silently (settings ride sync + backups, so the stamp
 *    travels with the data it describes).
 * 2. **Compare** — expose the mismatch (for banners) and the write `verdict` (for gates).
 * 3. **Adopt** — an explicit action re-stamping the current account, the only write path out
 *    of a mismatch besides reconnecting the original account.
 *
 * `current` should be memoized by the caller; `resolved` marks the identity fetch as settled
 * (for Google the identity *is* the loaded calendar list, so pass `current !== null`).
 */
export function useAccountFingerprint(args: {
    key: 'todoistAccount' | 'googleAccount';
    current: ExternalAccountRef | null;
    resolved: boolean;
    connected: boolean;
}): {
    stored: ExternalAccountRef | undefined;
    mismatch: AccountMismatch | null;
    verdict: FingerprintVerdict;
    adoptCurrentAccount: () => void;
} {
    const { key, current, resolved, connected } = args;
    const { settings, dispatch } = useDayPlan();
    const stored = settings[key];

    useEffect(() => {
        if (!connected || !current || stored) return;
        dispatch({ type: 'UPDATE_SETTINGS', settings: { [key]: current } });
    }, [connected, current, stored, dispatch, key]);

    const mismatch = useMemo<AccountMismatch | null>(() => {
        if (!current || !stored || stored.id === current.id) return null;
        return { stored, current };
    }, [current, stored]);

    const adoptCurrentAccount = useCallback(() => {
        if (!current) return;
        dispatch({ type: 'UPDATE_SETTINGS', settings: { [key]: current } });
    }, [current, dispatch, key]);

    return {
        stored,
        mismatch,
        verdict: fingerprintVerdict({ stored, currentId: current?.id ?? null, resolved }),
        adoptCurrentAccount,
    };
}
