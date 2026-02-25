/**
 * Profile (kind 0) vitals — name, picture, NIP-05, lud16, http checks.
 */

import { verifyNip05 } from '../mip-validation.js';

async function checkNip05(pubkey, nip05, vitalItems) {
    if (!nip05) {
        vitalItems.push({
            type: 'warn',
            text: 'NIP-05: not set (optional, improves identity verification)',
        });
        return false;
    }

    const isNip05FormatValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nip05);
    if (!isNip05FormatValid) {
        vitalItems.push({
            type: 'warn',
            text: `NIP-05: "${nip05}" — format invalid (expected user@domain.tld)`,
        });
        return false;
    }

    const verification = await verifyNip05(nip05, pubkey);
    const isNip05Verified = verification.verified;
    if (isNip05Verified) {
        vitalItems.push({
            type: 'ok',
            text: `NIP-05: ${nip05} ✓ verified`,
            verified: true,
        });
    } else {
        vitalItems.push({
            type: 'err',
            text: `NIP-05: ${nip05} — ${verification.reason}`,
            verified: false,
        });
    }
    return isNip05Verified;
}

function checkZapAddresses(lud16, lud06, vitalItems) {
    if (lud16) {
        const isLud16FormatValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lud16);
        vitalItems.push({
            type: isLud16FormatValid ? 'ok' : 'warn',
            text: isLud16FormatValid
                ? `Zap address (lud16): ${lud16}`
                : `Zap address: "${lud16}" — lud16 format invalid (expected user@domain.tld)`,
        });
        return;
    }
    if (lud06) {
        vitalItems.push({ type: 'ok', text: 'Zap: lud06 LNURL set' });
        return;
    }
    vitalItems.push({
        type: 'warn',
        text: 'Zap: no lud16/lud06 — cannot receive Lightning zaps',
    });
}

/**
 * @param {Object|null} bestK0
 * @param {string} pubkey
 * @returns {Promise<{ vitalItems: Array<{type:string,text:string}>, vitalErr: number, vitalWarn: number, nip05Verified: boolean }>}
 */
export async function analyzeProfileVitals(bestK0, pubkey) {
    const vitalItems = [];
    let isNip05Verified = false;

    if (bestK0?.content) {
        try {
            const meta = JSON.parse(bestK0.content);
            const hasName = !!meta?.name?.trim();
            const hasPicture = !!meta?.picture?.trim();
            const hasAbout = !!meta?.about?.trim();
            const nip05 = meta?.nip05?.trim() || '';
            const name = (meta.name || '');
            const about = (meta.about || '');
            const lud16 = meta?.lud16?.trim() || '';
            const lud06 = meta?.lud06?.trim() || '';
            const picture = meta?.picture?.trim() || '';
            const banner = meta?.banner?.trim() || '';

            vitalItems.push({
                type: hasName ? 'ok' : 'warn',
                text: hasName
                    ? `Name: "${name.slice(0, 40)}${name.length > 40 ? '…' : ''}"`
                    : 'Name: missing',
            });
            vitalItems.push({
                type: hasPicture ? 'ok' : 'warn',
                text: hasPicture ? 'Picture: set' : 'Picture: missing',
            });
            vitalItems.push({
                type: hasAbout ? 'ok' : 'warn',
                text: hasAbout ? `About: ${about.length} chars` : 'About: missing',
            });

            isNip05Verified = await checkNip05(pubkey, nip05, vitalItems);
            checkZapAddresses(lud16, lud06, vitalItems);
            if (picture.startsWith('http://')) {
                vitalItems.push({ type: 'warn', text: 'Profile picture uses http:// — blocked as mixed content in most web clients' });
            }
            if (banner.startsWith('http://')) {
                vitalItems.push({ type: 'warn', text: 'Profile banner uses http:// — blocked as mixed content in most web clients' });
            }
        } catch (err) {
            console.error('Failed to parse profile JSON', {
                pubkey,
                eventId: bestK0?.id,
                error: err,
            });
            vitalItems.push({ type: 'warn', text: 'Profile content not valid JSON' });
        }
    } else if (bestK0) {
        vitalItems.push({ type: 'warn', text: 'Profile (kind 0) found but content empty' });
    }

    const vitalWarn = vitalItems.filter(i => i.type === 'warn').length;
    const vitalErr = vitalItems.filter(i => i.type === 'err').length;

    return { vitalItems, vitalErr, vitalWarn, nip05Verified: isNip05Verified };
}
