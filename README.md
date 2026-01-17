# [NeverLanding.page](https://neverlanding.page)

Super lightweight static frontend + Cloudflare Worker API that returns a random website URL from the Tranco Top 1M list.

## Local run

1) Start the Worker (serves API + static assets):
```bash
wrangler dev
```

2) Open `http://localhost:8787` in your browser.

## List source

The Worker fetches the latest Tranco list metadata and downloads the Top 1M CSV,
then caches it in memory for ~30 days.
You can override the list URL via the `TRANCO_URL` variable.

## DNS family filter (optional)

By default the Worker checks each candidate domain against Cloudflare's Family DNS
over DoH to avoid adult domains. Set `DNS_FILTER=off` to disable this check.

## Deploy

```bash
wrangler deploy
```
