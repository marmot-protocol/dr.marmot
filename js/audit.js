import { nip19, SimplePool } from 'https://esm.sh/nostr-tools';
import { DEFAULT_RELAYS } from './config.js';
import { npubInput, nip07Btn, nextBtn, auditBtn, relayList, getChartActionButtons } from './dom.js';
import { errBeep, okBeep } from './audio.js';
import { say, clearQueue, setOnAllDone } from './dialog.js';
import { setSprite, startInvestigating, stopInvestigating } from './sprite.js';
import { speak, getDisplayName } from './personalities.js';
import {
    clearRelayPanel,
    setRelayState,
    appendResultSection,
    flashScreen,
} from './relay-panel.js';
import { addScanBar, removeScanBar, setScanProgress } from './scan-bar.js';
import { relayBootstrapAndDiscovery } from './audit/relayBootstrap.js';
import { assessRelaySync } from './audit/relaySync.js';
import { analyzeProfileVitals } from './audit/profileKind0.js';
import { analyzeNip65AndContacts } from './audit/nip65Contacts.js';
import { evaluateMarmot } from './audit/keypackages.js';
import { buildServicesAndDeprecation } from './audit/servicesDeprecation.js';
import {
    compileFindingsAndPrescriptions,
    categorizeFailures,
    getRootCauseHint,
    pickClosingMessage,
} from './audit/findingsPrescriptions.js';
import { renderChart } from './audit/chartRender.js';

let isAuditing = false;
let lastAuditState = null;

export function getAuditState() { return lastAuditState; }

export function resetAuditState() {
    lastAuditState = null;
    isAuditing = false;
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
    nextBtn.classList.add('hidden');
    clearRelayPanel();
    addScanBar();
    setScanProgress(0);

    setSprite('wave', 'bounce');
    const intro = speak(fromNip07 ? 'auditStartNip07' : 'auditStart', { npub: rawNpub.slice(0, 16) });
    await say(intro, () => { startInvestigating(); });

    const pool = new SimplePool();
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
        relayDiverges: false,
        nip65NoRead: false,
        nip65NoWrite: false,
        nip65Bloated: false,
        nip65Malformed: false,
        hasDeprecatedK4: false,
        hasDeprecatedK2: false,
        blossomConfigured: false,
        legacyDmsConfigured: false,
    };

    setSprite('listening', 'bounce');
    await say(speak('takingPulse'));

    const boot = await relayBootstrapAndDiscovery(pool, pubkey);
    const { relayData, relaysToInvestigate, userRelays, invalidUserRelays, urlValidityItems, relayStates } = boot;
    auditCtx.userRelayCount = userRelays.length;
    auditCtx.invalidRelayCount = invalidUserRelays.length;
    auditCtx.usedBootstrapFallback = userRelays.length === 0;

    for (const { relay, state, statusText } of relayStates) {
        setRelayState(relay, state, statusText);
    }
    setScanProgress(15);

    if (urlValidityItems.length > 0) appendResultSection('RELAY URL VALIDITY', urlValidityItems);
    if (userRelays.length > 0) {
        await say(speak('relayFound', { count: userRelays.length }));
    } else if (invalidUserRelays.length > 0) {
        await say(speak('relayInvalid', { count: invalidUserRelays.length }));
    } else {
        await say(speak('noRelays'));
    }
    setScanProgress(50);

    stopInvestigating();
    setSprite('thinking', 'bounce');
    await say(speak('examiningSync'));

    const sync = assessRelaySync(relaysToInvestigate, relayData);
    const {
        maxK0, maxK3, max10000, max10051, best10051,
        bestK10002, best10050, best10063, best10011, depK4, depK2,
        cwItems, relayStateUpdates, hasCrossed,
    } = sync;

    for (const { relay, state, statusText } of relayStateUpdates) {
        setRelayState(relay, state, statusText);
    }
    appendResultSection('RELAY SYNC (k0 / k3 / k10000)', cwItems);
    setScanProgress(65);

    const bestK0 = maxK0 ? [...relaysToInvestigate].map(r => relayData[r]?.[0]).find(e => e?.created_at === maxK0) : null;
    setSprite('magnify', 'bounce');
    await say(speak('vitalSigns'));
    const vitalResult = await analyzeProfileVitals(bestK0, pubkey);
    const { vitalItems, vitalErr, vitalWarn, nip05Verified } = vitalResult;
    auditCtx.vitalErrCount = vitalErr;
    auditCtx.vitalWarnCount = vitalWarn;
    auditCtx.nip05Verified = nip05Verified;

    if (vitalItems.length > 0) {
        appendResultSection('PROFILE VITAL SIGNS', vitalItems);
        if (vitalErr > 0) await say(speak('vitalGaps', { count: vitalErr }));
        else if (vitalWarn > 0) await say(`Profile basics present; ${vitalWarn} optional field(s) could strengthen your identity (NIP-05, about, picture).`);
        else await say(speak('vitalOk'));
    }

    let relayReachable = 0;
    for (const r of relaysToInvestigate) {
        const d = relayData[r];
        if (d && (d[0] || d[3] || d[10051])) relayReachable++;
    }
    const relayReachabilityItem = relayReachable < relaysToInvestigate.length
        ? { type: 'warn', text: `${relayReachable} of ${relaysToInvestigate.length} relay(s) reachable — some failed to respond; check relay status or firewall` }
        : { type: 'ok', text: `${relayReachable} of ${relaysToInvestigate.length} relay(s) reachable` };
    const resilienceItems = [relayReachabilityItem];
    if (relaysToInvestigate.length <= 1) {
        resilienceItems.push({ type: 'warn', text: 'Single relay — fragile! One outage = total unavailability' });
        resilienceItems.push({ type: 'warn', text: 'Prescription: Add more relays to k3 / k10002 / k10051 for redundancy' });
        await say(`<span class="warn">Single relay</span> — one outage and your profile is unreachable. Add 2–3 more relays for redundancy.`);
    } else {
        resilienceItems.push({ type: 'ok', text: `${relaysToInvestigate.length} relay(s) — good redundancy` });
        if (relayReachable < relaysToInvestigate.length) await say(speak('relayReachable', { reachable: relayReachable, total: relaysToInvestigate.length }));
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
        if (staleK0 !== null && staleK0 > 365) await say(`Profile last updated ${staleK0} days ago — consider refreshing if your details have changed.`);
        else if (staleK3 !== null && staleK3 > 365) await say(speak('contactsStale', { days: staleK3 }));
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

    const nip65Result = analyzeNip65AndContacts(bestK10002, bestK3, auditCtx);
    const { relayConfigItems, k3RelaySet, k10002RelaySet, canUnifyRelays, relayDivergenceVars } = nip65Result;
    appendResultSection('RELAY CONFIGURATION (NIP-65)', relayConfigItems);
    if (relayDivergenceVars) await say(speak('relayDivergence', relayDivergenceVars));

    setSprite('working', 'bounce');
    await say(speak(auditCtx.hasCrossedWires ? 'marmotPanelSync' : 'marmotPanel'));

    const marmotResult = await evaluateMarmot(pool, best10051, relaysToInvestigate, relayData, pubkey, auditCtx);
    const { mipItems, marmotRelays, kpEventsCollected, invalidMarmot, relayStateUpdates: marmotRelayStates, kpErrorHint } = marmotResult;
    for (const { relay, state, statusText } of marmotRelayStates) {
        setRelayState(relay, state, statusText);
    }
    setScanProgress(85);

    if (auditCtx.kpNoOverlapWithMain) {
        await say("KeyPackage relays aren't in your main relay list — inviters may need to connect to extra relays to find you.");
    }
    if (!best10051) await say(speak('no10051'));
    else if (marmotRelays.length > 0) {
        setSprite('surprised', 'bounce');
        await say(speak('kpRelaysFound', { count: marmotRelays.length }));
        if (kpEventsCollected.length === 0) {
            await say(`Kind 10051 lists ${marmotRelays.length} relay(s), but <span class='err'>no KeyPackages (k443)</span> found. Your client must publish at least one to receive Marmot DMs.`);
        } else {
            const kpErrors = mipItems.filter(i => i.type === 'err' && i.text?.startsWith('KP ')).length;
            if (kpErrors === 0) await say(speak('kpAllPass', { count: kpEventsCollected.length }));
            else await say(`<span class="err">${kpErrors} KeyPackage(s) failed</span> validation${kpErrorHint || ''}`);
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

    const { servicesItems, deprecationItems } = buildServicesAndDeprecation(best10050, best10063, best10011, depK4, depK2, nowSec, auditCtx);
    appendResultSection('SERVICES & IDENTITY', servicesItems);
    appendResultSection('DEPRECATION SCAN', deprecationItems);

    setScanProgress(100);
    removeScanBar();

    const allUsedRelays = [...new Set([...DEFAULT_RELAYS, ...relaysToInvestigate, ...marmotRelays])];
    pool.close(allUsedRelays);

    stopInvestigating();
    setSprite('writing', 'bounce');
    await say(speak('charting'));

    const compiled = compileFindingsAndPrescriptions({
        relayData,
        relaysToInvestigate,
        invalidUserRelays,
        invalidMarmot,
        mipItems,
        marmotRelays,
        kpEventsCollected,
        bestK0,
        bestK3,
        bestK10002,
        best10050,
        best10063,
        best10051,
        maxK0,
        maxK3,
        auditCtx,
        k3RelaySet,
        k10002RelaySet,
        canUnifyRelays,
        fromNip07,
        pubkey,
    });

    lastAuditState = compiled.lastAuditState;

    const { cardHTML } = renderChart({
        findings: compiled.findings,
        prescriptions: compiled.prescriptions,
        verdictClass: compiled.verdictClass,
        verdictIcon: compiled.verdictIcon,
        verdictLabel: compiled.verdictLabel,
        allOk: compiled.allOk,
        hasFailures: compiled.hasFailures,
        totalRelays: compiled.totalRelays,
        canRebroadcast: compiled.canRebroadcast,
        canDeleteKps: compiled.canDeleteKps,
        canUnifyRelays,
        rawNpub,
    }, getDisplayName);

    const cardContainer = document.createElement('div');
    cardContainer.innerHTML = cardHTML;
    const chartEl = cardContainer.firstElementChild;
    relayList.appendChild(chartEl);

    const { rebroadcast: rebroadcastBtn, deleteKps: deleteKpBtn, unifyRelays: unifyRelaysBtn } = getChartActionButtons(chartEl);
    if (rebroadcastBtn) {
        rebroadcastBtn.addEventListener('click', async () => {
            const { rebroadcastProfileAndContacts } = await import('./actions.js');
            rebroadcastBtn.disabled = true;
            rebroadcastBtn.classList.add('working');
            rebroadcastBtn.textContent = 'WORKING…';
            await rebroadcastProfileAndContacts();
            rebroadcastBtn.classList.remove('working');
            rebroadcastBtn.textContent = 'DONE';
        });
    }
    if (deleteKpBtn) {
        deleteKpBtn.addEventListener('click', async () => {
            const { deleteKeyPackages } = await import('./actions.js');
            deleteKpBtn.disabled = true;
            deleteKpBtn.classList.add('working');
            deleteKpBtn.textContent = 'WORKING…';
            await deleteKeyPackages();
            deleteKpBtn.classList.remove('working');
            deleteKpBtn.textContent = 'DONE';
        });
    }
    if (unifyRelaysBtn) {
        unifyRelaysBtn.addEventListener('click', async () => {
            const { unifyRelayLists } = await import('./actions.js');
            unifyRelaysBtn.disabled = true;
            unifyRelaysBtn.classList.add('working');
            unifyRelaysBtn.textContent = 'WORKING…';
            await unifyRelayLists();
            unifyRelaysBtn.classList.remove('working');
            unifyRelaysBtn.textContent = 'DONE';
        });
    }

    relayList.scrollTop = relayList.scrollHeight;

    if (compiled.allOk) {
        setSprite('success', 'success');
        flashScreen('ok');
        okBeep();
        setTimeout(() => okBeep(), 200);
        say(`Diagnosis complete. <span class='ok'>Clean bill of health!</span> ${compiled.totalRelays} relay(s), ${kpEventsCollected.length} KeyPackage(s), all in sync and Marmot-ready. Patient discharged.`);
    } else if (!compiled.hasFailures) {
        setSprite('writing', 'bounce');
        flashScreen('ok');
        okBeep();
        say(speak('minorWarn', { count: compiled.findings.warn.length }));
    } else {
        setSprite('error', 'error');
        flashScreen('err');
        errBeep();
        const categories = categorizeFailures(compiled.findings.fail);
        const rootHint = getRootCauseHint(auditCtx);
        const mainMsg = pickClosingMessage(auditCtx, compiled.findings.fail, categories);
        const useRootHint = rootHint && categories.length >= 2;
        const message = useRootHint ? `${rootHint} ${mainMsg}` : mainMsg;
        say(speak('failure', { count: compiled.findings.fail.length, message }));
    }

    isAuditing = false;
    setOnAllDone(() => {
        auditBtn.disabled = false;
        nip07Btn.disabled = false;
        nextBtn.classList.remove('hidden');
    });
}
