/**
 * Relay sync assessment — k0/k3/k10000 cross-relay consistency, best events collection.
 */

import { escapeHtml } from '../html.js';
import { shortUrl } from '../relay-validation.js';

/**
 * @param {string[]} relaysToInvestigate
 * @param {Object} relayData
 * @returns {{ maxK0: number, maxK3: number, max10000: number, max10050: number, max10051: number, best10051: Object|null,
 *   bestK10002: Object|null, best10050: Object|null, best10063: Object|null, best10011: Object|null,
 *   depK4: Object|null, depK2: Object|null, cwItems: Array<{type:string,text:string}>,
 *   relayStateUpdates: Array<{relay:string,state:string,statusText:string}>, hasCrossed: boolean }}
 */
export function assessRelaySync(relaysToInvestigate, relayData) {
    let maxK0 = 0, maxK3 = 0, max10050 = 0, max10051 = 0, max10000 = 0;
    let best10051 = null;
    for (const r of relaysToInvestigate) {
        const d = relayData[r];
        if (d) {
            if (d[0]?.created_at > maxK0) maxK0 = d[0].created_at;
            if (d[3]?.created_at > maxK3) maxK3 = d[3].created_at;
            if (d[10000]?.created_at > max10000) max10000 = d[10000].created_at;
            if (d[10050]?.created_at > max10050) max10050 = d[10050].created_at;
            if (d[10051]?.created_at > max10051) {
                max10051 = d[10051].created_at;
                best10051 = d[10051];
            }
        }
    }

    let bestK10002 = null, maxK10002 = 0;
    let best10050 = null, best10063 = null, best10011 = null;
    let depK4 = null, depK2 = null;
    for (const r of relaysToInvestigate) {
        const d = relayData[r];
        if (!d) continue;
        if (d[10002]?.created_at > maxK10002) { maxK10002 = d[10002].created_at; bestK10002 = d[10002]; }
        if (d[10050] && (!best10050 || d[10050].created_at > best10050.created_at)) {
            best10050 = d[10050];
        }
        if (d[10063] && (!best10063 || d[10063].created_at > best10063.created_at)) {
            best10063 = d[10063];
        }
        if (d[10011] && (!best10011 || d[10011].created_at > best10011.created_at)) {
            best10011 = d[10011];
        }
        if (d[4] && (!depK4 || d[4].created_at > depK4.created_at)) {
            depK4 = d[4];
        }
        if (d[2] && (!depK2 || d[2].created_at > depK2.created_at)) {
            depK2 = d[2];
        }
    }

    const cwItems = [];
    const relayStateUpdates = [];
    let hasCrossed = false;

    if (maxK0 === 0) {
        cwItems.push({ type: 'err', text: 'No Profile (kind 0) found on any relay!' });
        hasCrossed = true;
    } else {
        for (const r of relaysToInvestigate) {
            const ev = relayData[r]?.[0];
            if (!ev) {
                relayStateUpdates.push({ relay: r, state: 'warn', statusText: 'MISSING k0' });
                cwItems.push({ type: 'warn', text: `${escapeHtml(shortUrl(r))} — Profile (k0) missing` });
                hasCrossed = true;
            } else if (ev.created_at < maxK0) {
                relayStateUpdates.push({ relay: r, state: 'warn', statusText: 'STALE k0' });
                cwItems.push({ type: 'warn', text: `${escapeHtml(shortUrl(r))} — Profile (k0) outdated` });
                hasCrossed = true;
            } else {
                cwItems.push({ type: 'ok', text: `${escapeHtml(shortUrl(r))} — Profile in sync` });
            }
        }
    }

    if (maxK3 === 0) {
        cwItems.push({ type: 'err', text: 'No Contacts (kind 3) found on any relay!' });
        hasCrossed = true;
    } else {
        for (const r of relaysToInvestigate) {
            const ev = relayData[r]?.[3];
            if (!ev) {
                cwItems.push({ type: 'warn', text: `${escapeHtml(shortUrl(r))} — Contacts (k3) missing` });
                hasCrossed = true;
            } else if (ev.created_at < maxK3) {
                cwItems.push({ type: 'warn', text: `${escapeHtml(shortUrl(r))} — Contacts (k3) outdated` });
                hasCrossed = true;
            } else {
                cwItems.push({ type: 'ok', text: `${escapeHtml(shortUrl(r))} — Contacts in sync` });
            }
        }
    }

    if (max10000 > 0) {
        for (const r of relaysToInvestigate) {
            const ev = relayData[r]?.[10000];
            if (!ev) {
                cwItems.push({ type: 'warn', text: `${escapeHtml(shortUrl(r))} — Mute List (k10000) missing` });
                hasCrossed = true;
            } else if (ev.created_at < max10000) {
                cwItems.push({ type: 'warn', text: `${escapeHtml(shortUrl(r))} — Mute List (k10000) outdated` });
                hasCrossed = true;
            } else {
                cwItems.push({ type: 'ok', text: `${escapeHtml(shortUrl(r))} — Mute List in sync` });
            }
        }
    }

    return {
        maxK0, maxK3, max10000, max10050, max10051, best10051,
        bestK10002, best10050, best10063, best10011, depK4, depK2,
        cwItems, relayStateUpdates, hasCrossed,
    };
}
