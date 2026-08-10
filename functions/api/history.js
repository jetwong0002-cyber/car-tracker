// GET /api/history?token=xxx&day=2026-08-10   → 某一天的轨迹
// GET /api/history?token=xxx&days=7           → 最近 N 天(默认 1,最多 30)
// 返回 GeoJSON,直接喂给地图

import { neon } from '@neondatabase/serverless';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (url.searchParams.get('token') !== env.TRACK_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }

  const sql = neon(env.DATABASE_URL);
  const day = url.searchParams.get('day'); // YYYY-MM-DD
  let rows;

  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    rows = await sql(
      `SELECT recorded_at, lat, lng, speed, motion
         FROM track_points
        WHERE recorded_at >= $1::date
          AND recorded_at <  $1::date + interval '1 day'
        ORDER BY recorded_at`,
      [day]
    );
  } else {
    const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '1', 10), 1), 30);
    rows = await sql(
      `SELECT recorded_at, lat, lng, speed, motion
         FROM track_points
        WHERE recorded_at >= now() - ($1 || ' days')::interval
        ORDER BY recorded_at`,
      [String(days)]
    );
  }

  // 拆段:两点间隔超过 10 分钟就断开(不然停车后地图上会拉一条直线)
  const GAP_MS = 10 * 60 * 1000;
  const segments = [];
  let current = [];
  let prevTime = null;

  for (const r of rows) {
    const t = new Date(r.recorded_at).getTime();
    if (prevTime !== null && t - prevTime > GAP_MS && current.length > 0) {
      segments.push(current);
      current = [];
    }
    current.push([r.lng, r.lat]);
    prevTime = t;
  }
  if (current.length > 0) segments.push(current);

  const geojson = {
    type: 'FeatureCollection',
    features: segments
      .filter(s => s.length >= 2)
      .map(coords => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {},
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
