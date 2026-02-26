/**
 * Findings compilation, prescriptions, verdict, and closing-message helpers.
 */

const FAILURE_CATEGORIES = {
    'relay-config': ['Invalid relay', 'invalid relay', 'kind 10051 relay', 'relay URLs'],
    'sync': ['sync', 'outdated', 'missing', 'stale', 'Profile (kind 0)', 'Contacts (kind 3)', 'not found'],
    'marmot-foundation': [
        'kind 10051', 'kind 10050', 'No KeyPackage Relay', 'No Inbox Relay',
        'no relay tags', 'KeyPackage relay', 'Inbox relay', 'giftwrap',
    ],
    'keypackage': ['KeyPackage', 'KP ', 'kind 443', 'encoding', '0xf2ee', '0x000a', 'mls_', 'relays tag'],
};

/**
 * @param {string[]} failures - Array of failure message strings
 * @returns {string[]} Deduplicated list of category keys (e.g. 'relay-config', 'sync', 'marmot-foundation', 'keypackage')
 */
export function categorizeFailures(failures) {
    const cats = new Set();
    for (const f of failures) {
        const t = (f || '').toLowerCase();
        let added = false;
        for (const [cat, keywords] of Object.entries(FAILURE_CATEGORIES)) {
            if (keywords.some(k => t.includes(k.toLowerCase()))) {
                cats.add(cat);
                added = true;
                break;
            }
        }
        if (!added) cats.add('keypackage');
    }
    return [...cats];
}

/**
 * @param {string} text - Prescription message text
 * @returns {number} Sort priority (lower = higher priority)
 */
export function prescriptionPriority(text) {
    const t = (text || '').toLowerCase();
    if (t.includes('invalid relay') && t.includes('k3 / k10002')) return 1;
    if (t.includes('rebroadcast') || (t.includes('profile') && t.includes('contacts'))) return 2;
    if (t.includes('kind 10050') && (t.includes('publish') || t.includes('add relay') || t.includes('invalid relay'))) return 3;
    if (t.includes('kind 10051') && (t.includes('publish') || t.includes('add relay') || t.includes('invalid relay'))) return 3;
    if (t.includes('delete events') || t.includes('keypackage') || t.includes('encoding') || t.includes('0xf2ee') || t.includes('0x000a') || t.includes('mls_') || t.includes('relays tag')) return 4;
    return 5;
}

/**
 * @param {{ invalidRelayCount: number, has10051: boolean, kpCount: number, marmotRelayCount: number, hasCrossedWires: boolean }} ctx
 * @returns {string|null} A root-cause hint sentence, or null if none applies
 */
export function getRootCauseHint(ctx) {
    if (ctx.invalidRelayCount > 0) return 'Invalid URLs break relay discovery — fix those before anything else.';
    if (!ctx.has10050) return "Without kind 10050, giftwrap delivery fails — publish that alongside 10051.";
    if (!ctx.has10051 && (ctx.kpCount === 0 || ctx.marmotRelayCount === 0)) return "Without kind 10051, KeyPackages can't be advertised — publish that first.";
    if (ctx.hasCrossedWires && (ctx.has10051 || ctx.marmotRelayCount > 0)) return 'Sync issues can delay KeyPackage discovery; fix sync first.';
    return null;
}

/**
 * @param {{ invalidRelayCount: number, has10051: boolean, kpCount: number, marmotRelayCount: number, hasCrossedWires: boolean }} ctx
 * @param {string[]} failures - Array of failure message strings
 * @param {string[]} categories - Output of categorizeFailures(failures)
 * @returns {string} A closing message sentence for the diagnosis
 */
export function pickClosingMessage(ctx, failures, categories) {
    if (categories.includes('relay-config') && !categories.includes('sync') && !categories.includes('marmot-foundation') && !categories.includes('keypackage')) {
        return 'Invalid relay URLs in your metadata. Fix those first; other checks depend on valid relays. See prescription.';
    }
    if (categories.includes('sync') && !categories.includes('relay-config') && !categories.includes('marmot-foundation') && !categories.includes('keypackage')) {
        return "Profile and contacts out of sync across relays. Rebroadcast to all relays — that's the main fix.";
    }
    const marmotOnly = categories.includes('marmot-foundation') && !categories.includes('relay-config') && !categories.includes('sync');
    const kpOnly = categories.includes('keypackage') && !categories.includes('relay-config') && !categories.includes('sync') && !categories.includes('marmot-foundation');
    if (marmotOnly && !kpOnly) {
        const missing10050 = failures.some(f => f.toLowerCase().includes('kind 10050'));
        const missing10051 = failures.some(f => f.toLowerCase().includes('kind 10051'));
        if (missing10050 && missing10051) {
            return 'Marmot messaging unavailable. Publish kind 10050 and 10051 first. See prescription.';
        }
        if (missing10050) {
            return 'Giftwrap delivery impossible without kind 10050. Publish an Inbox Relay List. See prescription.';
        }
        return 'Marmot messaging unavailable. Publish kind 10051 first, then KeyPackages. See prescription.';
    }
    if (kpOnly) {
        return 'KeyPackages failed MIP-00/01. Fix encoding and mls_extensions per prescription.';
    }
    if (categories.length >= 2) {
        return '<em>Start with</em> relay/sync fixes so KeyPackages propagate; then address Marmot setup. See prescription.';
    }
    const topFail = failures[0] || '';
    return topFail.length > 70 ? topFail.slice(0, 67) + '…' : topFail;
}

/**
 * @param {string[]} relaysToInvestigate
 * @param {Record<string, any>} relayData
 * @param {number} maxK0 - Timestamp of the newest kind 0 event across all relays
 * @param {number} maxK3 - Timestamp of the newest kind 3 event across all relays
 * @returns {{ syncedRelays: number, staleRelays: number, missingRelays: number, totalRelays: number }}
 */
export function tallyRelaySync(relaysToInvestigate, relayData, maxK0, maxK3) {
    let syncedRelays = 0;
    let staleRelays = 0;
    let missingRelays = 0;
    const totalRelays = relaysToInvestigate.length;

    for (const relay of relaysToInvestigate) {
        const data = relayData[relay];
        const k0ok = data?.[0] && data[0].created_at === maxK0;
        const k3ok = data?.[3] && data[3].created_at === maxK3;
        if (k0ok && k3ok) {
            syncedRelays++;
        } else if (!data?.[0] || !data?.[3]) {
            missingRelays++;
        } else {
            staleRelays++;
        }
    }

    return { syncedRelays, staleRelays, missingRelays, totalRelays };
}

/**
 * @param {{ fail: any[], warn: any[], pass: any[] }} findings
 * @returns {{ verdictClass: string, verdictIcon: string, verdictLabel: string, hasFailures: boolean, hasWarnings: boolean, allOk: boolean }}
 */
export function determineVerdict(findings) {
    const hasFailures = findings.fail.length > 0;
    const hasWarnings = findings.warn.length > 0;
    const allOk = !hasFailures && !hasWarnings;

    if (allOk) {
        return {
            verdictClass: 'verdict-pass',
            verdictIcon: '✔',
            verdictLabel: 'CLEAN BILL OF HEALTH',
            hasFailures,
            hasWarnings,
            allOk,
        };
    }
    if (!hasFailures && hasWarnings) {
        return {
            verdictClass: 'verdict-warn',
            verdictIcon: '!',
            verdictLabel: 'MINOR ISSUES DETECTED',
            hasFailures,
            hasWarnings,
            allOk,
        };
    }
    return {
        verdictClass: 'verdict-fail',
        verdictIcon: '✖',
        verdictLabel: 'ISSUES FOUND',
        hasFailures,
        hasWarnings,
        allOk,
    };
}

export function generateFindings(params, auditCtx) {
    const {
        invalidUserRelays,
        invalidMarmot,
        maxK0,
        maxK3,
        totalRelays,
        relaysToInvestigate,
        relayData,
        best10051,
        marmotRelays,
        mipItems,
        inboxRelays,
        inboxItems,
        orphanedKpRelays,
    } = params;

    const findings = { pass: [], warn: [], fail: [] };

    if (invalidUserRelays.length > 0) {
        for (const { url, reason } of invalidUserRelays) {
            findings.fail.push(`Invalid relay URL: ${url} — ${reason}`);
        }
    }
    for (const { url, reason } of invalidMarmot) {
        findings.fail.push(`Invalid KeyPackage relay: ${url} — ${reason}`);
    }

    if (maxK0 === 0) {
        findings.fail.push('Profile (kind 0) not found on any relay');
    } else {
        let k0stale = 0;
        let k0miss = 0;
        for (const relay of relaysToInvestigate) {
            const event = relayData[relay]?.[0];
            if (!event) k0miss++;
            else if (event.created_at < maxK0) k0stale++;
        }
        if (k0stale === 0 && k0miss === 0) {
            findings.pass.push(`Profile (kind 0) in sync across all ${totalRelays} relay(s)`);
        } else {
            if (k0stale > 0) findings.warn.push(`Profile (kind 0) outdated on ${k0stale} relay(s)`);
            if (k0miss > 0) findings.warn.push(`Profile (kind 0) missing from ${k0miss} relay(s)`);
        }
    }

    if (maxK3 === 0) {
        findings.fail.push('Contacts list (kind 3) not found on any relay');
    } else {
        let k3stale = 0;
        let k3miss = 0;
        for (const relay of relaysToInvestigate) {
            const event = relayData[relay]?.[3];
            if (!event) k3miss++;
            else if (event.created_at < maxK3) k3stale++;
        }
        if (k3stale === 0 && k3miss === 0) {
            findings.pass.push(`Contacts (kind 3) in sync across all ${totalRelays} relay(s)`);
        } else {
            if (k3stale > 0) findings.warn.push(`Contacts (kind 3) outdated on ${k3stale} relay(s)`);
            if (k3miss > 0) findings.warn.push(`Contacts (kind 3) missing from ${k3miss} relay(s)`);
        }
    }

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

    // Inbox relay (k10050) findings
    if (!auditCtx.has10050) {
        findings.fail.push('No Inbox Relay List (kind 10050) — giftwrap delivery will fail');
    } else {
        findings.pass.push('Inbox Relay List (kind 10050) published');
        if (inboxRelays && inboxRelays.length > 0) {
            findings.pass.push(`${inboxRelays.length} Inbox relay(s) advertised`);
        } else if (inboxRelays && inboxRelays.length === 0) {
            findings.fail.push('kind 10050 contains no valid relay tags');
        }
    }

    // Forward individual invalid inbox relay errors to findings
    if (inboxItems) {
        for (const item of inboxItems) {
            if (item.type === 'err' && item.text.includes('Invalid Inbox relay')) {
                findings.fail.push(item.text);
            }
        }
    }

    // Orphaned KeyPackages
    if (orphanedKpRelays && orphanedKpRelays.length > 0) {
        findings.warn.push(
            `KeyPackage(s) found on ${orphanedKpRelays.length} relay(s) outside kind 10051 — stranded and undiscoverable`,
        );
    }

    // WhiteNoise login gate
    const hasUsable10002 = relaysToInvestigate.some(r =>
        (relayData[r]?.[10002]?.tags || []).some(t =>
            t[0] === 'r' && typeof t[1] === 'string' && t[1].trim() !== ''));
    const hasUsable10050 = inboxRelays ? inboxRelays.length > 0 : false;
    const hasUsable10051 = marmotRelays.length > 0;
    if (hasUsable10002 && hasUsable10050 && hasUsable10051) {
        findings.pass.push('WhiteNoise login gate: all three relay lists (k10002, k10050, k10051) present');
    } else {
        const missing = [];
        if (!hasUsable10002) missing.push('k10002');
        if (!hasUsable10050) missing.push('k10050');
        if (!hasUsable10051) missing.push('k10051');
        findings.fail.push(
            `WhiteNoise login gate incomplete: missing ${missing.join(', ')}`,
        );
    }

    for (const item of mipItems) {
        if (item.type === 'err' && item.text.startsWith('KP ')) findings.fail.push(item.text);
        if (item.type === 'err' && item.text.includes('No KeyPackages')) findings.fail.push(item.text);
        if (item.type === 'ok' && item.text.includes('all tags valid')) findings.pass.push(item.text);
        if (item.type === 'ok' && item.text.includes('All KeyPackages pass')) findings.pass.push(item.text);
        if (item.type === 'warn') findings.warn.push(item.text);
    }

    if (auditCtx.nip65NoRead) findings.fail.push('NIP-65: no read relays in kind 10002');
    if (auditCtx.nip65NoWrite) findings.fail.push('NIP-65: no write relays in kind 10002');
    if (auditCtx.nip65Bloated) findings.warn.push('NIP-65: excessive relay count in kind 10002 (> 10)');
    if (auditCtx.nip65Malformed) findings.warn.push('kind 10002 (NIP-65) has malformed or missing tags array');
    if (auditCtx.relayDiverges) findings.warn.push('Relay lists diverge: k3 and k10002 advertise different relays');
    if (!auditCtx.legacyDmsConfigured) findings.warn.push('No NIP-17 DM inbox relay list (k10050)');
    if (!auditCtx.blossomConfigured) findings.warn.push('No Blossom media server list (k10063)');
    if (auditCtx.hasDeprecatedK4) findings.warn.push('Uses deprecated NIP-04 (kind 4) DMs — leaks metadata');
    if (auditCtx.hasDeprecatedK2) findings.warn.push('Uses deprecated kind 2 relay recommendations');

    const { hasFailures, hasWarnings, allOk } = determineVerdict(findings);
    return { findings, hasFailures, hasWarnings, allOk };
}

const PRESCRIPTION_RULES = [
    {
        testAll: context => context.hasNoKeyPackages,
        message: 'Publish at least one KeyPackage (kind 443) to your advertised relays',
    },
    {
        test: (item) => item.type === 'err' && item.text.includes('encoding'),
        message: 'Fix KeyPackage encoding tag — must be "base64"',
    },
    {
        test: (item) => item.type === 'err' && item.text.includes('0xf2ee'),
        message: 'Add marmot_group_data extension (0xf2ee) to mls_extensions',
    },
    {
        test: (item) => item.type === 'err' && item.text.includes('0x000a'),
        message: 'Add last_resort extension (0x000a) to mls_extensions',
    },
    {
        test: (item) => item.type === 'err' && item.text.includes('missing mls_ciphersuite'),
        message: 'Include the mls_ciphersuite tag in your KeyPackage events',
    },
    {
        test: (item) => item.type === 'err' && item.text.includes('not in 0x0001-0x0007'),
        message: 'Use a supported mls_ciphersuite (0x0001–0x0007) in KeyPackage events',
    },
    {
        test: (item) => item.type === 'err' && item.text.includes('missing relays'),
        message: 'Include the relays tag in your KeyPackage events',
    },
    {
        test: (item) => item.type === 'err' && item.text.includes('relays['),
        message: 'Fix invalid relay URLs in KeyPackage relays tag — use valid wss:// or ws:// URLs',
    },
    {
        test: (item) => item.type === 'err' && item.text.includes('no overlap with kind 10051'),
        message: 'KeyPackage relays tag should include at least one relay from your kind 10051',
    },
    {
        test: (item) =>
            item.type === 'err'
            && (
                item.text.includes('missing content')
                || item.text.includes('content empty')
                || item.text.includes('content not valid base64')
            ),
        message: 'KeyPackage content must be non-empty, valid base64-encoded KeyPackageBundle',
    },
    {
        test: (item) => item.type === 'err' && item.text.includes('i tag:'),
        message: 'Fix i tag — must be hex-encoded KeyPackageRef with length matching ciphersuite',
    },
    {
        test: (item) => item.type === 'err' && item.text.includes('must not list default extensions'),
        message: 'Remove default extensions (0x0001–0x0005) from mls_extensions — only custom extensions belong',
    },
    {
        test: (item) => item.type === 'warn' && item.text.includes('kind 10051 content'),
        message: 'Leave kind 10051 content empty',
    },
    {
        testAll: context => context.missingITagIds.length > 0,
        message: (_, context) =>
            `Broadcast delete events (kind 5) for KeyPackages missing the i tag (ids: ${context.missingITagIds.join(', ')}), then publish fresh KeyPackages with the i tag`,
    },
];

export function generatePrescriptions(
    mipItems,
    auditCtx,
    marmotRelays,
    best10051,
    staleRelays,
    missingRelays,
    missingITagIds,
    invalidUserRelays,
    invalidMarmot,
    inboxRelays,
    inboxItems,
    orphanedKpRelays,
    best10050,
) {
    const prescriptions = [];
    const ruleContext = {
        missingITagIds,
        hasNoKeyPackages: mipItems.some(
            item => item.type === 'err' && item.text.includes('No KeyPackages'),
        ),
    };

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
    } else if (marmotRelays.length === 0
        && invalidMarmot.length === 0) {
        prescriptions.push('Add relay tags to your kind 10051 event');
    }

    // k10050 prescriptions
    if (!best10050) {
        prescriptions.push(
            'Publish an Inbox Relay List (kind 10050) — required for giftwrap delivery and WhiteNoise login',
        );
    } else if (inboxRelays && inboxRelays.length === 0
        && !(inboxItems && inboxItems.some(i => i.type === 'err' && i.text.includes('Invalid Inbox relay')))) {
        prescriptions.push('Add relay tags to your kind 10050 event');
    }
    if (inboxItems && inboxItems.some(i => i.type === 'err' && i.text.includes('Invalid Inbox relay'))) {
        prescriptions.push('Fix invalid relay URLs in kind 10050 — ensure all relay tags use valid wss:// or ws:// URLs');
    }

    // Orphaned KeyPackages
    if (orphanedKpRelays && orphanedKpRelays.length > 0) {
        prescriptions.push(
            'Delete orphaned KeyPackages from relays not in your kind 10051 list, or add those relays to kind 10051',
        );
    }

    for (const rule of PRESCRIPTION_RULES) {
        const passesRule = rule.testAll
            ? rule.testAll(ruleContext)
            : mipItems.some(item => rule.test(item, ruleContext));
        if (!passesRule) continue;
        const message = typeof rule.message === 'function'
            ? rule.message(null, ruleContext)
            : rule.message;
        prescriptions.push(message);
    }

    if (best10051 && marmotRelays.length > 0) {
        prescriptions.push('MIP-00: Rotate MLS signing keys periodically within groups; ensure your client supports this');
    }
    if (auditCtx.relayDiverges) {
        prescriptions.push('Unify your k3 and k10002 relay lists — both should advertise the same set of relays');
    }
    if (auditCtx.nip65NoRead) {
        prescriptions.push('Add at least one read relay to kind 10002 (NIP-65) — clients need it to deliver replies to you');
    }
    if (auditCtx.nip65NoWrite) {
        prescriptions.push('Add at least one write relay to kind 10002 (NIP-65) — clients need it to publish on your behalf');
    }
    if (auditCtx.nip65Bloated) {
        prescriptions.push('Reduce kind 10002 (NIP-65) to 10 or fewer relays for better client performance');
    }
    if (auditCtx.nip65Malformed) {
        prescriptions.push('Fix kind 10002 (NIP-65) — ensure tags array is valid with r-tagged relay URLs');
    }
    if (!auditCtx.legacyDmsConfigured) {
        prescriptions.push('Publish a DM inbox relay list (kind 10050) to receive NIP-17 encrypted messages');
    }
    if (!auditCtx.blossomConfigured) {
        prescriptions.push('Publish a Blossom server list (kind 10063) so clients know where to upload your media');
    }
    if (auditCtx.hasDeprecatedK4) {
        prescriptions.push('Migrate from NIP-04 (kind 4) to NIP-17 or Marmot — NIP-04 leaks message metadata');
    }
    if (auditCtx.hasDeprecatedK2) {
        prescriptions.push('Stop publishing kind 2 (Recommend Relay) events — use kind 10002 (NIP-65) instead');
    }

    const uniqueRx = [...new Set(prescriptions)].sort(
        (a, b) => prescriptionPriority(a) - prescriptionPriority(b),
    );
    const canRebroadcast = (staleRelays > 0 || missingRelays > 0);
    const canDeleteKps = missingITagIds.length > 0;
    return { prescriptions: uniqueRx, canRebroadcast, canDeleteKps };
}

/**
 * @param {Object} params
 * @returns {{ findings: Object, prescriptions: string[], verdictClass: string, verdictIcon: string, verdictLabel: string,
 *   hasFailures: boolean, hasWarnings: boolean, allOk: boolean, lastAuditState: Object, canRebroadcast: boolean,
 *   canDeleteKps: boolean, missingITagIds: string[], syncedRelays: number, staleRelays: number, missingRelays: number, totalRelays: number }}
 */
export function compileFindingsAndPrescriptions(params) {
    const {
        relayData,
        relaysToInvestigate,
        invalidUserRelays,
        invalidMarmot,
        mipItems,
        marmotRelays,
        kpEventsCollected,
        bestK0,
        bestK3,
        bestK10002,
        best10050,
        best10063,
        best10051,
        inboxRelays,
        inboxItems,
        orphanedKpRelays,
        maxK0,
        maxK3,
        auditCtx,
        k3RelaySet,
        k10002RelaySet,
        canUnifyRelays,
        fromNip07,
        pubkey,
    } = params;

    const relayTally = tallyRelaySync(relaysToInvestigate, relayData, maxK0, maxK3);
    const { syncedRelays, staleRelays, missingRelays, totalRelays } = relayTally;

    auditCtx.syncedRelays = syncedRelays;
    auditCtx.totalRelays = totalRelays;
    auditCtx.staleRelays = staleRelays;
    auditCtx.missingRelays = missingRelays;

    const missingITagIds = [...new Set(
        mipItems.filter(i => i.type === 'err' && i.text.includes('missing i tag') && i.kpId).map(i => i.kpId)
    )];
    const findingsResult = generateFindings(
        {
            invalidUserRelays,
            invalidMarmot,
            maxK0,
            maxK3,
            totalRelays,
            syncedRelays,
            staleRelays,
            missingRelays,
            relaysToInvestigate,
            relayData,
            best10051,
            marmotRelays,
            mipItems,
            inboxRelays,
            inboxItems,
            orphanedKpRelays,
        },
        auditCtx,
    );
    const { findings, hasFailures, hasWarnings, allOk } = findingsResult;
    const verdict = determineVerdict(findings);
    const { verdictClass, verdictIcon, verdictLabel } = verdict;

    const rxResult = generatePrescriptions(
        mipItems,
        auditCtx,
        marmotRelays,
        best10051,
        staleRelays,
        missingRelays,
        missingITagIds,
        invalidUserRelays,
        invalidMarmot,
        inboxRelays,
        inboxItems,
        orphanedKpRelays,
        best10050,
    );
    const { prescriptions: uniqueRx, canDeleteKps } = rxResult;
    const canRebroadcast = Boolean(rxResult.canRebroadcast) && !!(bestK0 || bestK3);

    const lastAuditState = {
        bestK0,
        bestK3,
        bestK10002,
        best10050,
        best10051,
        best10063,
        inboxRelays: inboxRelays ? [...inboxRelays] : [],
        orphanedKpRelays: orphanedKpRelays ? [...orphanedKpRelays] : [],
        relaysToInvestigate: [...relaysToInvestigate],
        marmotRelays: [...marmotRelays],
        kpEventsCollected: [...kpEventsCollected],
        missingITagIds: [...missingITagIds],
        fromNip07,
        pubkey,
        k3RelaySet: [...k3RelaySet],
        k10002RelaySet: [...k10002RelaySet],
        canUnifyRelays,
    };

    return {
        findings,
        prescriptions: uniqueRx,
        verdictClass,
        verdictIcon,
        verdictLabel,
        hasFailures,
        hasWarnings,
        allOk,
        lastAuditState,
        canRebroadcast,
        canDeleteKps,
        missingITagIds,
        syncedRelays,
        staleRelays,
        missingRelays,
        totalRelays,
    };
}
