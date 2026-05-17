import { useState, useCallback } from 'react';

/**
 * Hook that manages the state for a confirm modal. Returns the state value,
 * a setter to open the modal, and a close handler.
 */
export function useConfirmModal<T>(): {
    value: T | null;
    open: (v: T) => void;
    close: () => void;
} {
    const [value, setValue] = useState<T | null>(null);
    const open = useCallback((v: T) => setValue(v), []);
    const close = useCallback(() => setValue(null), []);
    return { value, open, close };
}
