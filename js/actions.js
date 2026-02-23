import { SimplePool } from 'https://esm.sh/nostr-tools';
import { getAuditState } from './audit.js';
import { say } from './dialog.js';
import { speak } from './personalities.js';
import { setSprite } from './sprite.js';
import { setRelayState, appendResultSection } from './relay-panel.js';
import { okBeep, errBeep } from './audio.js';
import { validateRelayUrl } from './relay-validation.js';

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

export async function unifyRelayLists() {
    const state = getAuditState();
    if (!state) { await say('No audit data available.'); return; }

    const { bestK3, bestK10002, relaysToInvestigate, pubkey } = state;
    if (!bestK3 && !bestK10002) { await say('No relay lists found to unify.'); return; }
    if (!window.nostr) {
        await say(speak('noNip07ForAction') || 'This action requires a NIP-07 extension to sign events.');
        return;
    }

    setSprite('working', 'bounce');
    await say(speak('unifyRelaysStart') || 'Merging your k3 and k10002 relay lists…');

    // Build unified relay set from both lists
    const merged = new Set();
    if (bestK3?.tags) {
        for (const t of bestK3.tags) {
            if (t[0] === 'relay' && t[1] && validateRelayUrl(t[1].trim()).valid) merged.add(t[1].trim());
        }
    }
    if (bestK10002?.tags) {
        for (const t of bestK10002.tags) {
            if (t[0] === 'r' && t[1] && validateRelayUrl(t[1].trim()).valid) merged.add(t[1].trim());
        }
    }
    const mergedRelays = [...merged];

    const pTags = bestK3?.tags?.filter(t => t[0] === 'p') ?? [];
    const unsigned_k3 = {
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: [...pTags, ...mergedRelays.map(r => ['relay', r])],
        content: bestK3?.content || '',
        pubkey,
    };
    const unsigned_k10002 = {
        kind: 10002,
        created_at: Math.floor(Date.now() / 1000) + 1,
        tags: mergedRelays.map(r => ['r', r]),
        content: '',
        pubkey,
    };

    let signed_k3, signed_k10002;
    try {
        await say(speak('deleteKpSign') || 'Requesting NIP-07 signatures…');
        signed_k3 = await window.nostr.signEvent(unsigned_k3);
        signed_k10002 = await window.nostr.signEvent(unsigned_k10002);
    } catch (e) {
        setSprite('error', 'error');
        errBeep();
        await say(speak('deleteKpFail') || `Signing failed: ${e?.message || 'extension declined'}`);
        return;
    }

    const pool = new SimplePool();
    const results = [];
    const events = [signed_k3, signed_k10002];

    for (const relay of relaysToInvestigate) {
        setRelayState(relay, 'connecting', 'UNIFY');
        let relayOk = true;
        for (const ev of events) {
            try {
                await Promise.race([
                    pool.publish([relay], ev),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PUBLISH_TIMEOUT_MS)),
                ]);
            } catch {
                relayOk = false;
            }
        }
        setRelayState(relay, relayOk ? 'ok' : 'error', relayOk ? 'UNIFIED' : 'FAIL');
        results.push({ relay, ok: relayOk });
    }

    pool.close(relaysToInvestigate);

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
        await say(speak('unifyRelaysDone', { count: succeeded, total: mergedRelays.length }) || `<span class='ok'>Unified!</span> ${succeeded} relay(s) updated. k3 and k10002 now share ${mergedRelays.length} relay(s).`);
    } else {
        setSprite('error', 'error');
        errBeep();
        await say(`${succeeded} relay(s) unified, ${failed} failed. Check those relays and retry.`);
    }
}
