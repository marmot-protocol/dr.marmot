import { getAudio } from './audio.js';
import { say } from './dialog.js';
import { setSprite } from './sprite.js';
import { startAudit } from './audit.js';
import { initStarfield } from './starfield.js';
import { npubInput, auditBtn } from './dom.js';

initStarfield();

auditBtn.addEventListener('click', () => { getAudio(); startAudit(); });
npubInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { getAudio(); startAudit(); }
});

setSprite('idle');
say("Hello! I am Doctor Marmot. Enter an npub below and I will conduct a thorough diagnostic — discovering relays from k3 / k10002 / k10051, checking sync across all of them, validating Marmot Protocol compliance, and examining vital signs. *adjusts stethoscope*");
