export async function onRequestGet(context) {
  const stored = context.env.TRACK_TOKEN || '';
  const url = new URL(context.request.url);
  const given = url.searchParams.get('token') || '';

  // 找出第一个不一样的位置
  let diffAt = -1;
  const max = Math.max(stored.length, given.length);
  for (let i = 0; i < max; i++) {
    if (stored[i] !== given[i]) { diffAt = i; break; }
  }

  return new Response(JSON.stringify({
    match: stored === given,          // 这个是终极答案
    stored_length: stored.length,
    given_length: given.length,
    first_diff_at: diffAt,            // -1 = 完全一致
    stored_around_diff: diffAt >= 0 ? stored.slice(Math.max(0, diffAt-3), diffAt+4) : null,
    given_around_diff:  diffAt >= 0 ? given.slice(Math.max(0, diffAt-3), diffAt+4) : null,
  }), { headers: { 'Content-Type': 'application/json' } });
}
