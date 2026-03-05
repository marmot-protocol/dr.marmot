import { SimplePool } from 'https://esm.sh/nostr-tools';
import { getAuditState } from './audit.js';
import { say } from './dialog.js';
import { speak } from './personalities.js';
import { setSprite } from './sprite.js';
import { setRelayState, appendResultSection } from './relay-panel.js';
import { okBeep, errBeep } from './audio.js';
import { validateRelayUrl } from './relay-validation.js';
import { RELAY_TIMEOUT_MS } from './config.js';

const PUBLISH_TIMEOUT_MS = 15_000;

export async function rebroadcastProfileAndContacts() {
    const state = getAuditState();
    if (!state) { await say(speak('noAuditData') || 'No audit data available.'); return; }

    const { bestK0, bestK3, relaysToInvestigate } = state;
    if (!bestK0 && !bestK3) { await say('Nothing to rebroadcast — no profile or contacts found.'); return; }

    setSprite('working', 'bounce');
    await say(speak('rebroadcastStart'));

    const pool = new SimplePool();
    const events = [bestK0, bestK3].filter(Boolean);
    const results = [];
    let done = 0;

    const publishWithTimeout = (relay, ev) =>
        Promise.race([
            pool.publish([relay], ev),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), PUBLISH_TIMEOUT_MS),
            ),
        ]);

    for (const relay of relaysToInvestigate) {
        setRelayState(relay, 'connecting', 'SENDING');
        let relayOk = true;
        for (const ev of events) {
            if (!relayOk) break;
            try {
                await publishWithTimeout(relay, ev);
            } catch {
                relayOk = false;
                break;
            }
        }
        done++;
        setRelayState(relay, relayOk ? 'ok' : 'error', relayOk ? 'SENT' : 'FAIL');
        results.push({ relay, ok: relayOk });

        if (done % 2 === 0 || done === relaysToInvestigate.length) {
            await say(speak('rebroadcastProgress', { done, total: relaysToInvestigate.length }));
        }
    }

    pool.close(relaysToInvestigate);

    const succeeded = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    const items = results.map(r => ({
        type: r.ok ? 'ok' : 'err',
        text: `${r.relay.replace(/^wss?:\/\//, '').replace(/\/$/, '')} — ${r.ok ? 'sent' : 'failed'}`,
    }));
    appendResultSection('REBROADCAST RESULTS', items);

    if (failed === 0) {
        setSprite('success', 'success');
        okBeep();
        await say(speak('rebroadcastDone', { count: succeeded }));
    } else {
        setSprite('error', 'error');
        errBeep();
        await say(speak('rebroadcastFail', { succeeded, failed }));
    }
}

export async function deleteKeyPackages() {
    const state = getAuditState();
    if (!state) { await say('No audit data available.'); return; }

    const { missingITagIds, marmotRelays, pubkey } = state;
    if (missingITagIds.length === 0) { await say('No KeyPackages to delete.'); return; }
    if (!window.nostr) {
        await say(speak('noNip07ForAction') || 'This action requires a NIP-07 extension to sign events.');
        return;
    }

    setSprite('working', 'bounce');
    await say(speak('deleteKpStart', { count: missingITagIds.length }));
    await say(speak('deleteKpSign'));

    const deleteEvents = [];
    try {
        for (const kpId of missingITagIds) {
            const unsigned = {
                kind: 5,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['e', kpId]],
                content: '',
                pubkey,
            };
            const signed = await window.nostr.signEvent(unsigned);
            deleteEvents.push(signed);
        }
    } catch (e) {
        setSprite('error', 'error');
        errBeep();
        await say(speak('deleteKpFail') || `Signing failed: ${e?.message || 'extension declined'}`);
        return;
    }

    const pool = new SimplePool();
    const relays = marmotRelays.length > 0 ? marmotRelays : state.relaysToInvestigate;
    const results = [];

    for (const relay of relays) {
        setRelayState(relay, 'connecting', 'DELETING');
        let relayOk = true;
        for (const ev of deleteEvents) {
            try {
                await pool.publish([relay], ev);
            } catch {
                relayOk = false;
            }
        }
        setRelayState(relay, relayOk ? 'ok' : 'error', relayOk ? 'DELETED' : 'FAIL');
        results.push({ relay, ok: relayOk });
    }

    pool.close(relays);

    const failed = results.filter(r => !r.ok).length;
    const items = results.map(r => ({
        type: r.ok ? 'ok' : 'err',
        text: `${r.relay.replace(/^wss?:\/\//, '').replace(/\/$/, '')} — ${r.ok ? 'delete sent' : 'failed'}`,
    }));
    appendResultSection('KP DELETION RESULTS', items);

    if (failed === 0) {
        setSprite('success', 'success');
        okBeep();
        await say(speak('deleteKpDone', { count: deleteEvents.length }));
    } else {
        setSprite('error', 'error');
        errBeep();
        await say(speak('deleteKpFail') || `${failed} relay(s) failed to accept deletion events.`);
    }
}

function buildUnifiedRelays(state) {
    const { bestK3, bestK10002, pubkey } = state;
    const merged = new Set();
    if (Array.isArray(bestK3?.tags)) {
        for (const t of bestK3.tags) {
            if (Array.isArray(t) && typeof t[0] === 'string' && typeof t[1] === 'string' && t[1]
                && t[0] === 'relay' && validateRelayUrl(t[1].trim()).valid) {
                merged.add(t[1].trim());
            }
        }
    }
    if (Array.isArray(bestK10002?.tags)) {
        for (const t of bestK10002.tags) {
            if (Array.isArray(t) && typeof t[0] === 'string' && typeof t[1] === 'string' && t[1]
                && t[0] === 'r' && validateRelayUrl(t[1].trim()).valid) {
                merged.add(t[1].trim());
            }
        }
    }
    const mergedRelays = [...merged];
    const pTags = Array.isArray(bestK3?.tags)
        ? bestK3.tags.filter(t => Array.isArray(t) && typeof t[0] === 'string' && t[0] === 'p')
        : [];
    const unsignedK3 = {
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: [...pTags, ...mergedRelays.map(r => ['relay', r])],
        content: bestK3?.content || '',
        pubkey,
    };
    const unsignedK10002 = {
        kind: 10002,
        created_at: Math.floor(Date.now() / 1000) + 1,
        tags: mergedRelays.map(r => ['r', r]),
        content: '',
        pubkey,
    };
    return { mergedRelays, unsignedK3, unsignedK10002 };
}

async function signUnifiedEvents(unsignedK3, unsignedK10002) {
    await say(speak('deleteKpSign') || 'Requesting NIP-07 signatures…');
    try {
        const signedK3 = await window.nostr.signEvent(unsignedK3);
        const signedK10002 = await window.nostr.signEvent(unsignedK10002);
        return { signedK3, signedK10002 };
    } catch (e) {
        setSprite('error', 'error');
        errBeep();
        await say(speak('deleteKpFail') || `Signing failed: ${e?.message || 'extension declined'}`);
        return null;
    }
}

async function publishUnifiedEvents(relaysToInvestigate, events) {
    const pool = new SimplePool();
    const results = [];
    for (const relay of relaysToInvestigate) {
        setRelayState(relay, 'connecting', 'UNIFY');
        let isRelayOk = true;
        for (const ev of events) {
            try {
                await Promise.race([
                    pool.publish([relay], ev),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('timeout')), PUBLISH_TIMEOUT_MS),
                    ),
                ]);
            } catch (e) {
                console.error('Unify publish failed', { relay, kind: ev?.kind, id: ev?.id }, e);
                isRelayOk = false;
            }
        }
        setRelayState(relay, isRelayOk ? 'ok' : 'error', isRelayOk ? 'UNIFIED' : 'FAIL');
        results.push({ relay, ok: isRelayOk });
    }
    pool.close(relaysToInvestigate);
    return results;
}

async function reportUnifyResults(results, mergedRelays, relaysToInvestigate, fallbackMsg) {
    const succeeded = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    const items = results.map(r => ({
        type: r.ok ? 'ok' : 'err',
        text: `${r.relay.replace(/^wss?:\/\//, '').replace(/\/$/, '')} — ${r.ok ? 'unified' : 'failed'}`,
    }));
    appendResultSection('RELAY UNIFICATION RESULTS', items);

    if (failed === 0) {
        setSprite('success', 'success');
        okBeep();
        await say(
            speak('unifyRelaysDone', { count: succeeded, total: mergedRelays.length }) || fallbackMsg,
        );
    } else {
        setSprite('error', 'error');
        errBeep();
        await say(
            `${succeeded} of ${relaysToInvestigate.length} relay(s) unified; ${failed} failed.`,
        );
    }
}

/**
 * Merges relay lists from kind 3 (Contacts) and kind 10002 (NIP-65) into a unified set,
 * signs new events via NIP-07, and publishes them to all investigation relays.
 * @returns {Promise<void>} Resolves when done. Side effects: updates sprite, relay panel, audio, and dialog.
 */
export async function unifyRelayLists() {
    const state = getAuditState();
    if (!state) { await say('No audit data available.'); return; }

    const { bestK3, bestK10002, relaysToInvestigate } = state;
    if (!bestK3 && !bestK10002) { await say('No relay lists found to unify.'); return; }
    if (!window.nostr) {
        await say(speak('noNip07ForAction') || 'This action requires a NIP-07 extension to sign events.');
        return;
    }

    const fallbackMsg = 'Relay list unification completed.';

    setSprite('working', 'bounce');
    await say(speak('unifyRelaysStart') || fallbackMsg);

    const { mergedRelays, unsignedK3, unsignedK10002 } = buildUnifiedRelays(state);
    if (mergedRelays.length === 0) {
        setSprite('error', 'error');
        errBeep();
        await say('No valid relays found to unify. Check your k3/k10002 relay tags.');
        return;
    }

    const signed = await signUnifiedEvents(unsignedK3, unsignedK10002);
    if (!signed) return;

    const { signedK3, signedK10002 } = signed;
    const events = [signedK3, signedK10002];
    const results = await publishUnifiedEvents(relaysToInvestigate, events);
    await reportUnifyResults(results, mergedRelays, relaysToInvestigate, fallbackMsg);
}

/**
 * Delete orphaned KeyPackages — signs kind 5 deletion events for KPs found on relays
 * not in the user's kind 10051 list, and publishes them to those relays.
 */
export async function deleteOrphanedKeyPackages() {
    const state = getAuditState();
    if (!state) { await say('No audit data available.'); return; }

    const { orphanedKpRelays, relaysToInvestigate, pubkey } = state;
    if (!orphanedKpRelays || orphanedKpRelays.length === 0) {
        await say('No orphaned KeyPackages to delete.');
        return;
    }
    if (!window.nostr) {
        await say(speak('noNip07ForAction') || 'This action requires a NIP-07 extension.');
        return;
    }

    // Collect KP event IDs found on orphaned relays
    // We need to query those relays for kind 443 events to get their IDs
    setSprite('working', 'bounce');
    await say(speak('deleteKpStart', { count: orphanedKpRelays.length })
        || `Deleting orphaned KeyPackages from ${orphanedKpRelays.length} relay(s)...`);

    // Find KP IDs that exist on orphaned relays — check kpEventsCollected
    const orphanedKpIds = [];
    const pool = new SimplePool();

    // Query orphaned relays for kind 443 events
    for (const relay of orphanedKpRelays) {
        try {
            const events = await new Promise((resolve) => {
                const collected = [];
                let done = false;
                const sub = pool.subscribeMany([relay], { authors: [pubkey], kinds: [443] }, {
                    onevent(ev) { collected.push(ev); },
                    oneose() {
                        if (done) return;
                        done = true;
                        try { sub.close(); } catch { /* ignore */ }
                        resolve(collected);
                    },
                });
                setTimeout(() => {
                    if (done) return;
                    done = true;
                    try { sub.close(); } catch { /* ignore */ }
                    resolve(collected);
                }, RELAY_TIMEOUT_MS);
            });
            for (const ev of events) {
                if (ev.id && !orphanedKpIds.includes(ev.id)) orphanedKpIds.push(ev.id);
            }
        } catch (e) {
            console.error('Failed to query orphaned relay for KPs', relay, e);
        }
    }

    if (orphanedKpIds.length === 0) {
        pool.close(orphanedKpRelays);
        setSprite('idle');
        await say('No KeyPackage events found on orphaned relays — they may have already been cleaned up.');
        return;
    }

    await say(speak('deleteKpSign'));

    // Sign deletion events
    const deleteEvents = [];
    try {
        for (const kpId of orphanedKpIds) {
            const unsigned = {
                kind: 5,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['e', kpId]],
                content: '',
                pubkey,
            };
            const signed = await window.nostr.signEvent(unsigned);
            deleteEvents.push(signed);
        }
    } catch (e) {
        pool.close(orphanedKpRelays);
        setSprite('error', 'error');
        errBeep();
        await say(speak('deleteKpFail') || `Signing failed: ${e?.message || 'extension declined'}`);
        return;
    }

    // Publish to orphaned relays + investigation relays
    const publishTargets = [...new Set([...orphanedKpRelays, ...relaysToInvestigate])];
    const results = [];
    for (const relay of publishTargets) {
        setRelayState(relay, 'connecting', 'DELETING');
        let relayOk = true;
        for (const ev of deleteEvents) {
            try {
                await Promise.race([
                    pool.publish([relay], ev),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('timeout')), PUBLISH_TIMEOUT_MS),
                    ),
                ]);
            } catch {
                relayOk = false;
            }
        }
        setRelayState(relay, relayOk ? 'ok' : 'error', relayOk ? 'DELETED' : 'FAIL');
        results.push({ relay, ok: relayOk });
    }

    pool.close(publishTargets);

    const succeeded = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    const items = results.map(r => ({
        type: r.ok ? 'ok' : 'err',
        text: `${r.relay.replace(/^wss?:\/\//, '').replace(/\/$/, '')} — ${r.ok ? 'delete sent' : 'failed'}`,
    }));
    appendResultSection('ORPHANED KP DELETION RESULTS', items);

    if (failed === 0) {
        setSprite('success', 'success');
        okBeep();
        await say(speak('deleteKpDone', { count: deleteEvents.length }));
    } else {
        setSprite('error', 'error');
        errBeep();
        await say(`${succeeded} relay(s) accepted deletions, ${failed} failed.`);
    }
}

/**
 * Delete all kind 4 (NIP-04 DM) events by signing kind 5 deletion events.
 * Queries all investigation relays for kind 4 events, then publishes deletions.
 */
export async function deleteDeprecatedKind4() {
    const state = getAuditState();
    if (!state) { await say('No audit data available.'); return; }

    const { relaysToInvestigate, pubkey } = state;
    if (!window.nostr) {
        await say(speak('noNip07ForAction') || 'This action requires a NIP-07 extension.');
        return;
    }

    setSprite('working', 'bounce');
    await say('Scanning for NIP-04 (kind 4) events to delete...');

    // Query all relays for kind 4 events
    const pool = new SimplePool();
    const kind4Ids = new Set();

    const PAGE_SIZE = 500;
    for (const relay of relaysToInvestigate) {
        setRelayState(relay, 'connecting', 'SCANNING');
        try {
            let totalFound = 0;
            let until = Math.floor(Date.now() / 1000) + 60;
            let pageCount = 0;
            const MAX_PAGES = 20; // Safety cap: 10,000 events max

            // Paginate using `until` cursor
            while (true) {
                if (pageCount >= MAX_PAGES) break;
                const page = await new Promise((resolve) => {
                    const collected = [];
                    let done = false;
                    const sub = pool.subscribeMany(
                        [relay],
                        { authors: [pubkey], kinds: [4], limit: PAGE_SIZE, until },
                        {
                            onevent(ev) { collected.push(ev); },
                            oneose() {
                                if (done) return;
                                done = true;
                                try { sub.close(); } catch { /* ignore */ }
                                resolve(collected);
                            },
                        },
                    );
                    setTimeout(() => {
                        if (done) return;
                        done = true;
                        try { sub.close(); } catch { /* ignore */ }
                        resolve(collected);
                    }, RELAY_TIMEOUT_MS);
                });

                for (const ev of page) {
                    if (ev.id) kind4Ids.add(ev.id);
                }
                totalFound += page.length;
                pageCount++;

                // If page returned fewer than PAGE_SIZE, we have all events
                if (page.length < PAGE_SIZE) break;

                // Set cursor to oldest event in this page for next iteration
                const oldest = page.reduce((min, ev) =>
                    ev.created_at < min ? ev.created_at : min, page[0].created_at);
                until = oldest - 1;
            }

            const cappedNote = pageCount >= MAX_PAGES ? ' (capped)' : '';
            setRelayState(relay, 'ok', totalFound + ' k4' + cappedNote);
        } catch (e) {
            console.error('Failed to query relay for kind 4', relay, e);
            setRelayState(relay, 'error', 'FAIL');
        }
    }

    if (kind4Ids.size === 0) {
        pool.close(relaysToInvestigate);
        setSprite('idle');
        await say('No kind 4 (NIP-04 DM) events found — nothing to delete.');
        return;
    }

    await say(`Found <span class="hi">${kind4Ids.size}</span> kind 4 event(s). Requesting NIP-07 signatures for deletion...`);

    // Sign deletion events
    const deleteEvents = [];
    try {
        // Batch into a single kind 5 with multiple e tags for efficiency
        const unsigned = {
            kind: 5,
            created_at: Math.floor(Date.now() / 1000),
            tags: [...kind4Ids].map(id => ['e', id]),
            content: 'NIP-04 DM cleanup — migrating to NIP-17/Marmot',
            pubkey,
        };
        const signed = await window.nostr.signEvent(unsigned);
        deleteEvents.push(signed);
    } catch (e) {
        pool.close(relaysToInvestigate);
        setSprite('error', 'error');
        errBeep();
        await say(`<span class="err">Signing failed</span> — ${e?.message || 'extension declined'}.`);
        return;
    }

    // Publish to all relays
    const results = [];
    for (const relay of relaysToInvestigate) {
        setRelayState(relay, 'connecting', 'DELETING');
        let relayOk = true;
        for (const ev of deleteEvents) {
            try {
                await Promise.race([
                    pool.publish([relay], ev),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('timeout')), PUBLISH_TIMEOUT_MS),
                    ),
                ]);
            } catch {
                relayOk = false;
            }
        }
        setRelayState(relay, relayOk ? 'ok' : 'error', relayOk ? 'DELETED' : 'FAIL');
        results.push({ relay, ok: relayOk });
    }

    pool.close(relaysToInvestigate);

    const succeeded = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    const items = results.map(r => ({
        type: r.ok ? 'ok' : 'err',
        text: `${r.relay.replace(/^wss?:\/\//, '').replace(/\/$/, '')} — ${r.ok ? 'delete sent' : 'failed'}`,
    }));
    appendResultSection('NIP-04 DELETION RESULTS', items);

    if (failed === 0) {
        setSprite('success', 'success');
        okBeep();
        await say(`<span class="ok">Done.</span> ${kind4Ids.size} kind 4 event(s) deleted across ${succeeded} relay(s). Welcome to the future of encrypted messaging.`);
    } else {
        setSprite('error', 'error');
        errBeep();
        await say(`${succeeded} relay(s) accepted deletions, <span class="err">${failed} failed</span>.`);
    }
}
