/**
 * NIP-11 relay information document fetcher.
 * Converts wss:// relay URLs to https:// and fetches the info doc.
 */

const NIP11_TIMEOUT_MS = 5000;

/**
 * Convert a WebSocket relay URL to its HTTP(S) equivalent for NIP-11.
 * @param {string} wsUrl - e.g. "wss://relay.damus.io"
 * @returns {string} e.g. "https://relay.damus.io"
 */
function wsToHttp(wsUrl) {
    return wsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

/**
 * Fetch NIP-11 info document from a relay.
 * @param {string} relayUrl - WebSocket relay URL (wss://…)
 * @returns {Promise<{
 *   name?: string,
 *   description?: string,
 *   pubkey?: string,
 *   contact?: string,
 *   supported_nips?: number[],
 *   software?: string,
 *   version?: string,
 *   limitation?: {
 *     max_message_length?: number,
 *     max_subscriptions?: number,
 *     max_filters?: number,
 *     max_limit?: number,
 *     max_event_tags?: number,
 *     max_content_length?: number,
 *     min_pow_difficulty?: number,
 *     auth_required?: boolean,
 *     payment_required?: boolean,
 *   },
 *   error?: string,
 * }>}
 */
export async function fetchNip11(relayUrl) {
    const httpUrl = wsToHttp(relayUrl);
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), NIP11_TIMEOUT_MS);

        const resp = await fetch(httpUrl, {
            headers: { 'Accept': 'application/nostr+json' },
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (!resp.ok) {
            return { error: `HTTP ${resp.status}` };
        }

        const contentType = resp.headers.get('content-type') || '';
        if (!contentType.includes('json')) {
            return { error: `Unexpected content-type: ${contentType.slice(0, 40)}` };
        }

        const info = await resp.json();
        return info;
    } catch (e) {
        if (e.name === 'AbortError') {
            return { error: 'timeout' };
        }
        return { error: e?.message || 'fetch failed' };
    }
}

/**
 * Format NIP-11 info for display as a short summary string.
 * @param {Object} info - NIP-11 response object
 * @returns {string} Human-readable summary
 */
export function formatNip11Summary(info) {
    if (!info || info.error) return info?.error || 'unknown';

    const parts = [];
    if (info.name) parts.push(info.name);
    if (info.software) {
        const sw = info.software.replace(/^https?:\/\//, '').replace(/\.git$/, '');
        parts.push(info.version ? `${sw} v${info.version}` : sw);
    }
    if (info.supported_nips?.length > 0) {
        parts.push(`NIPs: ${info.supported_nips.slice(0, 8).join(',')}${info.supported_nips.length > 8 ? '…' : ''}`);
    }
    if (info.limitation?.auth_required) parts.push('AUTH required');
    if (info.limitation?.payment_required) parts.push('PAID');

    return parts.join(' · ') || 'no info';
}
