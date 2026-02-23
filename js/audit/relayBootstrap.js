/**
 * Relay bootstrap and discovery — fetch from DEFAULT_RELAYS, extract user relays, query investigation set.
 */

import { DEFAULT_RELAYS } from '../config.js';
import { shortUrl } from '../relay-panel.js';
import { extractUserRelays } from '../relay-discovery.js';
import { queryRelayForKinds } from '../relay-query.js';

const BOOTSTRAP_KINDS = [0, 2, 3, 4, 10002, 10011, 10050, 10051, 10063];
const USER_RELAY_KINDS = [0, 3, 10000, 10011, 10050, 10051, 10063];
const DISCOVERY_KINDS = [3, 10002, 10051];

/**
 * @param {import('nostr-tools').SimplePool} pool
 * @param {string} pubkey
 * @returns {Promise<{ relayData: Object, relaysToInvestigate: string[], userRelays: string[],
 *   invalidUserRelays: Array<{url:string,reason:string}>, urlValidityItems: Array<{type:string,text:string}>,
 *   relayStates: Array<{relay:string,state:string,statusText:string}> }>}
 */
export async function relayBootstrapAndDiscovery(pool, pubkey) {
    const relayData = {};
    const relayStates = [];

    for (const r of DEFAULT_RELAYS) {
        relayStates.push({ relay: r, state: 'connecting', statusText: 'DISCOVER' });
    }

    const bootstrapQueries = DEFAULT_RELAYS.map(async (r) => {
        const res = await queryRelayForKinds(pool, r, pubkey, BOOTSTRAP_KINDS);
        relayData[r] = res;
        const hasAny = res[0] || res[3] || res[10002] || res[10051];
        relayStates.push({ relay: r, state: hasAny ? 'ok' : 'error', statusText: hasAny ? 'OK' : 'NO DATA' });
        return res;
    });

    const bootstrapResults = await Promise.all(bootstrapQueries);

    const allEventsForDiscovery = [];
    for (const res of bootstrapResults) {
        for (const k of DISCOVERY_KINDS) if (res[k]) allEventsForDiscovery.push(res[k]);
    }

    const { urls: userRelays, invalid: invalidUserRelays } = extractUserRelays(allEventsForDiscovery);
    const relaysToInvestigate = userRelays.length > 0 ? userRelays : DEFAULT_RELAYS;

    const urlValidityItems = [];
    if (invalidUserRelays.length > 0) {
        for (const { url, reason } of invalidUserRelays) {
            urlValidityItems.push({ type: 'err', text: `Invalid relay: ${url} — ${reason}` });
        }
    }
    for (const r of userRelays) {
        urlValidityItems.push({ type: 'ok', text: `${shortUrl(r)} — valid format` });
    }

    const toQuery = relaysToInvestigate.filter(r => !relayData[r]);
    for (const r of toQuery) {
        relayStates.push({ relay: r, state: 'connecting', statusText: 'CONNECTING' });
    }

    const userRelayQueries = toQuery.map(async (r) => {
        const res = await queryRelayForKinds(pool, r, pubkey, USER_RELAY_KINDS);
        relayData[r] = res;
        const hasAny = res[0] || res[3] || res[10050] || res[10051] || res[10063];
        relayStates.push({ relay: r, state: hasAny ? 'ok' : 'error', statusText: hasAny ? 'OK' : 'NO DATA' });
    });

    await Promise.all(userRelayQueries);

    return {
        relayData,
        relaysToInvestigate,
        userRelays,
        invalidUserRelays,
        urlValidityItems,
        relayStates,
    };
}
