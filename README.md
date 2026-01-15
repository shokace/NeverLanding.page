# Random Website (Common Crawl)

Super lightweight static frontend + Cloudflare Worker API that returns a random website URL from the Tranco Top 1M list.

## Local run

1) Start the Worker API:
```bash
wrangler dev
```

2) Serve the static page from this repo:
```bash
python3 -m http.server 5173
```

3) Open `http://localhost:5173` in your browser.

If you're serving the page from a different origin than the Worker, update the fetch URL in `index.html` to `http://localhost:8787/api/random`.

## List source

The Worker fetches the latest Tranco list metadata and downloads the Top 1M CSV,
then caches it in memory for ~30 days.
You can override the list URL via the `TRANCO_URL` variable.

## Deploy

```bash
wrangler deploy
```
