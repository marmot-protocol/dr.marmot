import { RELAY_TIMEOUT_MS } from './config.js';

/**
 * Query a relay for specific Nostr event kinds for a given pubkey.
 * Coordinates relay subscriptions, timeouts, and aggregates results.
 *
 * @param {Object} pool - Relay pool instance (e.g. nostr-tools SimplePool) with subscribeMany/close
 * @param {string} relayUrl - WebSocket relay URL (wss:// or ws://)
 * @param {string} pubkey - 64-char hex public key
 * @param {number[]} kinds - Array of Nostr event kinds to query (e.g. [0, 3, 10051])
 * @returns {Promise<Object>} Resolves with results object keyed by kind (value is event or null).
 *   Never rejects; returns empty results on error or timeout.
 */
export function queryRelayForKinds(pool, relayUrl, pubkey, kinds) {
    return new Promise((resolve) => {
        const results = {};
        for (const k of kinds) results[k] = null;

        let isDone = false;
        let timeoutId;

        try {
            const sub = pool.subscribeMany([relayUrl], { authors: [pubkey], kinds }, {
                onevent(ev) {
                    if (!results[ev.kind] || ev.created_at > results[ev.kind].created_at) {
                        results[ev.kind] = ev;
                    }
                },
                oneose() {
                    if (isDone) return;
                    isDone = true;
                    clearTimeout(timeoutId);
                    try {
                        sub.close();
                    } catch (e) {
                        console.error('Failed to close subscription', e);
                    }
                    resolve(results);
                },
            });
            timeoutId = setTimeout(() => {
                if (isDone) return;
                isDone = true;
                try {
                    sub.close();
                } catch (e) {
                    console.error('Failed to close subscription', e);
                }
                resolve(results);
            }, RELAY_TIMEOUT_MS);
        } catch (e) {
            console.error('Failed to query relay for kinds', e);
            resolve(results);
        }
    });
}
