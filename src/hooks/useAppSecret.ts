import { useSyncExternalStore } from 'react';
import { getStoredSecret, subscribeToStoredSecret } from '../lib/appSecret';

export function useAppSecret() {
    const secret = useSyncExternalStore(subscribeToStoredSecret, getStoredSecret, () => '');
    return { secret, hasSecret: secret.length > 0 };
}