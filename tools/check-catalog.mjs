import {supplementalSites} from '../lib/discovery.js';
import {publicUrl, inspectUrl} from '../lib/safety.js';
import fs from 'node:fs';
const duplicates = supplementalSites.filter((host,i) => supplementalSites.indexOf(host) !== i);
if (duplicates.length) throw new Error('Duplicate catalog entries');
for (const host of supplementalSites) if (!publicUrl(`https://${host}`)) throw new Error(`Invalid catalog host: ${host}`);
console.log(`${supplementalSites.length} supplemental sites across ${new Set(supplementalSites.map(host => host.split('.').at(-1))).size} TLDs`);
if (process.argv.includes('--live')) {
  const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1]) || supplementalSites.length;
  const results = [];
  let index = 0;
  await Promise.all(Array.from({length:4}, async () => {
    while (index < Math.min(limit, supplementalSites.length)) {
      const host = supplementalSites[index++];
      const entry = await inspectUrl(`https://${host}/`, {requireEmbed:false});
      results.push({host, ...entry, accepted:Boolean(entry)});
    }
  }));
  fs.writeFileSync('/tmp/neverlanding-catalog-check.json', JSON.stringify(results,null,2));
  console.log(JSON.stringify({checked:results.length,accepted:results.filter(r => r.accepted).length,embeddable:results.filter(r => r.embeddable).length}));
}
