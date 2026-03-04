/**
 * Generate copy-paste nak (nostr army knife) commands for each fixable prescription.
 * These let users without NIP-07 fix their relay setup from the terminal.
 *
 * nak CLI reference: https://github.com/fiatjaf/nak
 *   nak event -k <kind> --sec <key> --tag <tag> <relay...>  — create+publish
 *   nak req -k <kind> -a <pubkey> <relay...> | nak event <relay...>  — rebroadcast
 */

import { escapeHtml } from './html.js';

/**
 * Generate a nak command string for a given prescription action.
 *
 * @param {string} action - One of: rebroadcast, delete-kps, delete-orphaned-kps, unify-relays, delete-kind4
 * @param {Object} state - The audit state from getAuditState()
 * @returns {{ cmd: string, description: string }|null} The nak command and a human-readable description, or null if not applicable
 */
export function getNakCommand(action, state) {
    if (!state) return null;

    const { pubkey, relaysToInvestigate } = state;
    if (!pubkey) return null;

    const relayArgs = (relaysToInvestigate || []).join(' ');
    const sourceRelay = relaysToInvestigate?.[0] || 'wss://relay.damus.io';

    switch (action) {
    case 'rebroadcast':
        return buildRebroadcastCmd(pubkey, sourceRelay, relayArgs);
    case 'delete-kps':
        return buildDeleteKpsCmd(state, relayArgs);
    case 'delete-orphaned-kps':
        return buildDeleteOrphanedKpsCmd(state, relayArgs);
    case 'unify-relays':
        return buildUnifyCmd(state, relayArgs);
    case 'delete-kind4':
        return buildDeleteKind4Cmd(pubkey, relayArgs);
    default:
        return null;
    }
}

function buildRebroadcastCmd(pubkey, sourceRelay, relayArgs) {
    const cmd = `# Rebroadcast profile (k0) and contacts (k3) to all relays\n`
        + `nak req -k 0 -k 3 -a ${pubkey} ${sourceRelay} | \\\n`
        + `  nak event ${relayArgs}`;

    return {
        cmd,
        description: 'Fetches your latest kind 0 + kind 3 from the first relay and republishes them to all your relays.',
    };
}

function buildDeleteKpsCmd(state, relayArgs) {
    const { missingITagIds } = state;
    if (!missingITagIds || missingITagIds.length === 0) return null;

    const eTags = missingITagIds.map(id => '-e ' + id).join(' \\\n  ');
    const cmd = '# Delete orphaned/invalid KeyPackages (kind 5 deletion)\n'
        + 'nak event -k 5 --sec $NOSTR_SECRET_KEY \\\n'
        + '  ' + eTags + ' \\\n'
        + "  -c 'KeyPackage cleanup' \\\n"
        + '  ' + relayArgs;

    return {
        cmd,
        description: 'Signs kind 5 deletion events for ' + missingITagIds.length + ' KeyPackage(s) and publishes to all relays. Set NOSTR_SECRET_KEY first.',
    };
}

function buildDeleteOrphanedKpsCmd(state, relayArgs) {
    const { orphanedKpRelays } = state;
    if (!orphanedKpRelays || orphanedKpRelays.length === 0) return null;

    const orphanRelayArgs = orphanedKpRelays.join(' ');
    const pk = state.pubkey;
    const cmd = '# Step 1: Find KeyPackage IDs on orphaned relays\n'
        + 'nak req -k 443 -a ' + pk + ' ' + orphanRelayArgs + '\n\n'
        + '# Step 2: Delete them (replace <event-id> with IDs from step 1)\n'
        + 'nak event -k 5 --sec $NOSTR_SECRET_KEY \\\n'
        + '  -e <event-id> \\\n'
        + "  -c 'Orphaned KP cleanup' \\\n"
        + '  ' + orphanRelayArgs + ' ' + relayArgs;

    return {
        cmd,
        description: 'Queries ' + orphanedKpRelays.length + ' orphaned relay(s) for kind 443 events, then deletes them. Two-step: find IDs first, then delete.',
    };
}

function buildUnifyCmd(state, relayArgs) {
    const { k3RelaySet, k10002RelaySet, bestK3 } = state;
    if (!k3RelaySet && !k10002RelaySet) return null;

    // Merge both sets
    const merged = [...new Set([...(k3RelaySet || []), ...(k10002RelaySet || [])])];
    if (merged.length === 0) return null;

    // Build k10002 r-tags
    const rTags = merged.map(r => '--tag r=' + r).join(' \\\n  ');

    // Build k3 relay tags + preserve p-tags
    const relayTags = merged.map(r => '--tag relay=' + r).join(' \\\n  ');
    const pTags = (bestK3?.tags || [])
        .filter(t => Array.isArray(t) && t[0] === 'p' && t[1])
        .map(t => '-p ' + t[1])
        .join(' \\\n  ');

    const cmd = '# Publish unified kind 10002 (NIP-65 relay list)\n'
        + 'nak event -k 10002 --sec $NOSTR_SECRET_KEY \\\n'
        + '  ' + rTags + ' \\\n'
        + "  -c '' \\\n"
        + '  ' + relayArgs + '\n\n'
        + '# Publish unified kind 3 (contacts)\n'
        + 'nak event -k 3 --sec $NOSTR_SECRET_KEY \\\n'
        + (pTags ? '  ' + pTags + ' \\\n  ' : '  ')
        + relayTags + ' \\\n'
        + "  -c '" + escapeShellContent(bestK3?.content || '') + "' \\\n"
        + '  ' + relayArgs;

    return {
        cmd,
        description: 'Publishes a new kind 10002 and kind 3 with ' + merged.length + ' unified relay(s). Both events will advertise the same set.',
    };
}

function buildDeleteKind4Cmd(pubkey, relayArgs) {
    const cmd = '# Step 1: Find all kind 4 (NIP-04 DM) event IDs\n'
        + 'nak req -k 4 -a ' + pubkey + ' ' + relayArgs + '\n\n'
        + '# Step 2: Delete them (pipe IDs or list them manually)\n'
        + 'nak req -k 4 -a ' + pubkey + ' ' + relayArgs + ' | \\\n'
        + "  jq -r '.id' | \\\n"
        + '  xargs -I {} nak event -k 5 --sec $NOSTR_SECRET_KEY \\\n'
        + '    -e {} \\\n'
        + "    -c 'NIP-04 DM cleanup — migrating to NIP-17/Marmot' \\\n"
        + '    ' + relayArgs;

    return {
        cmd,
        description: 'Scans for kind 4 events and publishes kind 5 deletions for each. Requires jq and xargs.',
    };
}

function escapeShellContent(str) {
    // Escape single quotes for shell: replace ' with '\''
    return str.replace(/'/g, "'\\''");
}

/**
 * Render a nak command block as HTML with a copy button.
 * @param {{ cmd: string, description: string }} nakCmd
 * @returns {string} HTML string
 */
export function renderNakCommandBlock(nakCmd) {
    if (!nakCmd) return '';

    return `<div class="nak-cmd-block">`
        + `<div class="nak-cmd-header">`
        + `<span class="nak-cmd-label">🔧 nak command</span>`
        + `<button class="nak-copy-btn" data-action="copy-nak" title="Copy to clipboard">COPY</button>`
        + `</div>`
        + `<div class="nak-cmd-desc">${escapeHtml(nakCmd.description)}</div>`
        + `<pre class="nak-cmd-pre"><code>${escapeHtml(nakCmd.cmd)}</code></pre>`
        + `</div>`;
}
