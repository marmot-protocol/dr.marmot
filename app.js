import { nip19, SimplePool } from 'https://esm.sh/nostr-tools';

// ══════════════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════════════

const DEFAULT_RELAYS = [
    "wss://relay.damus.io",
    "wss://relay.primal.net",
    "wss://nos.lol",
];

const RELAY_TIMEOUT_MS = 5000;

// ══════════════════════════════════════════════════════════════
//  ELEMENTS
// ══════════════════════════════════════════════════════════════

const npubInput = document.getElementById('npub-input');
const auditBtn = document.getElementById('audit-btn');
const dialogText = document.getElementById('dialog-text');
const dialogArrow = document.getElementById('dialog-arrow');   // kept for fast-forward hint
const dialogHint = document.getElementById('dialog-hint');
const relayList = document.getElementById('relay-list');
const sprite = document.getElementById('doctor-sprite');
const gameWrap = document.getElementById('game-wrap');

// ══════════════════════════════════════════════════════════════
//  STARFIELD
// ══════════════════════════════════════════════════════════════

(function initStarfield() {
    const canvas = document.getElementById('starfield');
    const ctx = canvas.getContext('2d');
    let stars = [];

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        stars = Array.from({ length: 120 }, () => ({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            r: Math.random() * 1.4 + 0.3,
            a: Math.random(),
            speed: Math.random() * 0.008 + 0.002,
        }));
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const s of stars) {
            s.a += s.speed;
            const alpha = (Math.sin(s.a) * 0.5 + 0.5) * 0.8 + 0.1;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(160,160,255,${alpha.toFixed(2)})`;
            ctx.fill();
        }
        requestAnimationFrame(draw);
    }

    window.addEventListener('resize', resize);
    resize();
    draw();
})();

// ══════════════════════════════════════════════════════════════
//  WEB AUDIO (retro beeps)
// ══════════════════════════════════════════════════════════════

let audioCtx = null;
function getAudio() {
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
    } catch (e) { }
}

function typeBeep() { beep(880, 'square', 0.03, 0.04); }
function okBeep() { beep(660, 'square', 0.08, 0.1); setTimeout(() => beep(880, 'square', 0.1, 0.1), 80); }
function errBeep() { beep(220, 'sawtooth', 0.2, 0.12); }
function scanBeep() { beep(440, 'square', 0.04, 0.06); }

// ══════════════════════════════════════════════════════════════
//  DIALOG SYSTEM
// ══════════════════════════════════════════════════════════════

let msgQueue = [];
let isTyping = false;
let typeTimer = null;
let autoTimer = null;
let onAllDone = null;

const AUTO_ADVANCE_MS = 800; // pause between messages before auto-advancing

/** Queue a plain text message (with optional inline HTML via special tokens) */
function say(text, onDone = null) {
    msgQueue.push({ text, onDone });
    if (!isTyping) _nextMsg();
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

    // HTML-rich messages show instantly
    if (text.includes('<')) {
        dialogText.innerHTML = text;
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
        // Auto-advance to next message after a brief pause
        autoTimer = setTimeout(() => {
            msgQueue.shift();
            _nextMsg();
        }, AUTO_ADVANCE_MS);
    } else {
        msgQueue = [];
        dialogText.classList.add('done');
    }
}

// Clicking the dialog still fast-forwards / skips ahead
function _advance() {
    clearTimeout(autoTimer);
    if (isTyping) {
        // Fast-forward current typewriter
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

document.getElementById('dialog-box').addEventListener('click', _advance);

// ══════════════════════════════════════════════════════════════
//  SPRITE
// ══════════════════════════════════════════════════════════════

const POSES = ['idle', 'magnify', 'dig', 'blocked', 'working', 'writing'];

function setSprite(state, anim = '') {
    sprite.dataset.state = state;
    sprite.className = anim ? `anim-${anim}` : '';
}

let investigatePoseIdx = 0;
let poseTimer = null;

function startInvestigating() {
    // Cycle through magnify → dig → working → blocked
    const cycle = ['magnify', 'dig', 'working', 'blocked'];
    investigatePoseIdx = 0;
    poseTimer = setInterval(() => {
        setSprite(cycle[investigatePoseIdx % cycle.length], 'bounce');
        investigatePoseIdx++;
    }, 1200);
}

function stopInvestigating() {
    clearInterval(poseTimer);
    poseTimer = null;
}

// ══════════════════════════════════════════════════════════════
//  RELAY STATUS PANEL
// ══════════════════════════════════════════════════════════════

function clearRelayPanel() {
    relayList.innerHTML = '';
}

function setRelayState(url, state, statusText) {
    const id = 'relay-' + urlToId(url);
    let row = document.getElementById(id);
    if (!row) {
        row = document.createElement('div');
        row.id = id;
        row.className = 'relay-row';
        row.innerHTML = `
            <div class="relay-dot"></div>
            <div class="relay-name">${shortUrl(url)}</div>
            <div class="relay-status">IDLE</div>
        `;
        relayList.appendChild(row);
    }
    row.className = `relay-row ${state}`;
    row.querySelector('.relay-status').textContent = statusText;
    scanBeep();
}

function appendResultSection(title, items) {
    const sec = document.createElement('div');
    sec.className = 'result-section';
    sec.innerHTML = `<div class="result-section-title">◈ ${title}</div>`;
    for (const { type, text } of items) {
        const row = document.createElement('div');
        row.className = `result-row pop-in`;
        const icon = type === 'ok' ? '✔' : type === 'err' ? '✖' : type === 'warn' ? '!' : '•';
        row.innerHTML = `<span class="result-icon result-${type}">${icon}</span><span class="result-${type}">${text}</span>`;
        sec.appendChild(row);
    }
    relayList.appendChild(sec);
}

function urlToId(url) {
    return url.replace(/[^a-z0-9]/gi, '_');
}

function shortUrl(url) {
    return url.replace(/^wss?:\/\//, '').replace(/\/$/, '');
}

function flashScreen(type) {
    gameWrap.classList.remove('flash-ok', 'flash-err');
    void gameWrap.offsetWidth; // force reflow
    gameWrap.classList.add(type === 'ok' ? 'flash-ok' : 'flash-err');
    setTimeout(() => gameWrap.classList.remove('flash-ok', 'flash-err'), 900);
}

// ══════════════════════════════════════════════════════════════
//  SCAN BAR
// ══════════════════════════════════════════════════════════════

function addScanBar() {
    if (document.getElementById('scan-bar-wrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'scan-bar-wrap';
    wrap.innerHTML = `<div id="scan-bar" class="scanning"></div>`;
    document.getElementById('dialog-box').appendChild(wrap);
}

function removeScanBar() {
    const el = document.getElementById('scan-bar-wrap');
    if (el) el.remove();
}

function setScanProgress(pct) {
    const bar = document.getElementById('scan-bar');
    if (bar) {
        bar.style.width = `${pct}%`;
        if (pct >= 100) bar.classList.remove('scanning');
    }
}

// ══════════════════════════════════════════════════════════════
//  RELAY URL VALIDATION
// ══════════════════════════════════════════════════════════════

const MAX_RELAY_URL_LEN = 256;

/**
 * Validate a relay URL. Returns { valid: true } or { valid: false, reason: string }.
 */
function validateRelayUrl(url) {
    if (!url || typeof url !== 'string') return { valid: false, reason: 'empty or not a string' };
    const u = url.trim();
    if (!u) return { valid: false, reason: 'empty after trim' };
    if (u.length > MAX_RELAY_URL_LEN) return { valid: false, reason: 'URL too long' };
    if (u.includes('%20')) return { valid: false, reason: 'URL contains encoded space (%20)' };
    const lower = u.toLowerCase();
    if (!lower.startsWith('ws://') && !lower.startsWith('wss://')) {
        return { valid: false, reason: 'must use ws:// or wss:// scheme' };
    }
    try {
        const parsed = new URL(u);
        if (!parsed.hostname || parsed.hostname.length === 0) {
            return { valid: false, reason: 'missing hostname' };
        }
        if (/\s/.test(parsed.hostname)) {
            return { valid: false, reason: 'hostname contains spaces' };
        }
        // Reject http(s) masquerading (e.g. wss://http://evil.com)
        if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
            return { valid: false, reason: 'invalid protocol' };
        }
        return { valid: true };
    } catch (e) {
        return { valid: false, reason: 'malformed URL' };
    }
}

function isValidRelayUrl(url) {
    return validateRelayUrl(url).valid;
}

// ══════════════════════════════════════════════════════════════
//  MIP-00 KEYPACKAGE VALIDATION HELPERS
// ══════════════════════════════════════════════════════════════

/** Expected KeyPackageRef hex length by ciphersuite (RFC 9420 §17.1). */
const CIPHERSUITE_I_TAG_LEN = {
    '0x0001': 64, '0x0002': 64, '0x0003': 64,
    '0x0004': 128, '0x0005': 128, '0x0006': 128,
    '0x0007': 96,
};

const VALID_CIPHERSUITES = new Set(Object.keys(CIPHERSUITE_I_TAG_LEN));

/** Default MLS extensions that MUST NOT appear in mls_extensions (RFC 9420 §7.2). */
const DEFAULT_EXTENSIONS = new Set(['0x0001', '0x0002', '0x0003', '0x0004', '0x0005']);

function isValidBase64(str) {
    if (!str || typeof str !== 'string') return false;
    try {
        const decoded = atob(str.replace(/\s/g, ''));
        return decoded.length > 0;
    } catch {
        return false;
    }
}

/** Convert pubkey to hex for comparison. Handles Uint8Array or hex string. */
function pubkeyToHex(pubkey) {
    if (typeof pubkey === 'string' && /^[0-9a-f]{64}$/i.test(pubkey)) return pubkey.toLowerCase();
    if (pubkey instanceof Uint8Array && pubkey.length === 32) {
        return Array.from(pubkey).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (Array.isArray(pubkey) && pubkey.length === 32) {
        return pubkey.map(b => (b & 0xff).toString(16).padStart(2, '0')).join('');
    }
    return null;
}

/**
 * Verify NIP-05 by fetching /.well-known/nostr.json. Returns { verified: boolean, reason?: string }.
 */
async function verifyNip05(nip05, pubkey) {
    const hex = pubkeyToHex(pubkey);
    if (!hex) return { verified: false, reason: 'invalid pubkey' };
    const match = nip05.trim().match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
    if (!match) return { verified: false, reason: 'format invalid' };
    const [, localPart, domain] = match;
    const name = localPart.toLowerCase();
    let url;
    try {
        url = new URL(`https://${domain}/.well-known/nostr.json`);
        url.searchParams.set('name', name);
    } catch {
        return { verified: false, reason: 'invalid domain' };
    }
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    try {
        const res = await fetch(url.toString(), { method: 'GET', signal: ac.signal });
        if (!res.ok) return { verified: false, reason: `HTTP ${res.status}` };
        const body = await res.json();
        const names = body?.names;
        if (!names || typeof names !== 'object') return { verified: false, reason: 'no names in response' };
        const resolved = names[name] ?? names[localPart] ?? names[nip05.trim().toLowerCase()] ?? names[`${name}@${domain}`];
        if (!resolved || typeof resolved !== 'string') return { verified: false, reason: 'identifier not found' };
        const cleanResolved = resolved.length === 64 && /^[0-9a-f]+$/i.test(resolved) ? resolved.toLowerCase() : null;
        if (!cleanResolved) return { verified: false, reason: 'invalid pubkey in response' };
        return { verified: cleanResolved === hex, reason: cleanResolved !== hex ? 'pubkey mismatch' : undefined };
    } catch (e) {
        if (e.name === 'AbortError') return { verified: false, reason: 'timeout' };
        if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError')) {
            return { verified: false, reason: 'network/CORS' };
        }
        return { verified: false, reason: e.message || 'fetch failed' };
    } finally {
        clearTimeout(t);
    }
}

function validateKeyPackageIRef(val, ciphersuite) {
    if (!val || typeof val !== 'string') return { valid: false, reason: 'empty or not a string' };
    const s = val.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(s)) return { valid: false, reason: 'i tag must be hex-only' };
    const expectedLen = ciphersuite ? CIPHERSUITE_I_TAG_LEN[ciphersuite] : null;
    if (expectedLen != null && s.length !== expectedLen) {
        return { valid: false, reason: `i tag length ${s.length} ≠ ${expectedLen} for ciphersuite ${ciphersuite}` };
    }
    return { valid: true };
}

// ══════════════════════════════════════════════════════════════
//  RELAY DISCOVERY
// ══════════════════════════════════════════════════════════════

/** Extract relay URLs published by the user from events (k3, k10002, k10051). Returns { urls, invalid: [{ url, reason }] }. */
function extractUserRelays(events) {
    const seen = new Set();
    const invalidSeen = new Set(); // avoid duplicate invalid reports
    const urls = [];
    const invalid = [];

    function add(url) {
        if (!url || typeof url !== 'string') return;
        const u = url.trim();
        const v = validateRelayUrl(u);
        if (!v.valid) {
            const key = u.toLowerCase();
            if (invalidSeen.has(key)) return;
            invalidSeen.add(key);
            invalid.push({ url: u.slice(0, 60) + (u.length > 60 ? '…' : ''), reason: v.reason });
            return;
        }
        const key = u.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        urls.push(u);
    }

    for (const ev of events) {
        if (!ev?.tags) continue;
        if (ev.kind === 3) {
            // NIP-02: ["relay", "<url>", "read"|"write"]
            for (const t of ev.tags) if (t[0] === 'relay' && t[1]) add(t[1]);
        } else if (ev.kind === 10002) {
            // NIP-65: ["r", "<url>"]
            for (const t of ev.tags) if (t[0] === 'r' && t[1]) add(t[1]);
        } else if (ev.kind === 10051) {
            // MIP-00: ["relay", "<url>"]
            for (const t of ev.tags) if (t[0] === 'relay' && t[1]) add(t[1]);
        }
    }
    return { urls, invalid };
}

// ══════════════════════════════════════════════════════════════
//  PER-RELAY QUERY
// ══════════════════════════════════════════════════════════════

function queryRelayForKinds(pool, relayUrl, pubkey, kinds) {
    return new Promise((resolve) => {
        const results = {};
        for (const k of kinds) results[k] = null;

        try {
            const sub = pool.subscribeMany([relayUrl], { authors: [pubkey], kinds }, {
                onevent(ev) {
                    if (!results[ev.kind] || ev.created_at > results[ev.kind].created_at) {
                        results[ev.kind] = ev;
                    }
                },
                oneose() {
                    sub.close();
                    resolve(results);
                },
            });
            setTimeout(() => { try { sub.close(); } catch (e) { } resolve(results); }, RELAY_TIMEOUT_MS);
        } catch (e) {
            resolve(results);
        }
    });
}

// ══════════════════════════════════════════════════════════════
//  MAIN AUDIT
// ══════════════════════════════════════════════════════════════

let isAuditing = false;

async function startAudit() {
    if (isAuditing) return;

    const rawNpub = npubInput.value.trim();

    // Validate format
    if (!rawNpub.startsWith('npub1') || rawNpub.length < 60) {
        say("Hmm, that doesn't look like a valid npub. It should start with npub1 and be about 63 characters long.");
        errBeep();
        return;
    }

    let pubkey;
    try {
        const dec = nip19.decode(rawNpub);
        if (dec.type !== 'npub') throw new Error('bad type');
        pubkey = dec.data;
    } catch {
        say("I couldn't decode that npub. Are you sure it's correct?");
        errBeep();
        return;
    }

    // ── Begin ──
    isAuditing = true;
    msgQueue = [];
    auditBtn.disabled = true;
    clearRelayPanel();
    addScanBar();
    setScanProgress(0);

    setSprite('idle', 'bounce');
    say(`Very well. Initiating full diagnostic for patient ${rawNpub.slice(0, 16)}...`, () => {
        startInvestigating();
    });

    const pool = new SimplePool();
    const relayData = {}; // relayUrl → { k0, k3, k10051 }
    let invalidMarmot = [];
    let kpEventsCollected = [];

    // ── Phase 1a: Bootstrap — query default relays to discover user's relays ──
    say("Taking your pulse... connecting to bootstrap relays to discover your relay list.");

    for (const r of DEFAULT_RELAYS) {
        setRelayState(r, 'connecting', 'DISCOVER');
    }

    const bootstrapKinds = [0, 3, 10002, 10051];
    const bootstrapQueries = DEFAULT_RELAYS.map(async (r) => {
        const res = await queryRelayForKinds(pool, r, pubkey, bootstrapKinds);
        relayData[r] = res;
        const hasAny = res[0] || res[3] || res[10002] || res[10051];
        if (!hasAny) setRelayState(r, 'error', 'NO DATA');
        else setRelayState(r, 'ok', 'OK');
        return res;
    });

    const bootstrapResults = await Promise.all(bootstrapQueries);
    setScanProgress(15);

    // Collect all events for relay extraction (k3, k10002, k10051)
    const allEventsForDiscovery = [];
    for (const res of bootstrapResults) {
        for (const k of [3, 10002, 10051]) if (res[k]) allEventsForDiscovery.push(res[k]);
    }

    const { urls: userRelays, invalid: invalidUserRelays } = extractUserRelays(allEventsForDiscovery);
    const relaysToInvestigate = userRelays.length > 0 ? userRelays : DEFAULT_RELAYS;

    // ── Relay URL validity (user-published relays) ──
    const urlValidityItems = [];
    if (invalidUserRelays.length > 0) {
        for (const { url, reason } of invalidUserRelays) {
            urlValidityItems.push({ type: 'err', text: `Invalid relay: ${url} — ${reason}` });
        }
    }
    for (const r of userRelays) {
        urlValidityItems.push({ type: 'ok', text: `${shortUrl(r)} — valid format` });
    }
    if (urlValidityItems.length > 0) {
        appendResultSection('RELAY URL VALIDITY', urlValidityItems);
    }

    if (userRelays.length > 0) {
        say(`Found <span class="hi">${userRelays.length}</span> relay(s) from your k3 / k10002 / k10051. Investigating all of them...`);
    } else if (invalidUserRelays.length > 0) {
        say("Found relay tags but <span class='err'>all URLs were invalid</span>. Using standard relays for the audit...");
    } else {
        say("No relay lists found in your profile. Using standard relays for the audit...");
    }

    // ── Phase 1b: Query all user-published relays for k0, k3, k10051 ──
    const toQuery = relaysToInvestigate.filter(r => !relayData[r]); // skip already-queried
    for (const r of toQuery) {
        setRelayState(r, 'connecting', 'CONNECTING');
    }
    setScanProgress(20);

    const userRelayQueries = toQuery.map(async (r) => {
        const res = await queryRelayForKinds(pool, r, pubkey, [0, 3, 10051]);
        relayData[r] = res;
        const hasAny = res[0] || res[3] || res[10051];
        if (!hasAny) setRelayState(r, 'error', 'NO DATA');
        else setRelayState(r, 'ok', 'OK');
    });

    await Promise.all(userRelayQueries);
    setScanProgress(50);

    // ── Phase 2: Crossed wires analysis (across ALL investigated relays) ──
    stopInvestigating();
    setSprite('magnify', 'bounce');
    say("All relays queried. Examining for crossed wires and sync anomalies...");

    let maxK0 = 0, maxK3 = 0, max10051 = 0;
    let best10051 = null;
    for (const r of relaysToInvestigate) {
        const d = relayData[r];
        if (d) {
            if (d[0]?.created_at > maxK0) maxK0 = d[0].created_at;
            if (d[3]?.created_at > maxK3) maxK3 = d[3].created_at;
            if (d[10051]?.created_at > max10051) {
                max10051 = d[10051].created_at;
                best10051 = d[10051];
            }
        }
    }

    const cwItems = [];
    let hasCrossed = false;

    if (maxK0 === 0) {
        cwItems.push({ type: 'err', text: 'No Profile (kind 0) found on any relay!' });
        hasCrossed = true;
    } else {
        for (const r of relaysToInvestigate) {
            const ev = relayData[r]?.[0];
            if (!ev) {
                setRelayState(r, 'warn', 'MISSING k0');
                cwItems.push({ type: 'warn', text: `${shortUrl(r)} — Profile (k0) missing` });
                hasCrossed = true;
            } else if (ev.created_at < maxK0) {
                setRelayState(r, 'warn', 'STALE k0');
                cwItems.push({ type: 'warn', text: `${shortUrl(r)} — Profile (k0) outdated` });
                hasCrossed = true;
            } else {
                cwItems.push({ type: 'ok', text: `${shortUrl(r)} — Profile in sync` });
            }
        }
    }

    if (maxK3 === 0) {
        cwItems.push({ type: 'err', text: 'No Contacts (kind 3) found on any relay!' });
        hasCrossed = true;
    } else {
        for (const r of relaysToInvestigate) {
            const ev = relayData[r]?.[3];
            if (!ev) {
                cwItems.push({ type: 'warn', text: `${shortUrl(r)} — Contacts (k3) missing` });
                hasCrossed = true;
            } else if (ev.created_at < maxK3) {
                cwItems.push({ type: 'warn', text: `${shortUrl(r)} — Contacts (k3) outdated` });
                hasCrossed = true;
            } else {
                cwItems.push({ type: 'ok', text: `${shortUrl(r)} — Contacts in sync` });
            }
        }
    }

    appendResultSection('RELAY SYNC (k0 / k3)', cwItems);
    setScanProgress(65);

    // ── Phase 2b: Profile Vital Signs (kind 0 metadata) ──
    setSprite('magnify', 'bounce');
    say("Checking vital signs: name, picture, NIP-05...");
    const bestK0 = maxK0 ? [...relaysToInvestigate].map(r => relayData[r]?.[0]).find(e => e?.created_at === maxK0) : null;
    const vitalItems = [];
    if (bestK0?.content) {
        try {
            const meta = JSON.parse(bestK0.content);
            const hasName = !!meta?.name?.trim();
            const hasPicture = !!meta?.picture?.trim();
            const hasAbout = !!meta?.about?.trim();
            const nip05 = meta?.nip05?.trim() || '';
            vitalItems.push({ type: hasName ? 'ok' : 'warn', text: hasName ? `Name: "${(meta.name || '').slice(0, 40)}${(meta.name || '').length > 40 ? '…' : ''}"` : 'Name: missing' });
            vitalItems.push({ type: hasPicture ? 'ok' : 'warn', text: hasPicture ? 'Picture: set' : 'Picture: missing' });
            vitalItems.push({ type: hasAbout ? 'ok' : 'warn', text: hasAbout ? `About: ${(meta.about || '').length} chars` : 'About: missing' });
            if (nip05) {
                const nip05FormatOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nip05);
                if (!nip05FormatOk) {
                    vitalItems.push({ type: 'warn', text: `NIP-05: "${nip05}" — format invalid (expected user@domain.tld)` });
                } else {
                    say("Contacting NIP-05 server to verify...");
                    const v = await verifyNip05(nip05, pubkey);
                    if (v.verified) {
                        vitalItems.push({ type: 'ok', text: `NIP-05: ${nip05} ✓ verified` });
                    } else {
                        vitalItems.push({ type: 'err', text: `NIP-05: ${nip05} — ${v.reason}` });
                    }
                }
            } else {
                vitalItems.push({ type: 'warn', text: 'NIP-05: not set (optional, improves identity verification)' });
            }
        } catch {
            vitalItems.push({ type: 'warn', text: 'Profile content not valid JSON' });
        }
    } else if (maxK0 > 0) {
        vitalItems.push({ type: 'warn', text: 'Profile (kind 0) found but content empty' });
    }
    if (vitalItems.length > 0) appendResultSection('PROFILE VITAL SIGNS', vitalItems);

    // ── Phase 2c: Relay Resilience (redundancy) ──
    const resilienceItems = [];
    if (relaysToInvestigate.length <= 1) {
        resilienceItems.push({ type: 'warn', text: 'Single relay — fragile! One outage = total unavailability' });
        resilienceItems.push({ type: 'warn', text: 'Prescription: Add more relays to k3 / k10002 / k10051 for redundancy' });
    } else {
        resilienceItems.push({ type: 'ok', text: `${relaysToInvestigate.length} relay(s) — good redundancy` });
    }
    appendResultSection('RELAY RESILIENCE', resilienceItems);

    // ── Phase 2d: Event Freshness (record age) ──
    const nowSec = Math.floor(Date.now() / 1000);
    const daysAgo = (ts) => ts ? Math.floor((nowSec - ts) / 86400) : null;
    const freshnessItems = [];
    if (maxK0 > 0) {
        const d = daysAgo(maxK0);
        freshnessItems.push({ type: d !== null && d > 365 ? 'warn' : 'ok', text: `Profile (k0): ${d === 0 ? 'today' : d === 1 ? '1 day ago' : d < 365 ? `${d} days ago` : `over 1 year ago (${d} days)`}` });
    }
    if (maxK3 > 0) {
        const d = daysAgo(maxK3);
        freshnessItems.push({ type: d !== null && d > 365 ? 'warn' : 'ok', text: `Contacts (k3): ${d === 0 ? 'today' : d === 1 ? '1 day ago' : d < 365 ? `${d} days ago` : `over 1 year ago (${d} days)`}` });
    }
    if (max10051 > 0) {
        const d = daysAgo(max10051);
        freshnessItems.push({ type: d !== null && d > 365 ? 'warn' : 'ok', text: `KeyPackage list (k10051): ${d === 0 ? 'today' : d === 1 ? '1 day ago' : d < 365 ? `${d} days ago` : `over 1 year ago (${d} days)`}` });
    }
    if (freshnessItems.length > 0) appendResultSection('EVENT FRESHNESS', freshnessItems);

    // ── Phase 2e: Social Graph (follow list) ──
    const bestK3 = maxK3 ? [...relaysToInvestigate].map(r => relayData[r]?.[3]).find(e => e?.created_at === maxK3) : null;
    const followCount = bestK3?.tags?.filter(t => t[0] === 'p' && t[1]).length ?? 0;
    const socialItems = [];
    if (maxK3 > 0) {
        socialItems.push({ type: 'ok', text: `Follow list: ${followCount} contact(s)` });
        if (followCount === 0) socialItems.push({ type: 'warn', text: 'Empty follow list — some clients expect at least one contact' });
    }
    if (socialItems.length > 0) appendResultSection('SOCIAL GRAPH', socialItems);

    if (hasCrossed) {
        say(`<span class="err">⚠ CROSSED WIRES DETECTED!</span> Some relays have stale or missing events. See the panel above for details.`);
        errBeep();
    } else {
        say(`<span class="ok">✔ Profile and Contacts are perfectly in sync</span> across all your relays.`);
        okBeep();
    }

    // ── Phase 3: Marmot Protocol Audit ──
    setSprite('working', 'bounce');
    say("Now running the Marmot Protocol panel — MIP-00 / MIP-01 compliance scan...");

    const mipItems = [];
    let marmotOk = true;
    let marmotRelays = [];

    if (!best10051) {
        mipItems.push({ type: 'err', text: 'Missing Relay List (kind 10051) — not Marmot-ready' });
        marmotOk = false;
    } else {
        mipItems.push({ type: 'ok', text: 'Relay List (kind 10051) found' });
        if (best10051.content && best10051.content.trim() !== '') {
            mipItems.push({ type: 'warn', text: 'kind 10051 content should be empty' });
        }
        const rawMarmotRelays = best10051.tags.filter(t => t[0] === 'relay').map(t => t[1]);
        invalidMarmot = [];
        const invalidMarmotSeen = new Set();
        marmotRelays = rawMarmotRelays.filter((u) => {
            const v = validateRelayUrl(u);
            if (!v.valid) {
                const key = (u || '').toLowerCase();
                if (!invalidMarmotSeen.has(key)) {
                    invalidMarmotSeen.add(key);
                    invalidMarmot.push({ url: (u || '').slice(0, 50) + ((u || '').length > 50 ? '…' : ''), reason: v.reason });
                }
                return false;
            }
            return true;
        });

        for (const { url, reason } of invalidMarmot) {
            mipItems.push({ type: 'err', text: `Invalid KeyPackage relay: ${url} — ${reason}` });
            marmotOk = false;
        }
        if (marmotRelays.length === 0 && rawMarmotRelays.length > 0) {
            mipItems.push({ type: 'err', text: 'All kind 10051 relay URLs are invalid!' });
            marmotOk = false;
        } else if (marmotRelays.length === 0) {
            mipItems.push({ type: 'err', text: 'kind 10051 has no relay tags!' });
            marmotOk = false;
        } else {
            mipItems.push({ type: 'ok', text: `${marmotRelays.length} valid KeyPackage relay(s) listed` });
            // KeyPackage relay accessibility: SHOULD overlap with main relay list (k3/k10002)
            const mainRelaySet = new Set();
            for (const r of relaysToInvestigate) {
                const d = relayData[r];
                if (d?.[3]?.tags) for (const t of d[3].tags || []) if (t[0] === 'relay' && t[1] && validateRelayUrl(t[1].trim()).valid) mainRelaySet.add(t[1].trim().toLowerCase());
                if (d?.[10002]?.tags) for (const t of d[10002].tags || []) if (t[0] === 'r' && t[1] && validateRelayUrl(t[1].trim()).valid) mainRelaySet.add(t[1].trim().toLowerCase());
            }
            if (mainRelaySet.size > 0) {
                const hasOverlap = marmotRelays.some(u => mainRelaySet.has(u.trim().toLowerCase()));
                if (!hasOverlap) {
                    mipItems.push({ type: 'warn', text: 'KeyPackage relays not in your main relay list (k3/k10002) — inviters may need to connect to extra relays to find your KeyPackages' });
                }
            }
            say(`Found <span class="hi">${marmotRelays.length}</span> KeyPackage relay(s). Fetching KeyPackages (kind 443)...`);

            // Query Marmot relays for kind 443
            for (const r of marmotRelays) {
                setRelayState(r, 'connecting', 'KP QUERY');
            }

            let kpEvents = [];
            try {
                kpEvents = await pool.querySync(marmotRelays, { authors: [pubkey], kinds: [443] });
                kpEventsCollected = kpEvents;
                for (const r of marmotRelays) {
                    setRelayState(r, 'ok', 'KP OK');
                }
            } catch (e) {
                for (const r of marmotRelays) {
                    setRelayState(r, 'error', 'KP FAIL');
                }
                mipItems.push({ type: 'err', text: 'Failed to connect to KeyPackage relays' });
                marmotOk = false;
            }

            setScanProgress(85);

            if (kpEvents.length === 0) {
                mipItems.push({ type: 'err', text: 'No KeyPackages (kind 443) found on advertised relays' });
                marmotOk = false;
            } else {
                mipItems.push({ type: 'ok', text: `${kpEvents.length} KeyPackage(s) found` });

                // Validate each KeyPackage (report on all, not just first)
                const marmotRelaySet = new Set(marmotRelays.map(u => u.toLowerCase()));
                let kpErrors = 0;
                for (const kp of kpEvents) {
                    const enc = kp.tags.find(t => t[0] === 'encoding');
                    const ver = kp.tags.find(t => t[0] === 'mls_protocol_version');
                    const iTag = kp.tags.find(t => t[0] === 'i');
                    const ext = kp.tags.find(t => t[0] === 'mls_extensions');
                    const cph = kp.tags.find(t => t[0] === 'mls_ciphersuite');
                    const rel = kp.tags.find(t => t[0] === 'relays');

                    const errs = [];
                    if (!kp.content || typeof kp.content !== 'string') errs.push('missing content');
                    else if (!kp.content.trim()) errs.push('content empty');
                    else if (!isValidBase64(kp.content)) errs.push('content not valid base64');
                    if (!enc) errs.push('missing encoding tag');
                    else if ((enc[1] || '').toLowerCase() === 'hex') errs.push('hex encoding no longer supported per MIP-00; use base64');
                    else if (enc[1] !== 'base64') errs.push('encoding ≠ base64');
                    if (!ver || ver[1] !== '1.0') errs.push('mls_protocol_version missing/wrong');
                    if (!iTag || !iTag[1]) errs.push('missing i tag (KeyPackageRef)');
                    if (!cph) errs.push('missing mls_ciphersuite');
                    else if (!VALID_CIPHERSUITES.has(cph[1])) errs.push(`mls_ciphersuite ${cph[1]} not in 0x0001-0x0007`);
                    if (iTag?.[1] && cph?.[1]) {
                        const iVal = validateKeyPackageIRef(iTag[1], cph[1]);
                        if (!iVal.valid) errs.push(`i tag: ${iVal.reason}`);
                    }
                    if (!rel || rel.length < 2) errs.push('missing relays tag');
                    else {
                        for (let i = 1; i < rel.length; i++) {
                            const v = validateRelayUrl(rel[i]);
                            if (!v.valid) errs.push(`relays[${i}] invalid: ${v.reason}`);
                        }
                        let hasOverlap = false;
                        for (let i = 1; i < rel.length; i++) {
                            if (validateRelayUrl(rel[i]).valid && marmotRelaySet.has(rel[i].trim().toLowerCase())) {
                                hasOverlap = true;
                                break;
                            }
                        }
                        if (!hasOverlap && marmotRelaySet.size > 0) errs.push('relays tag has no overlap with kind 10051');
                    }
                    if (!ext) {
                        errs.push('missing mls_extensions');
                    } else {
                        if (!ext.includes('0xf2ee')) errs.push('missing 0xf2ee (marmot_group_data)');
                        if (!ext.includes('0x000a')) errs.push('missing 0x000a (last_resort)');
                        const listedDefaults = ext.slice(1).filter(e => DEFAULT_EXTENSIONS.has(e));
                        if (listedDefaults.length > 0) errs.push(`mls_extensions must not list default extensions: ${listedDefaults.join(', ')}`);
                    }

                    if (errs.length > 0) {
                        kpErrors++;
                        for (const e of errs) {
                            mipItems.push({ type: 'err', text: `KP ${kp.id.slice(0, 8)}… — ${e}`, kpId: kp.id });
                        }
                        marmotOk = false;
                    } else {
                        mipItems.push({ type: 'ok', text: `KP ${kp.id.slice(0, 8)}… — all tags valid` });
                    }
                }

                if (kpErrors === 0) {
                    mipItems.push({ type: 'ok', text: 'All KeyPackages pass MIP-00 / MIP-01 checks' });
                } else {
                    mipItems.push({ type: 'err', text: `${kpErrors} KeyPackage(s) failed validation` });
                }
            }
        }
    }

    appendResultSection('MARMOT PROTOCOL (MIP-00/01)', mipItems);

    // ── Phase 3b: KeyPackage Vital Stats ──
    if (kpEventsCollected.length > 0) {
        const nowSec2 = Math.floor(Date.now() / 1000);
        const daysAgoKp = (ts) => ts ? Math.floor((nowSec2 - ts) / 86400) : null;
        const ciphersuites = new Set();
        const clients = new Set();
        let newestKp = 0, oldestKp = Infinity;
        for (const kp of kpEventsCollected) {
            const cph = kp.tags?.find(t => t[0] === 'mls_ciphersuite');
            if (cph?.[1]) ciphersuites.add(cph[1]);
            const cli = kp.tags?.find(t => t[0] === 'client');
            if (cli?.[1]) clients.add(cli[1]);
            if (kp.created_at) {
                if (kp.created_at > newestKp) newestKp = kp.created_at;
                if (kp.created_at < oldestKp) oldestKp = kp.created_at;
            }
        }
        const kpStatsItems = [];
        kpStatsItems.push({ type: 'ok', text: `${kpEventsCollected.length} KeyPackage(s) on file` });
        if (ciphersuites.size > 0) {
            kpStatsItems.push({ type: 'ok', text: `Ciphersuite(s): ${[...ciphersuites].join(', ')}` });
            if (ciphersuites.size > 1) kpStatsItems.push({ type: 'warn', text: 'Multiple ciphersuites — different clients may use different crypto' });
        }
        if (clients.size > 0) {
            kpStatsItems.push({ type: 'ok', text: `Client(s): ${[...clients].slice(0, 5).join(', ')}${clients.size > 5 ? '…' : ''}` });
        }
        if (newestKp > 0) {
            const d = daysAgoKp(newestKp);
            kpStatsItems.push({ type: d !== null && d > 90 ? 'warn' : 'ok', text: `Newest KP: ${d === 0 ? 'today' : d === 1 ? '1 day ago' : d < 90 ? `${d} days ago` : `${d} days ago — consider rotating`}` });
        }
        if (oldestKp < Infinity && kpEventsCollected.length > 1) {
            const d = daysAgoKp(oldestKp);
            kpStatsItems.push({ type: 'ok', text: `Oldest KP: ${d === 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`}` });
        }
        if (kpEventsCollected.length === 1) {
            kpStatsItems.push({ type: 'warn', text: 'Single KeyPackage — add more for redundancy (different devices / clients)' });
        }
        appendResultSection('KEYPACKAGE VITAL STATS', kpStatsItems);
    }

    setScanProgress(100);
    removeScanBar();

    const allUsedRelays = [...new Set([...DEFAULT_RELAYS, ...relaysToInvestigate, ...marmotRelays])];
    pool.close(allUsedRelays);

    // ── Phase 4: Build the Final Diagnosis ──
    stopInvestigating();
    setSprite('writing', 'bounce');
    say("Charting the final diagnosis...");

    // Collect all findings into structured data
    const findings = { pass: [], warn: [], fail: [] };

    // Relay URL validity findings
    if (invalidUserRelays.length > 0) {
        for (const { url, reason } of invalidUserRelays) {
            findings.fail.push(`Invalid relay URL: ${url} — ${reason}`);
        }
    }
    for (const { url, reason } of invalidMarmot) {
        findings.fail.push(`Invalid KeyPackage relay: ${url} — ${reason}`);
    }

    // Relay sync findings
    const totalRelays = relaysToInvestigate.length;
    let syncedRelays = 0;
    let staleRelays = 0;
    let missingRelays = 0;

    for (const r of relaysToInvestigate) {
        const d = relayData[r];
        const k0ok = d?.[0] && d[0].created_at === maxK0;
        const k3ok = d?.[3] && d[3].created_at === maxK3;
        if (k0ok && k3ok) {
            syncedRelays++;
        } else {
            if (!d?.[0] || !d?.[3]) missingRelays++;
            else staleRelays++;
        }
    }

    if (maxK0 === 0) {
        findings.fail.push('Profile (kind 0) not found on any relay');
    } else if (syncedRelays === totalRelays) {
        findings.pass.push(`Profile (kind 0) in sync across all ${totalRelays} relay(s)`);
    } else {
        if (staleRelays > 0) findings.warn.push(`Profile (kind 0) outdated on ${staleRelays} relay(s)`);
        if (missingRelays > 0) findings.warn.push(`Profile (kind 0) missing from ${missingRelays} relay(s)`);
    }

    if (maxK3 === 0) {
        findings.fail.push('Contacts list (kind 3) not found on any relay');
    } else {
        let k3stale = 0, k3miss = 0;
        for (const r of relaysToInvestigate) {
            const ev = relayData[r]?.[3];
            if (!ev) k3miss++;
            else if (ev.created_at < maxK3) k3stale++;
        }
        if (k3stale === 0 && k3miss === 0) {
            findings.pass.push(`Contacts (kind 3) in sync across all ${totalRelays} relay(s)`);
        } else {
            if (k3stale > 0) findings.warn.push(`Contacts (kind 3) outdated on ${k3stale} relay(s)`);
            if (k3miss > 0) findings.warn.push(`Contacts (kind 3) missing from ${k3miss} relay(s)`);
        }
    }

    // Marmot findings
    if (!best10051) {
        findings.fail.push('No KeyPackage Relay List (kind 10051) — Marmot protocol requires this');
    } else {
        findings.pass.push('KeyPackage Relay List (kind 10051) published');
        if (marmotRelays.length === 0) {
            findings.fail.push('kind 10051 contains no relay tags');
        } else {
            findings.pass.push(`${marmotRelays.length} KeyPackage relay(s) advertised`);
        }
    }

    // KP tag findings
    for (const item of mipItems) {
        if (item.type === 'err' && item.text.startsWith('KP ')) findings.fail.push(item.text);
        if (item.type === 'err' && item.text.includes('No KeyPackages')) findings.fail.push(item.text);
        if (item.type === 'ok' && item.text.includes('all tags valid')) findings.pass.push(item.text);
        if (item.type === 'ok' && item.text.includes('All KeyPackages pass')) findings.pass.push(item.text);
        if (item.type === 'warn') findings.warn.push(item.text);
    }

    // Determine overall verdict
    const hasFailures = findings.fail.length > 0;
    const hasWarnings = findings.warn.length > 0;
    const allOk = !hasFailures && !hasWarnings;

    let verdictClass, verdictIcon, verdictLabel;
    if (allOk) {
        verdictClass = 'verdict-pass';
        verdictIcon = '✔';
        verdictLabel = 'CLEAN BILL OF HEALTH';
    } else if (!hasFailures && hasWarnings) {
        verdictClass = 'verdict-warn';
        verdictIcon = '!';
        verdictLabel = 'MINOR ISSUES DETECTED';
    } else {
        verdictClass = 'verdict-fail';
        verdictIcon = '✖';
        verdictLabel = 'ISSUES FOUND';
    }

    // Build prescriptions (recommendations)
    const prescriptions = [];
    if (invalidUserRelays.length > 0) {
        prescriptions.push('Fix invalid relay URLs in your k3 / k10002 / k10051 — use wss:// or ws:// and valid hostnames');
    }
    if (invalidMarmot.length > 0) {
        prescriptions.push('Fix invalid relay URLs in kind 10051 — ensure all relay tags use valid wss:// or ws:// URLs');
    }
    if (staleRelays > 0 || missingRelays > 0) {
        prescriptions.push('Rebroadcast your Profile (kind 0) and Contacts (kind 3) to all your relays');
    }
    if (!best10051) {
        prescriptions.push('Publish a KeyPackage Relay List (kind 10051) to enable Marmot messaging');
    } else if (marmotRelays.length === 0) {
        prescriptions.push('Add relay tags to your kind 10051 event');
    }
    const missingITagIds = [...new Set(
        mipItems.filter(i => i.type === 'err' && i.text.includes('missing i tag') && i.kpId).map(i => i.kpId)
    )];
    if (missingITagIds.length > 0) {
        prescriptions.push(`Broadcast delete events (kind 5) for KeyPackages missing the i tag (ids: ${missingITagIds.join(', ')}), then publish fresh KeyPackages with the i tag`);
    }
    for (const item of mipItems) {
        if (item.type === 'err' && item.text.includes('No KeyPackages')) {
            prescriptions.push('Publish at least one KeyPackage (kind 443) to your advertised relays');
        }
        if (item.type === 'err' && item.text.includes('encoding')) {
            prescriptions.push('Fix KeyPackage encoding tag — must be "base64"');
        }
        if (item.type === 'err' && item.text.includes('0xf2ee')) {
            prescriptions.push('Add marmot_group_data extension (0xf2ee) to mls_extensions');
        }
        if (item.type === 'err' && item.text.includes('0x000a')) {
            prescriptions.push('Add last_resort extension (0x000a) to mls_extensions');
        }
        if (item.type === 'err' && item.text.includes('missing mls_ciphersuite')) {
            prescriptions.push('Include the mls_ciphersuite tag in your KeyPackage events');
        }
        if (item.type === 'err' && item.text.includes('not in 0x0001-0x0007')) {
            prescriptions.push('Use a supported mls_ciphersuite (0x0001–0x0007) in KeyPackage events');
        }
        if (item.type === 'err' && item.text.includes('missing relays')) {
            prescriptions.push('Include the relays tag in your KeyPackage events');
        }
        if (item.type === 'err' && item.text.includes('relays[')) {
            prescriptions.push('Fix invalid relay URLs in KeyPackage relays tag — use valid wss:// or ws:// URLs');
        }
        if (item.type === 'err' && item.text.includes('no overlap with kind 10051')) {
            prescriptions.push('KeyPackage relays tag should include at least one relay from your kind 10051');
        }
        if (item.type === 'err' && (item.text.includes('missing content') || item.text.includes('content empty') || item.text.includes('content not valid base64'))) {
            prescriptions.push('KeyPackage content must be non-empty, valid base64-encoded KeyPackageBundle');
        }
        if (item.type === 'err' && item.text.includes('i tag:')) {
            prescriptions.push('Fix i tag — must be hex-encoded KeyPackageRef with length matching ciphersuite');
        }
        if (item.type === 'err' && item.text.includes('must not list default extensions')) {
            prescriptions.push('Remove default extensions (0x0001–0x0005) from mls_extensions — only custom extensions belong');
        }
        if (item.type === 'warn' && item.text.includes('kind 10051 content')) {
            prescriptions.push('Leave kind 10051 content empty');
        }
    }
    // Signing key rotation (MIP-00)
    if (best10051 && marmotRelays.length > 0) {
        prescriptions.push('MIP-00: Rotate MLS signing keys periodically within groups; ensure your client supports this');
    }
    // Deduplicate
    const uniqueRx = [...new Set(prescriptions)];

    // Build the diagnosis card HTML
    let cardHTML = `<div class="diagnosis-card">`;
    cardHTML += `<div class="diagnosis-header ${verdictClass}">`;
    cardHTML += `<span class="verdict-icon">${verdictIcon}</span>`;
    cardHTML += `<span>${verdictLabel}</span>`;
    cardHTML += `</div>`;
    cardHTML += `<div class="diagnosis-body">`;

    // Stats row
    cardHTML += `<div class="diagnosis-stats">`;
    cardHTML += `<div class="stat-box"><span class="stat-val dx-pass">${findings.pass.length}</span><span class="stat-label">PASSED</span></div>`;
    cardHTML += `<div class="stat-box"><span class="stat-val dx-warn">${findings.warn.length}</span><span class="stat-label">WARNINGS</span></div>`;
    cardHTML += `<div class="stat-box"><span class="stat-val dx-fail">${findings.fail.length}</span><span class="stat-label">ERRORS</span></div>`;
    cardHTML += `<div class="stat-box"><span class="stat-val dx-info">${totalRelays}</span><span class="stat-label">RELAYS</span></div>`;
    cardHTML += `</div>`;

    // Failures
    if (findings.fail.length > 0) {
        cardHTML += `<div><div class="diagnosis-section-label">Errors</div><div class="diagnosis-items">`;
        for (const f of findings.fail) {
            cardHTML += `<div class="dx-row"><span class="dx-icon dx-fail">✖</span><span class="dx-fail">${f}</span></div>`;
        }
        cardHTML += `</div></div>`;
    }

    // Warnings
    if (findings.warn.length > 0) {
        cardHTML += `<div><div class="diagnosis-section-label">Warnings</div><div class="diagnosis-items">`;
        for (const w of findings.warn) {
            cardHTML += `<div class="dx-row"><span class="dx-icon dx-warn">!</span><span class="dx-warn">${w}</span></div>`;
        }
        cardHTML += `</div></div>`;
    }

    // Passes
    if (findings.pass.length > 0) {
        cardHTML += `<div><div class="diagnosis-section-label">Passed</div><div class="diagnosis-items">`;
        for (const p of findings.pass) {
            cardHTML += `<div class="dx-row"><span class="dx-icon dx-pass">✔</span><span class="dx-pass">${p}</span></div>`;
        }
        cardHTML += `</div></div>`;
    }

    // Prescriptions
    if (uniqueRx.length > 0) {
        cardHTML += `<div class="diagnosis-summary">`;
        cardHTML += `<span class="rx-label">◈ PRESCRIPTION</span>`;
        for (const rx of uniqueRx) {
            cardHTML += `<div class="rx-item">${rx}</div>`;
        }
        cardHTML += `</div>`;
    }

    cardHTML += `</div></div>`; // close body + card

    // Append the card to the relay list panel
    const cardContainer = document.createElement('div');
    cardContainer.innerHTML = cardHTML;
    relayList.appendChild(cardContainer.firstElementChild);

    // Scroll the panel to the bottom so the diagnosis is visible
    relayList.scrollTop = relayList.scrollHeight;

    // Set sprite + flash based on result
    if (allOk) {
        setSprite('idle', 'success');
        flashScreen('ok');
        okBeep();
        setTimeout(() => okBeep(), 200);
        say("Diagnosis complete. <span class='ok'>Clean bill of health!</span> This profile is fully synced and Marmot-ready. No further action required.");
    } else if (!hasFailures) {
        setSprite('writing', 'bounce');
        flashScreen('ok');
        okBeep();
        say("Diagnosis complete. A few minor issues to address — nothing critical. See the prescription above.");
    } else {
        setSprite('blocked', 'error');
        flashScreen('err');
        errBeep();
        say("Diagnosis complete. <span class='err'>Issues detected.</span> Please review the full report and follow the prescription above.");
    }

    isAuditing = false;
    onAllDone = () => { auditBtn.disabled = false; };
}

// ══════════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════════

auditBtn.addEventListener('click', () => { getAudio(); startAudit(); });
npubInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { getAudio(); startAudit(); }
});

// Welcome message
setSprite('idle');
say("Hello! I am Doctor Marmot. Enter an npub below and I will conduct a thorough diagnostic — discovering relays from k3 / k10002 / k10051, checking sync across all of them, validating Marmot Protocol compliance, and examining vital signs. *adjusts stethoscope*");
