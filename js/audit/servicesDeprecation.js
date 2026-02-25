/**
 * Services (k10050, k10063, k10011) and deprecation (k4, k2) scan.
 */

import { escapeHtml } from '../html.js';
import { validateRelayUrl } from '../relay-validation.js';

/**
 * @param {Object|null} best10050
 * @param {Object|null} best10063
 * @param {Object|null} best10011
 * @param {Object} auditCtx - mutated
 * @returns {Array<{type:string,text:string}>}
 */
export function buildServicesItems(best10050, best10063, best10011, auditCtx) {
    const servicesItems = [];

    if (best10050) {
        const dmRelayTags = (Array.isArray(best10050.tags) ? best10050.tags : [])
            .filter(t => Array.isArray(t) && t[0] === 'relay' && typeof t[1] === 'string'
                && validateRelayUrl(t[1]).valid);
        if (dmRelayTags.length > 0) {
            servicesItems.push({
                type: 'ok',
                text: `NIP-17 DM relay list (k10050): ${dmRelayTags.length} relay(s) configured`,
            });
            auditCtx.legacyDmsConfigured = true;
        } else {
            servicesItems.push({
                type: 'warn',
                text: 'NIP-17 DM relay list (k10050) found but contains no relay tags',
            });
        }
    } else {
        servicesItems.push({
            type: 'warn',
            text: 'No NIP-17 DM relay list (k10050) — contacts using NIP-17 DMs may not reach you',
        });
    }

    if (best10063) {
        const blossomServerTags = (Array.isArray(best10063.tags) ? best10063.tags : [])
            .filter(t => Array.isArray(t) && t[0] === 'server' && t[1]);
        if (blossomServerTags.length > 0) {
            servicesItems.push({
                type: 'ok',
                text: `Blossom server list (k10063): ${blossomServerTags.length} server(s) configured`,
            });
            auditCtx.blossomConfigured = true;
        } else {
            servicesItems.push({
                type: 'warn',
                text: 'Blossom server list (k10063) found but contains no server tags',
            });
        }
    } else {
        servicesItems.push({
            type: 'warn',
            text: 'No Blossom server list (k10063) — media uploads may fail in Blossom-native clients',
        });
    }

    if (best10011) {
        const identityTags = (Array.isArray(best10011.tags) ? best10011.tags : [])
            .filter(t => Array.isArray(t) && t[0] === 'i' && t[1]);
        if (identityTags.length > 0) {
            for (const id of identityTags) {
                const [platform, handle] = (String(id[1] || '').split(':', 2));
                servicesItems.push({
                    type: 'ok',
                    text: `External identity: ${escapeHtml(platform || '?')} — ${escapeHtml(handle || '?')}`,
                });
            }
        } else {
            servicesItems.push({
                type: 'warn',
                text: 'NIP-39 event (k10011) found but contains no i-tagged identities',
            });
        }
    } else {
        servicesItems.push({
            type: 'info',
            text: 'No NIP-39 external identities (k10011) — optional, builds cross-platform trust',
        });
    }

    return servicesItems;
}

/**
 * @param {Object|null} depK4
 * @param {Object|null} depK2
 * @param {number} nowSec
 * @param {Object} auditCtx - mutated
 * @returns {Array<{type:string,text:string}>}
 */
export function buildDeprecationItems(depK4, depK2, nowSec, auditCtx) {
    const deprecationItems = [];
    if (depK4) {
        const dK4 = Math.floor((nowSec - depK4.created_at) / 86400);
        const dK4When = dK4 === 0 ? 'today' : `${dK4} day(s) ago`;
        deprecationItems.push({
            type: 'warn',
            text: `NIP-04 DMs (kind 4) found — last seen ${dK4When}. NIP-04 is deprecated: leaks metadata. Upgrade to NIP-17 or Marmot`,
        });
        auditCtx.hasDeprecatedK4 = true;
    } else {
        deprecationItems.push({ type: 'ok', text: 'No NIP-04 (kind 4) DMs found — good, NIP-04 is deprecated' });
    }
    if (depK2) {
        deprecationItems.push({
            type: 'warn',
            text: 'Kind 2 (Recommend Relay) event found — deprecated; use kind 10002 (NIP-65) for relay recommendations',
        });
        auditCtx.hasDeprecatedK2 = true;
    } else {
        deprecationItems.push({ type: 'ok', text: 'No kind 2 (deprecated Relay Recommendation) events found' });
    }

    return deprecationItems;
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
    const servicesItems = buildServicesItems(best10050, best10063, best10011, auditCtx);
    const deprecationItems = buildDeprecationItems(depK4, depK2, nowSec, auditCtx);
    return { servicesItems, deprecationItems };
}
