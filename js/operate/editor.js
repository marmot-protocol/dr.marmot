/**
 * Relay list editor — manages staged changes per event kind.
 * Tracks add/remove/modify operations without publishing until confirmed.
 */

import { html, escapeHtml } from '../html.js';
import { validateRelayUrl, shortUrl } from '../relay-validation.js';
import { formatLatency, healthScore } from './health.js';

/**
 * @typedef {'add'|'remove'|'modify'} ChangeType
 *
 * @typedef {Object} StagedChange
 * @property {ChangeType} type
 * @property {string} url
 * @property {string} [readWrite] - 'read'|'write'|'rw' (k10002 only)
 * @property {string} [prevReadWrite] - Previous read/write state (for modify)
 *
 * @typedef {Object} RelayEntry
 * @property {string} url
 * @property {string} readWrite - 'read'|'write'|'rw'|'' (empty for non-10002 kinds)
 * @property {boolean} staged - Whether this entry is a staged addition
 * @property {boolean} removed - Whether this entry is staged for removal
 */

/** Map of kind → array of staged changes */
const stagedChanges = new Map();

/** Map of kind → array of current relay entries (from audit state) */
const currentRelays = new Map();

/**
 * Initialize the editor state from the audit result.
 * @param {Object} auditState - from getAuditState()
 */
export function initEditorState(auditState) {
    stagedChanges.clear();
    currentRelays.clear();

    // Kind 10002 (NIP-65) — with read/write markers
    const k10002Relays = [];
    if (auditState.bestK10002?.tags) {
        for (const t of auditState.bestK10002.tags) {
            if (t[0] === 'r' && typeof t[1] === 'string' && t[1].trim()) {
                const marker = t[2] || 'rw'; // 'read', 'write', or default 'rw'
                k10002Relays.push({ url: t[1].trim(), readWrite: marker, staged: false, removed: false });
            }
        }
    }
    currentRelays.set(10002, k10002Relays);
    stagedChanges.set(10002, []);

    // Kind 10050 (Inbox Relays)
    const k10050Relays = [];
    if (auditState.best10050?.tags) {
        for (const t of auditState.best10050.tags) {
            if (t[0] === 'relay' && typeof t[1] === 'string' && t[1].trim()) {
                k10050Relays.push({ url: t[1].trim(), readWrite: '', staged: false, removed: false });
            }
        }
    }
    currentRelays.set(10050, k10050Relays);
    stagedChanges.set(10050, []);

    // Kind 10051 (KeyPackage Relays)
    const k10051Relays = [];
    if (auditState.best10051?.tags) {
        for (const t of auditState.best10051.tags) {
            if (t[0] === 'relay' && typeof t[1] === 'string' && t[1].trim()) {
                k10051Relays.push({ url: t[1].trim(), readWrite: '', staged: false, removed: false });
            }
        }
    }
    currentRelays.set(10051, k10051Relays);
    stagedChanges.set(10051, []);

    // Kind 3 (Contacts relay hints)
    const k3Relays = [];
    if (auditState.bestK3?.tags) {
        for (const t of auditState.bestK3.tags) {
            if (t[0] === 'relay' && typeof t[1] === 'string' && t[1].trim()) {
                k3Relays.push({ url: t[1].trim(), readWrite: '', staged: false, removed: false });
            }
        }
    }
    currentRelays.set(3, k3Relays);
    stagedChanges.set(3, []);
}

/**
 * Stage adding a relay to a kind's list.
 * @param {number} kind
 * @param {string} url
 * @param {string} [readWrite='rw'] - For k10002 only
 * @returns {{ ok: boolean, reason?: string }}
 */
export function stageAddRelay(kind, url, readWrite = 'rw') {
    const trimmed = url.trim();
    const validation = validateRelayUrl(trimmed);
    if (!validation.valid) return { ok: false, reason: validation.reason };

    const relays = currentRelays.get(kind) || [];
    const changes = stagedChanges.get(kind) || [];

    // Check duplicates (including already-staged adds)
    const exists = relays.some(r => r.url.toLowerCase() === trimmed.toLowerCase() && !r.removed);
    const alreadyStaged = changes.some(c => c.type === 'add' && c.url.toLowerCase() === trimmed.toLowerCase());
    if (exists || alreadyStaged) return { ok: false, reason: 'already in list' };

    // If previously removed, un-remove instead of adding
    const removeIdx = changes.findIndex(c => c.type === 'remove' && c.url.toLowerCase() === trimmed.toLowerCase());
    if (removeIdx !== -1) {
        changes.splice(removeIdx, 1);
        const entry = relays.find(r => r.url.toLowerCase() === trimmed.toLowerCase());
        if (entry) entry.removed = false;
        return { ok: true };
    }

    changes.push({ type: 'add', url: trimmed, readWrite: kind === 10002 ? readWrite : '' });
    relays.push({ url: trimmed, readWrite: kind === 10002 ? readWrite : '', staged: true, removed: false });
    stagedChanges.set(kind, changes);
    currentRelays.set(kind, relays);
    return { ok: true };
}

/**
 * Stage removing a relay from a kind's list.
 * @param {number} kind
 * @param {string} url
 * @returns {{ ok: boolean, reason?: string }}
 */
export function stageRemoveRelay(kind, url) {
    const trimmed = url.trim();
    const relays = currentRelays.get(kind) || [];
    const changes = stagedChanges.get(kind) || [];

    // If it was a staged add, just remove the staged add
    const addIdx = changes.findIndex(c => c.type === 'add' && c.url.toLowerCase() === trimmed.toLowerCase());
    if (addIdx !== -1) {
        changes.splice(addIdx, 1);
        const entryIdx = relays.findIndex(r => r.url.toLowerCase() === trimmed.toLowerCase() && r.staged);
        if (entryIdx !== -1) relays.splice(entryIdx, 1);
        return { ok: true };
    }

    const entry = relays.find(r => r.url.toLowerCase() === trimmed.toLowerCase());
    if (!entry) return { ok: false, reason: 'not in list' };
    if (entry.removed) return { ok: false, reason: 'already staged for removal' };

    entry.removed = true;
    changes.push({ type: 'remove', url: trimmed });
    stagedChanges.set(kind, changes);
    return { ok: true };
}

/**
 * Stage toggling read/write marker for a k10002 relay.
 * @param {string} url
 * @param {string} newReadWrite - 'read'|'write'|'rw'
 * @returns {{ ok: boolean, reason?: string }}
 */
export function stageToggleReadWrite(url, newReadWrite) {
    const trimmed = url.trim();
    const relays = currentRelays.get(10002) || [];
    const changes = stagedChanges.get(10002) || [];

    const entry = relays.find(r => r.url.toLowerCase() === trimmed.toLowerCase() && !r.removed);
    if (!entry) return { ok: false, reason: 'not in list' };
    if (entry.readWrite === newReadWrite) return { ok: true }; // no change

    const prevReadWrite = entry.readWrite;
    entry.readWrite = newReadWrite;

    // Remove any existing modify change for this URL
    const existingIdx = changes.findIndex(c => c.type === 'modify' && c.url.toLowerCase() === trimmed.toLowerCase());
    if (existingIdx !== -1) changes.splice(existingIdx, 1);

    changes.push({ type: 'modify', url: trimmed, readWrite: newReadWrite, prevReadWrite });
    stagedChanges.set(10002, changes);
    return { ok: true };
}

/**
 * Get the current relay list for a kind (including staged changes reflected).
 * @param {number} kind
 * @returns {RelayEntry[]}
 */
export function getRelayList(kind) {
    return currentRelays.get(kind) || [];
}

/**
 * Get staged changes for a kind.
 * @param {number} kind
 * @returns {StagedChange[]}
 */
export function getStagedChanges(kind) {
    return stagedChanges.get(kind) || [];
}

/**
 * Check if there are any staged changes across all kinds.
 * @returns {boolean}
 */
export function hasAnyStagedChanges() {
    for (const changes of stagedChanges.values()) {
        if (changes.length > 0) return true;
    }
    return false;
}

/**
 * Get total count of staged changes.
 * @returns {number}
 */
export function totalStagedChanges() {
    let count = 0;
    for (const changes of stagedChanges.values()) {
        count += changes.length;
    }
    return count;
}

/**
 * Get the final relay list for a kind (after applying staged changes).
 * Removes entries marked for removal, includes staged additions.
 * @param {number} kind
 * @returns {{ url: string, readWrite: string }[]}
 */
export function getFinalRelayList(kind) {
    const relays = currentRelays.get(kind) || [];
    return relays
        .filter(r => !r.removed)
        .map(r => ({ url: r.url, readWrite: r.readWrite }));
}

/**
 * Clear all staged changes without applying them.
 */
export function clearAllChanges() {
    // Restore readWrite values from modify changes before clearing
    for (const [kind, changes] of stagedChanges.entries()) {
        const relays = currentRelays.get(kind) || [];
        for (const change of changes) {
            if (change.type === 'modify' && change.prevReadWrite) {
                const entry = relays.find(
                    r => r.url.toLowerCase() === change.url.toLowerCase() && !r.staged,
                );
                if (entry) entry.readWrite = change.prevReadWrite;
            }
        }
        stagedChanges.set(kind, []);
    }
    // Re-init from currentRelays by removing staged entries and un-removing removed entries
    for (const [kind, relays] of currentRelays.entries()) {
        const cleaned = relays.filter(r => !r.staged);
        for (const r of cleaned) r.removed = false;
        currentRelays.set(kind, cleaned);
    }
}

// ─── RENDERING ───────────────────────────────────────────────────────────────

const KIND_LABELS = {
    10002: { title: 'NIP-65 RELAY LIST', tag: 'k10002', icon: '📡' },
    10050: { title: 'INBOX RELAYS', tag: 'k10050', icon: '📨' },
    10051: { title: 'KEYPACKAGE RELAYS', tag: 'k10051', icon: '🔑' },
    3: { title: 'CONTACTS RELAY HINTS', tag: 'k3', icon: '👥' },
};

/**
 * Render a relay tray (collapsible section) for a single kind.
 * @param {number} kind
 * @param {Map<string, import('./health.js').HealthResult>} [healthResults]
 * @returns {string} HTML string
 */
export function renderRelayTray(kind, healthResults) {
    const label = KIND_LABELS[kind] || { title: `KIND ${kind}`, tag: `k${kind}`, icon: '◈' };
    const relays = getRelayList(kind);
    const changes = getStagedChanges(kind);
    const changeCount = changes.length;

    const relayRows = relays.map((entry) => {
        const health = healthResults?.get(entry.url);
        const hp = health ? healthScore(health) : null;
        const latencyStr = health
            ? `C:${formatLatency(health.connectMs)} R:${formatLatency(health.readMs)}`
            : '';
        const statusCls = entry.removed ? 'or-removed' : entry.staged ? 'or-staged' : '';
        const healthCls = health
            ? `or-health-${health.status}`
            : '';
        const changeIcon = entry.removed ? '−' : entry.staged ? '+' : '';
        const changeCls = entry.removed ? 'or-change-remove' : entry.staged ? 'or-change-add' : '';

        let rwToggles = '';
        if (kind === 10002 && !entry.removed) {
            const isRead = entry.readWrite === 'read' || entry.readWrite === 'rw';
            const isWrite = entry.readWrite === 'write' || entry.readWrite === 'rw';
            rwToggles = html`
                <span class="or-rw-toggles">
                    <button class="or-rw-btn ${isRead ? 'or-rw-active' : ''}"
                            data-action="toggle-rw" data-kind="${kind}" data-url="${escapeHtml(entry.url)}" data-rw="read"
                            title="Toggle read">R</button>
                    <button class="or-rw-btn ${isWrite ? 'or-rw-active' : ''}"
                            data-action="toggle-rw" data-kind="${kind}" data-url="${escapeHtml(entry.url)}" data-rw="write"
                            title="Toggle write">W</button>
                </span>
            `;
        }

        const removeBtn = entry.removed
            ? html`<button class="or-relay-action or-undo-btn" data-action="undo-remove" data-kind="${kind}" data-url="${escapeHtml(entry.url)}" title="Undo removal">↩</button>`
            : html`<button class="or-relay-action or-remove-btn" data-action="remove-relay" data-kind="${kind}" data-url="${escapeHtml(entry.url)}" title="Remove relay">✕</button>`;

        return html`
            <div class="or-relay-row ${statusCls} ${healthCls}">
                <span class="or-change-icon ${changeCls}">${changeIcon}</span>
                <span class="or-relay-dot"></span>
                <span class="or-relay-url">${escapeHtml(shortUrl(entry.url))}</span>
                ${rwToggles}
                <span class="or-relay-latency" title="${health?.nip11Summary ? escapeHtml(health.nip11Summary) : ''}">${latencyStr}</span>
                ${hp !== null ? html`
                    <span class="or-relay-hp" title="Health: ${hp}%">
                        <span class="or-hp-track"><span class="or-hp-fill" style="width:${hp}%"></span></span>
                    </span>
                ` : ''}
                ${removeBtn}
            </div>
        `;
    });

    const stageBadge = changeCount > 0
        ? html`<span class="or-staged-badge">${changeCount} STAGED</span>`
        : '';

    return html`
        <div class="or-tray" data-kind="${kind}">
            <div class="or-tray-header" data-action="toggle-tray" data-kind="${kind}">
                <span class="or-tray-icon">${label.icon}</span>
                <span class="or-tray-title">${label.title}</span>
                <span class="or-tray-tag">${label.tag}</span>
                <span class="or-tray-count">${relays.filter(r => !r.removed).length} relay(s)</span>
                ${stageBadge}
                <span class="or-tray-arrow">▾</span>
            </div>
            <div class="or-tray-body">
                ${relayRows.length > 0 ? relayRows : html`<div class="or-empty">No relays configured</div>`}
                <div class="or-add-row">
                    <input type="text" class="or-add-input" data-kind="${kind}"
                           placeholder="wss://relay.example.com" spellcheck="false" autocomplete="off">
                    <button class="or-add-btn" data-action="add-relay" data-kind="${kind}">+ ADD</button>
                </div>
                <div class="or-add-error hidden" data-kind="${kind}"></div>
            </div>
        </div>
    `;
}

/**
 * Render the full Operating Room editor panel.
 * @param {Map<string, import('./health.js').HealthResult>} [healthResults]
 * @returns {string} HTML string
 */
export function renderEditorPanel(healthResults) {
    const kinds = [10002, 10050, 10051, 3];
    const trays = kinds.map(k => renderRelayTray(k, healthResults));
    const totalChanges = totalStagedChanges();

    return html`
        <div class="or-editor">
            <div class="or-editor-header">
                <span class="or-editor-title">◈ OPERATING ROOM</span>
                <span class="or-editor-subtitle">RELAY MANAGEMENT</span>
            </div>
            ${trays}
            <div class="or-actions">
                ${totalChanges > 0 ? html`
                    <div class="or-staged-summary">
                        <span class="or-staged-count">${totalChanges} change(s) staged</span>
                        <button class="or-discard-btn" data-action="discard-all">DISCARD ALL</button>
                    </div>
                    <button class="or-operate-btn" data-action="commit-operate">
                        <span class="or-operate-icon">⚕</span> OPERATE
                    </button>
                ` : html`
                    <div class="or-no-changes">No changes staged — add or remove relays above</div>
                `}
                <button class="or-close-btn" data-action="close-or">◀ BACK TO CHART</button>
            </div>
        </div>
    `;
}

/**
 * Render the staged changes summary (diff preview).
 * @returns {string} HTML string
 */
export function renderStagedSummary() {
    const kinds = [10002, 10050, 10051, 3];
    const sections = [];

    for (const kind of kinds) {
        const changes = getStagedChanges(kind);
        if (changes.length === 0) continue;

        const label = KIND_LABELS[kind] || { title: `KIND ${kind}` };
        const rows = changes.map((c) => {
            if (c.type === 'add') {
                return html`<div class="or-diff-row or-diff-add">+ ${escapeHtml(shortUrl(c.url))}${c.readWrite ? ` [${c.readWrite.toUpperCase()}]` : ''}</div>`;
            }
            if (c.type === 'remove') {
                return html`<div class="or-diff-row or-diff-remove">− ${escapeHtml(shortUrl(c.url))}</div>`;
            }
            if (c.type === 'modify') {
                return html`<div class="or-diff-row or-diff-modify">~ ${escapeHtml(shortUrl(c.url))} [${(c.prevReadWrite || '').toUpperCase()} → ${(c.readWrite || '').toUpperCase()}]</div>`;
            }
            return '';
        });

        sections.push(html`
            <div class="or-diff-section">
                <div class="or-diff-title">${label.title}</div>
                ${rows}
            </div>
        `);
    }

    return sections.length > 0
        ? html`<div class="or-diff-preview">${sections}</div>`
        : '';
}
