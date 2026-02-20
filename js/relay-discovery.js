import { validateRelayUrl } from './relay-validation.js';

export function extractUserRelays(events) {
    const seen = new Set();
    const invalidSeen = new Set();
    const urls = [];
    const invalid = [];

    function add(url) {
        if (!url || typeof url !== 'string') return;
        const u = url.trim();
        const v = validateRelayUrl(u);
        if (!v.valid) {
            const key = u.toLowerCase();
            if (invalidSeen.has(key)) return;
            invalidSeen.add(key);
            invalid.push({ url: u.slice(0, 60) + (u.length > 60 ? '…' : ''), reason: v.reason });
            return;
        }
        const key = u.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        urls.push(u);
    }

    for (const ev of events) {
        if (!ev?.tags) continue;
        if (ev.kind === 3) {
            for (const t of ev.tags) if (t[0] === 'relay' && t[1]) add(t[1]);
        } else if (ev.kind === 10002) {
            for (const t of ev.tags) if (t[0] === 'r' && t[1]) add(t[1]);
        } else if (ev.kind === 10051) {
            for (const t of ev.tags) if (t[0] === 'relay' && t[1]) add(t[1]);
        }
    }
    return { urls, invalid };
}
