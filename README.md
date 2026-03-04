# Dr. Marmot

*A Nostr Profile Auditor*

![Dr. Marmot](https://blossom.primal.net/953759719f553f29716fd17bf4d25a9237f6ef5677d5f49ba441d6f93215ad65.png)

Paste an npub. One of our doctors will examine your Nostr identity across every relay you publish to, checking sync, verifying NIP-05, and scanning for Marmot Protocol compliance. You'll get a full diagnosis card with findings and a prescription.

## The Examination

![The Examination](https://blossom.primal.net/07d485d6da2ac3aa080676e95d92332e3fa03a29a1f48dd8516f6ebca1f49f59.png)

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

![Running Locally](https://blossom.primal.net/70d3f10880b8c90865d74529249c1ffc6f888f354d1b41aff21a8d6037bd63cd.png)

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

![Deploying](https://blossom.primal.net/7c1741470a6dfba1a404644ad4b037da6d79a7c9cd14bc9a3d5f1a20d66c2d87.png)

Drop the files on any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages). No configuration needed.

## How It Works

![How It Works](https://blossom.primal.net/c5886cda40456b6a6c9e520ade529a79c443d1e00d0118c830479e67889724aa.png)

1. Paste an npub or sign in with a NIP-07 browser extension
2. The doctor connects to bootstrap relays and discovers your relay list
3. Every discovered relay is queried for your profile, contacts, and relay lists
4. Your advertised KeyPackage relays are queried for KeyPackage events
5. Sync analysis, profile validation, inbox relay checks, and MIP compliance checks run in sequence
6. The doctor charts a diagnosis with findings and a prescription

## Project Structure

![Project Structure](https://blossom.primal.net/35df576bc16788c3d78bbeb559524ad0455fa2cfa9ca6f3e3b6ffd45d8cbf6c9.png)

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

![Tech Stack](https://blossom.primal.net/286bfd6edd26194dfb3f94892d455978ac73630a661afc7d2d85e3a2e796c550.png)

- Vanilla JavaScript — ES6 modules, no framework, no build step
- Web Audio API for the retro beeps
- [nostr-tools](https://github.com/nbd-wtf/nostr-tools) via ESM CDN
- [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) pixel font

## Browser Requirements

![Browser Requirements](https://blossom.primal.net/d433dc35b37f30d5f07cf166d97e135e856f28e672ec3e753bfbe5567f7c93cd.png)

The app uses native ES modules and the Web Audio API — no polyfills, no transpilation. Any modern browser works:

| Browser | Minimum Version |
|---------|----------------|
| Chrome  | 61+            |
| Firefox | 60+            |
| Safari  | 11+            |
| Edge    | 16+            |

Internet Explorer is not supported.

## License

![License](https://blossom.primal.net/3b46682ddbd07e5b077c441f3cc7558e7a550e88e281ad467a1f44219893cbe1.png)

MIT — see [LICENSE](LICENSE).

## Related

![Related](https://blossom.primal.net/f0b3208defef4ecfd313d7fab5275bda071cb8d7a336500e62e6a13e7e1ed469.png)

- [Nostr Protocol](https://github.com/nostr-protocol/nostr) — the protocol being audited
- [Marmot Protocol](https://github.com/marmot-protocol/marmot) — MLS-based encrypted messaging for Nostr
