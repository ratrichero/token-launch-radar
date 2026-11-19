# Token Launch Radar

An entry for [token-radar-01](https://make.fun/c/token-radar-01/) on make.fun.

![token-radar-01](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/ratrichero/token-launch-radar/rank.svg)
![reward](https://make.fun/badge/token-radar-01/ratrichero/token-launch-radar/reward.svg)

## What it does

Radar scores protocols whose snapshot has no token metadata. It covers the
watchlist and eligible protocols below the snapshot's TVL floor. The offline
dashboard has shareable filters, a model breakdown, the peer table, a live-token
comparison and category-specific examples of what to verify before farming.
This is a **snapshot**, not a real-time tracker or a verified rewards calendar.

## Try the current code without the challenge kit

Use Node **22.18+**. The generator itself needs no npm install:

```sh
node tests/fixture.mjs demo-snapshot.json
node main.ts --input demo-snapshot.json --output demo-out
node tools/check-gate.mjs demo-out demo-snapshot.json
```

Open `demo-out/dashboard/index.html` directly. The fixture uses fake protocols
and values and is not suitable for market or farming decisions. The tracked
`out/` and `screenshots/` are **historical radar-2 submission artifacts**, not
output from the current radar-3 code; they are kept intact for provenance.

## Build from the official snapshot

The sealed snapshot is not in Git. Obtain `snapshot.json` from the challenge
kit or use the `/input` mount supplied by the runner:

```sh
node main.ts --input /path/to/snapshot.json --output radar-build
node tools/check-gate.mjs radar-build /path/to/snapshot.json
```

`--input` also accepts a directory containing `snapshot.json`. Use a fresh
output directory. Open `radar-build/dashboard/index.html`; `board.json`,
`data.js`, and the dossier live one level above the dashboard. `node main.ts
--help` lists the options. A missing watchlist slug, an excluded watchlist
entry, or one with live or ambiguous metadata is an explicit build error:
coverage does not justify labelling a protocol pre-token.

The first build copies the historical screenshots for packaging. To produce a
current submission, capture the rebuilt UI and pass those images to a second
build (do not shoot the synthetic demo for submission):

```sh
npm ci
npx playwright install chromium
node tools/shoot.mjs radar-build/shots radar-build/dashboard
node main.ts --input /path/to/snapshot.json --screenshots radar-build/shots --submission --output radar-build/final
node tools/check-gate.mjs radar-build/final /path/to/snapshot.json
```

## Reading the model and farm steps

`radar-3` multiplies **TVL × peer multiple × 7-day growth × maturity × chain
factor**, rounds to the nearest dollar, then applies a $1 minimum. The peer
multiple starts from the median circulating market cap / TVL of comparable live
tokens, shrinks towards the overall median, and is clamped. No category peers
means a global fallback; no eligible peers at all means an assumed 0.05× floor,
not a market observation. Peer counts are support indicators, not statistical
confidence intervals. The Value Model tab shows sensitivity to dropping the
chain bonus or shifting the peer multiple by ±25% for the baseline top ten.
The score is **not FDV, an expected payout, or a price prediction**.

For token status, all three fields (`mcap_usd`, `gecko_id`, `symbol`) absent
means no token recorded in the snapshot. A positive market cap and both
identifiers are needed for the live comparison. Partial evidence is treated as
unknown, not eligible for either list. CEXs are excluded; the ranked board also
excludes versioned protocol names.

Farm steps are category examples, not verified reward conditions. Check the
official program, the product/network, costs, minimums and how to exit before
spending. Budget figures are optional heuristics, not verified minimums. There
is no inferred requirement to transact weekly, fund a second network, or hold
until a future distribution.

## Development checks

```sh
npm test                 # unit + CLI round trip, deterministic output, local gate
npm ci
npx playwright install chromium  # add --with-deps for Linux CI
npm run test:browser     # offline Chromium smoke tests at 1440px and 390px
```

`CHROME=/path/to/chromium` can override Playwright's browser executable. CI runs
both test commands; passing the fixture gate does not confirm compatibility
with the official sealed snapshot.

| Path | What |
|------|------|
| `main.ts` | CLI: snapshot in, board + dashboard + dossier out |
| `lib/model.ts` | Snapshot parsing, token status, scoring and farm examples |
| `dashboard/` | Offline UI source |
| `tests/` | Synthetic fixture, model tests, CLI/gate tests |
| `tools/check-gate.mjs` | Local artifact checks |
| `tools/browser-smoke.mjs`, `tools/shoot.mjs` | Browser checks and screenshot capture |
| `vendor/makefun-board.ts` | Vendored make.fun dossier library |
| `REPORT.md` | Historical submission notes, not current verification |

MIT licensed — see [LICENSE](LICENSE).

## Submission audit

Compare the tracked radar-2 board with a radar-3 run without changing either artifact:

```sh
node tools/compare-radar.mjs out/board.json /path/to/snapshot.json > radar-diff.json
```

The report includes additions/removals, all watchlist conflicts, both top-20 lists
joined by slug, and factor changes. A board conflict returns exit 1 but still emits
JSON. The baseline board cannot prove snapshot identity, and its rounded factors
make the attribution approximate. The dashboard detail separately shows the actual
category and global peer samples, raw/bounded ratios, and the applied multiplier.

`tools/shoot.mjs` writes a capture manifest with SHA-256 hashes of data, dashboard
files, and each screenshot. `--submission` requires that manifest and a fresh output
directory. It refuses mismatches before writing output and copies only the four
expected images. This checks consistency, not who produced the images.

## Source-backed farm notes

`data/farm-evidence.json` is an optional editor-maintained object keyed by slug,
with fields `source` (official HTTPS page), `checked_at` (ISO date on or before
the snapshot), `networks` (nonempty string array), `eligibility`, and `exit`.
Use `--farm-evidence path/to/file.json` to supply a reviewed manifest for a build;
use the same manifest for capture and final packaging. A note is displayed separately
from the unverified category examples. The build checks format, not whether a
page is official or its claims are true: review those manually. The default file
is empty until sources and the official top ten are available; do not use guessed
eligibility or imply that every protocol has a program.
