export const npubInput = document.getElementById('npub-input');
export const nip07Btn = document.getElementById('nip07-btn');
export const nextBtn = document.getElementById('next-btn');
export const auditBtn = document.getElementById('audit-btn');
export const dialogText = document.getElementById('dialog-text');
export const dialogArrow = document.getElementById('dialog-arrow');
export const dialogHint = document.getElementById('dialog-hint');
export const relayList = document.getElementById('relay-list');
export const sprite = document.getElementById('doctor-sprite');
export const spritePanel = document.getElementById('sprite-panel');
export const spriteLabel = document.getElementById('sprite-label');
export const gameWrap = document.getElementById('game-wrap');
export const dialogBox = document.getElementById('dialog-box');
export const dialogSpeaker = document.getElementById('dialog-speaker');

/** Returns scan-bar-wrap element (created dynamically by scan-bar.js). */
export function getScanBarWrap() { return document.getElementById('scan-bar-wrap'); }

/** Returns scan-bar element (created dynamically by scan-bar.js). */
export function getScanBar() { return document.getElementById('scan-bar'); }

/** Returns relay row by id (e.g. relay-wss___example_com). */
export function getRelayRow(id) { return document.getElementById(id); }
