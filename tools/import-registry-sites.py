"""Add official registry destinations whose own hostname uses a collectible TLD.
Source URLs are retained so unusual ccTLD additions can be audited; never guess hosts.
All imported destinations still pass the live discovery filters.
"""
import concurrent.futures, html, json, re, urllib.request, urllib.parse
from pathlib import Path

def fetch(tld):
    source = 'https://www.iana.org/domains/root/db/' + tld + '.html'
    try:
        request = urllib.request.Request(source, headers={'User-Agent': 'NeverLanding catalog maintenance'})
        with urllib.request.urlopen(request, timeout=15) as response:
            text = response.read().decode()
        match = re.search(r'URL for registration services:</b>\s*<a href="([^"]+)"', text)
        if not match:return None
        parsed = urllib.parse.urlsplit(html.unescape(match.group(1)))
        host = (parsed.hostname or '').lower()
        if host.endswith('.'+tld):return {'tld':tld, 'host':host, 'source':source}
    except Exception:return None

definitions=json.loads(Path('public/data/achievements.json').read_text())['achievements']
tlds=[a['rule']['value'] for a in definitions if a['rule']['type']=='tld' and a.get('available',True)]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    sites=sorted(filter(None,pool.map(fetch,tlds)),key=lambda row:row['tld'])
Path('public/data/registry-sites.json').write_text(json.dumps({'verified':'2026-09-17','sites':sites},indent=2)+'\n')
print('Imported',len(sites),'official registry hosts using their own collectible TLD')
