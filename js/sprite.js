import { sprite, spritePanel } from './dom.js';

export const POSES = ['idle', 'magnify', 'dig', 'blocked', 'working', 'writing', 'thinking', 'wave', 'thumbs-up', 'surprised', 'listening', 'shrug'];

const CYCLE_CLASSIC = ['magnify', 'dig', 'working', 'blocked'];
const CYCLE_CUTE = ['magnify', 'dig', 'working', 'blocked', 'thinking', 'listening', 'surprised', 'wave'];

/** Map extended poses to 6-pose equivalents when not bubbly */
const CLASSIC_FALLBACK = {
    thinking: 'working',
    wave: 'idle',
    'thumbs-up': 'idle',
    surprised: 'magnify',
    listening: 'working',
    shrug: 'blocked',
};

let investigatePoseIdx = 0;
let poseTimer = null;

function resolvePose(state) {
    if (spritePanel?.dataset?.spriteStyle === 'bubbly') return state;
    return CLASSIC_FALLBACK[state] ?? state;
}

export function setSprite(state, anim = '') {
    sprite.dataset.state = resolvePose(state);
    sprite.className = anim ? `anim-${anim}` : '';
}

export function startInvestigating() {
    const style = spritePanel?.dataset?.spriteStyle;
    const cycle = style === 'bubbly' ? CYCLE_CUTE : CYCLE_CLASSIC;
    investigatePoseIdx = 0;
    poseTimer = setInterval(() => {
        setSprite(cycle[investigatePoseIdx % cycle.length], 'bounce');
        investigatePoseIdx++;
    }, 1200);
}

export function stopInvestigating() {
    clearInterval(poseTimer);
    poseTimer = null;
}
