/**
 * Relay health diagnostics.
 * Tests: WebSocket connectivity + latency, NIP-11 info, read latency (REQ→EOSE).
 */

import { fetchNip11, formatNip11Summary } from './nip11.js';

const WS_CONNECT_TIMEOUT_MS = 8000;
const READ_TEST_TIMEOUT_MS = 6000;

/**
 * @typedef {Object} HealthResult
 * @property {string} url - Relay URL
 * @property {'ok'|'warn'|'dead'} status - Overall health status
 * @property {number|null} connectMs - WS connect latency (ms) or null if failed
 * @property {number|null} readMs - REQ→EOSE latency (ms) or null if not tested
 * @property {Object|null} nip11 - NIP-11 info doc or null
 * @property {string} nip11Summary - Short human-readable NIP-11 summary
 * @property {string|null} error - Error message if connect failed
 */

/**
 * Test WebSocket connectivity and measure connect latency.
 * @param {string} relayUrl
 * @returns {Promise<{ connectMs: number|null, error: string|null, ws: WebSocket|null }>}
 */
function testWsConnect(relayUrl) {
    return new Promise((resolve) => {
        const start = performance.now();
        let resolved = false;
        let timer = null;

        const done = (result) => {
            if (resolved) return;
            resolved = true;
            if (timer != null) clearTimeout(timer);
            resolve(result);
        };

        let ws;
        try {
            ws = new WebSocket(relayUrl);
        } catch (e) {
            done({ connectMs: null, error: e?.message || 'WebSocket constructor failed', ws: null });
            return;
        }

        timer = setTimeout(() => {
            try { ws.close(); } catch { /* ignore */ }
            done({ connectMs: null, error: 'timeout', ws: null });
        }, WS_CONNECT_TIMEOUT_MS);

        ws.onopen = () => {
            const elapsed = Math.round(performance.now() - start);
            done({ connectMs: elapsed, error: null, ws });
        };

        ws.onerror = () => {
            try { ws.close(); } catch { /* ignore */ }
            done({ connectMs: null, error: 'connection failed', ws: null });
        };
    });
}

/**
 * Test read latency by sending a REQ and measuring time to EOSE.
 * Uses a filter guaranteed to return zero events (random author).
 * @param {WebSocket} ws - Open WebSocket connection
 * @returns {Promise<{ readMs: number|null, error: string|null }>}
 */
function testReadLatency(ws) {
    return new Promise((resolve) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            resolve({ readMs: null, error: 'not connected' });
            return;
        }

        const subId = '_health_' + Math.random().toString(36).slice(2, 8);
        const start = performance.now();
        let resolved = false;

        const done = (result) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            ws.removeEventListener('message', onMessage);
            // Send CLOSE for the subscription
            try { ws.send(JSON.stringify(['CLOSE', subId])); } catch { /* ignore */ }
            resolve(result);
        };

        const timer = setTimeout(() => {
            done({ readMs: null, error: 'timeout' });
        }, READ_TEST_TIMEOUT_MS);

        const onMessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (Array.isArray(msg) && msg[1] === subId && msg[0] === 'EOSE') {
                    const elapsed = Math.round(performance.now() - start);
                    done({ readMs: elapsed, error: null });
                }
            } catch { /* ignore parse errors */ }
        };

        ws.addEventListener('message', onMessage);

        // Random hex author that won't match anything
        const fakeAuthor = 'ff'.repeat(32);
        const req = JSON.stringify(['REQ', subId, { authors: [fakeAuthor], kinds: [0], limit: 1 }]);
        try {
            ws.send(req);
        } catch (e) {
            done({ readMs: null, error: e?.message || 'send failed' });
        }
    });
}

/**
 * Run full health diagnostics on a single relay.
 * @param {string} relayUrl
 * @param {function} [onProgress] - Optional callback: (phase: string) => void
 * @returns {Promise<HealthResult>}
 */
export async function checkRelayHealth(relayUrl, onProgress) {
    const result = {
        url: relayUrl,
        status: 'dead',
        connectMs: null,
        readMs: null,
        nip11: null,
        nip11Summary: '',
        error: null,
    };

    // Phase 1: WS connect + NIP-11 in parallel
    onProgress?.('connecting');
    const [wsResult, nip11Result] = await Promise.all([
        testWsConnect(relayUrl),
        fetchNip11(relayUrl),
    ]);

    result.nip11 = nip11Result;
    result.nip11Summary = formatNip11Summary(nip11Result);

    if (wsResult.error) {
        result.error = wsResult.error;
        result.status = 'dead';
        return result;
    }

    result.connectMs = wsResult.connectMs;

    // Phase 2: Read latency test
    onProgress?.('testing');
    const readResult = await testReadLatency(wsResult.ws);
    result.readMs = readResult.readMs;

    // Clean up WebSocket
    try { wsResult.ws.close(); } catch { /* ignore */ }

    // Determine status
    const totalLatency = (result.connectMs || 0) + (result.readMs || 0);
    if (result.connectMs === null) {
        result.status = 'dead';
    } else if (totalLatency > 3000 || result.readMs === null) {
        result.status = 'warn';
    } else if (totalLatency > 1500) {
        result.status = 'warn';
    } else {
        result.status = 'ok';
    }

    return result;
}

/**
 * Run health checks on multiple relays with progress callbacks.
 * @param {string[]} relayUrls
 * @param {function} [onRelayProgress] - (url: string, phase: string) => void
 * @param {function} [onRelayDone] - (result: HealthResult) => void
 * @returns {Promise<Map<string, HealthResult>>}
 */
export async function checkAllRelaysHealth(relayUrls, onRelayProgress, onRelayDone) {
    const results = new Map();

    // Run checks in parallel batches of 4 to avoid overwhelming the browser
    const BATCH_SIZE = 4;
    for (let i = 0; i < relayUrls.length; i += BATCH_SIZE) {
        const batch = relayUrls.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
            batch.map(async (url) => {
                const result = await checkRelayHealth(
                    url,
                    (phase) => onRelayProgress?.(url, phase),
                );
                onRelayDone?.(result);
                return result;
            }),
        );
        for (const r of batchResults) {
            results.set(r.url, r);
        }
    }

    return results;
}

/**
 * Format latency for display.
 * @param {number|null} ms
 * @returns {string}
 */
export function formatLatency(ms) {
    if (ms === null) return '---';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Compute a health score (0–100) from a HealthResult.
 * @param {HealthResult} result
 * @returns {number}
 */
export function healthScore(result) {
    if (result.status === 'dead') return 0;

    let score = 100;

    // Connect latency penalty
    if (result.connectMs !== null) {
        if (result.connectMs > 2000) score -= 40;
        else if (result.connectMs > 1000) score -= 25;
        else if (result.connectMs > 500) score -= 10;
    } else {
        score -= 50;
    }

    // Read latency penalty
    if (result.readMs !== null) {
        if (result.readMs > 2000) score -= 30;
        else if (result.readMs > 1000) score -= 15;
        else if (result.readMs > 500) score -= 5;
    } else {
        score -= 20;
    }

    // NIP-11 bonus/penalty
    if (result.nip11?.error) score -= 5;

    return Math.max(0, Math.min(100, score));
}
