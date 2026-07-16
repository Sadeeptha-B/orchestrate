import type { ReactNode } from 'react';
import { Button } from './Button';
import type { AccountMismatch } from '../../hooks/useAccountFingerprint';
import type { ExternalAccountRef } from '../../types';

interface AccountMismatchBannerProps {
    /** Integration name — renders as "<provider> account changed." */
    provider: string;
    mismatch: AccountMismatch;
    /** Lead-in for the stored fingerprint, e.g. "These habits were synced against". */
    intro: string;
    /** What is paused while the gate holds (rendered after the account comparison). */
    paused: string;
    /** Optional smaller how-to-resolve line. */
    guidance?: ReactNode;
    onAdopt: () => void;
}

const label = (ref: ExternalAccountRef) => ref.email ?? ref.id;

/**
 * v7.11: the red "account changed" notice shown wherever a fingerprint mismatch has paused
 * auto-writes (Habits page for Todoist, Settings for Google). One component so both
 * integrations present the gate — and its only write path, the adopt action — identically.
 */
export function AccountMismatchBanner({
    provider, mismatch, intro, paused, guidance, onAdopt,
}: AccountMismatchBannerProps) {
    return (
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 space-y-2.5">
            <div className="text-sm">
                <strong>{provider} account changed.</strong> {intro}{' '}
                <strong>{label(mismatch.stored)}</strong>, but the connected account is{' '}
                <strong>{label(mismatch.current)}</strong>. {paused}
            </div>
            {guidance && <div className="text-xs text-text-light">{guidance}</div>}
            <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={onAdopt}>
                    Use {mismatch.current.email ?? 'this account'} from now on
                </Button>
            </div>
        </div>
    );
}
