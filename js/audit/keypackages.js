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

    auditCtx.has10051 = true;
    mipItems.push({ type: 'ok', text: 'Relay List (kind 10051) found' });
    if (best10051.content && best10051.content.trim() !== '') {
        mipItems.push({ type: 'warn', text: 'kind 10051 content should be empty' });
    }

    const rawMarmotRelays = (Array.isArray(best10051.tags) ? best10051.tags : [])
        .filter(t => Array.isArray(t) && t[0] === 'relay' && t[1])
        .map(t => t[1]);
    const invalidMarmotSeen = new Set();
    marmotRelays = rawMarmotRelays.filter((u) => {
        const v = validateRelayUrl(u);
        if (!v.valid) {
            const key = (u || '').toLowerCase();
            if (!invalidMarmotSeen.has(key)) {
                invalidMarmotSeen.add(key);
                invalidMarmot.push({ url: (u || '').slice(0, 50) + ((u || '').length > 50 ? '…' : ''), reason: v.reason });
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
        return { mipItems, marmotRelays, kpEventsCollected, invalidMarmot, relayStateUpdates, kpErrorHint };
    }
    if (marmotRelays.length === 0) {
        auditCtx.marmotRelayCount = 0;
        mipItems.push({ type: 'err', text: 'kind 10051 has no relay tags!' });
        return { mipItems, marmotRelays, kpEventsCollected, invalidMarmot, relayStateUpdates, kpErrorHint };
    }

    mipItems.push({ type: 'ok', text: `${marmotRelays.length} valid KeyPackage relay(s) listed` });
    const mainRelaySet = new Set();
    for (const r of relaysToInvestigate) {
        const d = relayData[r];
        if (d?.[3]?.tags) for (const t of d[3].tags || []) if (t[0] === 'relay' && t[1] && validateRelayUrl(t[1].trim()).valid) mainRelaySet.add(t[1].trim().toLowerCase());
        if (d?.[10002]?.tags) for (const t of d[10002].tags || []) if (t[0] === 'r' && t[1] && validateRelayUrl(t[1].trim()).valid) mainRelaySet.add(t[1].trim().toLowerCase());
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
    } catch {
        for (const r of marmotRelays) {
            relayStateUpdates.push({ relay: r, state: 'error', statusText: 'KP FAIL' });
        }
        mipItems.push({ type: 'err', text: 'Failed to connect to KeyPackage relays' });
        return { mipItems, marmotRelays, kpEventsCollected, invalidMarmot, relayStateUpdates, kpErrorHint };
    }

    if (kpEvents.length === 0) {
        mipItems.push({ type: 'err', text: 'No KeyPackages (kind 443) found on advertised relays' });
        return { mipItems, marmotRelays, kpEventsCollected, invalidMarmot, relayStateUpdates, kpErrorHint };
    }

    mipItems.push({ type: 'ok', text: `${kpEvents.length} KeyPackage(s) found` });
    const marmotRelaySet = new Set(marmotRelays.map(u => u.toLowerCase()));
    let kpErrors = 0;
    let kpsWithoutClient = 0;

    for (const kp of kpEvents) {
        const enc = kp.tags.find(t => t[0] === 'encoding');
        const ver = kp.tags.find(t => t[0] === 'mls_protocol_version');
        const iTag = kp.tags.find(t => t[0] === 'i');
        const ext = kp.tags.find(t => t[0] === 'mls_extensions');
        const cph = kp.tags.find(t => t[0] === 'mls_ciphersuite');
        const rel = kp.tags.find(t => t[0] === 'relays');

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
            const iVal = validateKeyPackageIRef(iTag[1], cph[1]);
            if (!iVal.valid) errs.push(`i tag: ${iVal.reason}`);
        }
        if (!rel || rel.length < 2) errs.push('missing relays tag');
        else {
            for (let i = 1; i < rel.length; i++) {
                const v = validateRelayUrl(rel[i]);
                if (!v.valid) errs.push(`relays[${i}] invalid: ${v.reason}`);
            }
            let hasOverlap = false;
            for (let i = 1; i < rel.length; i++) {
                if (validateRelayUrl(rel[i]).valid && marmotRelaySet.has(rel[i].trim().toLowerCase())) {
                    hasOverlap = true;
                    break;
                }
            }
            if (!hasOverlap && marmotRelaySet.size > 0) errs.push('relays tag has no overlap with kind 10051');
        }
        if (!ext) {
            errs.push('missing mls_extensions');
        } else {
            if (!ext.includes('0xf2ee')) errs.push('missing 0xf2ee (marmot_group_data)');
            if (!ext.includes('0x000a')) errs.push('missing 0x000a (last_resort)');
            const listedDefaults = ext.slice(1).filter(e => DEFAULT_EXTENSIONS.has(e));
            if (listedDefaults.length > 0) errs.push(`mls_extensions must not list default extensions: ${listedDefaults.join(', ')}`);
        }

        if (errs.length > 0) {
            kpErrors++;
            for (const e of errs) {
                mipItems.push({ type: 'err', text: `KP ${kp.id.slice(0, 8)}… — ${e}`, kpId: kp.id });
            }
        } else {
            if (!kp.tags?.find(t => t[0] === 'client' && t[1])) kpsWithoutClient++;
            mipItems.push({ type: 'ok', text: `KP ${kp.id.slice(0, 8)}… — all tags valid` });
        }
    }

    if (kpsWithoutClient > 0) {
        mipItems.push({ type: 'warn', text: 'KeyPackages lack client tag — add it for better UX when signing keys are on another device' });
    }

    if (kpErrors === 0) {
        mipItems.push({ type: 'ok', text: 'All KeyPackages pass MIP-00 / MIP-01 checks' });
    } else {
        auditCtx.kpErrorCount = kpErrors;
        mipItems.push({ type: 'err', text: `${kpErrors} KeyPackage(s) failed validation` });
        const errTexts = mipItems.filter(i => i.type === 'err' && i.text?.startsWith('KP ')).map(i => i.text);
        const hasEncoding = errTexts.some(t => t.includes('encoding') || t.includes('base64'));
        const hasExt = errTexts.some(t => t.includes('0xf2ee') || t.includes('0x000a') || t.includes('extensions'));
        const hasRelays = errTexts.some(t => t.includes('relays') || t.includes('no overlap'));
        const hasITag = errTexts.some(t => t.includes('i tag') || t.includes('KeyPackageRef'));
        if (hasEncoding && hasExt) kpErrorHint = ' — typically encoding (use base64) and mls_extensions (0xf2ee, 0x000a) need fixing.';
        else if (hasEncoding) kpErrorHint = ' — check encoding tag: must be base64.';
        else if (hasExt) kpErrorHint = ' — mls_extensions must include 0xf2ee (marmot_group_data) and 0x000a (last_resort).';
        else if (hasRelays) kpErrorHint = ' — relays tag must list valid wss:// URLs and overlap with your kind 10051.';
        else if (hasITag) kpErrorHint = ' — i tag must be hex KeyPackageRef with length matching your ciphersuite.';
    }

    return { mipItems, marmotRelays, kpEventsCollected, invalidMarmot, relayStateUpdates, kpErrorHint };
}
