/**
 * Guided treatment flow — step-by-step prescription walker.
 * Presents prescriptions one at a time with doctor recommendations,
 * highlights the relevant tray, and lets the user advance or skip.
 */

import { html, escapeHtml } from '../html.js';
import { speak } from '../personalities.js';
import { getNakCommand, renderNakCommandBlock } from '../nak-commands.js';

/**
 * @typedef {Object} GuideStep
 * @property {number} index - Step number (0-based)
 * @property {string} prescription - The prescription text
 * @property {string|null} recommendation - Doctor's recommendation for this step
 * @property {number|null} targetKind - Which kind tray to highlight (10002, 10050, 10051, 3), or null
 * @property {boolean} isActionable - Whether the OR can stage a fix for this
 * @property {boolean} isClientSide - Whether this requires client/external action
 * @property {string|null} fixAction - data-action value for the FIX IT button, or null
 */

let steps = [];
let currentStep = -1;
let isGuided = false;
let storedAuditState = null;

/**
 * Whether guided mode is active.
 * @returns {boolean}
 */
export function isGuidedMode() {
    return isGuided;
}

/**
 * Get the current step index.
 * @returns {number}
 */
export function getCurrentStepIndex() {
    return currentStep;
}

/**
 * Get the current step, or null if not in guided mode.
 * @returns {GuideStep|null}
 */
export function getCurrentStep() {
    if (!isGuided || currentStep < 0 || currentStep >= steps.length) return null;
    return steps[currentStep];
}

/**
 * Get total step count.
 * @returns {number}
 */
export function getTotalSteps() {
    return steps.length;
}

/**
 * Initialize the guided flow from prescriptions.
 * @param {string[]} prescriptions - From compileFindingsAndPrescriptions
 * @param {Object} _findings - The findings object with pass/warn/fail arrays (reserved for future step enrichment)
 * @param {Object} [auditState] - Audit state for generating nak commands
 * @returns {number} Total steps
 */
export function initGuide(prescriptions, _findings, auditState) {
    storedAuditState = auditState || null;
    steps = prescriptions.map((rx, index) => ({
        index,
        prescription: rx,
        recommendation: getRecommendationForPrescription(rx),
        targetKind: getTargetKindForPrescription(rx),
        isActionable: isActionablePrescription(rx),
        isClientSide: isClientSidePrescription(rx),
        fixAction: getFixActionForPrescription(rx),
    }));
    currentStep = steps.length > 0 ? 0 : -1;
    isGuided = steps.length > 0;
    return steps.length;
}

/**
 * Advance to the next step.
 * @returns {GuideStep|null} The next step, or null if done
 */
export function nextStep() {
    if (!isGuided) return null;
    currentStep++;
    if (currentStep >= steps.length) {
        isGuided = false;
        return null;
    }
    return steps[currentStep];
}

/**
 * Skip the current step and advance.
 * @returns {GuideStep|null} The next step, or null if done
 */
export function skipStep() {
    return nextStep();
}

/**
 * Exit guided mode.
 */
export function exitGuide() {
    isGuided = false;
    currentStep = -1;
    steps = [];
    storedAuditState = null;
}

/**
 * Switch to manual (free-form) mode without losing position.
 */
export function switchToManual() {
    isGuided = false;
}

/**
 * Resume guided mode from the current position.
 */
export function resumeGuide() {
    if (steps.length > 0) {
        isGuided = true;
        if (currentStep < 0) currentStep = 0;
    }
}

/**
 * Render the guided step card UI.
 * @param {GuideStep} step
 * @returns {string} HTML string
 */
export function renderGuideCard(step) {
    if (!step) return '';

    const progress = `${step.index + 1} / ${steps.length}`;
    const kindLabel = step.targetKind ? `k${step.targetKind}` : '';
    const actionableTag = step.isClientSide
        ? '<span class="guide-tag guide-tag-client">CLIENT</span>'
        : step.isActionable
            ? '<span class="guide-tag guide-tag-actionable">FIXABLE</span>'
            : '<span class="guide-tag guide-tag-manual">MANUAL</span>';

    const recommendation = step.recommendation
        ? html`<div class="guide-recommendation">${step.recommendation}</div>`
        : '';

    const doctorNote = speak('guideStepNote', { step: step.index + 1, total: steps.length })
        || '';

    const requiresNip07 = !window.nostr;
    const fixBtn = step.fixAction
        ? html`
            <button class="guide-btn guide-btn-fix"
                    data-action="guide-fix"
                    data-fix-action="${step.fixAction}"
                    ${requiresNip07 ? 'disabled title="Requires NIP-07 extension"' : ''}
                    >⚕ FIX IT</button>
        `
        : '';

    // Generate nak command block for this step
    let nakSection = '';
    if (step.fixAction && storedAuditState) {
        const nakCmd = getNakCommand(step.fixAction, storedAuditState);
        if (nakCmd) {
            nakSection = html`
                <div class="guide-nak-toggle">
                    <button class="nak-toggle-btn" data-action="toggle-nak" title="Show nak CLI command">🔧 nak</button>
                </div>
                <div class="guide-nak-container hidden">${renderNakCommandBlock(nakCmd)}</div>
            `;
        }
    }

    return html`
        <div class="guide-card" data-target-kind="${step.targetKind || ''}">
            <div class="guide-card-header">
                <span class="guide-card-icon">📋</span>
                <span class="guide-card-title">TREATMENT STEP</span>
                <span class="guide-card-progress">${progress}</span>
                ${kindLabel ? html`<span class="guide-card-kind">${kindLabel}</span>` : ''}
            </div>
            <div class="guide-card-body">
                <div class="guide-prescription">
                    ${actionableTag}
                    <span class="guide-rx-text">${escapeHtml(step.prescription)}</span>
                </div>
                ${recommendation}
                ${doctorNote ? html`<div class="guide-doctor-note">${doctorNote}</div>` : ''}
            </div>
            <div class="guide-card-actions">
                ${fixBtn}
                <button class="guide-btn guide-btn-skip" data-action="guide-skip" title="Skip this step">SKIP</button>
                <button class="guide-btn guide-btn-next" data-action="guide-next" title="Mark done & continue">
                    ${step.index + 1 < steps.length ? 'NEXT ▸' : 'FINISH ✔'}
                </button>
                <button class="guide-btn guide-btn-manual" data-action="guide-manual" title="Switch to free editing">MANUAL MODE</button>
            </div>
            ${nakSection}
        </div>
    `;
}

/**
 * Render the guide mode toggle (shown in manual mode to resume).
 * @returns {string} HTML string
 */
export function renderGuideResumeBar() {
    if (steps.length === 0) return '';
    const remaining = steps.length - Math.max(0, currentStep);
    return html`
        <div class="guide-resume-bar">
            <button class="guide-btn guide-btn-resume" data-action="guide-resume">
                ▸ RESUME GUIDED MODE (${remaining} step(s) remaining)
            </button>
        </div>
    `;
}

// ─── PRESCRIPTION ANALYSIS ─────────────────────────────────────────────────

const KIND_PATTERNS = {
    10002: ['k10002', 'kind 10002', 'NIP-65', 'nip-65', 'read relay', 'write relay'],
    10050: ['k10050', 'kind 10050', 'inbox', 'giftwrap', 'DM inbox'],
    10051: ['k10051', 'kind 10051', 'KeyPackage Relay', 'keypackage relay'],
    3: ['k3', 'kind 3', 'contacts', 'Contacts'],
};

/**
 * Determine which kind tray a prescription targets.
 * @param {string} rx
 * @returns {number|null}
 */
function getTargetKindForPrescription(rx) {
    const lower = rx.toLowerCase();

    // Check for multi-kind prescriptions first
    const multiKind = ['k3 / k10002', 'k3/k10002', 'unify'].some(p => lower.includes(p));
    if (multiKind) return 10002; // Primary target is k10002

    for (const [kind, patterns] of Object.entries(KIND_PATTERNS)) {
        if (patterns.some(p => lower.includes(p.toLowerCase()))) {
            return Number(kind);
        }
    }

    // KeyPackage-related
    if (lower.includes('keypackage') || lower.includes('kind 443') || lower.includes('mls_')) {
        return 10051;
    }

    return null;
}

/**
 * Check if a prescription can be addressed by OR staging.
 * @param {string} rx
 * @returns {boolean}
 */
function isActionablePrescription(rx) {
    const lower = rx.toLowerCase();
    const actionablePatterns = [
        'fix invalid relay',
        'add relay tags',
        'unify',
        'add at least one read relay',
        'add at least one write relay',
        'reduce kind 10002',
        'publish a keypackage relay list',
        'publish an inbox relay list',
        'publish a dm inbox',
        'delete orphaned',
    ];
    return actionablePatterns.some(p => lower.includes(p));
}

/**
 * Check if a prescription requires client-side action (not OR fixable).
 * @param {string} rx
 * @returns {boolean}
 */
function isClientSidePrescription(rx) {
    const lower = rx.toLowerCase();
    // NIP-04 migration is now actionable via deleteDeprecatedKind4
    if (lower.includes('migrate from nip-04')) return false;
    // 'delete events' removed — prescriptions matching that text are handled
    // by the 'delete-kps' fix action and should not be classified as CLIENT-only.
    const clientPatterns = [
        'encoding',
        '0xf2ee',
        '0x000a',
        'ciphersuite',
        'mls_extensions',
        'keypackagebundle',
        'keypackageref',
        'rotate mls',
        'default extensions',
        'stop publishing kind 2',
        'i tag',
    ];
    return clientPatterns.some(p => lower.includes(p));
}

/**
 * Map a prescription to its fix action (data-action value for the FIX IT button).
 * Returns null if no automatic fix is available.
 * @param {string} rx
 * @returns {string|null}
 */
function getFixActionForPrescription(rx) {
    const lower = rx.toLowerCase();
    if (lower.includes('rebroadcast') && lower.includes('profile')) return 'rebroadcast';
    if (lower.includes('delete orphaned keypackages')) return 'delete-orphaned-kps';
    if (lower.includes('unify your k3 and k10002')) return 'unify-relays';
    if (lower.includes('migrate from nip-04') || (lower.includes('nip-04') && lower.includes('kind 4'))) return 'delete-kind4';
    if (lower.includes('delete events') && lower.includes('keypackage')) return 'delete-kps';
    return null;
}

/**
 * Get a recommendation explanation for a prescription.
 * These are the factual explanations; personality wrapper comes from speak().
 * @param {string} rx
 * @returns {string|null}
 */
function getRecommendationForPrescription(rx) {
    const lower = rx.toLowerCase();

    if (lower.includes('fix invalid relay') && lower.includes('k3 / k10002')) {
        return 'Invalid relay URLs prevent clients from discovering where to find your events. Remove the broken URLs and add correct wss:// addresses.';
    }
    if (lower.includes('rebroadcast')) {
        return 'Your profile or contacts are stale on some relays. Rebroadcasting pushes the latest version to all relays so clients see consistent data.';
    }
    if (lower.includes('publish a keypackage relay list') || (lower.includes('kind 10051') && lower.includes('publish'))) {
        return 'Kind 10051 tells other users where to find your KeyPackages. Without it, nobody can invite you to Marmot groups.';
    }
    if (lower.includes('add relay tags') && lower.includes('10051')) {
        return 'Your k10051 event exists but has no relay URLs. Add at least one relay where your KeyPackages are published.';
    }
    if (lower.includes('publish an inbox relay list') || lower.includes('publish a dm inbox') || (lower.includes('kind 10050') && lower.includes('publish'))) {
        return 'Kind 10050 tells clients where to deliver giftwrapped messages to you. Without it, encrypted DMs and Marmot invites cannot reach you.';
    }
    if (lower.includes('add relay tags') && lower.includes('10050')) {
        return 'Your k10050 event exists but has no relay URLs. Add at least one relay to receive giftwrapped messages.';
    }
    if (lower.includes('unify')) {
        return 'Your Contacts (k3) and NIP-65 (k10002) relay lists advertise different relays. Different clients check different lists, so having them agree means better discoverability.';
    }
    if (lower.includes('no read relays')) {
        return 'Without read relays in NIP-65, clients don\'t know where to deliver replies to you. At least one relay needs the read marker.';
    }
    if (lower.includes('no write relays')) {
        return 'Without write relays in NIP-65, clients don\'t know where you publish events. At least one relay needs the write marker.';
    }
    if (lower.includes('excessive relay count') || lower.includes('reduce kind 10002')) {
        return 'More than 10 relays in NIP-65 causes performance issues for clients. Each client must check all of them. Trim to your most reliable 5-8 relays.';
    }
    if (lower.includes('encoding')) {
        return 'The KeyPackage encoding tag must be "base64". MIP-00 requires base64-encoded KeyPackageBundle content.';
    }
    if (lower.includes('0xf2ee')) {
        return 'The marmot_group_data extension (0xf2ee) carries group metadata. Without it, Marmot clients cannot parse your KeyPackage.';
    }
    if (lower.includes('0x000a')) {
        return 'The last_resort extension (0x000a) marks a KeyPackage as always available. MIP-00 requires this for the primary KeyPackage.';
    }
    if (lower.includes('ciphersuite')) {
        return 'The mls_ciphersuite tag identifies which cryptographic algorithms your KeyPackage uses. It must be in the range 0x0001-0x0007.';
    }
    if (lower.includes('orphaned keypackages') || lower.includes('delete orphaned')) {
        return 'KeyPackages on relays not listed in your k10051 are invisible to other users. Either add those relays to k10051 or delete the orphaned KeyPackages.';
    }
    if (lower.includes('blossom')) {
        return 'A Blossom server list (k10063) tells clients where to upload media on your behalf. Without it, media attachments may not work.';
    }
    if (lower.includes('nip-04') || lower.includes('kind 4')) {
        return 'NIP-04 (kind 4) DMs expose metadata (who you\'re talking to and when). NIP-17 and Marmot both encrypt metadata. Migrate for better privacy.';
    }
    if (lower.includes('kind 2')) {
        return 'Kind 2 (Recommend Relay) is deprecated. Use NIP-65 (kind 10002) for relay advertisement instead.';
    }
    if (lower.includes('publish at least one keypackage')) {
        return 'No KeyPackages found on your advertised relays. Your Marmot client needs to publish at least one KeyPackage (kind 443) so others can invite you to groups.';
    }
    if (lower.includes('fix i tag') || lower.includes('i tag')) {
        return 'The i tag must contain a hex-encoded KeyPackageRef matching the ciphersuite hash length. It uniquely identifies the KeyPackage for deduplication.';
    }
    if (lower.includes('default extensions')) {
        return 'Default MLS extensions (0x0001-0x0005) are implicit and must not be listed in mls_extensions. Only custom extensions belong there.';
    }
    if (lower.includes('relays tag')) {
        return 'The relays tag in KeyPackage events tells clients where to deliver Welcome messages. It must contain valid wss:// URLs.';
    }

    return null;
}
