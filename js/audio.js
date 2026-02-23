let audioCtx = null;

export function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

function beep(freq = 440, type = 'square', dur = 0.05, vol = 0.08) {
    try {
        const ctx = getAudio();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + dur);
    } catch (e) {
        console.error('Failed to play beep', e);
    }
}

export function typeBeep() { beep(880, 'square', 0.03, 0.04); }
export function okBeep() { beep(660, 'square', 0.08, 0.1); setTimeout(() => beep(880, 'square', 0.1, 0.1), 80); }
export function errBeep() { beep(220, 'sawtooth', 0.2, 0.12); }
export function scanBeep() { beep(440, 'square', 0.04, 0.06); }
