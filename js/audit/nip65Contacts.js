/**
 * NIP-65 and k3/k10002 relay list analysis — read/write relays, k3 vs k10002 divergence.
 */

import { validateRelayUrl } from '../relay-validation.js';

export function analyzeK10002Relays(bestK10002, auditCtx) {
    const relayConfigItemsPart = [];
    const k10002RelaySet = new Set();
    const flags = {
        nip65Malformed: false,
        nip65NoRead: false,
        nip65NoWrite: false,
        nip65Bloated: false,
    };

    if (!bestK10002) {
        relayConfigItemsPart.push({
            type: 'warn',
            text: 'No kind 10002 (NIP-65) Relay List Metadata — some clients may not discover your relays',
        });
        return { relayConfigItemsPart, k10002RelaySet, flags };
    }

    const tagsRaw = Array.isArray(bestK10002.tags) ? bestK10002.tags : [];
    if (!Array.isArray(bestK10002.tags)) {
        relayConfigItemsPart.push({
            type: 'warn',
            text: 'kind 10002 (NIP-65) has malformed or missing tags array',
        });
        flags.nip65Malformed = true;
        auditCtx.nip65Malformed = true;
    }

    const relayTags = tagsRaw.filter(tag => Array.isArray(tag) && tag[0] === 'r' && tag[1]);
    const readRelays = relayTags.filter(tag => !tag[2] || tag[2] === 'read');
    const writeRelays = relayTags.filter(tag => !tag[2] || tag[2] === 'write');
    const totalRelayCount = new Set(relayTags.map(tag => tag[1])).size;

    if (totalRelayCount === 0) {
        relayConfigItemsPart.push({ type: 'err', text: 'kind 10002 (NIP-65) has no relay tags' });
        flags.nip65NoRead = true;
        flags.nip65NoWrite = true;
        auditCtx.nip65NoRead = true;
        auditCtx.nip65NoWrite = true;
    } else {
        if (readRelays.length === 0) {
            relayConfigItemsPart.push({
                type: 'err',
                text: 'NIP-65: no read relays — clients cannot deliver replies or mentions to you',
            });
            flags.nip65NoRead = true;
            auditCtx.nip65NoRead = true;
        } else {
            relayConfigItemsPart.push({ type: 'ok', text: `NIP-65: ${readRelays.length} read relay(s)` });
        }

        if (writeRelays.length === 0) {
            relayConfigItemsPart.push({
                type: 'err',
                text: 'NIP-65: no write relays — clients cannot publish events on your behalf',
            });
            flags.nip65NoWrite = true;
            auditCtx.nip65NoWrite = true;
        } else {
            relayConfigItemsPart.push({ type: 'ok', text: `NIP-65: ${writeRelays.length} write relay(s)` });
        }

        if (totalRelayCount > 10) {
            relayConfigItemsPart.push({
                type: 'warn',
                text: `NIP-65: ${totalRelayCount} relays listed — aim for ≤ 10; high counts degrade client performance`,
            });
            flags.nip65Bloated = true;
            auditCtx.nip65Bloated = true;
        }
    }

    for (const tag of relayTags) {
        const relay = String(tag[1]).trim();
        if (validateRelayUrl(relay).valid) k10002RelaySet.add(relay.toLowerCase());
    }

    return { relayConfigItemsPart, k10002RelaySet, flags };
}

export function computeRelayDivergence(k3RelaySet, k10002RelaySet) {
    const relayDivergenceVars = null;
    const divergenceItems = [];
    if (k3RelaySet.size === 0 && k10002RelaySet.size === 0) {
        return { canUnifyRelays: false, relayDivergenceVars, divergenceItems };
    }

    const onlyInK3 = [...k3RelaySet].filter(relay => !k10002RelaySet.has(relay));
    const onlyInK10002 = [...k10002RelaySet].filter(relay => !k3RelaySet.has(relay));
    const overlap = [...k3RelaySet].filter(relay => k10002RelaySet.has(relay));

    if (onlyInK3.length === 0 && onlyInK10002.length === 0) {
        divergenceItems.push({
            type: 'ok',
            text: 'Contacts (k3) and NIP-65 (k10002) relay lists agree',
        });
        return { canUnifyRelays: false, relayDivergenceVars, divergenceItems };
    }

    const vars = { k3Only: onlyInK3.length, k10002Only: onlyInK10002.length };
    if (onlyInK3.length > 0) {
        divergenceItems.push({
            type: 'warn',
            text: `${onlyInK3.length} relay(s) only in Contacts (k3), not in NIP-65 (k10002) — client fragmentation risk`,
        });
    }
    if (onlyInK10002.length > 0) {
        divergenceItems.push({
            type: 'warn',
            text: `${onlyInK10002.length} relay(s) only in NIP-65 (k10002), not in Contacts (k3) — client fragmentation risk`,
        });
    }
    if (overlap.length > 0) {
        divergenceItems.push({
            type: 'ok',
            text: `${overlap.length} relay(s) shared between k3 and k10002`,
        });
    }
    return { canUnifyRelays: true, relayDivergenceVars: vars, divergenceItems };
}

/**
 * @param {Object|null} bestK10002
 * @param {Object|null} bestK3
 * @param {Object} auditCtx - mutated: nip65Malformed, nip65NoRead, nip65NoWrite, nip65Bloated, relayDiverges
 * @returns {{ relayConfigItems: Array<{type:string,text:string}>, k3RelaySet: Set<string>, k10002RelaySet: Set<string>, canUnifyRelays: boolean, relayDivergenceVars: {k3Only:number,k10002Only:number}|null }}
 */
export function analyzeNip65AndContacts(bestK10002, bestK3, auditCtx) {
    const relayConfigItems = [];
    const k3RelaySet = new Set();
    const parsedK10002 = analyzeK10002Relays(bestK10002, auditCtx);
    const { relayConfigItemsPart, k10002RelaySet } = parsedK10002;
    relayConfigItems.push(...relayConfigItemsPart);

    if (Array.isArray(bestK3?.tags)) {
        for (const tag of bestK3.tags) {
            if (tag[0] === 'relay' && tag[1] && validateRelayUrl(tag[1].trim()).valid) {
                k3RelaySet.add(tag[1].trim().toLowerCase());
            }
        }
    }

    const divergence = computeRelayDivergence(k3RelaySet, k10002RelaySet);
    const { canUnifyRelays, relayDivergenceVars, divergenceItems } = divergence;
    relayConfigItems.push(...divergenceItems);
    if (canUnifyRelays) {
        auditCtx.relayDiverges = true;
    }

    return { relayConfigItems, k3RelaySet, k10002RelaySet, canUnifyRelays, relayDivergenceVars };
}
