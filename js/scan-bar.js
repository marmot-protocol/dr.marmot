import { dialogBox } from './dom.js';

export function addScanBar() {
    if (document.getElementById('scan-bar-wrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'scan-bar-wrap';
    wrap.innerHTML = `<div id="scan-bar" class="scanning"></div>`;
    dialogBox.appendChild(wrap);
}

export function removeScanBar() {
    const el = document.getElementById('scan-bar-wrap');
    if (el) el.remove();
}

export function setScanProgress(pct) {
    const bar = document.getElementById('scan-bar');
    if (bar) {
        bar.style.width = `${pct}%`;
        if (pct >= 100) bar.classList.remove('scanning');
    }
}
