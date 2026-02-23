/**
 * Patient chart HTML generation.
 */

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
    const shortNpub = rawNpub.slice(0, 20) + '…';

    const allEffects = [
        ...findings.fail.map(t => ({ type: 'fail', text: t })),
        ...findings.warn.map(t => ({ type: 'warn', text: t })),
        ...findings.pass.map(t => ({ type: 'pass', text: t })),
    ];

    let cardHTML = `<div class="patient-chart">`;
    cardHTML += `<div class="chart-header">`;
    cardHTML += `<div class="chart-header-left">`;
    cardHTML += `<span class="chart-title">PATIENT CHART</span>`;
    cardHTML += `<span class="chart-npub">${shortNpub}</span>`;
    cardHTML += `</div>`;
    cardHTML += `<div class="chart-header-right">`;
    cardHTML += `<span class="chart-doctor">${doctorName}</span>`;
    cardHTML += `<span class="chart-date">${chartDate}</span>`;
    cardHTML += `</div>`;
    cardHTML += `</div>`;
    cardHTML += `<div class="chart-body">`;
    cardHTML += `<div class="chart-section">`;
    cardHTML += `<div class="chart-section-label">CONDITION</div>`;
    cardHTML += `<div class="chart-condition">`;
    cardHTML += `<span class="chart-verdict ${verdictClass}">${verdictIcon} ${verdictLabel}</span>`;
    cardHTML += `<div class="chart-hp-row">`;
    cardHTML += `<span class="chart-hp-label">HP</span>`;
    cardHTML += `<div class="chart-hp-track"><div class="chart-hp-fill ${hpClass}" style="width:${hpPct}%"></div></div>`;
    cardHTML += `<span class="chart-hp-val">${hpPct}%</span>`;
    cardHTML += `</div>`;
    cardHTML += `<div class="chart-stats">`;
    cardHTML += `<span class="stat-tag dx-pass">${findings.pass.length} PASS</span>`;
    cardHTML += `<span class="stat-tag dx-warn">${findings.warn.length} WARN</span>`;
    cardHTML += `<span class="stat-tag dx-fail">${findings.fail.length} FAIL</span>`;
    cardHTML += `<span class="stat-tag dx-info">${totalRelays} RELAY</span>`;
    cardHTML += `</div>`;
    cardHTML += `</div>`;
    cardHTML += `</div>`;

    if (allEffects.length > 0) {
        cardHTML += `<div class="chart-section">`;
        cardHTML += `<div class="chart-section-label">STATUS EFFECTS</div>`;
        cardHTML += `<div class="chart-effects">`;
        for (const e of allEffects) {
            const icon = e.type === 'pass' ? '✔' : e.type === 'warn' ? '!' : '✖';
            cardHTML += `<div class="dx-row"><span class="dx-icon dx-${e.type}">${icon}</span><span class="dx-${e.type}">${e.text}</span></div>`;
        }
        cardHTML += `</div>`;
        cardHTML += `</div>`;
    }

    if (prescriptions.length > 0) {
        cardHTML += `<div class="chart-section">`;
        cardHTML += `<div class="chart-section-label">TREATMENT PLAN</div>`;
        cardHTML += `<div class="chart-treatment">`;
        for (const rx of prescriptions) {
            const isRebroadcast = rx.toLowerCase().includes('rebroadcast') && rx.toLowerCase().includes('profile');
            const isDeleteKp = rx.toLowerCase().includes('delete events') && rx.toLowerCase().includes('keypackage');
            const isUnifyRelays = rx.toLowerCase().includes('unify your k3 and k10002');
            cardHTML += `<div class="rx-row">`;
            cardHTML += `<span class="rx-text">${rx}</span>`;
            if (isRebroadcast && canRebroadcast) {
                cardHTML += `<button class="rx-action-btn" data-action="rebroadcast">REBROADCAST</button>`;
            } else if (isDeleteKp && canDeleteKps) {
                const disabled = !window.nostr ? ' disabled title="Requires NIP-07 extension"' : '';
                cardHTML += `<button class="rx-action-btn rx-action-delete" data-action="delete-kps"${disabled}>DELETE KPs</button>`;
            } else if (isUnifyRelays && canUnifyRelays) {
                const disabled = !window.nostr ? ' disabled title="Requires NIP-07 extension"' : '';
                cardHTML += `<button class="rx-action-btn" data-action="unify-relays"${disabled}>UNIFY RELAYS</button>`;
            }
            cardHTML += `</div>`;
        }
        cardHTML += `</div>`;
        cardHTML += `</div>`;
    }

    cardHTML += `<div class="chart-signature">── ${doctorName} ──</div>`;
    cardHTML += `</div></div>`;

    return { cardHTML };
}
