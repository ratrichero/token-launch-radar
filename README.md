# Token Launch Radar

An entry for [token-radar-01](https://make.fun/c/token-radar-01/) on make.fun.

![token-radar-01](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/ratrichero/token-launch-radar/rank.svg)
![reward](https://make.fun/badge/token-radar-01/ratrichero/token-launch-radar/reward.svg)

## What it does

Ranks pre-token DeFi protocols by the **implied value** of the token their record points to.
`main.ts` reads a sealed DefiLlama snapshot, scores every pre-token protocol with the model in
`lib/model.ts` (TVL × peer multiple × growth × maturity × chain, all derived from the snapshot —
no protocol is hardcoded), writes a 226-row board covering the full 40-slug watchlist plus the
early protocols below the $50M TVL floor, and ships a static dashboard (`dashboard/`) that renders
`data.js` with no network access: a sortable/filterable board, a per-protocol model breakdown with
the exact multiplication and farm steps, live tokens set aside for comparison, and the peer
multiple table.

Implied value is the entry's claim, not a published price — and not a price prediction.

## Run it

Node 22+ (nothing is installed):

```sh
node main.ts --input <path/to/snapshot.json> --output out
```

Then open `out/dashboard/index.html`. The entry also writes `out/board.json`, `out/data.js`,
`out/dossier.json` (via the vendored `vendor/makefun-board.ts`) and copies `screenshots/`.

Check the output locally:

```sh
node tools/check-gate.mjs out <path/to/snapshot.json>
```

## Layout

| Path | What |
|------|------|
| `main.ts` | entrypoint: snapshot in, board + dashboard + dossier out |
| `lib/model.ts` | the value model (radar-2) and board assembly |
| `dashboard/` | static page: `index.html`, `app.css`, `app.js` |
| `screenshots/` | 1-board.png, 2-detail.png, 3-filtered.png |
| `vendor/makefun-board.ts` | make.fun's dossier library, copied verbatim |
| `tools/` | local checks: `check-gate.mjs`, `shoot.mjs` |

MIT licensed — see [LICENSE](LICENSE).
