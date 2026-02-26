# Dr. Marmot

*A Nostr Profile Auditor*

Paste an npub. One of our doctors will examine your Nostr identity across every relay you publish to, checking sync, verifying NIP-05, and scanning for Marmot Protocol compliance. You'll get a full diagnosis card with findings and a prescription.

## The Examination

### Relay Health

- Discovers your relay list from kind 3 / 10002 / 10050 / 10051 events
- Detects out-of-sync profiles across relays
- Warns about single-relay fragility: one outage and you're unreachable

### Profile Vitals

- Name, picture, about field completeness
- NIP-05 identity verification (live HTTP check against `.well-known/nostr.json`)
- Event freshness — how long since your last profile or contacts update
- Follow list size

### Marmot Protocol Compliance (MIP-00 / MIP-01)

- Inbox relay list (kind 10050) — giftwrap delivery for WhiteNoise messaging
- KeyPackage relay list (kind 10051)
- KeyPackage events (kind 443) with base64 encoding validation
- MLS protocol version and ciphersuite checks (0x0001–0x0007)
- Required extensions: `0xf2ee` (marmot_group_data), `0x000a` (last_resort)
- KeyPackageRef (i tag) hex integrity and length per ciphersuite

At the end, the doctor charts a diagnosis card: pass/warn/error counts, detailed findings, and a prescription for anything that needs fixing.

## Running Locally

No build step. Zero npm dependencies. Just serve the static files — a local server is needed because the app uses ES modules and loads nostr-tools from a CDN.

```bash
# Python
python3 -m http.server 8000

# or Bun
bunx http-server

# or Node
npx http-server

# then open http://localhost:8000
```

## Deploying

Drop the files on any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages). No configuration needed.

## How It Works

1. Paste an npub or sign in with a NIP-07 browser extension
2. The doctor connects to bootstrap relays and discovers your relay list
3. Every discovered relay is queried for your profile, contacts, and relay lists
4. Your advertised KeyPackage relays are queried for KeyPackage events
5. Sync analysis, profile validation, inbox relay checks, and MIP compliance checks run in sequence
6. The doctor charts a diagnosis with findings and a prescription

## Project Structure

```text
dr.marmot/
├── index.html                # Entry point
├── style.css                 # JRPG styling, CRT scanlines
├── spritesheet-*.png         # Character sprites (one per doctor)
└── js/
    ├── main.js               # Init, NIP-07 sign-in, event wiring
    ├── config.js             # Default relays, timeouts, limits
    ├── audit.js              # Multi-phase audit orchestration
    ├── audit/
    │   ├── relayBootstrap.js       # Bootstrap relay discovery
    │   ├── relaySync.js            # Cross-relay sync assessment
    │   ├── profileKind0.js         # Profile (k0) validation
    │   ├── nip65Contacts.js        # NIP-65 / k3 relay analysis
    │   ├── keypackages.js          # k10051 + k443 MIP compliance
    │   ├── servicesDeprecation.js   # k10050, k10063, k10011, deprecation
    │   ├── findingsPrescriptions.js # Findings, prescriptions, verdict
    │   └── chartRender.js          # Patient chart HTML
    ├── personalities.js      # Per-doctor dialog lines and speech
    ├── dialog.js             # Typewriter text renderer
    ├── sprite.js             # Sprite animation controller
    ├── audio.js              # Web Audio beep effects
    ├── scan-bar.js           # Progress bar
    ├── relay-panel.js        # Relay status UI
    ├── relay-query.js        # Relay querying logic
    ├── relay-discovery.js    # User relay list extraction
    ├── relay-validation.js   # WebSocket URL validation
    ├── mip-validation.js     # MIP-00/01 compliance checks
    └── dom.js                # DOM element references
```

## Tech Stack

- Vanilla JavaScript — ES6 modules, no framework, no build step
- Web Audio API for the retro beeps
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) via ESM CDN
- [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) pixel font

## Related

- [Nostr Protocol](https://github.com/nostr-protocol/nostr) — the protocol being audited
- [Marmot Protocol](https://github.com/marmot-protocol/marmot) — MLS-based encrypted messaging for Nostr
