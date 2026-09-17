import catalog from '../public/data/achievements.json' with {type: 'json'};
import {publicUrl} from './url.js';

export const definitions = catalog.achievements;
export const countryCodes = definitions.filter(a => a.country && a.available !== false).map(a => a.code);

export function visitTld(value) { return publicUrl(value)?.hostname.split('.').at(-1) || ''; }

export function earnedCodes({visits = 0, urls = [], unlocked = [], loggedIn = true, shares = 0}) {
  const earned = new Set(unlocked);
  const tlds = new Set(urls.map(visitTld).filter(Boolean));
  // Evaluate TLDs before the passport: its last flag must unlock on this visit.
  for (const a of definitions) {
    if (a.available === false) continue;
    const rule = a.rule;
    if ((rule.type === 'tld' && tlds.has(rule.value)) ||
        (rule.type === 'visits' && visits >= rule.value) ||
        (rule.type === 'login' && loggedIn) ||
        (rule.type === 'share' && shares >= rule.value)) earned.add(a.code);
  }
  for (const a of definitions) if (a.rule.type === 'passport' && visits >= a.rule.value && countryCodes.every(code => earned.has(code))) earned.add(a.code);
  return [...earned];
}

// Ordered visits let us keep the actual supporting landing for each new award.
export function achievementSource(definition, visits, {shareUrl = null} = {}) {
  const rule = definition.rule;
  if (rule.type === 'tld') return visits.find(row => visitTld(row.url) === rule.value)?.url || null;
  if (rule.type === 'visits') return visits[rule.value - 1]?.url || null;
  if (rule.type === 'share') return shareUrl;
  if (rule.type === 'passport') {
    const first = new Map();
    visits.forEach((row, index) => {const code = `tld_${visitTld(row.url)}`; if (!first.has(code)) first.set(code, index);});
    if (!countryCodes.every(code => first.has(code))) return null;
    const index = Math.max(rule.value - 1, ...countryCodes.map(code => first.get(code)));
    return visits[index]?.url || null;
  }
  return null;
}

export async function syncAchievements(env, userId, {share = false, shareUrl = null} = {}) {
  const [visitsResult, awards] = await Promise.all([
    env.DB.prepare('SELECT url FROM visits WHERE user_id = ? ORDER BY visited_at, id').bind(userId).all(),
    env.DB.prepare('SELECT a.code FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id WHERE ua.user_id = ?').bind(userId).all()
  ]);
  const visits = visitsResult.results || [];
  const old = new Set((awards.results || []).map(row => row.code));
  const codes = earnedCodes({visits: visits.length, urls: visits.map(row => row.url), unlocked: [...old], shares: share ? 1 : 0});
  const statements = codes.filter(code => !old.has(code)).map(code => {
    const source = achievementSource(definitions.find(a => a.code === code), visits, {shareUrl});
    return env.DB.prepare(
      'INSERT OR IGNORE INTO user_achievements (id, user_id, achievement_id, source_url) SELECT ?, ?, id, ? FROM achievements WHERE code = ?'
    ).bind(crypto.randomUUID(), userId, source, code);
  });
  if (statements.length) await env.DB.batch(statements);
  return codes;
}
