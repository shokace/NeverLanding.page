# Random discovery and filtering

Candidates come from random ranges throughout the entire Tranco list (80% of
picks), mixed with the discovery and registry supplements (20%). There is no
popularity or rank weighting. The supplement contains 641 unique hosts across
222 TLDs; 207 registry hosts were imported from their IANA registration-service
records, retaining a source URL for each. Supplements are not safety exemptions.

When R2 is unavailable, the latest Tranco CSV is streamed into a shared,
one-day in-memory cache, avoiding multiple simultaneous full downloads. If both
sources fail, the supplement still supplies candidates. R2 ranges discard partial
CSV records at both boundaries. Candidate probes run in batches of three, with a
shared outbound-request budget and bounded headers/body read times.

Every candidate and each HTTP redirect hop must pass:

1. Public HTTPS URL validation (no credentials, IP literals, internal hosts, or
   alternate ports).
2. The maintained [HaGeZi NSFW domain list](https://github.com/hagezi/dns-blocklists)
   including parent-domain matching and a small explicit adult-host/TLD filter.
3. [Cloudflare Families DNS](https://developers.cloudflare.com/1.1.1.1/setup/)
   with public A/AAAA answers; errors, empty answers, and blocked addresses fail
   closed. The old `DNS_FILTER=off` bypass is no longer supported.
4. A successful HTML response, no explicit adult metadata/age gate, no common
   soft error/challenge/parked page, and an embedding policy that permits previews.

Redirects are followed manually so a safe entry cannot simply redirect to an
unchecked host. Meta refresh and obvious cross-site script redirects are skipped.
No third-party content is rehosted or its framing restrictions bypassed. Third-party
pages can change after inspection and navigate themselves; domain filters and
HTML screening cannot promise perfect classification of the changing open web.

Successful checks expire after five minutes; DNS checks after five minutes;
the adult list after eight hours. A stale/missing filter never becomes an allow.
Caches have bounded entry counts. `/api/random` uses `Cache-Control: no-store`.
`/api/resolve` applies the same checks to shared URLs, history, and old favorites.

Maintenance:

- `npm run check:catalog` validates the supplement; add `-- --live` to check sites
  through the same network filters. Network failures do not delete entries.
- `python3 tools/import-registry-sites.py` refreshes IANA-sourced registry hosts.
- `TRANCO_R2_KEY` defaults to `tranco/top-1m.csv`; `TRANCO_URL` overrides the live
  fallback CSV source. R2 contains an uncompressed `rank,domain` CSV.

Tests cover fail-closed outages, blocked redirects, private addresses, every
frame-policy directive, body checks, CSV parsing, full-list sampling, and TLD
coverage. The live sample checked 20 supplemental sites: 17 passed content/DNS
checks and eight also permitted framing (2026-09-17).
