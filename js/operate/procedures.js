/**
 * Surgical procedures — event construction, NIP-07 signing, and publishing.
 * Each procedure creates Nostr events from the editor's final state,
 * signs via NIP-07, and publishes to relays.
 */

import { SimplePool } from 'https://esm.sh/nostr-tools';
import { getAuditState } from '../audit.js';
import { getFinalRelayList, getStagedChanges } from './editor.js';

const PUBLISH_TIMEOUT_MS = 15_000;

/**
 * @typedef {Object} Procedure
 * @property {string} name - Human-readable procedure name
 * @property {number} kind - Nostr event kind
 * @property {string} description - What this procedure does
 * @property {Object} unsignedEvent - The unsigned Nostr event to sign
 */

/**
 * @typedef {Object} ProcedureResult
 * @property {string} name
 * @property {boolean} ok
 * @property {number} succeeded - Number of relays that accepted
 * @property {number} failed - Number of relays that rejected
 * @property {{ relay: string, ok: boolean }[]} relayResults
 */

/**
 * Build unsigned kind 10002 (NIP-65) event from editor state.
 * @param {string} pubkey
 * @returns {Object|null}
 */
function buildK10002Event(pubkey) {
    const relays = getFinalRelayList(10002);

    const tags = relays.map(({ url, readWrite }) => {
        if (readWrite === 'read') return ['r', url, 'read'];
        if (readWrite === 'write') return ['r', url, 'write'];
        return ['r', url]; // 'rw' or default — no third element means both
    });

    return {
        kind: 10002,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: '',
        pubkey,
    };
}

/**
 * Build unsigned kind 10050 (Inbox Relays) event from editor state.
 * @param {string} pubkey
 * @returns {Object|null}
 */
function buildK10050Event(pubkey) {
    const relays = getFinalRelayList(10050);

    return {
        kind: 10050,
        created_at: Math.floor(Date.now() / 1000),
        tags: relays.map(({ url }) => ['relay', url]),
        content: '',
        pubkey,
    };
}

/**
 * Build unsigned kind 10051 (KeyPackage Relays) event from editor state.
 * @param {string} pubkey
 * @returns {Object|null}
 */
function buildK10051Event(pubkey) {
    const relays = getFinalRelayList(10051);

    return {
        kind: 10051,
        created_at: Math.floor(Date.now() / 1000),
        tags: relays.map(({ url }) => ['relay', url]),
        content: '',
        pubkey,
    };
}

/**
 * Build unsigned kind 3 (Contacts) event from editor state.
 * Preserves all existing 'p' tags and content from the current k3 event.
 * Only updates 'relay' tags.
 * @param {string} pubkey
 * @returns {Object|null}
 */
function buildK3Event(pubkey) {
    const state = getAuditState();
    const relays = getFinalRelayList(3);
    if (!state?.bestK3 && relays.length === 0) return null; // No existing k3 and nothing to publish

    // Preserve all non-relay tags (p tags, etc.) from existing k3
    const preservedTags = [];
    if (state?.bestK3?.tags) {
        for (const t of state.bestK3.tags) {
            if (Array.isArray(t) && t[0] !== 'relay') {
                preservedTags.push(t);
            }
        }
    }

    const relayTags = relays.map(({ url }) => ['relay', url]);

    return {
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: [...preservedTags, ...relayTags],
        content: state?.bestK3?.content || '',
        pubkey,
    };
}

/**
 * Determine which procedures need to run based on staged changes.
 * @returns {Procedure[]}
 */
export function planProcedures() {
    const state = getAuditState();
    if (!state) return [];

    const pubkey = state.pubkey;
    const procedures = [];

    const k10002Changes = getStagedChanges(10002);
    if (k10002Changes.length > 0) {
        const ev = buildK10002Event(pubkey);
        if (ev) {
            procedures.push({
                name: 'Update NIP-65 Relay List',
                kind: 10002,
                description: `Publishing updated relay list with ${ev.tags.length} relay(s)`,
                unsignedEvent: ev,
            });
        }
    }

    const k10050Changes = getStagedChanges(10050);
    if (k10050Changes.length > 0) {
        const ev = buildK10050Event(pubkey);
        if (ev) {
            procedures.push({
                name: 'Update Inbox Relays',
                kind: 10050,
                description: `Publishing updated inbox relays with ${ev.tags.length} relay(s)`,
                unsignedEvent: ev,
            });
        }
    }

    const k10051Changes = getStagedChanges(10051);
    if (k10051Changes.length > 0) {
        const ev = buildK10051Event(pubkey);
        if (ev) {
            procedures.push({
                name: 'Update KeyPackage Relays',
                kind: 10051,
                description: `Publishing updated KeyPackage relay list with ${ev.tags.length} relay(s)`,
                unsignedEvent: ev,
            });
        }
    }

    const k3Changes = getStagedChanges(3);
    if (k3Changes.length > 0) {
        const ev = buildK3Event(pubkey);
        if (ev) {
            procedures.push({
                name: 'Update Contact Relay Hints',
                kind: 3,
                description: `Publishing updated contacts with ${ev.tags.filter(t => t[0] === 'relay').length} relay hint(s)`,
                unsignedEvent: ev,
            });
        }
    }

    return procedures;
}

/**
 * Execute a single procedure: sign via NIP-07 and publish to relays.
 * @param {Procedure} procedure
 * @param {string[]} publishRelays - Relay URLs to publish to
 * @param {function} [onRelayStatus] - (relay: string, status: string) => void
 * @returns {Promise<ProcedureResult>}
 */
export async function executeProcedure(procedure, publishRelays, onRelayStatus) {
    const result = {
        name: procedure.name,
        ok: false,
        succeeded: 0,
        failed: 0,
        relayResults: [],
    };

    // Step 1: Sign via NIP-07
    if (!window.nostr) {
        return { ...result, ok: false };
    }

    let signedEvent;
    try {
        signedEvent = await window.nostr.signEvent(procedure.unsignedEvent);
    } catch (e) {
        console.error('NIP-07 signing failed for', procedure.name, e);
        return { ...result, ok: false };
    }

    // Step 2: Publish to relays
    const pool = new SimplePool();
    const publishWithTimeout = (relay, ev) =>
        Promise.race([
            pool.publish([relay], ev),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), PUBLISH_TIMEOUT_MS),
            ),
        ]);

    for (const relay of publishRelays) {
        onRelayStatus?.(relay, 'SENDING');
        let relayOk = true;
        try {
            await publishWithTimeout(relay, signedEvent);
        } catch {
            relayOk = false;
        }
        onRelayStatus?.(relay, relayOk ? 'OK' : 'FAIL');
        result.relayResults.push({ relay, ok: relayOk });
        if (relayOk) result.succeeded++;
        else result.failed++;
    }

    pool.close(publishRelays);
    result.ok = result.succeeded > 0;
    return result;
}

/**
 * Execute all planned procedures sequentially.
 * @param {string[]} publishRelays
 * @param {function} [onProcedureStart] - (procedure: Procedure, index: number, total: number) => void
 * @param {function} [onProcedureDone] - (result: ProcedureResult, index: number, total: number) => void
 * @param {function} [onRelayStatus] - (relay: string, status: string) => void
 * @returns {Promise<ProcedureResult[]>}
 */
export async function executeAllProcedures(publishRelays, onProcedureStart, onProcedureDone, onRelayStatus) {
    const procedures = planProcedures();
    const results = [];

    for (let i = 0; i < procedures.length; i++) {
        onProcedureStart?.(procedures[i], i, procedures.length);
        const result = await executeProcedure(procedures[i], publishRelays, onRelayStatus);
        results.push(result);
        onProcedureDone?.(result, i, procedures.length);
    }

    return results;
}
