import { SimplePool } from 'https://esm.sh/nostr-tools';
import { getAuditState } from './audit.js';
import { say } from './dialog.js';
import { speak } from './personalities.js';
import { setSprite } from './sprite.js';
import { setRelayState, appendResultSection } from './relay-panel.js';
import { okBeep, errBeep } from './audio.js';

export async function rebroadcastProfileAndContacts() {
    const state = getAuditState();
    if (!state) { await say(speak('noNip07ForAction') || 'No audit data available.'); return; }

    const { bestK0, bestK3, relaysToInvestigate } = state;
    if (!bestK0 && !bestK3) { await say('Nothing to rebroadcast — no profile or contacts found.'); return; }

    setSprite('working', 'bounce');
    await say(speak('rebroadcastStart'));

    const pool = new SimplePool();
    const events = [bestK0, bestK3].filter(Boolean);
    const results = [];
    let done = 0;

    for (const relay of relaysToInvestigate) {
        setRelayState(relay, 'connecting', 'SENDING');
        let relayOk = true;
        for (const ev of events) {
            try {
                await pool.publish([relay], ev);
            } catch {
                relayOk = false;
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

    const succeeded = results.filter(r => r.ok).length;
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
