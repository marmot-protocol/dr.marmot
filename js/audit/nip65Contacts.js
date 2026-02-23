/**
 * NIP-65 and k3/k10002 relay list analysis — read/write relays, k3 vs k10002 divergence.
 */

import { validateRelayUrl } from '../relay-validation.js';

/**
 * @param {Object|null} bestK10002
 * @param {Object|null} bestK3
 * @param {Object} auditCtx - mutated: nip65Malformed, nip65NoRead, nip65NoWrite, nip65Bloated, relayDiverges
 * @returns {{ relayConfigItems: Array<{type:string,text:string}>, k3RelaySet: Set<string>, k10002RelaySet: Set<string>, canUnifyRelays: boolean, relayDivergenceVars: {k3Only:number,k10002Only:number}|null }}
 */
export function analyzeNip65AndContacts(bestK10002, bestK3, auditCtx) {
    const relayConfigItems = [];
    const k3RelaySet = new Set();
    const k10002RelaySet = new Set();
    let canUnifyRelays = false;
    let relayDivergenceVars = null;

    if (bestK10002) {
        const tagsRaw = Array.isArray(bestK10002.tags) ? bestK10002.tags : [];
        if (!Array.isArray(bestK10002.tags)) {
            relayConfigItems.push({ type: 'warn', text: 'kind 10002 (NIP-65) has malformed or missing tags array' });
            auditCtx.nip65Malformed = true;
        }
        const k10002Tags = tagsRaw.filter(t => Array.isArray(t) && t[0] === 'r' && t[1]);
        const readRelays = k10002Tags.filter(t => !t[2] || t[2] === 'read');
        const writeRelays = k10002Tags.filter(t => !t[2] || t[2] === 'write');
        const totalRelayCount = new Set(k10002Tags.map(t => t[1])).size;
        if (totalRelayCount === 0) {
            relayConfigItems.push({ type: 'err', text: 'kind 10002 (NIP-65) has no relay tags' });
            auditCtx.nip65NoRead = true;
            auditCtx.nip65NoWrite = true;
        } else {
            if (readRelays.length === 0) {
                relayConfigItems.push({ type: 'err', text: 'NIP-65: no read relays — clients cannot deliver replies or mentions to you' });
                auditCtx.nip65NoRead = true;
            } else {
                relayConfigItems.push({ type: 'ok', text: `NIP-65: ${readRelays.length} read relay(s)` });
            }
            if (writeRelays.length === 0) {
                relayConfigItems.push({ type: 'err', text: 'NIP-65: no write relays — clients cannot publish events on your behalf' });
                auditCtx.nip65NoWrite = true;
            } else {
                relayConfigItems.push({ type: 'ok', text: `NIP-65: ${writeRelays.length} write relay(s)` });
            }
            if (totalRelayCount > 10) {
                relayConfigItems.push({ type: 'warn', text: `NIP-65: ${totalRelayCount} relays listed — aim for ≤ 10; high counts degrade client performance` });
                auditCtx.nip65Bloated = true;
            }
        }
        for (const t of k10002Tags) {
            if (Array.isArray(t) && t[1] && validateRelayUrl(String(t[1]).trim()).valid) {
                k10002RelaySet.add(String(t[1]).trim().toLowerCase());
            }
        }
    } else {
        relayConfigItems.push({ type: 'warn', text: 'No kind 10002 (NIP-65) Relay List Metadata — some clients may not discover your relays' });
    }

    if (bestK3?.tags) {
        for (const t of bestK3.tags) {
            if (t[0] === 'relay' && t[1] && validateRelayUrl(t[1].trim()).valid) k3RelaySet.add(t[1].trim().toLowerCase());
        }
    }

    if (k3RelaySet.size > 0 || k10002RelaySet.size > 0) {
        const onlyInK3 = [...k3RelaySet].filter(r => !k10002RelaySet.has(r));
        const onlyInK10002 = [...k10002RelaySet].filter(r => !k3RelaySet.has(r));
        const overlap = [...k3RelaySet].filter(r => k10002RelaySet.has(r));
        if (onlyInK3.length === 0 && onlyInK10002.length === 0) {
            relayConfigItems.push({ type: 'ok', text: `Contacts (k3) and NIP-65 (k10002) relay lists agree` });
        } else {
            auditCtx.relayDiverges = true;
            canUnifyRelays = true;
            relayDivergenceVars = { k3Only: onlyInK3.length, k10002Only: onlyInK10002.length };
            if (onlyInK3.length > 0) relayConfigItems.push({ type: 'warn', text: `${onlyInK3.length} relay(s) only in Contacts (k3), not in NIP-65 (k10002) — client fragmentation risk` });
            if (onlyInK10002.length > 0) relayConfigItems.push({ type: 'warn', text: `${onlyInK10002.length} relay(s) only in NIP-65 (k10002), not in Contacts (k3) — client fragmentation risk` });
            if (overlap.length > 0) relayConfigItems.push({ type: 'ok', text: `${overlap.length} relay(s) shared between k3 and k10002` });
        }
    }

    return { relayConfigItems, k3RelaySet, k10002RelaySet, canUnifyRelays, relayDivergenceVars };
}
