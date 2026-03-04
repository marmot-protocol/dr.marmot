/**
 * Operating Room — the main orchestrator.
 * Transforms the relay panel into a surgical relay management view.
 * Handles all user interaction, health diagnostics, and procedure execution.
 */

import { getAuditState } from '../audit.js';
import { relayList, getTrayByKind, getAddBtnByKind } from '../dom.js';
import { say } from '../dialog.js';
import { speak } from '../personalities.js';
import { setSprite } from '../sprite.js';
import { okBeep, errBeep, scanBeep } from '../audio.js';
import { flashScreen, setRelayState, appendResultSection } from '../relay-panel.js';
import { addScanBar, removeScanBar, setScanProgress } from '../scan-bar.js';

import {
    initEditorState,
    renderEditorPanel,
    renderStagedSummary,
    stageAddRelay,
    stageRemoveRelay,
    stageToggleReadWrite,
    hasAnyStagedChanges,
    totalStagedChanges,
    clearAllChanges,
    getRelayList,
} from './editor.js';

import { checkAllRelaysHealth } from './health.js';
import { planProcedures, executeAllProcedures } from './procedures.js';
import { autoStageFromPrescriptions } from './autostage.js';
import {
    initGuide,
    isGuidedMode,
    getCurrentStep,
    getTotalSteps,
    nextStep,
    skipStep,
    exitGuide,
    switchToManual,
    resumeGuide,
    renderGuideCard,
    renderGuideResumeBar,
} from './guide.js';

let isOperating = false;
let healthResults = null;
let orSessionId = 0;
/** @type {HTMLElement[]} Saved chart DOM nodes (preserved with event listeners) */
let savedChartNodes = [];

/**
 * Check if the Operating Room is currently active.
 * @returns {boolean}
 */
export function isInOperatingRoom() {
    return isOperating;
}

/**
 * Enter the Operating Room.
 * Called when user clicks OPERATE on the patient chart.
 */
export async function enterOperatingRoom() {
    const state = getAuditState();
    if (!state) {
        await say(speak('noAuditData') || 'No audit data available.');
        return;
    }

    if (!window.nostr) {
        await say(speak('noNip07ForAction') || 'Operating Room requires NIP-07 for signing.');
        return;
    }

    if (!state.fromNip07) {
        await say(speak('orRequiresNip07') || 'Sign in with NIP-07 first — the Operating Room can only modify your own relays.');
        return;
    }

    isOperating = true;
    orSessionId++;
    healthResults = new Map();

    // Save current relay list DOM nodes (preserves event listeners) [S1 fix]
    savedChartNodes = [];
    while (relayList.firstChild) {
        savedChartNodes.push(relayList.removeChild(relayList.firstChild));
    }

    // Initialize editor state from audit results
    initEditorState(state);

    // Bind the delegated click handler once [C1 fix]
    relayList.addEventListener('click', handleEditorClick);

    // Pre-OR briefing — doctor explains the surgical plan
    setSprite('working', 'bounce');
    await say(speak('orIntro'));

    // Auto-stage from prescriptions
    const compiled = state.compiledResult;
    let autoStageResult = null;
    if (compiled && compiled.prescriptions?.length > 0) {
        autoStageResult = autoStageFromPrescriptions(state, compiled);

        // Pre-OR briefing with auto-stage summary
        if (autoStageResult.staged > 0) {
            await say(speak('orBriefingAutoStaged', {
                staged: autoStageResult.staged,
                actions: autoStageResult.actions.length,
            }));
        }
        if (autoStageResult.suggestions.length > 0) {
            await say(speak('orBriefingSuggestions', {
                count: autoStageResult.suggestions.length,
            }));
        }

        // Initialize guided mode
        initGuide(compiled.prescriptions, compiled.findings, state);
        if (getTotalSteps() > 0) {
            await say(speak('orBriefingGuided', { steps: getTotalSteps() }));
        }
    }

    // Render the editor (with guide card if in guided mode)
    renderRoom();

    // Start health checks in background
    runHealthChecks(state);
}

/**
 * Exit the Operating Room, restoring the previous relay panel.
 */
export function exitOperatingRoom() {
    isOperating = false;
    orSessionId++;
    healthResults = null;
    clearAllChanges();
    exitGuide();

    // Remove the delegated click handler [S2 fix]
    relayList.removeEventListener('click', handleEditorClick);

    // Restore saved chart DOM nodes (with intact event listeners) [S1 fix]
    relayList.innerHTML = '';
    for (const node of savedChartNodes) {
        relayList.appendChild(node);
    }
    savedChartNodes = [];

    setSprite('idle');
}

/**
 * Render or re-render the Operating Room UI.
 * Does NOT re-bind the click handler — it's bound once on entry. [C1 fix]
 */
function renderRoom() {
    let guideHtml = '';
    if (isGuidedMode()) {
        const step = getCurrentStep();
        if (step) {
            guideHtml = renderGuideCard(step);
        }
    } else if (getTotalSteps() > 0) {
        guideHtml = renderGuideResumeBar();
    }

    const editorHtml = renderEditorPanel(healthResults);
    relayList.innerHTML = guideHtml + editorHtml;
    relayList.scrollTop = 0;
    bindInputEvents();

    // Highlight targeted tray in guided mode
    if (isGuidedMode()) {
        const step = getCurrentStep();
        if (step?.targetKind) {
            const tray = getTrayByKind(relayList, step.targetKind);
            if (tray) {
                tray.classList.add('or-tray-highlighted');
                tray.classList.remove('or-tray-collapsed');
            }
        }
    }
}

/**
 * Run health checks on all relays across all kinds.
 * @param {Object} auditState - Audit state
 */
async function runHealthChecks(auditState) {
    const session = orSessionId;

    // Collect all unique relay URLs from all kinds
    const allUrls = new Set();
    for (const kind of [10002, 10050, 10051, 3]) {
        for (const entry of getRelayList(kind)) {
            allUrls.add(entry.url);
        }
    }
    // Also include the investigation relays
    if (auditState.relaysToInvestigate) {
        for (const url of auditState.relaysToInvestigate) allUrls.add(url);
    }

    if (allUrls.size === 0) return;

    scanBeep();
    await say(speak('orHealthStart') || 'Running relay diagnostics...');
    if (session !== orSessionId) return; // OR closed during say()

    addScanBar();
    setScanProgress(10);

    let checked = 0;
    const total = allUrls.size;

    const results = await checkAllRelaysHealth(
        [...allUrls],
        (_url, phase) => {
            if (session !== orSessionId) return;
            if (phase === 'connecting') scanBeep();
        },
        (_result) => {
            if (session !== orSessionId) return;
            checked++;
            const pct = Math.round(10 + (80 * checked / total));
            setScanProgress(pct);
        },
    );

    // Bail if OR was closed during health checks
    if (session !== orSessionId) return;

    healthResults = results;
    setScanProgress(100);
    removeScanBar();

    // Report summary
    const dead = [...healthResults.values()].filter(r => r.status === 'dead').length;
    const slow = [...healthResults.values()].filter(r => r.status === 'warn').length;
    const healthy = [...healthResults.values()].filter(r => r.status === 'ok').length;

    if (dead > 0) {
        await say(speak('orHealthDead', { count: dead }) || `<span class="err">${dead} relay(s) unreachable.</span> Consider removing dead relays.`);
    } else if (slow > 0) {
        await say(speak('orHealthSlow', { count: slow }) || `${slow} relay(s) running slow. ${healthy} healthy.`);
    } else {
        await say(speak('orHealthGood', { count: healthy }) || `All ${healthy} relay(s) responding. Vitals stable.`);
    }

    if (session !== orSessionId) return;

    // Re-render with health data
    renderRoom();
}

/**
 * Bind keydown events on add-relay inputs.
 * These are on elements replaced by innerHTML, so must be rebound on each render.
 * The click handler is NOT rebound — it's delegated on relayList once.
 */
function bindInputEvents() {
    const inputs = relayList.querySelectorAll('.or-add-input');
    for (const input of inputs) {
        input.addEventListener('keydown', handleAddInputKeydown);
    }
}

/**
 * Compute new read/write state when toggling a bit.
 * @param {string} currentReadWrite - Current state: 'read'|'write'|'rw'
 * @param {'read'|'write'} toggleBit - Which bit to flip
 * @returns {string} New read/write state
 */
function computeNewReadWrite(currentReadWrite, toggleBit) {
    const isRead = currentReadWrite === 'read' || currentReadWrite === 'rw';
    const isWrite = currentReadWrite === 'write' || currentReadWrite === 'rw';

    let newRead = isRead;
    let newWrite = isWrite;

    if (toggleBit === 'read') newRead = !isRead;
    else newWrite = !isWrite;

    // Can't have neither — default to both
    if (!newRead && !newWrite) return 'rw';
    if (newRead && newWrite) return 'rw';
    if (newRead) return 'read';
    return 'write';
}

/**
 * Handle delegated click events in the editor.
 * @param {Event} e
 */
async function handleEditorClick(e) {
    // Only handle OR actions (prefixed with or- data-actions or known OR actions)
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;

    // Guard: only handle OR-specific actions to avoid collisions
    const OR_ACTIONS = [
        'toggle-tray', 'add-relay', 'remove-relay', 'undo-remove',
        'toggle-rw', 'discard-all', 'commit-operate', 'close-or',
        'guide-next', 'guide-skip', 'guide-manual', 'guide-resume', 'guide-fix',
        'toggle-nak', 'copy-nak',
    ];
    if (!OR_ACTIONS.includes(action)) return;

    const kind = btn.dataset.kind ? Number(btn.dataset.kind) : null;
    const url = btn.dataset.url;

    switch (action) {
    case 'toggle-tray': {
        const tray = btn.closest('.or-tray');
        if (tray) tray.classList.toggle('or-tray-collapsed');
        break;
    }
    case 'add-relay': {
        if (kind === null) break;
        const input = relayList.querySelector(`.or-add-input[data-kind="${kind}"]`);
        const errorEl = relayList.querySelector(`.or-add-error[data-kind="${kind}"]`);
        if (!input) break;
        const relayUrl = input.value.trim();
        if (!relayUrl) break;

        const result = stageAddRelay(kind, relayUrl);
        if (result.ok) {
            input.value = '';
            errorEl?.classList.add('hidden');
            scanBeep();
            renderRoom();
        } else {
            if (errorEl) {
                errorEl.textContent = result.reason || 'Invalid relay URL';
                errorEl.classList.remove('hidden');
            }
        }
        break;
    }
    case 'remove-relay': {
        if (kind === null || !url) break;
        const result = stageRemoveRelay(kind, url);
        if (result.ok) {
            scanBeep();
            renderRoom();
        }
        break;
    }
    case 'undo-remove': {
        if (kind === null || !url) break;
        // Re-add is equivalent to staging an add for a removed relay
        stageAddRelay(kind, url);
        scanBeep();
        renderRoom();
        break;
    }
    case 'toggle-rw': {
        if (!url) break;
        const entry = getRelayList(10002).find(
            r => r.url.toLowerCase() === url.toLowerCase() && !r.removed,
        );
        if (!entry) break;

        const newRw = computeNewReadWrite(entry.readWrite, btn.dataset.rw);
        stageToggleReadWrite(url, newRw);
        scanBeep();
        renderRoom();
        break;
    }
    case 'discard-all': {
        clearAllChanges();
        await say(speak('orDiscard') || 'Changes discarded.');
        renderRoom();
        break;
    }
    case 'commit-operate': {
        await executeOperations();
        break;
    }
    case 'close-or': {
        exitOperatingRoom();
        await say(speak('orClose') || 'Operating Room closed.');
        break;
    }
    case 'guide-next': {
        const next = nextStep();
        if (next) {
            await say(speak('guideStepAdvance', { step: next.index + 1, total: getTotalSteps() }));
        } else {
            exitGuide();
            await say(speak('guideComplete') || 'Treatment plan complete. Review and operate when ready.');
        }
        renderRoom();
        break;
    }
    case 'guide-skip': {
        const next = skipStep();
        if (next) {
            await say(speak('guideStepSkip') || 'Skipped. Moving on.');
        } else {
            exitGuide();
            await say(speak('guideComplete') || 'Treatment plan complete.');
        }
        renderRoom();
        break;
    }
    case 'guide-manual': {
        switchToManual();
        await say(speak('guideManualMode') || 'Manual mode. Edit freely.');
        renderRoom();
        break;
    }
    case 'guide-resume': {
        resumeGuide();
        await say(speak('guideResume') || 'Resuming guided treatment.');
        renderRoom();
        break;
    }
    case 'toggle-nak': {
        const container = btn.closest('.guide-card, .rx-row-wrap')?.querySelector('.guide-nak-container, .rx-nak-container');
        if (container) container.classList.toggle('hidden');
        break;
    }
    case 'copy-nak': {
        const pre = btn.closest('.nak-cmd-block')?.querySelector('.nak-cmd-pre code');
        if (pre) {
            navigator.clipboard.writeText(pre.textContent).then(() => {
                btn.textContent = 'COPIED ✔';
                setTimeout(() => { btn.textContent = 'COPY'; }, 2000);
            });
        }
        break;
    }
    case 'guide-fix': {
        const fixAction = btn.dataset.fixAction;
        if (!fixAction) break;
        btn.disabled = true;
        btn.textContent = 'WORKING…';
        let succeeded = false;
        try {
            await executeFixAction(fixAction);
            succeeded = true;
        } catch (err) {
            console.error('Guide fix action failed', err);
            errBeep();
        }
        btn.disabled = false;
        btn.textContent = succeeded ? 'DONE ✔' : 'ERROR';
        if (succeeded) {
            okBeep();
            // Auto-advance to next step after fix
            const next = nextStep();
            if (next) {
                await say(speak('guideStepAdvance', { step: next.index + 1, total: getTotalSteps() }));
            } else {
                exitGuide();
                await say(speak('guideComplete') || 'Treatment plan complete.');
            }
            renderRoom();
        }
        break;
    }
    }
}

/**
 * Execute a fix action by name (dispatches to the appropriate actions.js function).
 * @param {string} fixAction - One of: rebroadcast, delete-kps, delete-orphaned-kps, unify-relays, delete-kind4
 */
async function executeFixAction(fixAction) {
    switch (fixAction) {
    case 'rebroadcast': {
        const { rebroadcastProfileAndContacts } = await import('../actions.js');
        await rebroadcastProfileAndContacts();
        break;
    }
    case 'delete-kps': {
        const { deleteKeyPackages } = await import('../actions.js');
        await deleteKeyPackages();
        break;
    }
    case 'delete-orphaned-kps': {
        const { deleteOrphanedKeyPackages } = await import('../actions.js');
        await deleteOrphanedKeyPackages();
        break;
    }
    case 'unify-relays': {
        const { unifyRelayLists } = await import('../actions.js');
        await unifyRelayLists();
        break;
    }
    case 'delete-kind4': {
        const { deleteDeprecatedKind4 } = await import('../actions.js');
        await deleteDeprecatedKind4();
        break;
    }
    default:
        throw new Error('Unknown fix action: ' + fixAction);
    }
}

/**
 * Handle Enter key on add-relay inputs.
 * @param {KeyboardEvent} e
 */
function handleAddInputKeydown(e) {
    if (e.key !== 'Enter') return;
    const kind = Number(e.target.dataset.kind);
    const addBtn = getAddBtnByKind(relayList, kind);
    if (addBtn) addBtn.click();
}

/**
 * Execute all staged operations (the surgery itself).
 */
async function executeOperations() {
    if (!hasAnyStagedChanges()) {
        await say('No changes to apply.');
        return;
    }

    const auditState = getAuditState();
    if (!auditState) return;

    const procedures = planProcedures();
    if (procedures.length === 0) {
        await say('No procedures to execute.');
        return;
    }

    // Show diff preview
    const diffHtml = renderStagedSummary();
    if (diffHtml) {
        const diffContainer = document.createElement('div');
        diffContainer.innerHTML = diffHtml;
        relayList.appendChild(diffContainer);
        relayList.scrollTop = relayList.scrollHeight;
    }

    const stagedCount = totalStagedChanges();
    setSprite('working', 'bounce');
    await say(speak('orOperateStart', { count: procedures.length, changes: stagedCount }));

    addScanBar();
    setScanProgress(5);

    // Determine publish targets: all relays we know about
    const publishRelays = [...new Set([
        ...(Array.isArray(auditState.relaysToInvestigate) ? auditState.relaysToInvestigate : []),
        ...(Array.isArray(auditState.marmotRelays) ? auditState.marmotRelays : []),
    ])];

    const results = await executeAllProcedures(
        publishRelays,
        async (procedure, index, total) => {
            const pct = Math.round(5 + (85 * index / total));
            setScanProgress(pct);
            await say(speak('orProcedure', { index: index + 1, total, name: procedure.name }));
        },
        async (result, index, total) => {
            const pct = Math.round(5 + (85 * (index + 1) / total));
            setScanProgress(pct);
            if (result.ok) {
                await say(speak('orProcedureOk', { name: result.name, succeeded: result.succeeded }));
            } else {
                errBeep();
                await say(speak('orProcedureFail', { name: result.name, failed: result.failed }));
            }
        },
        (relay, status) => {
            // [C2 fix] Renamed to avoid shadowing outer `auditState`
            const cssState = status === 'SENDING' ? 'connecting' : status === 'OK' ? 'ok' : 'error';
            setRelayState(relay, cssState, status);
        },
    );

    setScanProgress(100);
    removeScanBar();

    // Compile results
    const allSucceeded = results.every(r => r.ok);
    const totalSucceeded = results.reduce((sum, r) => sum + r.succeeded, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);

    const resultItems = results.map(r => ({
        type: r.ok ? 'ok' : 'err',
        text: `${r.name}: ${r.succeeded} relay(s) updated${r.failed > 0 ? `, ${r.failed} failed` : ''}`,
    }));
    appendResultSection('SURGICAL RESULTS', resultItems);

    if (allSucceeded) {
        setSprite('idle', 'success');
        flashScreen('ok');
        okBeep();
        setTimeout(() => okBeep(), 200);
        await say(speak('orSuccess', { procedures: procedures.length, relays: totalSucceeded }));
    } else if (totalSucceeded > 0) {
        setSprite('writing', 'bounce');
        flashScreen('ok');
        okBeep();
        await say(speak('orPartial', { succeeded: totalSucceeded, failed: totalFailed }));
    } else {
        setSprite('blocked', 'error');
        flashScreen('err');
        errBeep();
        await say(speak('orFail'));
    }

    // Clear staged changes after execution
    clearAllChanges();

    // Re-render to show clean state
    renderRoom();
}
