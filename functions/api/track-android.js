// GET/POST /api/track-android?token=xxx&lat=..&lon=..&time=..&spd=..&alt=..&acc=..&batt=..
// 接收 Android 车机上 GPSLogger 的 Custom URL 上报,存进同一张 track_points 表
// GPSLogger 里 URL 模板填:
// https://你的项目.pages.dev/api/track-android?token=你的TOKEN&lat=%LAT&lon=%LON&time=%TIME&spd=%SPD&alt=%ALT&acc=%ACC&batt=%BATT

import { neon } from '@neondatabase/serverless';

async function handle(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const p = url.searchParams;

  if (p.get('token') !== env.TRACK_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }

  const lat = parseFloat(p.get('lat'));
  const lng = parseFloat(p.get('lon'));
  // %TIME 是 ISO 8601 (UTC);没有就用服务器当前时间兜底
  const time = p.get('time') || new Date().toISOString();

  if (!isFinite(lat) || !isFinite(lng)) {
    return json({ error: 'missing lat/lon' }, 400);
  }

  const num = (k) => {
    const v = parseFloat(p.get(k));
    return isFinite(v) ? v : null;
  };

  const vehicle = (p.get('veh') || 'default').toUpperCase().slice(0, 20);
  const sql = neon(env.DATABASE_URL);
  await sql(
    `INSERT INTO track_points
       (recorded_at, lat, lng, speed, altitude, h_accuracy, motion, battery, vehicle)
     VALUES ($1, $2, $3, $4, $5, $6, 'car_unit', $7, $8)`,
    [time, lat, lng, num('spd'), num('alt'), num('acc'), num('batt'), vehicle]
  );

  // 滚动清理 30 天(单点插入很频繁,1% 概率触发一次就够,省数据库调用)
  if (Math.random() < 0.01) {
    await sql(
      `DELETE FROM track_points WHERE recorded_at < now() - interval '30 days'`
    );
  }

  return json({ result: 'ok' });
}

export const onRequestGet = handle;
export const onRequestPost = handle;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
