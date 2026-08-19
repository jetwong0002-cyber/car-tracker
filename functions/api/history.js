// GET /api/history?token=xxx&days=7&veh=JUP2821
// token 可以是 VIEW_PASSWORD(看图密码)或 TRACK_TOKEN(长钥匙),二者皆可读
// &list=vehicles 返回车辆清单
// &day=YYYY-MM-DD 查某一天(按马来西亚时间 UTC+8 切界)
// &latest=1       返回最后一个上报点(车现在在哪)

import { neon } from '@neondatabase/serverless';

// 数据库存的是 timestamptz,Neon 会话默认 UTC。用户在马来西亚(UTC+8),
// 直接 $1::date 切界会把当地凌晨 0~8 点的行程算到前一天去,所以显式带上时区。
const TZ = '+08:00';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const given = url.searchParams.get('token') || '';
  const ok = (env.VIEW_PASSWORD && given === env.VIEW_PASSWORD) || given === env.TRACK_TOKEN;
  if (!ok) return json({ error: 'unauthorized' }, 401);

  const sql = neon(env.DATABASE_URL);
  // 空字符串当成"不筛选",否则会拿 '' 去比对导致查不到任何点
  const vehicle = url.searchParams.get('veh') || null;

  // 车辆清单(给前端 dropdown 用);老数据可能有 NULL,滤掉免得下拉出现空白项
  if (url.searchParams.get('list') === 'vehicles') {
    const vs = await sql(
      `SELECT DISTINCT vehicle FROM track_points WHERE vehicle IS NOT NULL ORDER BY vehicle`
    );
    return json({ vehicles: vs.map(r => r.vehicle) });
  }

  // 最后一个点:前端用来显示"车在哪 / 多久前上报"
  if (url.searchParams.get('latest') === '1') {
    const rs = await sql(
      `SELECT recorded_at, lat, lng, speed, battery, vehicle
         FROM track_points
        WHERE ($1::text IS NULL OR vehicle = $1)
        ORDER BY recorded_at DESC
        LIMIT 1`,
      [vehicle]
    );
    return json({ latest: rs[0] || null });
  }

  const day = url.searchParams.get('day');
  let rows;

  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    rows = await sql(
      `SELECT recorded_at, lat, lng, speed, motion
         FROM track_points
        WHERE recorded_at >= ($1 || 'T00:00:00${TZ}')::timestamptz
          AND recorded_at <  ($1 || 'T00:00:00${TZ}')::timestamptz + interval '1 day'
          AND ($2::text IS NULL OR vehicle = $2)
        ORDER BY recorded_at`,
      [day, vehicle]
    );
  } else {
    const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '1', 10), 1), 30);
    rows = await sql(
      `SELECT recorded_at, lat, lng, speed, motion
         FROM track_points
        WHERE recorded_at >= now() - ($1 || ' days')::interval
          AND ($2::text IS NULL OR vehicle = $2)
        ORDER BY recorded_at`,
      [String(days), vehicle]
    );
  }

  // 拆段:两点间隔超过 10 分钟断开;每段记录起止时间
  const GAP_MS = 10 * 60 * 1000;
  const segments = [];
  let cur = null;
  let prevT = null;

  for (const r of rows) {
    const t = new Date(r.recorded_at).getTime();
    if (cur === null || (prevT !== null && t - prevT > GAP_MS)) {
      if (cur && cur.coords.length >= 2) segments.push(cur);
      cur = { coords: [], start: r.recorded_at, end: r.recorded_at };
    }
    cur.coords.push([r.lng, r.lat]);
    cur.end = r.recorded_at;
    prevT = t;
  }
  if (cur && cur.coords.length >= 2) segments.push(cur);

  const geojson = {
    type: 'FeatureCollection',
    features: segments.map(s => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: s.coords },
      properties: { start: s.start, end: s.end },
    })),
  };

  return json({ points: rows.length, geojson });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
