# Leaderboard and public identity

The View menu opens a top-100 leaderboard ordered by total recorded landings,
not unique domains or achievements. Equal totals share a competition rank (1,
1, 3). Existing landings are retained. The public response contains only
`{items: [{rank, username, visits}]}`. It has no personalized fields, email,
account IDs, display names, avatars, visit URLs, sessions, or achievement details.
The SQL selects only username and visit total, and the response uses an explicit
field allowlist. HTML is never constructed from player data.

D1 stores totals maintained by insert/delete triggers on visits. Migration 0012
backfills counts from historical visits without changing visits or awards. An
index orders the totals. Each leaderboard request reads the top 100 from D1 and
returns `Cache-Control: no-store`, so renames and deletions appear on the next
refresh without a stale browser or edge cache. There is no private "my rank"
result mixed into this public response. This uses the
existing Worker and D1; no paid add-on is required. It still consumes the
account's normal Workers/D1 allowances.

## Usernames

Email signup requires a 3–24 character username using ASCII letters, numbers,
underscores, or hyphens. New Google accounts have a null username until their
owner chooses one in the mandatory setup dialog; no public identity is derived
from Google email or profile name. Existing safe usernames (up to 32 characters)
are preserved. Migration 0013 clears unsafe/blank names and, if old names collide
case-insensitively, retains the earliest account's name and prompts the others.
A case-insensitive unique index handles races as well as normal availability
checks. No account, earned award, or visit is deleted by this migration.

Incomplete accounts are blocked from authenticated game operations until setup
is complete, even if they bypass the dialog. Setup can only update the current
session's incomplete account. It cannot rename another account or overwrite an
existing valid name. Incomplete accounts are excluded from public rankings until
a name is chosen. Their totals remain stored.

## Visit integrity and private endpoints

Every `/api/random` destination includes a ten-minute HMAC-SHA256 receipt signed
using the secret `VISIT_SIGNING_KEY`. Receipts bind the normalized URL, unique
nonce, and authenticated user when present. Anonymous receipts support a page
queued before login, but still require authentication and a username to score.
Receipts stay in page memory: they are not put into iframes, URLs, history,
public leaderboard responses, or logs.

The visit endpoint verifies the receipt before inserting. A unique database
index permits each nonce to count only once globally, including concurrent
submissions. An insert-time per-user limit in D1 works across Worker instances.
Background preloads, Back, Forward, Refresh, and favorites do not submit visits.
Historical visits are preserved as recorded; they cannot be retroactively
verified. Receipts prevent fabricated destinations and replay, but cannot prove
that a human read a third-party page or prevent all browser automation.

Other API responses default to `Cache-Control: no-store` and omit wildcard CORS.
POST requests require JSON and reject cross-site Origin/Fetch Metadata headers.
JSON bodies are bounded to 16 KiB. Cookies remain HttpOnly, SameSite=Lax, and
Secure on HTTPS. No private data is included in leaderboard errors.

## Deploy and verify

Set a randomly generated signing secret with `wrangler secret put VISIT_SIGNING_KEY`
without printing it. Local development needs a separate key (at least 32 characters)
in ignored `.dev.vars`. Apply migrations 0012 and 0013 before deploying the Worker.
Already-open older clients need to reload before new landings can score.

- `npm test`: receipt signature/binding/expiry/tampering, strict public projection,
  migration preservation, case collisions, and single-use database constraints.
- `npm run test:integration`: local-only accounts and actual D1 covering required
  usernames, concurrent claims/replays, private headers, CSRF, visit counts,
  receipt rejection, protected accounts, and public JSON field allowlists.
- `npm run test:browser`: actual browser rendering, required setup/collision UI,
  mobile layout, keyboard operation, error/empty states, receipt handoff, existing
  achievements, glowing earned tiles, reduced motion, and footer action confirmations.

The footer defaults to only the GitHub link, retaining action confirmations and
loading/errors when relevant. Discovery source names never appear. Queue diagnostics
remain hidden, and the old embed notice is removed. Earned achievements have a steady gold glow;
new unlocks sparkle continuously during their first viewing session. Opening
the notification scrolls to the first unseen award. Only tiles actually visible on
screen are acknowledged when the panel closes (or the page is left). Viewed awards
are remembered per account in this browser using the existing seen-achievements
storage; reopening or reloading does not replay them. Off-screen awards stay unread
and keep their sparkle for a later session. Reduced-motion users get the steady
glow without animation.


## Settings and account deletion

File → Settings opens an accessible window for changing a username, choosing
reduced motion (saved per browser), clearing this tab’s local navigation history,
and signing out every other device. History cleanup does not erase saved visits,
favorites, or achievements. Guests can use browser preferences and sign in from
Settings. Device reduced-motion preferences remain respected.

`POST /api/account/profile` renames only the authenticated account, retaining its
ID, visits, favorites, and achievements. The same 3–24-character validation and
case-insensitive unique index used at signup reject collisions, including races.
The original `/api/account/username` remains limited to mandatory initial setup.
`POST /api/account/sessions/revoke` removes the current user’s other sessions;
the current session and every other account remain untouched.

Deletion requires typing `DELETE`, plus the current password for password-based
accounts. Google-only accounts require a session created within the preceding ten
minutes; older sessions get a sign-out/sign-in path before retrying. The server
checks these conditions itself and ignores client-supplied account IDs. Existing
JSON, same-origin, session, and no-store protections apply to all account routes.
The client never receives password hashes or OAuth credentials.

`POST /api/account/delete` executes a single atomic users deletion. Existing
foreign-key cascades remove visits, favorites, earned achievements, visit totals,
provider credentials, and all sessions for that account. The global achievement
catalog and other users are preserved. The response expires the session cookie.
The client clears private account state, local navigation history, and that
account’s seen-achievement storage, and notifies other open tabs to clear theirs.
Late progress/favorites responses cannot restore the deleted account’s UI data.
As with any D1 deletion, provider-managed database recovery retention is separate
from the live application database; this endpoint does not purge Cloudflare backups.

`tests/settings-integration.mjs` uses only disposable local D1 users to verify
renames, collisions, preserved awards, session isolation, deletion credentials,
CSRF rejection, all cascade targets, immediate public ranking updates, and Google
session age checks. `tests/settings-browser.mjs` covers confirmation, errors,
preferences, guest controls, cleanup, reauthentication, keyboard focus, and mobile
layout. No production account is deleted during verification.
