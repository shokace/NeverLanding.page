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

export async function syncAchievements(env, userId, {share = false} = {}) {
  const [count, urls, awards] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM visits WHERE user_id = ?').bind(userId).first(),
    env.DB.prepare('SELECT DISTINCT url FROM visits WHERE user_id = ?').bind(userId).all(),
    env.DB.prepare('SELECT a.code FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id WHERE ua.user_id = ?').bind(userId).all()
  ]);
  const old = new Set((awards.results || []).map(row => row.code));
  const codes = earnedCodes({visits: count?.count || 0, urls: (urls.results || []).map(row => row.url), unlocked: [...old], shares: share ? 1 : 0});
  const statements = codes.filter(code => !old.has(code)).map(code => env.DB.prepare(
    'INSERT OR IGNORE INTO user_achievements (id, user_id, achievement_id) SELECT ?, ?, id FROM achievements WHERE code = ?'
  ).bind(crypto.randomUUID(), userId, code));
  if (statements.length) await env.DB.batch(statements);
  return codes;
}
