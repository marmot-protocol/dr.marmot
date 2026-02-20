import { sprite } from './dom.js';

export const POSES = ['idle', 'magnify', 'dig', 'blocked', 'working', 'writing'];

let investigatePoseIdx = 0;
let poseTimer = null;

export function setSprite(state, anim = '') {
    sprite.dataset.state = state;
    sprite.className = anim ? `anim-${anim}` : '';
}

export function startInvestigating() {
    const cycle = ['magnify', 'dig', 'working', 'blocked'];
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
