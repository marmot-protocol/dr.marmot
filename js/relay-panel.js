import { relayList, gameWrap, getRelayRow } from './dom.js';
import { scanBeep } from './audio.js';
import { html, escapeHtml } from './html.js';
import { shortUrl } from './relay-validation.js';
import { isJeff } from './jeff.js';

export { shortUrl };

export function urlToId(url) {
    return url.replace(/[^a-z0-9]/gi, '_');
}

export function clearRelayPanel() {
    relayList.innerHTML = '';
}

/** In Jeff Mode, relay rows are collected inside a wrapper card. */
function getRelayGroup() {
    let group = relayList.querySelector('.relay-group');
    if (!group) {
        group = document.createElement('div');
        group.className = 'relay-group';
        group.innerHTML = html`<div class="relay-group-title">Relays</div>`;
        relayList.appendChild(group);
    }
    return group;
}

export function setRelayState(url, state, statusText) {
    const id = 'relay-' + urlToId(url);
    let row = getRelayRow(id);
    if (!row) {
        row = document.createElement('div');
        row.id = id;
        row.className = 'relay-row';
        // shortUrl(url) is escaped before injection — relay URLs are untrusted input.
        row.innerHTML = html`
            <div class="relay-dot"></div>
            <div class="relay-name">${escapeHtml(shortUrl(url))}</div>
            <div class="relay-status">IDLE</div>
        `;
        if (isJeff) {
            getRelayGroup().appendChild(row);
        } else {
            relayList.appendChild(row);
        }
    }
    row.className = `relay-row ${state}`;
    row.querySelector('.relay-status').textContent = statusText;
    scanBeep();
}

/**
 * Renders a labelled section of audit result rows into the relay list panel.
 *
 * Audit item contract: `text` is treated as pre-formatted HTML (may contain
 * `<span>` tags for colour/emphasis such as `<span class="ok">…</span>`).
 * Callers are responsible for escaping any untrusted content before it reaches
 * `text`. Use {@link escapeHtml} from html.js for any relay URLs or external
 * strings that flow into these messages — do NOT pass raw untrusted values
 * through `text` without escaping first.
 */
export function appendResultSection(title, items) {
    const sec = document.createElement('div');
    sec.className = 'result-section';
    sec.innerHTML = html`<div class="result-section-title">◈ ${title}</div>`;
    for (const { type, text } of items) {
        const row = document.createElement('div');
        row.className = `result-row pop-in`;
        const icon = type === 'ok' ? '✔' : type === 'err' ? '✖' : type === 'warn' ? '!' : '•';
        row.innerHTML = html`
            <span class="result-icon result-${type}">${icon}</span>
            <span class="result-${type}">${text}</span>
        `;
        sec.appendChild(row);
    }
    relayList.appendChild(sec);
}

export function flashScreen(type) {
    gameWrap.classList.remove('flash-ok', 'flash-err');
    void gameWrap.offsetWidth;
    gameWrap.classList.add(type === 'ok' ? 'flash-ok' : 'flash-err');
    setTimeout(() => gameWrap.classList.remove('flash-ok', 'flash-err'), 900);
}
