/**
 * Profile (kind 0) vitals — name, picture, NIP-05, lud16, http checks.
 */

import { verifyNip05 } from '../mip-validation.js';

/**
 * @param {Object|null} bestK0
 * @param {string} pubkey
 * @returns {Promise<{ vitalItems: Array<{type:string,text:string}>, vitalErr: number, vitalWarn: number, nip05Verified: boolean }>}
 */
export async function analyzeProfileVitals(bestK0, pubkey) {
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
            const lud16 = meta?.lud16?.trim() || '';
            const lud06 = meta?.lud06?.trim() || '';
            if (lud16) {
                const lud16Ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lud16);
                vitalItems.push({ type: lud16Ok ? 'ok' : 'warn', text: lud16Ok ? `Zap address (lud16): ${lud16}` : `Zap address: "${lud16}" — lud16 format invalid (expected user@domain.tld)` });
            } else if (lud06) {
                vitalItems.push({ type: 'ok', text: 'Zap: lud06 LNURL set' });
            } else {
                vitalItems.push({ type: 'warn', text: 'Zap: no lud16/lud06 — cannot receive Lightning zaps' });
            }
            const picture = meta?.picture?.trim() || '';
            const banner = meta?.banner?.trim() || '';
            if (picture.startsWith('http://')) {
                vitalItems.push({ type: 'warn', text: 'Profile picture uses http:// — blocked as mixed content in most web clients' });
            }
            if (banner.startsWith('http://')) {
                vitalItems.push({ type: 'warn', text: 'Profile banner uses http:// — blocked as mixed content in most web clients' });
            }
        } catch {
            vitalItems.push({ type: 'warn', text: 'Profile content not valid JSON' });
        }
    } else if (bestK0) {
        vitalItems.push({ type: 'warn', text: 'Profile (kind 0) found but content empty' });
    }

    const vitalWarn = vitalItems.filter(i => i.type === 'warn').length;
    const vitalErr = vitalItems.filter(i => i.type === 'err').length;
    const nip05Verified = vitalItems.some(i => i.text && i.text.includes('✓ verified'));

    return { vitalItems, vitalErr, vitalWarn, nip05Verified };
}
