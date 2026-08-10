export async function onRequestGet(context) {
  const t = context.env.TRACK_TOKEN || '';
  return new Response(JSON.stringify({
    token_set: t.length > 0,          // 变量存在吗
    token_length: t.length,           // 长度
    token_start: t.slice(0, 4),       // 开头4个字符
    token_end: t.slice(-4),           // 结尾4个字符
    has_whitespace: t !== t.trim(),   // 头尾藏了空格/换行吗
    db_set: Boolean(context.env.DATABASE_URL),
  }), { headers: { 'Content-Type': 'application/json' } });
}
