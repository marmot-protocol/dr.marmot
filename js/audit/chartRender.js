/**
 * Patient chart HTML generation.
 */

import { html } from '../html.js';

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

function buildEffectsSection(allEffects) {
    if (allEffects.length === 0) return '';

    const effectRows = allEffects.map((effect) => {
        const icon = effect.type === 'pass' ? '✔' : effect.type === 'warn' ? '!' : '✖';
        return html`
            <div class="dx-row">
                <span class="dx-icon dx-${effect.type}">${icon}</span>
                <span class="dx-${effect.type}">${effect.text}</span>
            </div>
        `;
    });

    return html`
        <div class="chart-section">
            <div class="chart-section-label">STATUS EFFECTS</div>
            <div class="chart-effects">${effectRows}</div>
        </div>
    `;
}

function resolvePrescriptionAction(rx) {
    if (rx?.action) return rx.action;
    const text = String(rx?.text ?? rx).toLowerCase();
    if (text.includes('rebroadcast') && text.includes('profile')) return 'rebroadcast';
    if (text.includes('delete events') && text.includes('keypackage')) return 'delete-kps';
    if (text.includes('unify your k3 and k10002')) return 'unify-relays';
    return null;
}

function buildTreatmentSection(prescriptions, canRebroadcast, canDeleteKps, canUnifyRelays) {
    if (prescriptions.length === 0) return '';

    const requiresNip07Attrs = !window.nostr ? ' disabled title="Requires NIP-07 extension"' : '';
    const treatmentRows = prescriptions.map((rx) => {
        const rxText = rx?.text ?? rx;
        const action = resolvePrescriptionAction(rx);

        let actionButton = '';
        if (action === 'rebroadcast' && canRebroadcast) {
            actionButton = html`<button class="rx-action-btn" data-action="rebroadcast">REBROADCAST</button>`;
        } else if (action === 'delete-kps' && canDeleteKps) {
            actionButton = html`
                <button class="rx-action-btn rx-action-delete" data-action="delete-kps"${requiresNip07Attrs}>
                    DELETE KPs
                </button>
            `;
        } else if (action === 'unify-relays' && canUnifyRelays) {
            actionButton = html`
                <button class="rx-action-btn" data-action="unify-relays"${requiresNip07Attrs}>
                    UNIFY RELAYS
                </button>
            `;
        }

        return html`
            <div class="rx-row">
                <span class="rx-text">${rxText}</span>
                ${actionButton}
            </div>
        `;
    });

    return html`
        <div class="chart-section">
            <div class="chart-section-label">TREATMENT PLAN</div>
            <div class="chart-treatment">${treatmentRows}</div>
        </div>
    `;
}

function buildChartSignature(doctorName) {
    return html`<div class="chart-signature">── ${doctorName} ──</div>`;
}

/**
 * @param {Object} params
 * @param {Function} getDisplayName
 * @returns {{ cardHTML: string }}
 */
export function renderChart(params, getDisplayName) {
    const {
        findings,
        prescriptions,
        verdictClass,
        verdictIcon,
        verdictLabel,
        allOk,
        hasFailures,
        totalRelays,
        canRebroadcast,
        canDeleteKps,
        canUnifyRelays,
        rawNpub,
    } = params;

    const hpTotal = findings.pass.length + findings.warn.length + findings.fail.length;
    const hpPct = Math.round(100 * findings.pass.length / Math.max(1, hpTotal));
    const hpClass = allOk ? 'hp-full' : !hasFailures ? 'hp-warn' : 'hp-crit';
    const doctorName = getDisplayName();
    const chartDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const shortNpub = rawNpub.slice(0, NPUB_SHORT_LEN) + '…';

    const allEffects = [
        ...findings.fail.map(t => ({ type: 'fail', text: t })),
        ...findings.warn.map(t => ({ type: 'warn', text: t })),
        ...findings.pass.map(t => ({ type: 'pass', text: t })),
    ];

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
                ${buildEffectsSection(allEffects)}
                ${buildTreatmentSection(
        prescriptions,
        canRebroadcast,
        canDeleteKps,
        canUnifyRelays,
    )}
                ${buildChartSignature(doctorName)}
            </div>
        </div>
    `;

    return { cardHTML };
}
