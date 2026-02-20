export const CIPHERSUITE_I_TAG_LEN = {
    '0x0001': 64, '0x0002': 64, '0x0003': 64,
    '0x0004': 128, '0x0005': 128, '0x0006': 128,
    '0x0007': 96,
};

export const VALID_CIPHERSUITES = new Set(Object.keys(CIPHERSUITE_I_TAG_LEN));
export const DEFAULT_EXTENSIONS = new Set(['0x0001', '0x0002', '0x0003', '0x0004', '0x0005']);

export function isValidBase64(str) {
    if (!str || typeof str !== 'string') return false;
    try {
        const decoded = atob(str.replace(/\s/g, ''));
        return decoded.length > 0;
    } catch {
        return false;
    }
}

export function pubkeyToHex(pubkey) {
    if (typeof pubkey === 'string' && /^[0-9a-f]{64}$/i.test(pubkey)) return pubkey.toLowerCase();
    if (pubkey instanceof Uint8Array && pubkey.length === 32) {
        return Array.from(pubkey).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (Array.isArray(pubkey) && pubkey.length === 32) {
        return pubkey.map(b => (b & 0xff).toString(16).padStart(2, '0')).join('');
    }
    return null;
}

export async function verifyNip05(nip05, pubkey) {
    const hex = pubkeyToHex(pubkey);
    if (!hex) return { verified: false, reason: 'invalid pubkey' };
    const match = nip05.trim().match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
    if (!match) return { verified: false, reason: 'format invalid' };
    const [, localPart, domain] = match;
    const name = localPart.toLowerCase();
    let url;
    try {
        url = new URL(`https://${domain}/.well-known/nostr.json`);
        url.searchParams.set('name', name);
    } catch {
        return { verified: false, reason: 'invalid domain' };
    }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    try {
        const res = await fetch(url.toString(), { method: 'GET', signal: ac.signal });
        if (!res.ok) return { verified: false, reason: `HTTP ${res.status}` };
        const body = await res.json();
        const names = body?.names;
        if (!names || typeof names !== 'object') return { verified: false, reason: 'no names in response' };
        const resolved = names[name] ?? names[localPart] ?? names[nip05.trim().toLowerCase()] ?? names[`${name}@${domain}`];
        if (!resolved || typeof resolved !== 'string') return { verified: false, reason: 'identifier not found' };
        const cleanResolved = resolved.length === 64 && /^[0-9a-f]+$/i.test(resolved) ? resolved.toLowerCase() : null;
        if (!cleanResolved) return { verified: false, reason: 'invalid pubkey in response' };
        return { verified: cleanResolved === hex, reason: cleanResolved !== hex ? 'pubkey mismatch' : undefined };
    } catch (e) {
        if (e.name === 'AbortError') return { verified: false, reason: 'timeout' };
        if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError')) {
            return { verified: false, reason: 'network/CORS' };
        }
        return { verified: false, reason: e.message || 'fetch failed' };
    } finally {
        clearTimeout(t);
    }
}

export function validateKeyPackageIRef(val, ciphersuite) {
    if (!val || typeof val !== 'string') return { valid: false, reason: 'empty or not a string' };
    const s = val.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(s)) return { valid: false, reason: 'i tag must be hex-only' };
    const expectedLen = ciphersuite ? CIPHERSUITE_I_TAG_LEN[ciphersuite] : null;
    if (expectedLen != null && s.length !== expectedLen) {
        return { valid: false, reason: `i tag length ${s.length} ≠ ${expectedLen} for ciphersuite ${ciphersuite}` };
    }
    return { valid: true };
}
