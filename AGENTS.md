# Dr. Marmot — Agent Guidelines

**For: AI coding agents operating in this repository**

---

## Quick Facts

- **Tech Stack:** Vanilla JavaScript (ES6 modules), no build step, zero npm dependencies
- **App Purpose:** Nostr profile auditor with Marmot Protocol (MIP-00/01) compliance checks
- **Deployment:** Static files only
- **Browser Target:** Modern browsers with ES modules support

---

## Build, Lint, Test Commands

### Lint

```bash
# Run ESLint on all JS files
npm run lint
# or from repo root
node .github/lint/node_modules/.bin/eslint . -c .github/lint/eslint.config.js
```

**Config:** `.github/lint/eslint.config.js`
- ESLint 9 with recommended rules
- Browser globals enabled
- `no-unused-vars`: warn (unused function params prefixed with `_` are ignored)
- `no-console`: off (console.error is used for audit logging)

### Local Server (No Build)

```bash
# Any of these work — ES modules require HTTP (not file://)
python3 -m http.server 8000
bun x http-server
npx http-server

# Then open http://localhost:8000
```

---

## Code Style Guidelines

### Imports

- **ESM only:** `import` statements from CDN (nostr-tools) or local modules
- **Order:** Standard library → External → Local (one blank line between groups)

```javascript
import { nip19, SimplePool } from 'https://esm.sh/nostr-tools';
import { DEFAULT_RELAYS } from './config.js';
import { npubInput } from './dom.js';
```

- **CDN:** `https://esm.sh/nostr-tools` is the sole approved external CDN for this project (no package.json dependency). All other assets must be self-hosted.

### Formatting

- **Indentation:** 4 spaces (not tabs)
- **Line length:** Soft 100 chars, hard 120 chars
- **Semicolons:** Required at end of statements
- **Trailing commas:** Use in multi-line objects/arrays

```javascript
const obj = {
    key1: 'value1',
    key2: 'value2',  // trailing comma
};
```

### Naming Conventions

- **Functions:** camelCase, descriptive action verbs
  - `queryRelayForKinds()`, `validateRelayUrl()`, `isValidBase64()`, `extractUserRelays()`
  
- **Variables:** camelCase
  - `lastAuditState`, `isAuditing`, `relayUrl`, `pubkey`
  
- **Constants:** UPPER_SNAKE_CASE
  - `DEFAULT_RELAYS`, `RELAY_TIMEOUT_MS`, `VALID_CIPHERSUITES`
  - Exception: Constants exported as objects/maps use camelCase keys: `CIPHERSUITE_I_TAG_LEN`
  
- **Booleans:** Prefix with `is`, `has`, `should`, `can`
  - `isAuditing`, `hasError`, `isValidBase64()`
  
- **Private functions:** None — no name-based privacy (module-level scope is default)

### Types & Validation

- **No TypeScript.** Use JSDoc for function signatures when helpful:

```javascript
/**
 * Query a relay for specific event kinds.
 * @param {SimplePool} pool - nostr-tools pool instance
 * @param {string} relayUrl - WebSocket relay URL
 * @param {string} pubkey - 64-char hex public key
 * @param {number[]} kinds - Nostr event kinds (0, 3, 10051, etc.)
 * @returns {Promise<Object>} results keyed by kind, value is event or null
 */
export function queryRelayForKinds(pool, relayUrl, pubkey, kinds) { ... }
```

- **Runtime validation:** Validate untrusted input (relay URLs, npubs, base64)
  - `validateRelayUrl()`, `isValidBase64()`, `pubkeyToHex()`

### Error Handling

- **Pattern:** Try-catch with console logging
  
```javascript
try {
    const sub = pool.subscribeMany([relayUrl], { authors: [pubkey], kinds }, {
        onevent(ev) { ... },
        oneose() { sub.close(); resolve(results); },
    });
} catch (e) {
    console.error('Failed to query relay for kinds', e);
    resolve(results);  // Graceful fallback
}
```

- **Web errors:** Catch fetch/network failures, return null or empty result
- **User messaging:** Use `say()` from `dialog.js` for user-facing errors (not alert/console)
- **Never throw from module exports** — return null/empty/error object instead

### Code Organization

- **One export type per file:** Either one default export OR multiple named exports
  - `config.js`: Multiple constants (DEFAULT_RELAYS, RELAY_TIMEOUT_MS)
  - `dialog.js`: Functions (say, clearQueue, setOnAllDone)
  
- **Module scope:** Functions at module scope (no fake "classes" or IIFE wrappers)

- **Side effects:** Acceptable only in `main.js` (initialization)
  - Other modules export functions/constants; don't execute on import

### DOM Access

- **Centralize:** All DOM queries live in `dom.js`
- **Use exported references:** Import from dom.js, don't query in your module

```javascript
import { npubInput, auditBtn, relayList } from './dom.js';
npubInput.value = 'value';
auditBtn.addEventListener('click', ...);
```

### Async Patterns

- **Promise-based:** Use Promise constructor or async/await
- **Pool timeouts:** Wrap in setTimeout to avoid hanging subscriptions

```javascript
export function queryRelayForKinds(pool, relayUrl, pubkey, kinds) {
    return new Promise((resolve) => {
        // ... subscription setup ...
        setTimeout(() => {
            sub.close();
            resolve(results);
        }, RELAY_TIMEOUT_MS);
    });
}
```

### Audit Module Pattern

Multi-phase audit flow (main module orchestrates):

1. **extractUserRelays()** → discover relays from kind 3/10002/10051
2. **queryRelayForKinds()** → fetch profile/contacts/KeyPackage from each relay
3. **Validation stack** → mip-validation, relay-validation, nip05 checks
4. UI updates via **relay-panel.js** and **dialog.js**

State tracked in `lastAuditState`; reset via `resetAuditState()` before new audit.

---

## File Purpose Summary

| File | Purpose |
|------|---------|
| `main.js` | Init, event wiring, NIP-07 sign-in, audit orchestration |
| `audit.js` | Multi-phase audit state, relay querying orchestration |
| `config.js` | Constants (relays, timeouts, limits) |
| `relay-query.js` | Pool queries with subscription + timeout |
| `relay-discovery.js` | Extract relay list from user's kind 3/10002/10051 |
| `relay-validation.js` | WebSocket URL validity checks |
| `mip-validation.js` | MIP-00/01 spec validation, NIP-05 verification |
| `relay-panel.js` | Relay status UI, result sections |
| `dialog.js` | Typewriter text renderer, message queue |
| `sprite.js` | Character sprite animation controller |
| `personalities.js` | Per-doctor dialog lines and speech |
| `audio.js` | Web Audio beep effects |
| `scan-bar.js` | Progress bar UI |
| `dom.js` | Central DOM element references |
| `audit/relayBootstrap.js` | Relay bootstrap and discovery |
| `audit/relaySync.js` | Relay sync (k0/k3/k10000) assessment |
| `audit/profileKind0.js` | Profile (kind 0) vitals |
| `audit/nip65Contacts.js` | NIP-65 and k3/k10002 relay lists |
| `audit/keypackages.js` | KeyPackage (kind 443) MIP-00/01 evaluation |
| `audit/servicesDeprecation.js` | Services (k10050/k10063/k10011) and deprecation (k4/k2) |
| `audit/findingsPrescriptions.js` | Findings compilation, prescriptions, verdict |
| `audit/chartRender.js` | Patient chart HTML |

---

## Common Patterns to Follow

1. **Exports at bottom:** Define functions, then list exports
2. **Early returns:** Return null/empty on validation failure
3. **No globals:** Pass data as function args, not window state
4. **Consistent error messages:** Match user-facing strings in relay-panel.js
5. **Test in browser:** No CI tests; manual UI validation
