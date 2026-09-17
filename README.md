# [NeverLanding.page](https://neverlanding.page)

A retro browser game for discovering random websites and collecting TLD
achievements. Random selection covers the full Tranco Top 1M plus a supplement
of interesting sites and IANA-sourced registry destinations; there is no
popularity weighting. Each tab prepares five pages in the background and Go
displays a loaded page without reloading it. Every candidate passes live adult-content, DNS, redirect,
HTML, and preview checks.

## Local run

```sh
npm ci
npx wrangler d1 migrations apply neverlanding-dev --local
npm run dev
```

Open `http://localhost:8787`. Auth secrets belong in the ignored `.dev.vars` file.
Production uses the versioned R2 CSV selected in `wrangler.toml`. Local development
falls back to the live Tranco CSV when that R2 object is absent.

## Verify

```sh
npm test
npm run check:catalog
npm run test:browser   # requires local server and Playwright Chromium
node tests/integration.mjs  # local D1 only; creates disposable test accounts
```

## Deploy

```sh
npx wrangler whoami
npx wrangler d1 migrations apply neverlanding-dev --remote
npx wrangler deploy --keep-vars
```

Apply migrations before deploying code that uses new columns. Existing earned
achievements and their IDs are preserved. See [achievement notes](docs/ACHIEVEMENTS.md)
[discovery/filtering notes](docs/DISCOVERY.md), and [queue notes](docs/QUEUE.md) for maintenance and verification.
The deployed CSV's source, list ID, count, and SHA-256 are recorded in
`public/data/tranco-source.json`; the previous R2 object is retained for rollback.
