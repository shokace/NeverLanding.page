// Public names cannot be email addresses, HTML, control characters, or URLs.
export function isPublicUsername(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value);
}
export async function leaderboardResponse(env) {
  try {
    // Never SELECT users.*: private account fields must not enter this response.
    const {results = []} = await env.DB.prepare(`
      SELECT users.username AS username, totals.visits AS visits
      FROM user_visit_totals AS totals JOIN users ON users.id = totals.user_id
      WHERE totals.visits > 0 AND length(users.username) BETWEEN 1 AND 32
        AND users.username NOT GLOB '*[^A-Za-z0-9_-]*'
      ORDER BY totals.visits DESC, totals.user_id ASC LIMIT 100
    `).all();
    let rank = 0, previous;
    const items = results.filter(row => isPublicUsername(row.username)).map((row,index) => {
      const visits = Number(row.visits);
      if (visits !== previous) rank = index + 1;
      previous = visits;
      return {rank, username:row.username, visits};
    });
    const response = Response.json({items}, {headers:{
      'cache-control':'no-store', 'x-content-type-options':'nosniff',
    }});
    return response;
  } catch {
    return Response.json({error:'The leaderboard is temporarily unavailable.'}, {status:503,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  }
}
