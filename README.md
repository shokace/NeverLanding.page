# Random Website (Common Crawl)

Super lightweight static frontend + Cloudflare Worker API that returns a random website URL from the latest Common Crawl index.

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

## Deploy

```bash
wrangler deploy
```
