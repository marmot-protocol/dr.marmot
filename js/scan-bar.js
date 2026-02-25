import { dialogBox, getScanBarWrap, getScanBar } from './dom.js';
import { html } from './html.js';

export function addScanBar() {
    if (getScanBarWrap()) return;
    const wrap = document.createElement('div');
    wrap.id = 'scan-bar-wrap';
    wrap.innerHTML = html`<div id="scan-bar" class="scanning"></div>`;
    dialogBox.appendChild(wrap);
}

export function removeScanBar() {
    const el = getScanBarWrap();
    if (el) el.remove();
}

export function setScanProgress(pct) {
    const bar = getScanBar();
    if (bar) {
        bar.style.width = `${pct}%`;
        if (pct >= 100) bar.classList.remove('scanning');
    }
}
