/**
 * Relay bootstrap and discovery — fetch from DEFAULT_RELAYS, extract user relays, query investigation set.
 */

import { DEFAULT_RELAYS } from '../config.js';
import { shortUrl } from '../relay-validation.js';
import { escapeHtml } from '../html.js';
import { extractUserRelays } from '../relay-discovery.js';
import { queryRelayForKinds } from '../relay-query.js';

const BOOTSTRAP_KINDS = [0, 2, 3, 4, 10002, 10011, 10050, 10051, 10063];
const USER_RELAY_KINDS = [0, 3, 10000, 10011, 10050, 10051, 10063];
const DISCOVERY_KINDS = [3, 10002, 10051];

async function performBootstrapQueries(pool, pubkey, relayData, relayStates) {
    const bootstrapQueries = DEFAULT_RELAYS.map(async (relay) => {
        try {
            const res = await queryRelayForKinds(pool, relay, pubkey, BOOTSTRAP_KINDS);
            relayData[relay] = res;
            const hasAny = Object.values(res).some(Boolean);
            relayStates.push({
                relay,
                state: hasAny ? 'ok' : 'error',
                statusText: hasAny ? 'OK' : 'NO DATA',
            });
            return res;
        } catch (err) {
            console.error('Bootstrap relay query failed', { relay, pubkey, error: err });
            relayData[relay] = {};
            relayStates.push({
                relay,
                state: 'error',
                statusText: `ERROR: ${err?.message || 'query failed'}`,
            });
            return {};
        }
    });
    const bootstrapResults = await Promise.all(bootstrapQueries);
    return { bootstrapResults };
}

function parseDiscoveryEvents(bootstrapResults) {
    const allEventsForDiscovery = [];
    for (const result of bootstrapResults) {
        for (const kind of DISCOVERY_KINDS) {
            if (result[kind]) allEventsForDiscovery.push(result[kind]);
        }
    }

    const { urls: userRelays, invalid: invalidUserRelays } = extractUserRelays(allEventsForDiscovery);
    const urlValidityItems = [];
    if (invalidUserRelays.length > 0) {
        for (const { url, reason } of invalidUserRelays) {
            urlValidityItems.push({ type: 'err', text: `Invalid relay: ${escapeHtml(String(url || ''))} — ${escapeHtml(String(reason || ''))}` });
        }
    }
    for (const relay of userRelays) {
        urlValidityItems.push({ type: 'ok', text: `${escapeHtml(shortUrl(relay))} — valid format` });
    }

    return { allEventsForDiscovery, userRelays, invalidUserRelays, urlValidityItems };
}

async function performUserRelayQueries(pool, toQuery, pubkey, relayData, relayStates) {
    const userRelayQueries = toQuery.map(async (relay) => {
        try {
            const res = await queryRelayForKinds(pool, relay, pubkey, USER_RELAY_KINDS);
            relayData[relay] = res;
            const hasAny = Object.values(res).some(Boolean);
            relayStates.push({
                relay,
                state: hasAny ? 'ok' : 'error',
                statusText: hasAny ? 'OK' : 'NO DATA',
            });
            return res;
        } catch (err) {
            console.error('User relay query failed', { relay, pubkey, error: err });
            relayData[relay] = {};
            relayStates.push({
                relay,
                state: 'error',
                statusText: `ERROR: ${err?.message || 'query failed'}`,
            });
            return {};
        }
    });

    await Promise.all(userRelayQueries);
}

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

    const boot = await performBootstrapQueries(pool, pubkey, relayData, relayStates);
    const { bootstrapResults } = boot;
    const parsed = parseDiscoveryEvents(bootstrapResults);
    const { userRelays, invalidUserRelays, urlValidityItems } = parsed;
    const relaysToInvestigate = userRelays.length > 0 ? userRelays : DEFAULT_RELAYS;

    const toQuery = relaysToInvestigate.filter(r => !relayData[r]);
    for (const r of toQuery) {
        relayStates.push({ relay: r, state: 'connecting', statusText: 'CONNECTING' });
    }

    await performUserRelayQueries(pool, toQuery, pubkey, relayData, relayStates);

    return {
        relayData,
        relaysToInvestigate,
        userRelays,
        invalidUserRelays,
        urlValidityItems,
        relayStates,
    };
}
