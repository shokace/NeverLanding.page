# Achievement catalog

`public/data/achievements.json` is the shared source for tiles and server-side rules.
All 45 existing non-flag icons have definitions. No image assets were added.
Country flags match the final hostname label, including multi-label domains such
as `example.co.uk`. Paths, query strings, and subdomains do not award flags.
The existing `.biz`, login, sharing, and Explorer codes are unchanged.

- Explorer Level 1: 100 landings (unchanged).
- Explorer Level 2: 2026 landings (unchanged).
- Explorer Level 3: 2026 landings plus all available flag achievements. The final
  flag now counts on the same visit. Unrelated generic TLDs are not countries.
- `.mf` remains visible and existing earned records are preserved, but it is
  unavailable and excluded from completion because it is not delegated in DNS.
- The already-present Saint Vincent and the Grenadines flag awards `.vc`.
- The already-present Soviet Union flag awards the still-delegated `.su`.

Historical, fictional, and unrecognized flags without a delegated corresponding
TLD remain unused assets. They are not given invented domains or reassigned to
unrelated countries. Alternate historical designs do not create duplicate awards.
The arbitrary empty grid slots have been removed: every rendered tile now has a
complete definition or an explicit explanation of its unavailable TLD.

Existing earned awards are never deleted. New rules backfill from stored visits
when a signed-in player loads achievements or records another visit. Preparing
background pages does not record a landing or unlock an achievement.

Run `npm run achievements:generate` after editing definitions, then apply the
additive migration. Its upsert preserves existing IDs, even nonstandard ones,
and preserves `user_achievements` records and timestamps. The regression suite
checks old thresholds, every TLD rule, final-flag completion, and migration reruns.

Flag reference: [IANA Root Zone Database](https://www.iana.org/domains/root/db),
verified 2026-09-17; [.mf delegation](https://www.iana.org/domains/root/db/mf.html).

New unlocks store their supporting URL in `user_achievements.source_url`. TLD
awards use the first matching recorded visit; visit milestones use their exact
numbered landing. A later visit never overwrites an award's original link.
Login has no triggering website. Existing awards without provenance keep their
original timestamps and do not display an invented link.

Explorer Level 3 displays `???` while locked and exactly `Visited the 2026th
Website` after unlocking. Its rule is not disclosed in the achievement dialog.

For subsequent catalog updates, generate a **new** migration, for example
`npm run achievements:generate -- --migration 0012_catalog_update.sql`.
Applied migrations must not be rewritten.
