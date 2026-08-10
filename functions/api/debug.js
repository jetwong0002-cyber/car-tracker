import { neon } from '@neondatabase/serverless';

export async function onRequestGet(context) {
  const out = {};
  try {
    const sql = neon(context.env.DATABASE_URL);

    // 测试1:数据库连得上吗
    await sql.query('SELECT 1');
    out.db_connect = true;

    // 测试2:track_points 表存在吗
    const t = await sql.query("SELECT to_regclass('public.track_points') AS tbl");
    const row = Array.isArray(t) ? t[0] : t.rows?.[0];
    out.table_exists = row?.tbl !== null;

    // 测试3:能查吗
    if (out.table_exists) {
      const c = await sql.query('SELECT count(*) AS n FROM track_points');
      const crow = Array.isArray(c) ? c[0] : c.rows?.[0];
      out.row_count = Number(crow?.n);
    }
  } catch (e) {
    out.error = String(e?.message || e);
  }
  return new Response(JSON.stringify(out), {
    headers: { 'Content-Type': 'application/json' },
  });
}
