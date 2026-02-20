import { nip19, SimplePool } from 'https://esm.sh/nostr-tools';
import { DEFAULT_RELAYS } from './config.js';
import { npubInput, nip07Btn, auditBtn, relayList } from './dom.js';
import { getAudio, errBeep, okBeep } from './audio.js';
import { say, clearQueue, setOnAllDone } from './dialog.js';
import { setSprite, startInvestigating, stopInvestigating } from './sprite.js';
import { speak } from './personalities.js';
import {
    clearRelayPanel,
    setRelayState,
    appendResultSection,
    shortUrl,
    flashScreen,
} from './relay-panel.js';
import { addScanBar, removeScanBar, setScanProgress } from './scan-bar.js';
import { validateRelayUrl } from './relay-validation.js';
import {
    verifyNip05,
    validateKeyPackageIRef,
    isValidBase64,
    VALID_CIPHERSUITES,
    DEFAULT_EXTENSIONS,
} from './mip-validation.js';
import { extractUserRelays } from './relay-discovery.js';
import { queryRelayForKinds } from './relay-query.js';

let isAuditing = false;

const FAILURE_CATEGORIES = {
    'relay-config': ['Invalid relay', 'invalid relay', 'kind 10051 relay', 'relay URLs'],
    'sync': ['sync', 'outdated', 'missing', 'stale', 'Profile (kind 0)', 'Contacts (kind 3)', 'not found'],
    'marmot-foundation': ['kind 10051', 'No KeyPackage Relay', 'no relay tags', 'KeyPackage relay'],
    'keypackage': ['KeyPackage', 'KP ', 'kind 443', 'encoding', '0xf2ee', '0x000a', 'mls_', 'relays tag'],
};

function categorizeFailures(failures) {
    const cats = new Set();
    for (const f of failures) {
        const t = (f || '').toLowerCase();
        let added = false;
        for (const [cat, keywords] of Object.entries(FAILURE_CATEGORIES)) {
            if (keywords.some(k => t.includes(k.toLowerCase()))) {
                cats.add(cat);
                added = true;
                break;
            }
        }
        if (!added) cats.add('keypackage');
    }
    return [...cats];
}

function prescriptionPriority(text) {
    const t = (text || '').toLowerCase();
    if (t.includes('invalid relay') && t.includes('k3 / k10002')) return 1;
    if (t.includes('rebroadcast') || (t.includes('profile') && t.includes('contacts'))) return 2;
    if (t.includes('kind 10051') && (t.includes('publish') || t.includes('add relay') || t.includes('invalid relay'))) return 3;
    if (t.includes('delete events') || t.includes('keypackage') || t.includes('encoding') || t.includes('0xf2ee') || t.includes('0x000a') || t.includes('mls_') || t.includes('relays tag')) return 4;
    return 5;
}

function getRootCauseHint(ctx) {
    if (ctx.invalidRelayCount > 0) return 'Invalid URLs break relay discovery — fix those before anything else.';
    if (!ctx.has10051 && (ctx.kpCount === 0 || ctx.marmotRelayCount === 0)) return "Without kind 10051, KeyPackages can't be advertised — publish that first.";
    if (ctx.hasCrossedWires && (ctx.has10051 || ctx.marmotRelayCount > 0)) return 'Sync issues can delay KeyPackage discovery; fix sync first.';
    return null;
}

function pickClosingMessage(ctx, failures, categories) {
    if (categories.includes('relay-config') && !categories.includes('sync') && !categories.includes('marmot-foundation') && !categories.includes('keypackage')) {
        return 'Invalid relay URLs in your metadata. Fix those first; other checks depend on valid relays. See prescription.';
    }
    if (categories.includes('sync') && !categories.includes('relay-config') && !categories.includes('marmot-foundation') && !categories.includes('keypackage')) {
        return "Profile and contacts out of sync across relays. Rebroadcast to all relays — that's the main fix.";
    }
    const marmotOnly = categories.includes('marmot-foundation') && !categories.includes('relay-config') && !categories.includes('sync');
    const kpOnly = categories.includes('keypackage') && !categories.includes('relay-config') && !categories.includes('sync') && !categories.includes('marmot-foundation');
    if (marmotOnly && !kpOnly) {
        return 'Marmot messaging unavailable. Publish kind 10051 first, then KeyPackages. See prescription.';
    }
    if (kpOnly) {
        return 'KeyPackages failed MIP-00/01. Fix encoding and mls_extensions per prescription.';
    }
    if (categories.length >= 2) {
        return '<em>Start with</em> relay/sync fixes so KeyPackages propagate; then address Marmot setup. See prescription.';
    }
    const topFail = failures[0] || '';
    return topFail.length > 70 ? topFail.slice(0, 67) + '…' : topFail;
}

export async function startAudit(opts = {}) {
    const { fromNip07 = false } = opts;
    if (isAuditing) return;

    const rawNpub = npubInput.value.trim();

    if (!rawNpub.startsWith('npub1') || rawNpub.length < 60) {
        say(speak('invalidNpub'));
        errBeep();
        return;
    }

    let pubkey;
    try {
        const dec = nip19.decode(rawNpub);
        if (dec.type !== 'npub') throw new Error('bad type');
        pubkey = dec.data;
    } catch {
        say(speak('decodeFail'));
        errBeep();
        return;
    }

    isAuditing = true;
    clearQueue();
    auditBtn.disabled = true;
    nip07Btn.disabled = true;
    clearRelayPanel();
    addScanBar();
    setScanProgress(0);

    setSprite('wave', 'bounce');
    const intro = speak(fromNip07 ? 'auditStartNip07' : 'auditStart', { npub: rawNpub.slice(0, 16) });
    await say(intro, () => {
        startInvestigating();
    });

    const pool = new SimplePool();
    const relayData = {};
    let invalidMarmot = [];
    let kpEventsCollected = [];

    const auditCtx = {
        userRelayCount: 0,
        invalidRelayCount: 0,
        usedBootstrapFallback: false,
        hasCrossedWires: false,
        syncedRelays: 0,
        totalRelays: 0,
        staleRelays: 0,
        missingRelays: 0,
        problemRelayNames: [],
        vitalErrCount: 0,
        vitalWarnCount: 0,
        nip05Verified: false,
        has10051: false,
        marmotRelayCount: 0,
        kpCount: 0,
        kpErrorCount: 0,
        kpNoOverlapWithMain: false,
    };

    setSprite('listening', 'bounce');
    await say(speak('takingPulse'));

    for (const r of DEFAULT_RELAYS) {
        setRelayState(r, 'connecting', 'DISCOVER');
    }

    const bootstrapKinds = [0, 3, 10002, 10051];
    const bootstrapQueries = DEFAULT_RELAYS.map(async (r) => {
        const res = await queryRelayForKinds(pool, r, pubkey, bootstrapKinds);
        relayData[r] = res;
        const hasAny = res[0] || res[3] || res[10002] || res[10051];
        if (!hasAny) setRelayState(r, 'error', 'NO DATA');
        else setRelayState(r, 'ok', 'OK');
        return res;
    });

    const bootstrapResults = await Promise.all(bootstrapQueries);
    setScanProgress(15);

    const allEventsForDiscovery = [];
    for (const res of bootstrapResults) {
        for (const k of [3, 10002, 10051]) if (res[k]) allEventsForDiscovery.push(res[k]);
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
    if (urlValidityItems.length > 0) {
        appendResultSection('RELAY URL VALIDITY', urlValidityItems);
    }

    auditCtx.userRelayCount = userRelays.length;
    auditCtx.invalidRelayCount = invalidUserRelays.length;
    auditCtx.usedBootstrapFallback = userRelays.length === 0;

    if (userRelays.length > 0) {
        await say(speak('relayFound', { count: userRelays.length }));
    } else if (invalidUserRelays.length > 0) {
        await say(speak('relayInvalid', { count: invalidUserRelays.length }));
    } else {
        await say(speak('noRelays'));
    }

    const toQuery = relaysToInvestigate.filter(r => !relayData[r]);
    for (const r of toQuery) {
        setRelayState(r, 'connecting', 'CONNECTING');
    }
    setScanProgress(20);

    const userRelayQueries = toQuery.map(async (r) => {
        const res = await queryRelayForKinds(pool, r, pubkey, [0, 3, 10051]);
        relayData[r] = res;
        const hasAny = res[0] || res[3] || res[10051];
        if (!hasAny) setRelayState(r, 'error', 'NO DATA');
        else setRelayState(r, 'ok', 'OK');
    });

    await Promise.all(userRelayQueries);
    setScanProgress(50);

    stopInvestigating();
    setSprite('thinking', 'bounce');
    await say(speak('examiningSync'));

    let maxK0 = 0, maxK3 = 0, max10051 = 0;
    let best10051 = null;
    for (const r of relaysToInvestigate) {
        const d = relayData[r];
        if (d) {
            if (d[0]?.created_at > maxK0) maxK0 = d[0].created_at;
            if (d[3]?.created_at > maxK3) maxK3 = d[3].created_at;
            if (d[10051]?.created_at > max10051) {
                max10051 = d[10051].created_at;
                best10051 = d[10051];
            }
        }
    }

    const cwItems = [];
    let hasCrossed = false;

    if (maxK0 === 0) {
        cwItems.push({ type: 'err', text: 'No Profile (kind 0) found on any relay!' });
        hasCrossed = true;
    } else {
        for (const r of relaysToInvestigate) {
            const ev = relayData[r]?.[0];
            if (!ev) {
                setRelayState(r, 'warn', 'MISSING k0');
                cwItems.push({ type: 'warn', text: `${shortUrl(r)} — Profile (k0) missing` });
                hasCrossed = true;
            } else if (ev.created_at < maxK0) {
                setRelayState(r, 'warn', 'STALE k0');
                cwItems.push({ type: 'warn', text: `${shortUrl(r)} — Profile (k0) outdated` });
                hasCrossed = true;
            } else {
                cwItems.push({ type: 'ok', text: `${shortUrl(r)} — Profile in sync` });
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
                cwItems.push({ type: 'warn', text: `${shortUrl(r)} — Contacts (k3) missing` });
                hasCrossed = true;
            } else if (ev.created_at < maxK3) {
                cwItems.push({ type: 'warn', text: `${shortUrl(r)} — Contacts (k3) outdated` });
                hasCrossed = true;
            } else {
                cwItems.push({ type: 'ok', text: `${shortUrl(r)} — Contacts in sync` });
            }
        }
    }

    appendResultSection('RELAY SYNC (k0 / k3)', cwItems);
    setScanProgress(65);

    setSprite('magnify', 'bounce');
    await say(speak('vitalSigns'));
    const bestK0 = maxK0 ? [...relaysToInvestigate].map(r => relayData[r]?.[0]).find(e => e?.created_at === maxK0) : null;
    const vitalItems = [];
    if (bestK0?.content) {
        try {
            const meta = JSON.parse(bestK0.content);
            const hasName = !!meta?.name?.trim();
            const hasPicture = !!meta?.picture?.trim();
            const hasAbout = !!meta?.about?.trim();
            const nip05 = meta?.nip05?.trim() || '';
            vitalItems.push({ type: hasName ? 'ok' : 'warn', text: hasName ? `Name: "${(meta.name || '').slice(0, 40)}${(meta.name || '').length > 40 ? '…' : ''}"` : 'Name: missing' });
            vitalItems.push({ type: hasPicture ? 'ok' : 'warn', text: hasPicture ? 'Picture: set' : 'Picture: missing' });
            vitalItems.push({ type: hasAbout ? 'ok' : 'warn', text: hasAbout ? `About: ${(meta.about || '').length} chars` : 'About: missing' });
            if (nip05) {
                const nip05FormatOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nip05);
                if (!nip05FormatOk) {
                    vitalItems.push({ type: 'warn', text: `NIP-05: "${nip05}" — format invalid (expected user@domain.tld)` });
                } else {
                    await say("Contacting NIP-05 server to verify...");
                    const v = await verifyNip05(nip05, pubkey);
                    if (v.verified) {
                        vitalItems.push({ type: 'ok', text: `NIP-05: ${nip05} ✓ verified` });
                    } else {
                        vitalItems.push({ type: 'err', text: `NIP-05: ${nip05} — ${v.reason}` });
                    }
                }
            } else {
                vitalItems.push({ type: 'warn', text: 'NIP-05: not set (optional, improves identity verification)' });
            }
        } catch {
            vitalItems.push({ type: 'warn', text: 'Profile content not valid JSON' });
        }
    } else if (maxK0 > 0) {
        vitalItems.push({ type: 'warn', text: 'Profile (kind 0) found but content empty' });
    }
    if (vitalItems.length > 0) {
        appendResultSection('PROFILE VITAL SIGNS', vitalItems);
        const vitalWarn = vitalItems.filter(i => i.type === 'warn').length;
        const vitalErr = vitalItems.filter(i => i.type === 'err').length;
        auditCtx.vitalErrCount = vitalErr;
        auditCtx.vitalWarnCount = vitalWarn;
        auditCtx.nip05Verified = vitalItems.some(i => i.text && i.text.includes('✓ verified'));
        if (vitalErr > 0) {
            await say(speak('vitalGaps', { count: vitalErr }));
        } else if (vitalWarn > 0) {
            await say(`Profile basics present; ${vitalWarn} optional field(s) could strengthen your identity (NIP-05, about, picture).`);
        } else {
            await say(speak('vitalOk'));
        }
    }

    let relayReachable = 0;
    for (const r of relaysToInvestigate) {
        const d = relayData[r];
        if (d && (d[0] || d[3] || d[10051])) relayReachable++;
    }
    const relayReachabilityItem = relayReachable < relaysToInvestigate.length
        ? { type: 'warn', text: `${relayReachable} of ${relaysToInvestigate.length} relay(s) reachable — some failed to respond; check relay status or firewall` }
        : { type: 'ok', text: `${relayReachable} of ${relaysToInvestigate.length} relay(s) reachable` };

    const resilienceItems = [];
    resilienceItems.push(relayReachabilityItem);
    if (relaysToInvestigate.length <= 1) {
        resilienceItems.push({ type: 'warn', text: 'Single relay — fragile! One outage = total unavailability' });
        resilienceItems.push({ type: 'warn', text: 'Prescription: Add more relays to k3 / k10002 / k10051 for redundancy' });
        await say(`<span class="warn">Single relay</span> — one outage and your profile is unreachable. Add 2–3 more relays for redundancy.`);
    } else {
        resilienceItems.push({ type: 'ok', text: `${relaysToInvestigate.length} relay(s) — good redundancy` });
        if (relayReachable < relaysToInvestigate.length) {
            await say(speak('relayReachable', { reachable: relayReachable, total: relaysToInvestigate.length }));
        }
    }
    appendResultSection('RELAY RESILIENCE', resilienceItems);

    const nowSec = Math.floor(Date.now() / 1000);
    const daysAgo = (ts) => ts ? Math.floor((nowSec - ts) / 86400) : null;
    const freshnessItems = [];
    if (maxK0 > 0) {
        const d = daysAgo(maxK0);
        freshnessItems.push({ type: d !== null && d > 365 ? 'warn' : 'ok', text: `Profile (k0): ${d === 0 ? 'today' : d === 1 ? '1 day ago' : d < 365 ? `${d} days ago` : `over 1 year ago (${d} days)`}` });
    }
    if (maxK3 > 0) {
        const d = daysAgo(maxK3);
        freshnessItems.push({ type: d !== null && d > 365 ? 'warn' : 'ok', text: `Contacts (k3): ${d === 0 ? 'today' : d === 1 ? '1 day ago' : d < 365 ? `${d} days ago` : `over 1 year ago (${d} days)`}` });
    }
    if (max10051 > 0) {
        const d = daysAgo(max10051);
        freshnessItems.push({ type: d !== null && d > 365 ? 'warn' : 'ok', text: `KeyPackage list (k10051): ${d === 0 ? 'today' : d === 1 ? '1 day ago' : d < 365 ? `${d} days ago` : `over 1 year ago (${d} days)`}` });
    }
    if (freshnessItems.length > 0) {
        appendResultSection('EVENT FRESHNESS', freshnessItems);
        const staleK0 = maxK0 ? daysAgo(maxK0) : null;
        const staleK3 = maxK3 ? daysAgo(maxK3) : null;
        if (staleK0 !== null && staleK0 > 365) {
            await say(`Profile last updated ${staleK0} days ago — consider refreshing if your details have changed.`);
        } else if (staleK3 !== null && staleK3 > 365) {
            await say(speak('contactsStale', { days: staleK3 }));
        }
    }

    const bestK3 = maxK3 ? [...relaysToInvestigate].map(r => relayData[r]?.[3]).find(e => e?.created_at === maxK3) : null;
    const followCount = bestK3?.tags?.filter(t => t[0] === 'p' && t[1]).length ?? 0;
    const socialItems = [];
    if (maxK3 > 0) {
        socialItems.push({ type: 'ok', text: `Follow list: ${followCount} contact(s)` });
        if (followCount === 0) socialItems.push({ type: 'warn', text: 'Empty follow list — some clients expect at least one contact' });
    }
    if (socialItems.length > 0) appendResultSection('SOCIAL GRAPH', socialItems);

    if (hasCrossed) {
        const problemRelays = [...new Set(cwItems.filter(i => i.type !== 'ok').map(i => i.text.split(' — ')[0]))];
        auditCtx.hasCrossedWires = true;
        auditCtx.problemRelayNames = problemRelays;
        const named = problemRelays.slice(0, 3).join(', ');
        const extras = problemRelays.length > 3 ? ` and ${problemRelays.length - 3} more` : '';
        await say(speak('crossedWires', { count: problemRelays.length, named, extras }));
        errBeep();
    } else {
        await say(speak('perfectSync', { count: relaysToInvestigate.length }));
        okBeep();
    }

    setSprite('working', 'bounce');
    const marmotIntro = auditCtx.hasCrossedWires
        ? "Now running the Marmot Protocol panel — MIP-00 / MIP-01 compliance scan. I noticed sync issues earlier — rebroadcasting will help KeyPackage propagation."
        : "Now running the Marmot Protocol panel — MIP-00 / MIP-01 compliance scan...";
    await say(speak(auditCtx.hasCrossedWires ? 'marmotPanelSync' : 'marmotPanel'));

    const mipItems = [];
    let marmotOk = true;
    let marmotRelays = [];

    if (!best10051) {
        auditCtx.has10051 = false;
        mipItems.push({ type: 'err', text: 'Missing Relay List (kind 10051) — not Marmot-ready' });
        marmotOk = false;
        await say(speak('no10051'));
    } else {
        auditCtx.has10051 = true;
        mipItems.push({ type: 'ok', text: 'Relay List (kind 10051) found' });
        if (best10051.content && best10051.content.trim() !== '') {
            mipItems.push({ type: 'warn', text: 'kind 10051 content should be empty' });
        }
        const rawMarmotRelays = best10051.tags.filter(t => t[0] === 'relay').map(t => t[1]);
        invalidMarmot = [];
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
            marmotOk = false;
        }
        if (marmotRelays.length === 0 && rawMarmotRelays.length > 0) {
            auditCtx.marmotRelayCount = 0;
            mipItems.push({ type: 'err', text: 'All kind 10051 relay URLs are invalid!' });
            marmotOk = false;
        } else if (marmotRelays.length === 0) {
            auditCtx.marmotRelayCount = 0;
            mipItems.push({ type: 'err', text: 'kind 10051 has no relay tags!' });
            marmotOk = false;
        } else {
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
                    await say("KeyPackage relays aren't in your main relay list — inviters may need to connect to extra relays to find you.");
                }
            }
            auditCtx.marmotRelayCount = marmotRelays.length;
            setSprite('surprised', 'bounce');
            await say(speak('kpRelaysFound', { count: marmotRelays.length }));

            for (const r of marmotRelays) {
                setRelayState(r, 'connecting', 'KP QUERY');
            }

            let kpEvents = [];
            try {
                kpEvents = await pool.querySync(marmotRelays, { authors: [pubkey], kinds: [443] });
                kpEventsCollected = kpEvents;
                auditCtx.kpCount = kpEvents.length;
                for (const r of marmotRelays) {
                    setRelayState(r, 'ok', 'KP OK');
                }
            } catch (e) {
                for (const r of marmotRelays) {
                    setRelayState(r, 'error', 'KP FAIL');
                }
                mipItems.push({ type: 'err', text: 'Failed to connect to KeyPackage relays' });
                marmotOk = false;
            }

            setScanProgress(85);

            if (kpEvents.length === 0) {
                mipItems.push({ type: 'err', text: 'No KeyPackages (kind 443) found on advertised relays' });
                marmotOk = false;
                await say(`Kind 10051 lists ${marmotRelays.length} relay(s), but <span class='err'>no KeyPackages (k443)</span> found. Your client must publish at least one to receive Marmot DMs.`);
            } else {
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
                        marmotOk = false;
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
                    await say(speak('kpAllPass', { count: kpEvents.length }));
                } else {
                    auditCtx.kpErrorCount = kpErrors;
                    mipItems.push({ type: 'err', text: `${kpErrors} KeyPackage(s) failed validation` });
                    const errTexts = mipItems.filter(i => i.type === 'err' && i.text?.startsWith('KP ')).map(i => i.text);
                    const hasEncoding = errTexts.some(t => t.includes('encoding') || t.includes('base64'));
                    const hasExt = errTexts.some(t => t.includes('0xf2ee') || t.includes('0x000a') || t.includes('extensions'));
                    const hasRelays = errTexts.some(t => t.includes('relays') || t.includes('no overlap'));
                    const hasITag = errTexts.some(t => t.includes('i tag') || t.includes('KeyPackageRef'));
                    let hint = '';
                    if (hasEncoding && hasExt) hint = ' — typically encoding (use base64) and mls_extensions (0xf2ee, 0x000a) need fixing.';
                    else if (hasEncoding) hint = ' — check encoding tag: must be base64.';
                    else if (hasExt) hint = ' — mls_extensions must include 0xf2ee (marmot_group_data) and 0x000a (last_resort).';
                    else if (hasRelays) hint = ' — relays tag must list valid wss:// URLs and overlap with your kind 10051.';
                    else if (hasITag) hint = ' — i tag must be hex KeyPackageRef with length matching your ciphersuite.';
                    await say(`<span class="err">${kpErrors} KeyPackage(s) failed</span> validation${hint}`);
                }
            }
        }
    }

    appendResultSection('MARMOT PROTOCOL (MIP-00/01)', mipItems);

    if (kpEventsCollected.length > 0) {
        const nowSec2 = Math.floor(Date.now() / 1000);
        const daysAgoKp = (ts) => ts ? Math.floor((nowSec2 - ts) / 86400) : null;
        const ciphersuites = new Set();
        const clients = new Set();
        let newestKp = 0, oldestKp = Infinity;
        for (const kp of kpEventsCollected) {
            const cph = kp.tags?.find(t => t[0] === 'mls_ciphersuite');
            if (cph?.[1]) ciphersuites.add(cph[1]);
            const cli = kp.tags?.find(t => t[0] === 'client');
            if (cli?.[1]) clients.add(cli[1]);
            if (kp.created_at) {
                if (kp.created_at > newestKp) newestKp = kp.created_at;
                if (kp.created_at < oldestKp) oldestKp = kp.created_at;
            }
        }
        const kpStatsItems = [];
        kpStatsItems.push({ type: 'ok', text: `${kpEventsCollected.length} KeyPackage(s) on file` });
        if (ciphersuites.size > 0) {
            kpStatsItems.push({ type: 'ok', text: `Ciphersuite(s): ${[...ciphersuites].join(', ')}` });
            if (ciphersuites.size > 1) kpStatsItems.push({ type: 'warn', text: 'Multiple ciphersuites — different clients may use different crypto' });
        }
        if (clients.size > 0) {
            kpStatsItems.push({ type: 'ok', text: `Client(s): ${[...clients].slice(0, 5).join(', ')}${clients.size > 5 ? '…' : ''}` });
        }
        if (newestKp > 0) {
            const d = daysAgoKp(newestKp);
            kpStatsItems.push({ type: d !== null && d > 90 ? 'warn' : 'ok', text: `Newest KP: ${d === 0 ? 'today' : d === 1 ? '1 day ago' : d < 90 ? `${d} days ago` : `${d} days ago — consider rotating`}` });
        }
        if (oldestKp < Infinity && kpEventsCollected.length > 1) {
            const d = daysAgoKp(oldestKp);
            kpStatsItems.push({ type: 'ok', text: `Oldest KP: ${d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`}` });
        }
        if (kpEventsCollected.length === 1) {
            kpStatsItems.push({ type: 'warn', text: 'Single KeyPackage — add more for redundancy (different devices / clients)' });
        }
        appendResultSection('KEYPACKAGE VITAL STATS', kpStatsItems);
    }

    setScanProgress(100);
    removeScanBar();

    const allUsedRelays = [...new Set([...DEFAULT_RELAYS, ...relaysToInvestigate, ...marmotRelays])];
    pool.close(allUsedRelays);

    stopInvestigating();
    setSprite('writing', 'bounce');
    await say(speak('charting'));

    const findings = { pass: [], warn: [], fail: [] };

    if (invalidUserRelays.length > 0) {
        for (const { url, reason } of invalidUserRelays) {
            findings.fail.push(`Invalid relay URL: ${url} — ${reason}`);
        }
    }
    for (const { url, reason } of invalidMarmot) {
        findings.fail.push(`Invalid KeyPackage relay: ${url} — ${reason}`);
    }

    const totalRelays = relaysToInvestigate.length;
    let syncedRelays = 0;
    let staleRelays = 0;
    let missingRelays = 0;

    for (const r of relaysToInvestigate) {
        const d = relayData[r];
        const k0ok = d?.[0] && d[0].created_at === maxK0;
        const k3ok = d?.[3] && d[3].created_at === maxK3;
        if (k0ok && k3ok) {
            syncedRelays++;
        } else {
            if (!d?.[0] || !d?.[3]) missingRelays++;
            else staleRelays++;
        }
    }

    auditCtx.syncedRelays = syncedRelays;
    auditCtx.totalRelays = totalRelays;
    auditCtx.staleRelays = staleRelays;
    auditCtx.missingRelays = missingRelays;

    if (maxK0 === 0) {
        findings.fail.push('Profile (kind 0) not found on any relay');
    } else if (syncedRelays === totalRelays) {
        findings.pass.push(`Profile (kind 0) in sync across all ${totalRelays} relay(s)`);
    } else {
        if (staleRelays > 0) findings.warn.push(`Profile (kind 0) outdated on ${staleRelays} relay(s)`);
        if (missingRelays > 0) findings.warn.push(`Profile (kind 0) missing from ${missingRelays} relay(s)`);
    }

    if (maxK3 === 0) {
        findings.fail.push('Contacts list (kind 3) not found on any relay');
    } else {
        let k3stale = 0, k3miss = 0;
        for (const r of relaysToInvestigate) {
            const ev = relayData[r]?.[3];
            if (!ev) k3miss++;
            else if (ev.created_at < maxK3) k3stale++;
        }
        if (k3stale === 0 && k3miss === 0) {
            findings.pass.push(`Contacts (kind 3) in sync across all ${totalRelays} relay(s)`);
        } else {
            if (k3stale > 0) findings.warn.push(`Contacts (kind 3) outdated on ${k3stale} relay(s)`);
            if (k3miss > 0) findings.warn.push(`Contacts (kind 3) missing from ${k3miss} relay(s)`);
        }
    }

    if (!best10051) {
        findings.fail.push('No KeyPackage Relay List (kind 10051) — Marmot protocol requires this');
    } else {
        findings.pass.push('KeyPackage Relay List (kind 10051) published');
        if (marmotRelays.length === 0) {
            findings.fail.push('kind 10051 contains no relay tags');
        } else {
            findings.pass.push(`${marmotRelays.length} KeyPackage relay(s) advertised`);
        }
    }

    for (const item of mipItems) {
        if (item.type === 'err' && item.text.startsWith('KP ')) findings.fail.push(item.text);
        if (item.type === 'err' && item.text.includes('No KeyPackages')) findings.fail.push(item.text);
        if (item.type === 'ok' && item.text.includes('all tags valid')) findings.pass.push(item.text);
        if (item.type === 'ok' && item.text.includes('All KeyPackages pass')) findings.pass.push(item.text);
        if (item.type === 'warn') findings.warn.push(item.text);
    }

    const hasFailures = findings.fail.length > 0;
    const hasWarnings = findings.warn.length > 0;
    const allOk = !hasFailures && !hasWarnings;

    let verdictClass, verdictIcon, verdictLabel;
    if (allOk) {
        verdictClass = 'verdict-pass';
        verdictIcon = '✔';
        verdictLabel = 'CLEAN BILL OF HEALTH';
    } else if (!hasFailures && hasWarnings) {
        verdictClass = 'verdict-warn';
        verdictIcon = '!';
        verdictLabel = 'MINOR ISSUES DETECTED';
    } else {
        verdictClass = 'verdict-fail';
        verdictIcon = '✖';
        verdictLabel = 'ISSUES FOUND';
    }

    const prescriptions = [];
    if (invalidUserRelays.length > 0) {
        prescriptions.push('Fix invalid relay URLs in your k3 / k10002 / k10051 — use wss:// or ws:// and valid hostnames');
    }
    if (invalidMarmot.length > 0) {
        prescriptions.push('Fix invalid relay URLs in kind 10051 — ensure all relay tags use valid wss:// or ws:// URLs');
    }
    if (staleRelays > 0 || missingRelays > 0) {
        prescriptions.push('Rebroadcast your Profile (kind 0) and Contacts (kind 3) to all your relays');
    }
    if (!best10051) {
        prescriptions.push('Publish a KeyPackage Relay List (kind 10051) to enable Marmot messaging');
    } else if (marmotRelays.length === 0) {
        prescriptions.push('Add relay tags to your kind 10051 event');
    }
    const missingITagIds = [...new Set(
        mipItems.filter(i => i.type === 'err' && i.text.includes('missing i tag') && i.kpId).map(i => i.kpId)
    )];
    if (missingITagIds.length > 0) {
        prescriptions.push(`Broadcast delete events (kind 5) for KeyPackages missing the i tag (ids: ${missingITagIds.join(', ')}), then publish fresh KeyPackages with the i tag`);
    }
    for (const item of mipItems) {
        if (item.type === 'err' && item.text.includes('No KeyPackages')) {
            prescriptions.push('Publish at least one KeyPackage (kind 443) to your advertised relays');
        }
        if (item.type === 'err' && item.text.includes('encoding')) {
            prescriptions.push('Fix KeyPackage encoding tag — must be "base64"');
        }
        if (item.type === 'err' && item.text.includes('0xf2ee')) {
            prescriptions.push('Add marmot_group_data extension (0xf2ee) to mls_extensions');
        }
        if (item.type === 'err' && item.text.includes('0x000a')) {
            prescriptions.push('Add last_resort extension (0x000a) to mls_extensions');
        }
        if (item.type === 'err' && item.text.includes('missing mls_ciphersuite')) {
            prescriptions.push('Include the mls_ciphersuite tag in your KeyPackage events');
        }
        if (item.type === 'err' && item.text.includes('not in 0x0001-0x0007')) {
            prescriptions.push('Use a supported mls_ciphersuite (0x0001–0x0007) in KeyPackage events');
        }
        if (item.type === 'err' && item.text.includes('missing relays')) {
            prescriptions.push('Include the relays tag in your KeyPackage events');
        }
        if (item.type === 'err' && item.text.includes('relays[')) {
            prescriptions.push('Fix invalid relay URLs in KeyPackage relays tag — use valid wss:// or ws:// URLs');
        }
        if (item.type === 'err' && item.text.includes('no overlap with kind 10051')) {
            prescriptions.push('KeyPackage relays tag should include at least one relay from your kind 10051');
        }
        if (item.type === 'err' && (item.text.includes('missing content') || item.text.includes('content empty') || item.text.includes('content not valid base64'))) {
            prescriptions.push('KeyPackage content must be non-empty, valid base64-encoded KeyPackageBundle');
        }
        if (item.type === 'err' && item.text.includes('i tag:')) {
            prescriptions.push('Fix i tag — must be hex-encoded KeyPackageRef with length matching ciphersuite');
        }
        if (item.type === 'err' && item.text.includes('must not list default extensions')) {
            prescriptions.push('Remove default extensions (0x0001–0x0005) from mls_extensions — only custom extensions belong');
        }
        if (item.type === 'warn' && item.text.includes('kind 10051 content')) {
            prescriptions.push('Leave kind 10051 content empty');
        }
    }
    if (best10051 && marmotRelays.length > 0) {
        prescriptions.push('MIP-00: Rotate MLS signing keys periodically within groups; ensure your client supports this');
    }
    const uniqueRx = [...new Set(prescriptions)].sort((a, b) => prescriptionPriority(a) - prescriptionPriority(b));

    let cardHTML = `<div class="diagnosis-card">`;
    cardHTML += `<div class="diagnosis-header ${verdictClass}">`;
    cardHTML += `<span class="verdict-icon">${verdictIcon}</span>`;
    cardHTML += `<span>${verdictLabel}</span>`;
    cardHTML += `</div>`;
    cardHTML += `<div class="diagnosis-body">`;

    cardHTML += `<div class="diagnosis-stats">`;
    cardHTML += `<div class="stat-box"><span class="stat-val dx-pass">${findings.pass.length}</span><span class="stat-label">PASSED</span></div>`;
    cardHTML += `<div class="stat-box"><span class="stat-val dx-warn">${findings.warn.length}</span><span class="stat-label">WARNINGS</span></div>`;
    cardHTML += `<div class="stat-box"><span class="stat-val dx-fail">${findings.fail.length}</span><span class="stat-label">ERRORS</span></div>`;
    cardHTML += `<div class="stat-box"><span class="stat-val dx-info">${totalRelays}</span><span class="stat-label">RELAYS</span></div>`;
    cardHTML += `</div>`;

    if (findings.fail.length > 0) {
        cardHTML += `<div><div class="diagnosis-section-label">Errors</div><div class="diagnosis-items">`;
        for (const f of findings.fail) {
            cardHTML += `<div class="dx-row"><span class="dx-icon dx-fail">✖</span><span class="dx-fail">${f}</span></div>`;
        }
        cardHTML += `</div></div>`;
    }

    if (findings.warn.length > 0) {
        cardHTML += `<div><div class="diagnosis-section-label">Warnings</div><div class="diagnosis-items">`;
        for (const w of findings.warn) {
            cardHTML += `<div class="dx-row"><span class="dx-icon dx-warn">!</span><span class="dx-warn">${w}</span></div>`;
        }
        cardHTML += `</div></div>`;
    }

    if (findings.pass.length > 0) {
        cardHTML += `<div><div class="diagnosis-section-label">Passed</div><div class="diagnosis-items">`;
        for (const p of findings.pass) {
            cardHTML += `<div class="dx-row"><span class="dx-icon dx-pass">✔</span><span class="dx-pass">${p}</span></div>`;
        }
        cardHTML += `</div></div>`;
    }

    if (uniqueRx.length > 0) {
        cardHTML += `<div class="diagnosis-summary">`;
        cardHTML += `<span class="rx-label">◈ PRESCRIPTION</span>`;
        for (const rx of uniqueRx) {
            cardHTML += `<div class="rx-item">${rx}</div>`;
        }
        cardHTML += `</div>`;
    }

    cardHTML += `</div></div>`;

    const cardContainer = document.createElement('div');
    cardContainer.innerHTML = cardHTML;
    relayList.appendChild(cardContainer.firstElementChild);

    relayList.scrollTop = relayList.scrollHeight;

    if (allOk) {
        setSprite('success', 'success');
        flashScreen('ok');
        okBeep();
        setTimeout(() => okBeep(), 200);
        const kpCount = kpEventsCollected.length;
        say(`Diagnosis complete. <span class='ok'>Clean bill of health!</span> ${totalRelays} relay(s), ${kpCount} KeyPackage(s), all in sync and Marmot-ready. Patient discharged.`);
    } else if (!hasFailures) {
        setSprite('writing', 'bounce');
        flashScreen('ok');
        okBeep();
        say(speak('minorWarn', { count: findings.warn.length }));
    } else {
        setSprite('error', 'error');
        flashScreen('err');
        errBeep();
        const categories = categorizeFailures(findings.fail);
        const rootHint = getRootCauseHint(auditCtx);
        const mainMsg = pickClosingMessage(auditCtx, findings.fail, categories);
        const useRootHint = rootHint && categories.length >= 2;
        const message = useRootHint ? `${rootHint} ${mainMsg}` : mainMsg;
        say(speak('failure', { count: findings.fail.length, message }));
    }

    isAuditing = false;
    setOnAllDone(() => {
        auditBtn.disabled = false;
        nip07Btn.disabled = false;
    });
}
