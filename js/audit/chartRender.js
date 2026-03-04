/**
 * Patient chart HTML generation.
 */

import { html, escapeHtml } from '../html.js';

const NPUB_SHORT_LEN = 20;

function buildChartHeader(doctorName, chartDate, shortNpub) {
    return html`
        <div class="chart-header">
            <div class="chart-header-left">
                <span class="chart-title">PATIENT CHART</span>
                <span class="chart-npub">${shortNpub}</span>
            </div>
            <div class="chart-header-right">
                <span class="chart-doctor">${doctorName}</span>
                <span class="chart-date">${chartDate}</span>
            </div>
        </div>
    `;
}

function buildConditionSection(
    findings,
    verdictClass,
    verdictIcon,
    verdictLabel,
    hpPct,
    hpClass,
    totalRelays,
) {
    return html`
        <div class="chart-section">
            <div class="chart-section-label">CONDITION</div>
            <div class="chart-condition">
                <span class="chart-verdict ${verdictClass}">${verdictIcon} ${verdictLabel}</span>
                <div class="chart-hp-row">
                    <span class="chart-hp-label">HP</span>
                    <div class="chart-hp-track">
                        <div class="chart-hp-fill ${hpClass}" style="width:${hpPct}%"></div>
                    </div>
                    <span class="chart-hp-val">${hpPct}%</span>
                </div>
                <div class="chart-stats">
                    <span class="stat-tag dx-pass">${findings.pass.length} PASS</span>
                    <span class="stat-tag dx-warn">${findings.warn.length} WARN</span>
                    <span class="stat-tag dx-fail">${findings.fail.length} FAIL</span>
                    <span class="stat-tag dx-info">${totalRelays} RELAY</span>
                </div>
            </div>
        </div>
    `;
}

function buildDoctorNotesSection(doctorNote) {
    if (!doctorNote) return '';

    return html`
        <div class="chart-section">
            <div class="chart-section-label">DOCTOR'S NOTES</div>
            <div class="chart-doctor-notes">
                <div class="doctor-note-text">${doctorNote}</div>
            </div>
        </div>
    `;
}

function buildEffectGroup(groupLabel, groupClass, items) {
    if (items.length === 0) return '';
    const icon = groupClass === 'fail' ? '✖' : groupClass === 'warn' ? '!' : '✔';
    const isPassGroup = groupClass === 'pass';

    const rows = items.map((effect) => {
        const hintRow = effect.hint
            ? html`<div class="dx-hint">${escapeHtml(effect.hint)}</div>`
            : '';
        return html`
            <div class="dx-row${effect.hint ? ' dx-has-hint' : ''}">
                <span class="dx-icon dx-${effect.type}">${icon}</span>
                <span class="dx-${effect.type}">${effect.text}</span>
                ${hintRow}
            </div>
        `;
    });

    return html`
        <div class="dx-group ${isPassGroup ? 'dx-group-collapsed' : ''}" data-group="${groupClass}">
            <div class="dx-group-label dx-${groupClass}"
                 ${isPassGroup ? 'data-action="toggle-dx-group" role="button" tabindex="0"' : ''}>
                ${groupLabel}
                <span class="dx-group-count">${items.length}</span>
                ${isPassGroup ? html`<span class="dx-group-toggle">▸</span>` : ''}
            </div>
            <div class="dx-group-body">${rows}</div>
        </div>
    `;
}

function buildEffectsSection(allEffects) {
    if (allEffects.length === 0) return '';

    const fails = allEffects.filter(e => e.type === 'fail');
    const warns = allEffects.filter(e => e.type === 'warn');
    const passes = allEffects.filter(e => e.type === 'pass');

    return html`
        <div class="chart-section">
            <div class="chart-section-label">STATUS EFFECTS</div>
            <div class="chart-effects">
                ${buildEffectGroup('⚠ AILMENTS', 'fail', fails)}
                ${buildEffectGroup('◈ CAUTIONS', 'warn', warns)}
                ${buildEffectGroup('✦ VITALS OK', 'pass', passes)}
            </div>
        </div>
    `;
}

function resolvePrescriptionAction(rx) {
    if (rx?.action) return rx.action;
    const text = String(rx?.text ?? rx).toLowerCase();
    if (text.includes('rebroadcast') && text.includes('profile')) return 'rebroadcast';
    if (text.includes('delete events') && text.includes('keypackage')) return 'delete-kps';
    if (text.includes('delete orphaned keypackages')) return 'delete-orphaned-kps';
    if (text.includes('unify your k3 and k10002')) return 'unify-relays';
    if (text.includes('reduce kind 10002')) return 'reduce-relays';
    if (text.includes('migrate from nip-04') || (text.includes('nip-04') && text.includes('kind 4'))) return 'delete-kind4';
    return null;
}

function buildTreatmentSection(prescriptions, actionFlags, canOperate) {
    if (prescriptions.length === 0 && !canOperate) return '';

    const {
        canRebroadcast, canDeleteKps, canUnifyRelays,
        canDeleteOrphanedKps, canDeleteKind4,
    } = actionFlags;

    const requiresNip07Attrs = !window.nostr ? ' disabled title="Requires NIP-07 extension"' : '';
    const treatmentRows = prescriptions.map((rx) => {
        const rxText = rx?.text ?? rx;
        const action = resolvePrescriptionAction(rx);

        let actionButton = '';
        if (action === 'rebroadcast' && canRebroadcast) {
            actionButton = html`<button class="rx-action-btn" data-action="rebroadcast"${requiresNip07Attrs}>▶ BROADCAST</button>`;
        } else if (action === 'delete-kps' && canDeleteKps) {
            actionButton = html`
                <button class="rx-action-btn rx-action-delete" data-action="delete-kps"${requiresNip07Attrs}>✕ DELETE</button>
            `;
        } else if (action === 'delete-orphaned-kps' && canDeleteOrphanedKps) {
            actionButton = html`
                <button class="rx-action-btn rx-action-delete" data-action="delete-orphaned-kps"${requiresNip07Attrs}>✕ DELETE</button>
            `;
        } else if (action === 'unify-relays' && canUnifyRelays) {
            actionButton = html`
                <button class="rx-action-btn" data-action="unify-relays"${requiresNip07Attrs}>⚙ UNIFY</button>
            `;
        } else if (action === 'reduce-relays') {
            actionButton = html`
                <button class="rx-action-btn" data-action="enter-operating-room"${requiresNip07Attrs}>⚕ OPERATE</button>
            `;
        } else if (action === 'delete-kind4' && canDeleteKind4) {
            actionButton = html`
                <button class="rx-action-btn rx-action-delete" data-action="delete-kind4"${requiresNip07Attrs}>✕ PURGE</button>
            `;
        }

        return html`
            <div class="rx-row">
                <span class="rx-text">${rxText}</span>
                ${actionButton}
            </div>
        `;
    });

    const operateBtn = canOperate ? html`
        <div class="chart-operate-banner">
            <button class="rx-action-btn rx-action-operate" data-action="enter-operating-room"${requiresNip07Attrs}>
                ⚕ OPERATING ROOM
            </button>
            <span class="chart-operate-hint">Manage all relay lists in one place. Add, remove, and edit relays across NIP-65, Inbox, KeyPackage, and Contacts.</span>
        </div>
    ` : '';

    return html`
        <div class="chart-section">
            <div class="chart-section-label">TREATMENT PLAN</div>
            <div class="chart-treatment">
                ${treatmentRows}
                ${operateBtn}
            </div>
        </div>
    `;
}

function buildChartSignature(doctorName) {
    return html`<div class="chart-signature">── ${doctorName} ──</div>`;
}

/**
 * @param {Object} params
 * @param {Function} getDisplayName
 * @param {Function} [speakFn] - speak() from personalities.js for doctor notes
 * @returns {{ cardHTML: string }}
 */
export function renderChart(params, getDisplayName, speakFn) {
    const {
        findings,
        findingsWithHints,
        prescriptions,
        verdictClass,
        verdictIcon,
        verdictLabel,
        allOk,
        hasFailures,
        totalRelays,
        canRebroadcast,
        canDeleteKps,
        canDeleteOrphanedKps,
        canDeleteKind4,
        canUnifyRelays,
        canOperate,
        rawNpub,
        doctorNotes,
    } = params;

    const hpTotal = findings.pass.length + findings.warn.length + findings.fail.length;
    const hpPct = Math.round(100 * findings.pass.length / Math.max(1, hpTotal));
    const hpClass = allOk ? 'hp-full' : !hasFailures ? 'hp-warn' : 'hp-crit';
    const doctorName = getDisplayName();
    const chartDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const shortNpub = rawNpub.slice(0, NPUB_SHORT_LEN) + '…';

    // Use findingsWithHints if available, otherwise fallback to raw findings
    const hinted = findingsWithHints || null;
    const allEffects = hinted
        ? [
            ...hinted.fail.map(f => ({ type: 'fail', text: f.text, hint: f.hint })),
            ...hinted.warn.map(f => ({ type: 'warn', text: f.text, hint: f.hint })),
            ...hinted.pass.map(f => ({ type: 'pass', text: f.text, hint: f.hint })),
        ]
        : [
            ...findings.fail.map(t => ({ type: 'fail', text: t })),
            ...findings.warn.map(t => ({ type: 'warn', text: t })),
            ...findings.pass.map(t => ({ type: 'pass', text: t })),
        ];

    // Generate doctor's note text via personality system
    let doctorNoteText = null;
    if (doctorNotes && speakFn) {
        doctorNoteText = speakFn(doctorNotes.noteKey, doctorNotes.noteVars);
    }

    const cardHTML = html`
        <div class="patient-chart">
            ${buildChartHeader(doctorName, chartDate, shortNpub)}
            <div class="chart-body">
                ${buildConditionSection(
        findings,
        verdictClass,
        verdictIcon,
        verdictLabel,
        hpPct,
        hpClass,
        totalRelays,
    )}
                ${buildDoctorNotesSection(doctorNoteText)}
                ${buildEffectsSection(allEffects)}
                ${buildTreatmentSection(
        prescriptions,
        { canRebroadcast, canDeleteKps, canUnifyRelays, canDeleteOrphanedKps, canDeleteKind4 },
        canOperate,
    )}
                ${buildChartSignature(doctorName)}
            </div>
        </div>
    `;

    return { cardHTML };
}
