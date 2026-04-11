const ALGO = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

function toBase64(buf: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): ArrayBuffer {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
}

export async function encryptToken(
    token: string,
): Promise<{ encrypted: string; iv: string; key: string }> {
    const key = await crypto.subtle.generateKey(
        { name: ALGO, length: KEY_LENGTH },
        true,
        ['encrypt', 'decrypt'],
    );

    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(token);

    const ciphertext = await crypto.subtle.encrypt(
        { name: ALGO, iv },
        key,
        encoded,
    );

    const exportedKey = await crypto.subtle.exportKey('raw', key);

    return {
        encrypted: toBase64(ciphertext),
        iv: toBase64(iv.buffer),
        key: toBase64(exportedKey),
    };
}

export async function decryptToken(
    encrypted: string,
    iv: string,
    keyBase64: string,
): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        fromBase64(keyBase64),
        { name: ALGO, length: KEY_LENGTH },
        false,
        ['decrypt'],
    );

    const plaintext = await crypto.subtle.decrypt(
        { name: ALGO, iv: fromBase64(iv) },
        key,
        fromBase64(encrypted),
    );

    return new TextDecoder().decode(plaintext);
}
