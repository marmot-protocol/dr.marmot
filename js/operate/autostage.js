/**
 * Auto-staging logic — maps audit prescriptions to OR staged changes.
 * Analyzes the compiled audit result and pre-stages actionable fixes
 * so the user enters the OR with a treatment plan already loaded.
 */

import { stageAddRelay, stageRemoveRelay, stageToggleReadWrite, getRelayList } from './editor.js';
import { validateRelayUrl } from '../relay-validation.js';

/**
 * @typedef {Object} AutoStageResult
 * @property {number} staged - Number of changes successfully auto-staged
 * @property {string[]} actions - Human-readable descriptions of what was staged
 * @property {string[]} suggestions - Things that need manual action (can't be auto-staged)
 */

/**
 * Analyze prescriptions and audit state to determine what can be auto-staged.
 * Call this after initEditorState() in room.js.
 *
 * @param {Object} auditState - from getAuditState()
 * @param {Object} compiledResult - from compileFindingsAndPrescriptions() stored on auditState
 * @returns {AutoStageResult}
 */
export function autoStageFromPrescriptions(auditState, compiledResult) {
    const actions = [];
    const suggestions = [];
    let staged = 0;

    // --- 1. Remove invalid relay URLs ---
    staged += removeInvalidRelays(auditState, actions);

    // --- 2. Unify k3 and k10002 relay lists ---
    if (compiledResult?.canUnifyRelays || auditState.canUnifyRelays) {
        staged += unifyRelayLists(auditState, actions);
    }

    // --- 3. Add missing inbox relays (k10050) from k10002 if k10050 is empty ---
    if (compiledResult?.findings?.fail?.some(f => f.includes('kind 10050 contains no valid relay tags'))) {
        staged += suggestInboxRelaysFromNip65(auditState, actions, suggestions);
    }

    // --- 4. Handle orphaned KeyPackage relays ---
    if (auditState.orphanedKpRelays?.length > 0) {
        staged += stageOrphanedKpRelayFixes(auditState, actions, suggestions);
    }

    // --- 5. NIP-65 read/write fixes ---
    staged += fixNip65ReadWrite(auditState, compiledResult, actions);

    // --- 6. Suggest things that need manual/client action ---
    addManualSuggestions(auditState, compiledResult, suggestions);

    return { staged, actions, suggestions };
}

/**
 * Remove invalid relay URLs from all kinds.
 * @returns {number} Count of staged removals
 */
function removeInvalidRelays(auditState, actions) {
    let count = 0;

    // Check each kind for invalid URLs
    for (const kind of [10002, 10050, 10051, 3]) {
        const relays = getRelayList(kind);
        for (const entry of relays) {
            if (entry.removed || entry.staged) continue;
            const { valid } = validateRelayUrl(entry.url);
            if (!valid) {
                const result = stageRemoveRelay(kind, entry.url);
                if (result.ok) {
                    count++;
                    actions.push(`Remove invalid URL from k${kind}: ${entry.url}`);
                }
            }
        }
    }

    return count;
}

/**
 * Unify k3 and k10002 relay lists by adding missing relays to each.
 * @returns {number} Count of staged additions
 */
function unifyRelayLists(auditState, actions) {
    let count = 0;

    const k3Set = new Set((auditState.k3RelaySet || []).map(u => u.toLowerCase()));
    const k10002Set = new Set((auditState.k10002RelaySet || []).map(u => u.toLowerCase()));

    // Add k3-only relays to k10002
    for (const url of auditState.k3RelaySet || []) {
        if (!k10002Set.has(url.toLowerCase())) {
            const result = stageAddRelay(10002, url, 'rw');
            if (result.ok) {
                count++;
                actions.push(`Add to k10002 (from k3): ${url}`);
            }
        }
    }

    // Add k10002-only relays to k3
    for (const url of auditState.k10002RelaySet || []) {
        if (!k3Set.has(url.toLowerCase())) {
            const result = stageAddRelay(3, url);
            if (result.ok) {
                count++;
                actions.push(`Add to k3 (from k10002): ${url}`);
            }
        }
    }

    return count;
}

/**
 * Suggest inbox relays (k10050) from the user's NIP-65 read relays.
 * @returns {number} Count of staged additions
 */
function suggestInboxRelaysFromNip65(auditState, actions, suggestions) {
    let count = 0;

    const k10002Relays = getRelayList(10002);
    const readRelays = k10002Relays.filter(
        r => !r.removed && (r.readWrite === 'read' || r.readWrite === 'rw'),
    );

    if (readRelays.length > 0) {
        // Add the first 3 read relays as inbox relays
        for (const relay of readRelays.slice(0, 3)) {
            const result = stageAddRelay(10050, relay.url);
            if (result.ok) {
                count++;
                actions.push(`Add inbox relay (from NIP-65 read): ${relay.url}`);
            }
        }
    } else {
        suggestions.push('Add inbox relays (k10050) — no read relays found to suggest from');
    }

    return count;
}

/**
 * Handle orphaned KeyPackage relays — suggest adding them to k10051.
 * @returns {number} Count of staged additions
 */
function stageOrphanedKpRelayFixes(auditState, actions, suggestions) {
    let count = 0;

    for (const url of auditState.orphanedKpRelays) {
        const result = stageAddRelay(10051, url);
        if (result.ok) {
            count++;
            actions.push(`Add orphaned KP relay to k10051: ${url}`);
        }
    }

    if (count === 0 && auditState.orphanedKpRelays.length > 0) {
        suggestions.push(
            `${auditState.orphanedKpRelays.length} orphaned KP relay(s) already in k10051 — delete orphaned KPs from those relays instead`,
        );
    }

    return count;
}

/**
 * Fix NIP-65 read/write issues by toggling relays that are read-only or write-only.
 * Only acts when ALL relays are the same direction (no read or no write).
 * @returns {number} Count of staged modifications
 */
function fixNip65ReadWrite(auditState, compiledResult, actions) {
    let count = 0;
    const findings = compiledResult?.findings;
    if (!findings) return 0;

    const hasNoRead = findings.fail?.some(f => f.includes('NIP-65: no read relays'));
    const hasNoWrite = findings.fail?.some(f => f.includes('NIP-65: no write relays'));

    if (!hasNoRead && !hasNoWrite) return 0;

    const k10002Relays = getRelayList(10002);
    for (const entry of k10002Relays) {
        if (entry.removed || entry.staged) continue;

        if (hasNoRead && entry.readWrite === 'write') {
            // Make it rw so there's at least one read relay
            stageToggleReadWrite(entry.url, 'rw');
            count++;
            actions.push(`Set to R/W (was write-only): ${entry.url}`);
            break; // Only need to fix one
        }

        if (hasNoWrite && entry.readWrite === 'read') {
            stageToggleReadWrite(entry.url, 'rw');
            count++;
            actions.push(`Set to R/W (was read-only): ${entry.url}`);
            break;
        }
    }

    return count;
}

/**
 * Add suggestions for things that require manual or client-side action.
 */
function addManualSuggestions(auditState, compiledResult, suggestions) {
    const findings = compiledResult?.findings;
    if (!findings) return;

    // k10051 missing entirely
    if (findings.fail?.some(f => f.includes('No KeyPackage Relay List (kind 10051)'))) {
        suggestions.push('Publish a KeyPackage Relay List (k10051) — add relays in the KEYPACKAGE RELAYS tray');
    }

    // k10050 missing entirely
    if (findings.fail?.some(f => f.includes('No Inbox Relay List (kind 10050)'))) {
        suggestions.push('Publish an Inbox Relay List (k10050) — add relays in the INBOX RELAYS tray');
    }

    // NIP-65 bloated
    if (findings.warn?.some(f => f.includes('excessive relay count'))) {
        suggestions.push('Consider removing some relays from k10002 — 10 or fewer is recommended');
    }

    // KeyPackage issues (client-side)
    if (findings.fail?.some(f => f.includes('KP ') || f.includes('KeyPackage'))) {
        suggestions.push('KeyPackage issues require your Marmot client to publish corrected KeyPackages');
    }

    // Stale profile/contacts
    if (compiledResult?.canRebroadcast) {
        suggestions.push('Profile/Contacts out of sync — use REBROADCAST from the chart, or re-audit after operating');
    }
}

/**
 * Format the auto-stage results into a briefing summary.
 * @param {AutoStageResult} result
 * @returns {{ actionSummary: string, suggestionSummary: string }}
 */
export function formatAutoStageSummary(result) {
    const actionSummary = result.actions.length > 0
        ? result.actions.map(a => `  + ${a}`).join('\n')
        : 'No changes auto-staged.';

    const suggestionSummary = result.suggestions.length > 0
        ? result.suggestions.map(s => `  ? ${s}`).join('\n')
        : '';

    return { actionSummary, suggestionSummary };
}
