import { dialogText, dialogBox, dialogArrow, dialogHint } from './dom.js';
import { typeBeep } from './audio.js';
import { isJeff } from './jeff.js';

let msgQueue = [];
let isTyping = false;
let typeTimer = null;
let autoTimer = null;
let onAllDone = null;

/**
 * Delay before auto-advancing to next message (ms).
 * Set to 0 to disable auto-advance (click-to-advance only).
 */
let autoAdvanceMs = 0;

/**
 * Enable or disable auto-advance mode.
 * @param {boolean} enabled
 */
export function setAutoAdvance(enabled) {
    autoAdvanceMs = enabled ? 400 : 0;
}

export function clearQueue() {
    msgQueue = [];
    clearInterval(typeTimer);
    clearTimeout(autoTimer);
    isTyping = false;
    _hideAdvanceIndicators();
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

/**
 * Append a message entry to the dialog log.
 * @param {string} content - Text or pre-sanitized HTML
 * @param {boolean} isHtml - If true, render as innerHTML (caller must pre-sanitize); otherwise textContent
 */
function _appendToLog(content, isHtml = false) {
    const entry = document.createElement('div');
    entry.className = 'dialog-msg';
    if (isHtml) {
        entry.innerHTML = content;
    } else {
        entry.textContent = content;
    }
    dialogText.appendChild(entry);
    dialogText.scrollTop = dialogText.scrollHeight;
}

function _nextMsg() {
    clearTimeout(autoTimer);
    _hideAdvanceIndicators();

    if (msgQueue.length === 0) {
        dialogText.classList.add('done');
        if (onAllDone) { const f = onAllDone; onAllDone = null; f(); }
        return;
    }

    isTyping = true;
    dialogText.classList.remove('done');

    const { text, onDone } = msgQueue[0];

    if (text.includes('<')) {
        // Pre-formatted HTML from speak() — callers are responsible for sanitizing
        // untrusted values via escapeHtml() before they reach this path.
        _appendToLog(text, true);
        _finishMsg(onDone);
        return;
    }

    if (isJeff) {
        _appendToLog(text); // plain text — safe textContent path
        _finishMsg(onDone);
        return;
    }

    // Typewriter effect: create a new log entry and type into it
    const entry = document.createElement('div');
    entry.className = 'dialog-msg';
    dialogText.appendChild(entry);

    let i = 0;
    clearInterval(typeTimer);
    typeTimer = setInterval(() => {
        if (i % 3 === 0) typeBeep();
        entry.textContent += text.charAt(i);
        i++;
        dialogText.scrollTop = dialogText.scrollHeight;
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
        if (autoAdvanceMs > 0) {
            autoTimer = setTimeout(() => {
                msgQueue.shift();
                _nextMsg();
            }, autoAdvanceMs);
        } else {
            // Click-to-advance: show indicators and wait
            _showAdvanceIndicators();
        }
    } else {
        msgQueue = [];
        dialogText.classList.add('done');
        _hideAdvanceIndicators();
        if (onAllDone) { const f = onAllDone; onAllDone = null; f(); }
    }
}

function _showAdvanceIndicators() {
    if (dialogArrow) dialogArrow.classList.remove('hidden');
    if (dialogHint) dialogHint.classList.remove('hidden');
}

function _hideAdvanceIndicators() {
    if (dialogArrow) dialogArrow.classList.add('hidden');
    if (dialogHint) dialogHint.classList.add('hidden');
}

function _advance() {
    clearTimeout(autoTimer);
    _hideAdvanceIndicators();
    if (isTyping) {
        clearInterval(typeTimer);
        const msg = msgQueue[0];
        const text = msg?.text ?? '';
        // Complete the typewriter instantly
        const lastEntry = dialogText.querySelector('.dialog-msg:last-child');
        if (lastEntry && !text.includes('<')) {
            lastEntry.textContent = text;
        } else if (lastEntry) {
            lastEntry.innerHTML = text;
        }
        dialogText.scrollTop = dialogText.scrollHeight;
        _finishMsg(msg?.onDone);
        return;
    }
    if (msgQueue.length > 1) {
        msgQueue.shift();
        _nextMsg();
    }
}

dialogBox.addEventListener('click', _advance);
