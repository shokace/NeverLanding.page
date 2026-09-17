export function publicUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host)) return null;
    if (/\.(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)) return null;
    url.hostname = host;
    url.hash = '';
    return url;
  } catch { return null; }
}

