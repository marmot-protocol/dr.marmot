import { dialogText, dialogBox } from './dom.js';
import { typeBeep } from './audio.js';
import { isJeff } from './jeff.js';

let msgQueue = [];
let isTyping = false;
let typeTimer = null;
let autoTimer = null;
let onAllDone = null;

const AUTO_ADVANCE_MS = 400;

export function clearQueue() {
    msgQueue = [];
    clearInterval(typeTimer);
    clearTimeout(autoTimer);
    isTyping = false;
}

export function setOnAllDone(fn) {
    onAllDone = fn;
}

export function say(text, onDone = null) {
    return new Promise((resolve) => {
        const wrappedOnDone = () => {
            onDone?.();
            resolve();
        };
        msgQueue.push({ text, onDone: wrappedOnDone });
        if (!isTyping) _nextMsg();
    });
}

function _nextMsg() {
    clearTimeout(autoTimer);

    if (msgQueue.length === 0) {
        dialogText.classList.add('done');
        if (onAllDone) { const f = onAllDone; onAllDone = null; f(); }
        return;
    }

    isTyping = true;
    dialogText.classList.remove('done');

    const { text, onDone } = msgQueue[0];

    if (text.includes('<')) {
        dialogText.innerHTML = text;
        _finishMsg(onDone);
        return;
    }

    if (isJeff) {
        dialogText.textContent = text;
        _finishMsg(onDone);
        return;
    }

    dialogText.textContent = '';
    let i = 0;
    clearInterval(typeTimer);
    typeTimer = setInterval(() => {
        if (i % 3 === 0) typeBeep();
        dialogText.textContent += text.charAt(i);
        i++;
        if (i >= text.length) {
            clearInterval(typeTimer);
            _finishMsg(onDone);
        }
    }, 28);
}

function _finishMsg(onDone) {
    isTyping = false;
    if (onDone) onDone();

    if (msgQueue.length > 1) {
        autoTimer = setTimeout(() => {
            msgQueue.shift();
            _nextMsg();
        }, AUTO_ADVANCE_MS);
    } else {
        msgQueue = [];
        dialogText.classList.add('done');
        if (onAllDone) { const f = onAllDone; onAllDone = null; f(); }
    }
}

function _advance() {
    clearTimeout(autoTimer);
    if (isTyping) {
        clearInterval(typeTimer);
        const text = msgQueue[0]?.text ?? '';
        if (!text.includes('<')) dialogText.textContent = text;
        _finishMsg(msgQueue[0]?.onDone);
        return;
    }
    if (msgQueue.length > 1) {
        msgQueue.shift();
        _nextMsg();
    }
}

dialogBox.addEventListener('click', _advance);
