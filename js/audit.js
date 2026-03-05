import { nip19, SimplePool } from 'https://esm.sh/nostr-tools';
import { DEFAULT_RELAYS } from './config.js';
import { npubInput, nip07Btn, nextBtn, auditBtn, cancelBtn, relayList, getChartActionButtons } from './dom.js';
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
import { buildServicesAndDeprecation, evaluateInboxRelays } from './audit/servicesDeprecation.js';
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

async function runBootstrapPhase(pool, pubkey, auditCtx) {
    setSprite('listening', 'bounce');
    await say(speak('takingPulse'));

    const boot = await relayBootstrapAndDiscovery(pool, pubkey);
    const { userRelays, invalidUserRelays, urlValidityItems, relayStates } = boot;
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

    return boot;
}

async function runSyncPhase(relaysToInvestigate, relayData) {
    stopInvestigating();
    setSprite('thinking', 'bounce');
    await say(speak('examiningSync'));

    const sync = assessRelaySync(relaysToInvestigate, relayData);
    const { cwItems, relayStateUpdates } = sync;
    for (const { relay, state, statusText } of relayStateUpdates) {
        setRelayState(relay, state, statusText);
    }
    appendResultSection('RELAY SYNC (k0 / k3 / k10000)', cwItems);
    setScanProgress(65);
    return sync;
}

async function runVitalsPhase(bestK0, pubkey, auditCtx) {
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
        else if (vitalWarn > 0) {
            await say('Profile basics present; '
                + `${vitalWarn} optional field(s) could strengthen your identity (NIP-05, about, picture).`);
        } else {
            await say(speak('vitalOk'));
        }
    }
    return vitalResult;
}

async function runResiliencePhase(
    relaysToInvestigate,
    relayData,
    maxK0,
    maxK3,
    max10050,
    max10051,
    bestK3,
    cwItems,
    hasCrossed,
    auditCtx,
) {
    let relayReachable = 0;
    for (const relay of relaysToInvestigate) {
        const data = relayData[relay];
        if (data && (data[0] || data[3] || data[10002] || data[10050] || data[10051])) relayReachable++;
    }

    const relayReachabilityItem = relayReachable < relaysToInvestigate.length
        ? {
            type: 'warn',
            text: `${relayReachable} of ${relaysToInvestigate.length} relay(s) reachable — some failed to respond; check relay status or firewall`,
        }
        : { type: 'ok', text: `${relayReachable} of ${relaysToInvestigate.length} relay(s) reachable` };
    const resilienceItems = [relayReachabilityItem];
    if (relaysToInvestigate.length <= 1) {
        resilienceItems.push({
            type: 'warn',
            text: 'Single relay — fragile! One outage = total unavailability',
        });
        resilienceItems.push({
            type: 'warn',
            text: 'Prescription: Add more relays to k3 / k10002 / k10051 for redundancy',
        });
        await say(
            "<span class=\"warn\">Single relay</span> — one outage and your profile is unreachable. "
            + 'Add 2–3 more relays for redundancy.',
        );
    } else {
        resilienceItems.push({ type: 'ok', text: `${relaysToInvestigate.length} relay(s) — good redundancy` });
        if (relayReachable < relaysToInvestigate.length) {
            await say(speak('relayReachable', {
                reachable: relayReachable,
                total: relaysToInvestigate.length,
            }));
        }
    }
    appendResultSection('RELAY RESILIENCE', resilienceItems);

    const nowSec = Math.floor(Date.now() / 1000);
    const daysAgo = ts => (ts ? Math.floor((nowSec - ts) / 86400) : null);
    const formatFreshnessText = (days) => {
        if (days === 0) return 'today';
        if (days === 1) return '1 day ago';
        if (days < 365) return `${days} days ago`;
        return `over 1 year ago (${days} days)`;
    };
    const freshnessItems = [];
    if (maxK0 > 0) {
        const days = daysAgo(maxK0);
        freshnessItems.push({
            type: days !== null && days > 365 ? 'warn' : 'ok',
            text: `Profile (k0): ${formatFreshnessText(days)}`,
        });
    }
    if (maxK3 > 0) {
        const days = daysAgo(maxK3);
        freshnessItems.push({
            type: days !== null && days > 365 ? 'warn' : 'ok',
            text: `Contacts (k3): ${formatFreshnessText(days)}`,
        });
    }
    if (max10050 > 0) {
        const days = daysAgo(max10050);
        freshnessItems.push({
            type: days !== null && days > 365 ? 'warn' : 'ok',
            text: `Inbox relays (k10050): ${formatFreshnessText(days)}`,
        });
    }
    if (max10051 > 0) {
        const days = daysAgo(max10051);
        freshnessItems.push({
            type: days !== null && days > 365 ? 'warn' : 'ok',
            text: `KeyPackage list (k10051): ${formatFreshnessText(days)}`,
        });
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

    const followCount = Array.isArray(bestK3?.tags)
        ? bestK3.tags.filter(t => Array.isArray(t) && t.length > 1 && t[0] === 'p' && typeof t[1] === 'string').length
        : 0;
    const socialItems = [];
    if (maxK3 > 0) {
        socialItems.push({ type: 'ok', text: `Follow list: ${followCount} contact(s)` });
        if (followCount === 0) {
            socialItems.push({
                type: 'warn',
                text: 'Empty follow list — some clients expect at least one contact',
            });
        }
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

    return { nowSec };
}

async function runNip65Phase(bestK10002, bestK3, auditCtx) {
    const nip65Result = analyzeNip65AndContacts(bestK10002, bestK3, auditCtx);
    const { relayConfigItems, relayDivergenceVars } = nip65Result;
    appendResultSection('RELAY CONFIGURATION (NIP-65)', relayConfigItems);
    if (relayDivergenceVars) await say(speak('relayDivergence', relayDivergenceVars));
    return nip65Result;
}

async function runMarmotPhase(pool, best10051, relaysToInvestigate, relayData, pubkey, auditCtx) {
    setSprite('working', 'bounce');
    await say(speak(auditCtx.hasCrossedWires ? 'marmotPanelSync' : 'marmotPanel'));
    const marmotResult = await evaluateMarmot(
        pool,
        best10051,
        relaysToInvestigate,
        relayData,
        pubkey,
        auditCtx,
    );

    const { mipItems, marmotRelays, kpEventsCollected, relayStateUpdates: marmotRelayStates, kpErrorHint } = marmotResult;
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
        const nowSec = Math.floor(Date.now() / 1000);
        const daysAgoKp = ts => (ts ? Math.floor((nowSec - ts) / 86400) : null);
        const ciphersuites = new Set();
        const clients = new Set();
        let newestKp = 0;
        let oldestKp = Infinity;
        for (const kp of kpEventsCollected) {
            const cph = Array.isArray(kp.tags) ? kp.tags.find(t => Array.isArray(t) && t.length >= 2 && t[0] === 'mls_ciphersuite') : undefined;
            if (cph?.[1]) ciphersuites.add(cph[1]);
            const cli = Array.isArray(kp.tags) ? kp.tags.find(t => Array.isArray(t) && t.length >= 2 && t[0] === 'client') : undefined;
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
            if (ciphersuites.size > 1) {
                kpStatsItems.push({
                    type: 'warn',
                    text: 'Multiple ciphersuites — different clients may use different crypto',
                });
            }
        }
        if (clients.size > 0) {
            kpStatsItems.push({
                type: 'ok',
                text: `Client(s): ${[...clients].slice(0, 5).join(', ')}${clients.size > 5 ? '…' : ''}`,
            });
        }
        if (newestKp > 0) {
            const days = daysAgoKp(newestKp);
            kpStatsItems.push({
                type: days !== null && days > 90 ? 'warn' : 'ok',
                text: `Newest KP: ${days === 0 ? 'today' : days === 1 ? '1 day ago' : days < 90 ? `${days} days ago` : `${days} days ago — consider rotating`}`,
            });
        }
        if (oldestKp < Infinity && kpEventsCollected.length > 1) {
            const days = daysAgoKp(oldestKp);
            kpStatsItems.push({
                type: 'ok',
                text: `Oldest KP: ${days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`}`,
            });
        }
        if (kpEventsCollected.length === 1) {
            kpStatsItems.push({
                type: 'warn',
                text: 'Single KeyPackage — add more for redundancy (different devices / clients)',
            });
        }
        appendResultSection('KEYPACKAGE VITAL STATS', kpStatsItems);
    }

    return marmotResult;
}

function runCleanupPhase(pool, relaysToInvestigate, marmotRelays) {
    setScanProgress(100);
    removeScanBar();
    const allUsedRelays = [...new Set([...DEFAULT_RELAYS, ...relaysToInvestigate, ...marmotRelays])];
    pool.close(allUsedRelays);
}

async function runCompileAndRenderPhase(rawNpub, compileParams, kpEventsCollected, canUnifyRelays, auditCtx) {
    stopInvestigating();
    setSprite('writing', 'bounce');
    await say(speak('charting'));

    const compiled = compileFindingsAndPrescriptions(compileParams);
    lastAuditState = compiled.lastAuditState;

    // Attach compiled result to audit state for OR access
    lastAuditState.compiledResult = {
        findings: compiled.findings,
        findingsWithHints: compiled.findingsWithHints,
        prescriptions: compiled.prescriptions,
        canRebroadcast: compiled.canRebroadcast,
        canDeleteKps: compiled.canDeleteKps,
        canUnifyRelays,
        allOk: compiled.allOk,
        hasFailures: compiled.hasFailures,
        hasWarnings: compiled.hasWarnings,
        doctorNotes: compiled.doctorNotes,
        categories: compiled.categories,
    };

    const canOperate = Boolean(window.nostr) && Boolean(compiled.lastAuditState?.fromNip07);

    const { cardHTML } = renderChart({
        findings: compiled.findings,
        findingsWithHints: compiled.findingsWithHints,
        prescriptions: compiled.prescriptions,
        verdictClass: compiled.verdictClass,
        verdictIcon: compiled.verdictIcon,
        verdictLabel: compiled.verdictLabel,
        allOk: compiled.allOk,
        hasFailures: compiled.hasFailures,
        totalRelays: compiled.totalRelays,
        canRebroadcast: compiled.canRebroadcast,
        canDeleteKps: compiled.canDeleteKps,
        canDeleteOrphanedKps: compiled.canDeleteOrphanedKps,
        canDeleteKind4: compiled.canDeleteKind4,
        canUnifyRelays,
        canOperate,
        rawNpub,
        doctorNotes: compiled.doctorNotes,
        auditState: lastAuditState,
    }, getDisplayName, speak);

    // Collapse relay status rows and result sections behind an expandable summary
    const existingRows = relayList.querySelectorAll('.relay-row, .result-section');
    if (existingRows.length > 0) {
        const collapser = document.createElement('div');
        collapser.className = 'relay-rows-collapsed';
        collapser.dataset.count = existingRows.length;
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'relay-collapse-toggle';
        toggleBtn.textContent = `▶ VIEW RELAY DETAILS (${existingRows.length} sections)`;
        toggleBtn.addEventListener('click', () => {
            collapser.classList.toggle('relay-rows-expanded');
            toggleBtn.textContent = collapser.classList.contains('relay-rows-expanded')
                ? `▼ HIDE RELAY DETAILS`
                : `▶ VIEW RELAY DETAILS (${existingRows.length} sections)`;
        });
        collapser.appendChild(toggleBtn);
        for (const row of existingRows) {
            collapser.appendChild(row);
        }
        relayList.appendChild(collapser);
    }

    const cardContainer = document.createElement('div');
    cardContainer.innerHTML = cardHTML;
    const chartEl = cardContainer.firstElementChild;
    relayList.appendChild(chartEl);

    // Wire up nak toggle and copy buttons
    chartEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'toggle-nak') {
            const wrap = btn.closest('.rx-row-wrap');
            const container = wrap?.querySelector('.rx-nak-container');
            if (container) container.classList.toggle('hidden');
        } else if (action === 'copy-nak') {
            const pre = btn.closest('.nak-cmd-block')?.querySelector('.nak-cmd-pre code');
            if (pre) {
                navigator.clipboard.writeText(pre.textContent).then(() => {
                    btn.textContent = 'COPIED ✔';
                    setTimeout(() => { btn.textContent = 'COPY'; }, 2000);
                });
            }
        }
    });

    // Wire up collapsible pass-group toggle in STATUS EFFECTS
    const passGroupToggle = chartEl.querySelector('[data-action="toggle-dx-group"]');
    if (passGroupToggle) {
        passGroupToggle.addEventListener('click', () => {
            const group = passGroupToggle.closest('.dx-group');
            if (group) group.classList.toggle('dx-group-collapsed');
        });
    }

    const {
        rebroadcast: rebroadcastBtn,
        deleteKps: deleteKpBtn,
        unifyRelays: unifyRelaysBtn,
        deleteOrphanedKps: deleteOrphanedKpsBtn,
        deleteKind4: deleteKind4Btn,
    } = getChartActionButtons(chartEl);
    if (rebroadcastBtn) {
        rebroadcastBtn.addEventListener('click', async () => {
            const { rebroadcastProfileAndContacts } = await import('./actions.js');
            rebroadcastBtn.disabled = true;
            rebroadcastBtn.classList.add('working');
            rebroadcastBtn.textContent = 'WORKING…';
            let succeeded = false;
            try {
                await rebroadcastProfileAndContacts();
                succeeded = true;
            } catch (err) {
                console.error('Rebroadcast action failed', err);
            } finally {
                rebroadcastBtn.disabled = false;
                rebroadcastBtn.classList.remove('working');
                rebroadcastBtn.textContent = succeeded ? 'DONE' : 'ERROR';
            }
        });
    }
    if (deleteKpBtn) {
        deleteKpBtn.addEventListener('click', async () => {
            const { deleteKeyPackages } = await import('./actions.js');
            deleteKpBtn.disabled = true;
            deleteKpBtn.classList.add('working');
            deleteKpBtn.textContent = 'WORKING…';
            let succeeded = false;
            try {
                await deleteKeyPackages();
                succeeded = true;
            } catch (err) {
                console.error('Delete KeyPackages action failed', err);
            } finally {
                deleteKpBtn.disabled = false;
                deleteKpBtn.classList.remove('working');
                deleteKpBtn.textContent = succeeded ? 'DONE' : 'ERROR';
            }
        });
    }
    if (unifyRelaysBtn) {
        unifyRelaysBtn.addEventListener('click', async () => {
            const { unifyRelayLists } = await import('./actions.js');
            unifyRelaysBtn.disabled = true;
            unifyRelaysBtn.classList.add('working');
            unifyRelaysBtn.textContent = 'WORKING…';
            let succeeded = false;
            try {
                await unifyRelayLists();
                succeeded = true;
            } catch (err) {
                console.error('Unify relay lists action failed', err);
            } finally {
                unifyRelaysBtn.disabled = false;
                unifyRelaysBtn.classList.remove('working');
                unifyRelaysBtn.textContent = succeeded ? 'DONE' : 'ERROR';
            }
        });
    }

    if (deleteOrphanedKpsBtn) {
        deleteOrphanedKpsBtn.addEventListener('click', async () => {
            const { deleteOrphanedKeyPackages } = await import('./actions.js');
            deleteOrphanedKpsBtn.disabled = true;
            deleteOrphanedKpsBtn.classList.add('working');
            deleteOrphanedKpsBtn.textContent = 'WORKING…';
            let succeeded = false;
            try {
                await deleteOrphanedKeyPackages();
                succeeded = true;
            } catch (err) {
                console.error('Delete orphaned KPs action failed', err);
            } finally {
                deleteOrphanedKpsBtn.disabled = false;
                deleteOrphanedKpsBtn.classList.remove('working');
                deleteOrphanedKpsBtn.textContent = succeeded ? 'DONE' : 'ERROR';
            }
        });
    }
    if (deleteKind4Btn) {
        deleteKind4Btn.addEventListener('click', async () => {
            const { deleteDeprecatedKind4 } = await import('./actions.js');
            deleteKind4Btn.disabled = true;
            deleteKind4Btn.classList.add('working');
            deleteKind4Btn.textContent = 'WORKING…';
            let succeeded = false;
            try {
                await deleteDeprecatedKind4();
                succeeded = true;
            } catch (err) {
                console.error('Delete kind 4 action failed', err);
            } finally {
                deleteKind4Btn.disabled = false;
                deleteKind4Btn.classList.remove('working');
                deleteKind4Btn.textContent = succeeded ? 'DONE' : 'ERROR';
            }
        });
    }

    const { operatingRoom: orBtn } = getChartActionButtons(chartEl);
    if (orBtn) {
        orBtn.addEventListener('click', async () => {
            const { enterOperatingRoom } = await import('./operate/room.js');
            orBtn.disabled = true;
            orBtn.classList.add('working');
            orBtn.textContent = 'PREPPING…';
            try {
                await enterOperatingRoom();
            } catch (err) {
                console.error('Operating Room entry failed', err);
                orBtn.disabled = false;
                orBtn.classList.remove('working');
                orBtn.textContent = '⚕ OPERATING ROOM';
            }
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

    return compiled;
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
    lastAuditState = null;
    clearQueue();
    auditBtn.disabled = true;
    nip07Btn.disabled = true;
    nextBtn.classList.add('hidden');
    cancelBtn.classList.remove('hidden');
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
        has10050: false,
        inboxRelayCount: 0,
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

    let marmotRelaysForCleanup = [];
    let relaysToInvestigateForCleanup = [];
    try {
        const boot = await runBootstrapPhase(pool, pubkey, auditCtx);
        const { relayData, relaysToInvestigate, invalidUserRelays } = boot;
        relaysToInvestigateForCleanup = relaysToInvestigate;

        const sync = await runSyncPhase(relaysToInvestigate, relayData);
        const {
            maxK0,
            maxK3,
            max10050,
            max10051,
            best10051,
            bestK10002,
            best10050,
            best10063,
            best10011,
            depK4,
            depK2,
            cwItems,
            hasCrossed,
        } = sync;

        const bestK0 = maxK0
            ? [...relaysToInvestigate].map(r => relayData[r]?.[0]).find(e => e?.created_at === maxK0)
            : null;
        await runVitalsPhase(bestK0, pubkey, auditCtx);

        const bestK3 = maxK3
            ? [...relaysToInvestigate].map(r => relayData[r]?.[3]).find(e => e?.created_at === maxK3)
            : null;
        const resilience = await runResiliencePhase(
            relaysToInvestigate,
            relayData,
            maxK0,
            maxK3,
            max10050,
            max10051,
            bestK3,
            cwItems,
            hasCrossed,
            auditCtx,
        );
        const { nowSec } = resilience;

        const nip65Result = await runNip65Phase(bestK10002, bestK3, auditCtx);
        const { k3RelaySet, k10002RelaySet, canUnifyRelays } = nip65Result;

        const marmotResult = await runMarmotPhase(
            pool,
            best10051,
            relaysToInvestigate,
            relayData,
            pubkey,
            auditCtx,
        );
        const { mipItems, marmotRelays, kpEventsCollected, invalidMarmot } = marmotResult;
        marmotRelaysForCleanup = marmotRelays;

        // --- INBOX RELAYS (NIP-17) ---
        await say(speak('inboxRelayCheck'));
        const { inboxItems, inboxRelays, hasOverlapWarning } = evaluateInboxRelays(
            best10050,
            k10002RelaySet,
            auditCtx,
        );
        if (!best10050) {
            await say(speak('no10050'));
        } else if (inboxRelays.length > 0) {
            await say(speak('inboxRelaysFound', { count: inboxRelays.length }));
            if (hasOverlapWarning) {
                await say(speak('inboxNoOverlap'));
            }
        }
        appendResultSection('INBOX RELAYS (NIP-17)', inboxItems);

        // --- ORPHANED KEYPACKAGES ---
        const advertisedRelaySet = new Set(
            marmotRelays.map(u => u.trim().toLowerCase()),
        );
        const orphanedKpRelays = [];
        if (marmotRelays.length > 0) {
            for (const r of relaysToInvestigate) {
                if (!advertisedRelaySet.has(r.trim().toLowerCase())
                    && relayData[r]?.[443]) {
                    orphanedKpRelays.push(r);
                }
            }
        }
        if (orphanedKpRelays.length > 0) {
            await say(speak('orphanedKps', { count: orphanedKpRelays.length }));
        }

        const services = buildServicesAndDeprecation(
            best10050,
            best10063,
            best10011,
            depK4,
            depK2,
            nowSec,
            auditCtx,
        );
        const { servicesItems, deprecationItems } = services;
        appendResultSection('SERVICES & IDENTITY', servicesItems);
        appendResultSection('DEPRECATION SCAN', deprecationItems);

        runCleanupPhase(pool, relaysToInvestigate, marmotRelays);

        await runCompileAndRenderPhase(
            rawNpub,
            {
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
                inboxRelays,
                inboxItems,
                orphanedKpRelays,
                maxK0,
                maxK3,
                auditCtx,
                k3RelaySet,
                k10002RelaySet,
                canUnifyRelays,
                fromNip07,
                pubkey,
            },
            kpEventsCollected,
            canUnifyRelays,
            auditCtx,
        );
    } catch (err) {
        console.error('Audit failed with unexpected error', err);
        removeScanBar();
        try { pool.close([...new Set([...DEFAULT_RELAYS, ...relaysToInvestigateForCleanup, ...marmotRelaysForCleanup])]); } catch { /* ignore */ }
    } finally {
        isAuditing = false;
        cancelBtn.classList.add('hidden');
        setOnAllDone(() => {
            auditBtn.disabled = false;
            nip07Btn.disabled = !window.nostr;
            nextBtn.classList.remove('hidden');
        });
    }
}
