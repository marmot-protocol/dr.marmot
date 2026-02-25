/**
 * KeyPackage (kind 443) evaluation — MIP-00/01 validation, kind 10051 relay handling.
 */

import { validateRelayUrl } from '../relay-validation.js';
import {
    validateKeyPackageIRef,
    isValidBase64,
    VALID_CIPHERSUITES,
    DEFAULT_EXTENSIONS,
} from '../mip-validation.js';

function parse10051Relays(best10051, auditCtx, mipItems) {
    const invalidMarmot = [];
    let marmotRelays = [];

    auditCtx.has10051 = true;
    mipItems.push({ type: 'ok', text: 'Relay List (kind 10051) found' });
    if (best10051.content && best10051.content.trim() !== '') {
        mipItems.push({ type: 'warn', text: 'kind 10051 content should be empty' });
    }

    const rawMarmotRelays = (Array.isArray(best10051.tags) ? best10051.tags : [])
        .filter(tag => Array.isArray(tag) && tag[0] === 'relay' && tag[1])
        .map(tag => tag[1]);
    const invalidSeen = new Set();
    marmotRelays = rawMarmotRelays.filter((url) => {
        const validated = validateRelayUrl(url);
        if (!validated.valid) {
            const key = (url || '').toLowerCase();
            if (!invalidSeen.has(key)) {
                invalidSeen.add(key);
                invalidMarmot.push({
                    url: (url || '').slice(0, 50) + ((url || '').length > 50 ? '…' : ''),
                    reason: validated.reason,
                });
            }
            return false;
        }
        return true;
    });

    for (const { url, reason } of invalidMarmot) {
        mipItems.push({ type: 'err', text: `Invalid KeyPackage relay: ${url} — ${reason}` });
    }

    if (marmotRelays.length === 0 && rawMarmotRelays.length > 0) {
        auditCtx.marmotRelayCount = 0;
        mipItems.push({ type: 'err', text: 'All kind 10051 relay URLs are invalid!' });
    } else if (marmotRelays.length === 0) {
        auditCtx.marmotRelayCount = 0;
        mipItems.push({ type: 'err', text: 'kind 10051 has no relay tags!' });
    } else {
        mipItems.push({ type: 'ok', text: `${marmotRelays.length} valid KeyPackage relay(s) listed` });
        auditCtx.marmotRelayCount = marmotRelays.length;
    }

    return { rawMarmotRelays, marmotRelays, invalidMarmot };
}

function validateSingleKeyPackage(kp, marmotRelaySet) {
    const tags = Array.isArray(kp.tags) ? kp.tags : [];
    const enc = tags.find(t => t[0] === 'encoding');
    const ver = tags.find(t => t[0] === 'mls_protocol_version');
    const iTag = tags.find(t => t[0] === 'i');
    const ext = tags.find(t => t[0] === 'mls_extensions');
    const cph = tags.find(t => t[0] === 'mls_ciphersuite');
    const rel = tags.find(t => t[0] === 'relays');

    const errs = [];
    if (!kp.content || typeof kp.content !== 'string') errs.push('missing content');
    else if (!kp.content.trim()) errs.push('content empty');
    else if (!isValidBase64(kp.content)) errs.push('content not valid base64');

    if (!enc) errs.push('missing encoding tag');
    else if ((enc[1] || '').toLowerCase() === 'hex') errs.push('hex encoding no longer supported per MIP-00; use base64');
    else if (enc[1] !== 'base64') errs.push('encoding ≠ base64');

    if (!ver || ver[1] !== '1.0') errs.push('mls_protocol_version missing/wrong');
    if (!iTag || !iTag[1]) errs.push('missing i tag (KeyPackageRef)');

    if (!cph) errs.push('missing mls_ciphersuite');
    else if (!VALID_CIPHERSUITES.has(cph[1])) errs.push(`mls_ciphersuite ${cph[1]} not in 0x0001-0x0007`);

    if (iTag?.[1] && cph?.[1]) {
        const iValidation = validateKeyPackageIRef(iTag[1], cph[1]);
        if (!iValidation.valid) errs.push(`i tag: ${iValidation.reason}`);
    }

    if (!rel || rel.length < 2) {
        errs.push('missing relays tag');
    } else {
        const validatedRelays = [];
        for (let i = 1; i < rel.length; i++) {
            const raw = rel[i];
            const trimmedLower = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
            const validation = validateRelayUrl(raw);
            validatedRelays.push({ raw, trimmedLower, valid: validation.valid, reason: validation.reason });
            if (!validation.valid) errs.push(`relays[${i}] invalid: ${validation.reason}`);
        }
        const hasOverlap = marmotRelaySet.size > 0
            && validatedRelays.some(v => v.valid && marmotRelaySet.has(v.trimmedLower));
        if (!hasOverlap && marmotRelaySet.size > 0) errs.push('relays tag has no overlap with kind 10051');
    }

    if (!ext) {
        errs.push('missing mls_extensions');
    } else {
        if (!ext.includes('0xf2ee')) errs.push('missing 0xf2ee (marmot_group_data)');
        if (!ext.includes('0x000a')) errs.push('missing 0x000a (last_resort)');
        const listedDefaults = ext.slice(1).filter(entry => DEFAULT_EXTENSIONS.has(entry));
        if (listedDefaults.length > 0) {
            errs.push(`mls_extensions must not list default extensions: ${listedDefaults.join(', ')}`);
        }
    }

    const hasClientTag = tags.some(t => Array.isArray(t) && t[0] === 'client' && t[1]);
    const shortId = `${kp.id.slice(0, 8)}…`;
    return { errs, hasClientTag, shortId };
}

function aggregateKpErrors(mipItems, auditCtx) {
    const errTexts = mipItems
        .filter(item => item.type === 'err' && item.text?.startsWith('KP '))
        .map(item => item.text);

    auditCtx.kpErrorCount = errTexts.length;
    if (errTexts.length === 0) return null;

    const hasEncoding = errTexts.some(text => text.includes('encoding') || text.includes('base64'));
    const hasExt = errTexts.some(text => (
        text.includes('0xf2ee') || text.includes('0x000a') || text.includes('extensions')
    ));
    const hasRelays = errTexts.some(text => text.includes('relays') || text.includes('no overlap'));
    const hasITag = errTexts.some(text => text.includes('i tag') || text.includes('KeyPackageRef'));

    if (hasEncoding && hasExt) {
        return ' — typically encoding (use base64) and mls_extensions (0xf2ee, 0x000a) need fixing.';
    }
    if (hasEncoding) return ' — check encoding tag: must be base64.';
    if (hasExt) return ' — mls_extensions must include 0xf2ee (marmot_group_data) and 0x000a (last_resort).';
    if (hasRelays) return ' — relays tag must list valid wss:// URLs and overlap with your kind 10051.';
    if (hasITag) return ' — i tag must be hex KeyPackageRef with length matching your ciphersuite.';
    return null;
}

/**
 * @param {import('nostr-tools').SimplePool} pool
 * @param {Object|null} best10051
 * @param {string[]} relaysToInvestigate
 * @param {Object} relayData
 * @param {string} pubkey
 * @param {Object} auditCtx - mutated
 * @returns {Promise<{ mipItems: Array<{type:string,text:string,kpId?:string}>, marmotRelays: string[],
 *   kpEventsCollected: Object[], invalidMarmot: Array<{url:string,reason:string}>,
 *   relayStateUpdates: Array<{relay:string,state:string,statusText:string}>, kpErrorHint: string|null }>}
 */
export async function evaluateMarmot(pool, best10051, relaysToInvestigate, relayData, pubkey, auditCtx) {
    const mipItems = [];
    let marmotRelays = [];
    let kpEventsCollected = [];
    let invalidMarmot = [];
    const relayStateUpdates = [];
    let kpErrorHint = null;

    if (!best10051) {
        auditCtx.has10051 = false;
        mipItems.push({ type: 'err', text: 'Missing Relay List (kind 10051) — not Marmot-ready' });
        return { mipItems, marmotRelays, kpEventsCollected, invalidMarmot, relayStateUpdates, kpErrorHint };
    }

    const parsed = parse10051Relays(best10051, auditCtx, mipItems);
    marmotRelays = parsed.marmotRelays;
    invalidMarmot = parsed.invalidMarmot;

    if (marmotRelays.length === 0) {
        return { mipItems, marmotRelays, kpEventsCollected, invalidMarmot, relayStateUpdates, kpErrorHint };
    }

    const mainRelaySet = new Set();
    for (const r of relaysToInvestigate) {
        const d = relayData[r];
        const k3Tags = Array.isArray(d?.[3]?.tags) ? d[3].tags : [];
        for (const t of k3Tags) {
            if (!Array.isArray(t) || t[0] !== 'relay' || !t[1]) continue;
            const raw = t[1].trim();
            if (validateRelayUrl(raw).valid) mainRelaySet.add(raw.toLowerCase());
        }
        const k10002Tags = Array.isArray(d?.[10002]?.tags) ? d[10002].tags : [];
        for (const t of k10002Tags) {
            if (!Array.isArray(t) || t[0] !== 'r' || !t[1]) continue;
            const raw = t[1].trim();
            if (validateRelayUrl(raw).valid) mainRelaySet.add(raw.toLowerCase());
        }
    }
    if (mainRelaySet.size > 0) {
        const hasOverlap = marmotRelays.some(u => mainRelaySet.has(u.trim().toLowerCase()));
        if (!hasOverlap) {
            auditCtx.kpNoOverlapWithMain = true;
            mipItems.push({ type: 'warn', text: 'KeyPackage relays not in your main relay list (k3/k10002) — inviters may need to connect to extra relays to find your KeyPackages' });
        }
    }
    auditCtx.marmotRelayCount = marmotRelays.length;

    for (const r of marmotRelays) {
        relayStateUpdates.push({ relay: r, state: 'connecting', statusText: 'KP QUERY' });
    }

    let kpEvents = [];
    try {
        kpEvents = await pool.querySync(marmotRelays, { authors: [pubkey], kinds: [443] });
        kpEventsCollected = kpEvents;
        auditCtx.kpCount = kpEvents.length;
        for (const r of marmotRelays) {
            relayStateUpdates.push({ relay: r, state: 'ok', statusText: 'KP OK' });
        }
    } catch (err) {
        console.error('Failed querying KeyPackages from relays', {
            relays: marmotRelays,
            pubkey,
            error: err,
        });
        const errMsg = err?.message || 'unknown error';
        kpErrorHint = ` — relay query failed: ${errMsg}`;
        for (const r of marmotRelays) {
            relayStateUpdates.push({
                relay: r,
                state: 'error',
                statusText: `KP FAIL: ${errMsg}`,
            });
        }
        mipItems.push({
            type: 'err',
            text: `Failed to connect to KeyPackage relays: ${errMsg}`,
        });
        return { mipItems, marmotRelays, kpEventsCollected, invalidMarmot, relayStateUpdates, kpErrorHint };
    }

    if (kpEvents.length === 0) {
        mipItems.push({ type: 'err', text: 'No KeyPackages (kind 443) found on advertised relays' });
        return { mipItems, marmotRelays, kpEventsCollected, invalidMarmot, relayStateUpdates, kpErrorHint };
    }

    mipItems.push({ type: 'ok', text: `${kpEvents.length} KeyPackage(s) found` });
    const marmotRelaySet = new Set(marmotRelays.map(u => u.toLowerCase()));
    let kpsWithoutClient = 0;

    for (const kp of kpEvents) {
        const { errs, hasClientTag, shortId } = validateSingleKeyPackage(kp, marmotRelaySet);

        if (errs.length > 0) {
            for (const e of errs) {
                mipItems.push({ type: 'err', text: `KP ${shortId} — ${e}`, kpId: kp.id });
            }
        } else {
            if (!hasClientTag) kpsWithoutClient++;
            mipItems.push({ type: 'ok', text: `KP ${shortId} — all tags valid` });
        }
    }

    if (kpsWithoutClient > 0) {
        mipItems.push({ type: 'warn', text: 'KeyPackages lack client tag — add it for better UX when signing keys are on another device' });
    }

    const kpErrors = mipItems.filter(i => i.type === 'err' && i.text.startsWith('KP ')).length;
    if (kpErrors === 0) {
        mipItems.push({ type: 'ok', text: 'All KeyPackages pass MIP-00 / MIP-01 checks' });
    } else {
        mipItems.push({ type: 'err', text: `${kpErrors} KeyPackage(s) failed validation` });
        kpErrorHint = aggregateKpErrors(mipItems, auditCtx);
    }

    return { mipItems, marmotRelays, kpEventsCollected, invalidMarmot, relayStateUpdates, kpErrorHint };
}
