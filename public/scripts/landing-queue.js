// Own the actual iframe nodes. Promotion changes visibility in place: moving or
// recreating an iframe would reload the document and defeat preloading.
export class LandingQueue {
  constructor({container, target = 5, concurrency = 3, fetcher = (...args) => fetch(...args), onChange = () => {}, pageTimeout = 15000, requestTimeout = 25000, readyTtl = 5 * 60 * 1000}) {
    Object.assign(this, {container, target, concurrency, fetcher, onChange, pageTimeout, requestTimeout, readyTtl});
    this.entries = [];
    this.pending = 0;
    this.reserved = new Set();
    this.recent = [];
    this.waiters = new Set();
    this.failures = 0;
    this.closed = false;
  }
  get readyCount() { return this.entries.length; }
  notify() {
    this.onChange({ready: this.entries.length, loading: this.pending, target: this.target});
    for (const wake of this.waiters) wake();
  }
  start() { this.expire(); this.fill(); }
  expire() {
    const now = Date.now();
    this.entries = this.entries.filter(entry => {
      if (now - entry.queuedAt < this.readyTtl) return true;
      entry.frame.remove();
      this.frames.delete(entry.frame);
      this.reserved.delete(new URL(entry.url).origin);
      return false;
    });
    this.scheduleExpiry();
  }
  scheduleExpiry() {
    clearTimeout(this.expiryTimer);
    if (this.closed || !this.entries.length) return;
    const expires = Math.min(...this.entries.map(entry => entry.queuedAt + this.readyTtl));
    this.expiryTimer = setTimeout(() => {this.expire(); this.fill();}, Math.max(1, expires - Date.now()));
  }
  fill() {
    if (this.closed || this.retryTimer) return;
    while (this.entries.length + this.pending < this.target && this.pending < this.concurrency) {
      this.pending++;
      this.prepare().then(entry => {
        if (this.closed) {entry.frame.remove(); return;}
        this.entries.push(entry);
        this.scheduleExpiry();
        this.failures = 0;
      }).catch(() => {
        this.failures++;
        if (!this.closed && !this.retryTimer) this.retryTimer = setTimeout(() => {
          this.retryTimer = null; this.fill();
        }, Math.min(30000, 1000 * 2 ** Math.min(this.failures - 1, 5)));
      }).finally(() => {
        this.pending--; this.notify(); this.fill();
      });
    }
    this.notify();
  }
  async prepare() {
    const controller = new AbortController();
    const requestTimer = setTimeout(() => controller.abort(), this.requestTimeout);
    this.controllers ??= new Set();
    this.controllers.add(controller);
    let entry;
    try {
      const query = new URLSearchParams();
      for (const url of [...this.recent.slice(-15), ...this.reserved]) query.append('exclude', url);
      const response = await this.fetcher(`/api/random?${query}`, {cache: 'no-store', signal: controller.signal});
      if (!response.ok) throw new Error('Discovery unavailable');
      entry = await response.json();
    } finally {
      clearTimeout(requestTimer); this.controllers.delete(controller);
    }
    const parsed = new URL(entry.url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) throw new Error('Invalid destination');
    const key = parsed.origin;
    if (this.closed || this.reserved.has(key) || this.recent.some(url => new URL(url).origin === key)) throw new Error('Duplicate destination');
    this.reserved.add(key);
    const frame = document.createElement('iframe');
    frame.className = 'preloaded-frame';
    frame.title = 'Queued website preview';
    frame.setAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin allow-popups');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', "autoplay 'none'; camera 'none'; microphone 'none'; geolocation 'none'");
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.inert = true;
    this.frames ??= new Set(); this.frames.add(frame);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('Preview timed out')), this.pageTimeout);
        const finish = error => {
          clearTimeout(timer); frame.onload = null; frame.onerror = null;
          this.cancellations.delete(cancel);
          if (error) reject(error); else resolve();
        };
        const cancel = () => finish(new Error('Queue closed'));
        this.cancellations ??= new Set(); this.cancellations.add(cancel);
        frame.onload = () => {
          // Same-origin blank/error documents are not prepared destinations.
          try {
            if (frame.contentWindow.location.href === 'about:blank') return;
            if (frame.contentWindow.location.href.startsWith('chrome-error:')) return finish(new Error('Preview blocked'));
          } catch { /* Expected for third-party pages. */ }
          finish();
        };
        frame.onerror = () => finish(new Error('Preview failed'));
        frame.src = parsed.href;
        this.container.appendChild(frame);
      });
      return {...entry, url: parsed.href, frame, queuedAt: Date.now()};
    } catch (error) {
      frame.remove(); this.frames.delete(frame); this.reserved.delete(key); throw error;
    }
  }
  async take(signal) {
    const deadline = Date.now() + 30000;
    this.fill();
    while (!this.closed) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      // Do not activate indefinitely stale pages after a long idle session.
      while (this.entries.length) {
        const entry = this.entries.shift();
        this.reserved.delete(new URL(entry.url).origin);
        this.frames.delete(entry.frame);
        if (Date.now() - entry.queuedAt >= this.readyTtl) { entry.frame.remove(); continue; }
        this.recent.push(entry.url); this.recent = this.recent.slice(-20);
        this.scheduleExpiry();
        this.fill(); return entry;
      }
      this.fill();
      if (Date.now() >= deadline) throw new Error('The next pages are still loading. Please try again.');
      await new Promise((resolve, reject) => {
        const wake = () => {cleanup(); resolve();};
        const abort = () => {cleanup(); reject(new DOMException('Stopped', 'AbortError'));};
        const timeout = setTimeout(() => {cleanup(); reject(new Error('The next pages are still loading. Please try again.'));}, Math.max(1, deadline - Date.now()));
        const cleanup = () => {clearTimeout(timeout); this.waiters.delete(wake); signal?.removeEventListener('abort', abort);};
        this.waiters.add(wake); signal?.addEventListener('abort', abort, {once: true});
      });
    }
    throw new DOMException('Queue closed', 'AbortError');
  }
  close() {
    this.closed = true; clearTimeout(this.retryTimer); clearTimeout(this.expiryTimer);
    this.controllers?.forEach(c => c.abort());
    this.cancellations?.forEach(cancel => cancel());
    this.frames?.forEach(frame => frame.remove());
    this.entries = []; this.reserved.clear(); this.notify();
  }
}
