import { nip19 } from 'https://esm.sh/nostr-tools';
import { isJeff } from './jeff.js';
import { getAudio } from './audio.js';
import { say, clearQueue } from './dialog.js';
import { setSprite } from './sprite.js';
import { startAudit, resetAuditState } from './audit.js';
import { getDisplayName, speak } from './personalities.js';
import { removeScanBar } from './scan-bar.js';
import { npubInput, nip07Btn, nextBtn, auditBtn, cancelBtn, spritePanel, dialogSpeaker, spriteLabel, relayList } from './dom.js';
import { html } from './html.js';

if (isJeff) document.body.dataset.mode = 'jeff';

const SPRITE_STYLES = ['marmot', 'sunny', 'bubbly', 'professor', 'sparky', 'nuts', 'daimon', 'house'];

function initSpriteStyle() {
    if (isJeff) {
        if (dialogSpeaker) dialogSpeaker.textContent = 'Dr. Marmot';
        return;
    }
    /* Inline script in HTML sets style before first paint; only sync if missing */
    if (!spritePanel?.dataset?.spriteStyle) {
        const style = SPRITE_STYLES[Math.floor(Math.random() * SPRITE_STYLES.length)];
        spritePanel.dataset.spriteStyle = style;
    }
    const name = getDisplayName();
    if (dialogSpeaker) dialogSpeaker.textContent = name;
    if (spriteLabel) spriteLabel.textContent = name.toUpperCase();
}

initSpriteStyle();

function updateNip07State() {
    nip07Btn.disabled = !window.nostr;
    if (window.nostr) nip07Btn.classList.add('nip07-ready');
}

updateNip07State();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(updateNip07State, 500));
} else {
    setTimeout(updateNip07State, 500);
}

async function signInWithNip07() {
    if (!window.nostr) {
        say("No Nostr extension detected. Install nos2x, Alby, or another NIP-07–compatible extension.");
        return;
    }
    try {
        const hex = await window.nostr.getPublicKey();
        const npub = nip19.npubEncode(hex);
        npubInput.value = npub;
        startAudit({ fromNip07: true });
    } catch (e) {
        say(e?.message || "Extension declined or error occurred.");
    }
}

function resetForNextPatient() {
    getAudio();
    clearQueue();
    resetAuditState();
    removeScanBar();
    relayList.innerHTML = html`<div class="relay-idle">Awaiting investigation...</div>`;
    npubInput.value = '';
    nextBtn.classList.add('hidden');
    setSprite('idle');
    say(speak('nextPatient'));
    npubInput.focus();
}

nip07Btn.addEventListener('click', () => { getAudio(); signInWithNip07(); });
auditBtn.addEventListener('click', () => { getAudio(); startAudit(); });
nextBtn.addEventListener('click', resetForNextPatient);
cancelBtn.addEventListener('click', () => { getAudio(); resetForNextPatient(); });
npubInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { getAudio(); startAudit(); }
});

setSprite('idle');
say(speak('intro'));
