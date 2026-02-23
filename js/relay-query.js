import { RELAY_TIMEOUT_MS } from './config.js';

export function queryRelayForKinds(pool, relayUrl, pubkey, kinds) {
    return new Promise((resolve) => {
        const results = {};
        for (const k of kinds) results[k] = null;

        let done = false;
        let timeoutId;

        try {
            const sub = pool.subscribeMany([relayUrl], { authors: [pubkey], kinds }, {
                onevent(ev) {
                    if (!results[ev.kind] || ev.created_at > results[ev.kind].created_at) {
                        results[ev.kind] = ev;
                    }
                },
                oneose() {
                    if (done) return;
                    done = true;
                    clearTimeout(timeoutId);
                    sub.close();
                    resolve(results);
                },
            });
            timeoutId = setTimeout(() => {
                if (done) return;
                done = true;
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
