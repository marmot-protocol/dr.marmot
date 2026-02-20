import { nip19 } from 'https://esm.sh/nostr-tools';
import { getAudio } from './audio.js';
import { say } from './dialog.js';
import { setSprite } from './sprite.js';
import { startAudit } from './audit.js';
import { initStarfield } from './starfield.js';
import { getDisplayName, speak } from './personalities.js';
import { npubInput, nip07Btn, auditBtn, spritePanel, dialogSpeaker, spriteLabel } from './dom.js';

const SPRITE_STYLES = ['marmot', 'sunny', 'bubbly', 'professor', 'sparky', 'nuts', 'daimon', 'house'];

function initSpriteStyle() {
    /* Inline script in HTML sets style before first paint; only sync if missing */
    if (!spritePanel?.dataset?.spriteStyle) {
        const style = SPRITE_STYLES[Math.floor(Math.random() * SPRITE_STYLES.length)];
        spritePanel.dataset.spriteStyle = style;
    }
    const name = getDisplayName();
    if (dialogSpeaker) dialogSpeaker.textContent = name;
    if (spriteLabel) spriteLabel.textContent = name.toUpperCase();
}

initStarfield();
initSpriteStyle();

function updateNip07Visibility() {
    nip07Btn.classList.toggle('hidden', !window.nostr);
}

updateNip07Visibility();
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(updateNip07Visibility, 500));
} else {
    setTimeout(updateNip07Visibility, 500);
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

nip07Btn.addEventListener('click', () => { getAudio(); signInWithNip07(); });
auditBtn.addEventListener('click', () => { getAudio(); startAudit(); });
npubInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { getAudio(); startAudit(); }
});

setSprite('idle');
say(speak('intro'));
