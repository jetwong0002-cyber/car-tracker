// GET /api/history?token=xxx&days=7&veh=JUP2821
// token 可以是 VIEW_PASSWORD(看图密码)或 TRACK_TOKEN(长钥匙),二者皆可读
// &list=vehicles 返回车辆清单

import { neon } from '@neondatabase/serverless';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const given = url.searchParams.get('token') || '';
  const ok = (env.VIEW_PASSWORD && given === env.VIEW_PASSWORD) || given === env.TRACK_TOKEN;
  if (!ok) return json({ error: 'unauthorized' }, 401);

  const sql = neon(env.DATABASE_URL);
  const vehicle = url.searchParams.get('veh');

  // 车辆清单(给前端 dropdown 用)
  if (url.searchParams.get('list') === 'vehicles') {
    const vs = await sql(`SELECT DISTINCT vehicle FROM track_points ORDER BY vehicle`);
    return json({ vehicles: vs.map(r => r.vehicle) });
  }

  const day = url.searchParams.get('day');
  let rows;

  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    rows = await sql(
      `SELECT recorded_at, lat, lng, speed, motion
         FROM track_points
        WHERE recorded_at >= $1::date
          AND recorded_at <  $1::date + interval '1 day'
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
