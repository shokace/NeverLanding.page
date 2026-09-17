# Five-page preparation queue

Each open tab starts a queue immediately, including for signed-out visitors.
The target is five fully loaded third-party iframe documents, with at most three
simultaneous preparations and one visible page in addition to the queue.

Go consumes a ready document and changes its visibility in place. It never moves
that iframe to another parent or assigns its URL again, so the loaded browsing
context is retained. Refill starts as soon as a page is consumed. Only an actual
Go landing records a visit; background preparation never awards achievements.

- Concurrent requests reserve final origins to avoid duplicates after redirects.
- Recent destinations are excluded from discovery requests and checked again in
  the browser before a frame is added.
- API fetches time out after 25 seconds; page loads after 15 seconds. Failed
  preparations are removed and retried with bounded exponential backoff.
- A cold Go waits up to 30 seconds for a ready page, with a Stop control. Stopping
  or changing navigation invalidates late completions.
- Ready pages expire after five minutes and are replaced proactively, including
  when a tab becomes visible again. Idle tabs do not keep stale pages forever.
- Leaving the page aborts requests, clears timers, and removes prepared frames.
- History, refresh, favorites and shared URLs pass the server's preview checks.
  Failed history checks leave the current history position intact.
- Background frames are inert, hidden from accessibility navigation and denied
  autoplay, camera, microphone and geolocation. The same restrictions continue
  after promotion. NeverLanding itself denies framing to prevent nested copies
  of the app recursively preparing more pages.

Cross-origin browsers do not expose the contents of an iframe to the parent.
Readiness therefore uses a bounded load event plus the server's HTML/framing
checks; a site changing its response for a browser can still refuse its preview.
The address link remains available in that case. Framing restrictions are not
bypassed or removed.

Verification:

- `npm run test:browser` uses actual browser frames with deterministic network
  fixtures. It verifies five ready pages, no extra navigation on promotion,
  preserved browsing context, automatic refill, no background visits, retry,
  history behavior, achievement links and secret descriptions.
- The queue harness additionally verifies duplicate rejection, active request
  limits, idle expiry, API/page timeouts, cancellation, recovery and cleanup.
- `npm run test:live` uses real screened websites (local UI with production API
  by default). For the deployed UI use `SITE_URL=https://neverlanding.page`.
  A live sample filled five pages in about eight seconds and promoted the loaded
  document in 51 ms. These are measured examples, not network-speed guarantees.
