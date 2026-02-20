import { RELAY_TIMEOUT_MS } from './config.js';

export function queryRelayForKinds(pool, relayUrl, pubkey, kinds) {
    return new Promise((resolve) => {
        const results = {};
        for (const k of kinds) results[k] = null;

        try {
            const sub = pool.subscribeMany([relayUrl], { authors: [pubkey], kinds }, {
                onevent(ev) {
                    if (!results[ev.kind] || ev.created_at > results[ev.kind].created_at) {
                        results[ev.kind] = ev;
                    }
                },
                oneose() {
                    sub.close();
                    resolve(results);
                },
            });
            setTimeout(() => { try { sub.close(); } catch (e) { } resolve(results); }, RELAY_TIMEOUT_MS);
        } catch (e) {
            resolve(results);
        }
    });
}
