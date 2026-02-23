import { relayList, gameWrap, getRelayRow } from './dom.js';
import { scanBeep } from './audio.js';

export function urlToId(url) {
    return url.replace(/[^a-z0-9]/gi, '_');
}

export function shortUrl(url) {
    return url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
}

export function clearRelayPanel() {
    relayList.innerHTML = '';
}

export function setRelayState(url, state, statusText) {
    const id = 'relay-' + urlToId(url);
    let row = getRelayRow(id);
    if (!row) {
        row = document.createElement('div');
        row.id = id;
        row.className = 'relay-row';
        row.innerHTML = `
            <div class="relay-dot"></div>
            <div class="relay-name">${shortUrl(url)}</div>
            <div class="relay-status">IDLE</div>
        `;
        relayList.appendChild(row);
    }
    row.className = `relay-row ${state}`;
    row.querySelector('.relay-status').textContent = statusText;
    scanBeep();
}

export function appendResultSection(title, items) {
    const sec = document.createElement('div');
    sec.className = 'result-section';
    sec.innerHTML = `<div class="result-section-title">◈ ${title}</div>`;
    for (const { type, text } of items) {
        const row = document.createElement('div');
        row.className = `result-row pop-in`;
        const icon = type === 'ok' ? '✔' : type === 'err' ? '✖' : type === 'warn' ? '!' : '•';
        row.innerHTML = `<span class="result-icon result-${type}">${icon}</span><span class="result-${type}">${text}</span>`;
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
