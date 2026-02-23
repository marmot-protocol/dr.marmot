/**
 * Services (k10050, k10063, k10011) and deprecation (k4, k2) scan.
 */

function escapeHtml(s) {
    if (typeof s !== 'string') return '';
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * @param {Object|null} best10050
 * @param {Object|null} best10063
 * @param {Object|null} best10011
 * @param {Object|null} depK4
 * @param {Object|null} depK2
 * @param {number} nowSec
 * @param {Object} auditCtx - mutated
 * @returns {{ servicesItems: Array<{type:string,text:string}>, deprecationItems: Array<{type:string,text:string}> }}
 */
export function buildServicesAndDeprecation(best10050, best10063, best10011, depK4, depK2, nowSec, auditCtx) {
    const servicesItems = [];

    if (best10050) {
        const dmRelayTags = (Array.isArray(best10050.tags) ? best10050.tags : []).filter(t => Array.isArray(t) && t[0] === 'relay' && t[1]);
        servicesItems.push({ type: 'ok', text: `NIP-17 DM relay list (k10050): ${dmRelayTags.length} relay(s) configured` });
        auditCtx.legacyDmsConfigured = true;
    } else {
        servicesItems.push({ type: 'warn', text: 'No NIP-17 DM relay list (k10050) — contacts using NIP-17 DMs may not reach you' });
    }

    if (best10063) {
        const blossomServerTags = (Array.isArray(best10063.tags) ? best10063.tags : []).filter(t => Array.isArray(t) && t[0] === 'server' && t[1]);
        servicesItems.push({ type: 'ok', text: `Blossom server list (k10063): ${blossomServerTags.length} server(s) configured` });
        auditCtx.blossomConfigured = true;
    } else {
        servicesItems.push({ type: 'warn', text: 'No Blossom server list (k10063) — media uploads may fail in Blossom-native clients' });
    }

    if (best10011) {
        const identityTags = (Array.isArray(best10011.tags) ? best10011.tags : []).filter(t => Array.isArray(t) && t[0] === 'i' && t[1]);
        if (identityTags.length > 0) {
            for (const id of identityTags) {
                const [platform, handle] = (String(id[1] || '').split(':', 2));
                const safePlatform = escapeHtml(platform || '?');
                const safeHandle = escapeHtml(handle || '?');
                servicesItems.push({ type: 'ok', text: `External identity: ${safePlatform} — ${safeHandle}` });
            }
        } else {
            servicesItems.push({ type: 'warn', text: 'NIP-39 event (k10011) found but contains no i-tagged identities' });
        }
    } else {
        servicesItems.push({ type: 'info', text: 'No NIP-39 external identities (k10011) — optional, builds cross-platform trust' });
    }

    const deprecationItems = [];
    if (depK4) {
        const dK4 = Math.floor((nowSec - depK4.created_at) / 86400);
        deprecationItems.push({ type: 'warn', text: `NIP-04 DMs (kind 4) found — last seen ${dK4 === 0 ? 'today' : `${dK4} day(s) ago`}. NIP-04 is deprecated: leaks metadata. Upgrade to NIP-17 or Marmot` });
        auditCtx.hasDeprecatedK4 = true;
    } else {
        deprecationItems.push({ type: 'ok', text: 'No NIP-04 (kind 4) DMs found — good, NIP-04 is deprecated' });
    }
    if (depK2) {
        deprecationItems.push({ type: 'warn', text: 'Kind 2 (Recommend Relay) event found — deprecated; use kind 10002 (NIP-65) for relay recommendations' });
        auditCtx.hasDeprecatedK2 = true;
    } else {
        deprecationItems.push({ type: 'ok', text: 'No kind 2 (deprecated Relay Recommendation) events found' });
    }

    return { servicesItems, deprecationItems };
}
