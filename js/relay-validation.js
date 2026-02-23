import { MAX_RELAY_URL_LEN } from './config.js';

export function validateRelayUrl(url) {
    if (!url || typeof url !== 'string') return { valid: false, reason: 'empty or not a string' };
    const u = url.trim();
    if (!u) return { valid: false, reason: 'empty after trim' };
    if (u.length > MAX_RELAY_URL_LEN) return { valid: false, reason: 'URL too long' };
    if (u.includes('%20')) return { valid: false, reason: 'URL contains encoded space (%20)' };
    const lower = u.toLowerCase();
    if (!lower.startsWith('ws://') && !lower.startsWith('wss://')) {
        return { valid: false, reason: 'must use ws:// or wss:// scheme' };
    }
    try {
        const parsed = new URL(u);
        if (!parsed.hostname || parsed.hostname.length === 0) {
            return { valid: false, reason: 'missing hostname' };
        }
        if (/\s/.test(parsed.hostname)) {
            return { valid: false, reason: 'hostname contains spaces' };
        }
        if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
            return { valid: false, reason: 'invalid protocol' };
        }
        return { valid: true };
    } catch (e) {
        console.error('Failed to validate relay URL', e);
        return { valid: false, reason: 'malformed URL' };
    }
}

export function isValidRelayUrl(url) {
    return validateRelayUrl(url).valid;
}
