// POST /api/track?token=xxx
// 接收 Overland app 批量上报的 GPS 点,写入 Neon,并顺手删掉 30 天前的旧数据
// 环境变量: DATABASE_URL (Neon 连接串), TRACK_TOKEN (自己随便生成的长密码)

import { neon } from '@neondatabase/serverless';

export async function onRequestPost(context) {
  const { request, env } = context;

  // --- 鉴权:URL 里的 token 必须匹配 ---
  const url = new URL(request.url);
  if (url.searchParams.get('token') !== env.TRACK_TOKEN) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const locations = Array.isArray(body?.locations) ? body.locations : [];
  const sql = neon(env.DATABASE_URL);

  if (locations.length > 0) {
    // Overland 每个点是 GeoJSON Feature:
    // { geometry: { coordinates: [lng, lat] }, properties: { timestamp, speed, ... } }
    const rows = locations
      .filter(f => f?.geometry?.coordinates?.length === 2 && f?.properties?.timestamp)
      .map(f => ({
        recorded_at: f.properties.timestamp,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        speed: f.properties.speed ?? null,
        altitude: f.properties.altitude ?? null,
        h_accuracy: f.properties.horizontal_accuracy ?? null,
        motion: Array.isArray(f.properties.motion) ? f.properties.motion.join(',') : null,
        battery: f.properties.battery_level ?? null,
      }));

    // 批量插入(一次最多几百个点,拼一条 INSERT 就行)
    if (rows.length > 0) {
      const values = [];
      const params = [];
      rows.forEach((r, i) => {
        const o = i * 8;
        values.push(`($${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5}, $${o+6}, $${o+7}, $${o+8})`);
        params.push(r.recorded_at, r.lat, r.lng, r.speed, r.altitude, r.h_accuracy, r.motion, r.battery);
      });
      await sql(
        `INSERT INTO track_points
           (recorded_at, lat, lng, speed, altitude, h_accuracy, motion, battery)
         VALUES ${values.join(',')}`,
        params
      );
    }

    // --- 滚动清理:顺手删 30 天前的点(有索引,毫秒级) ---
    await sql(
      `DELETE FROM track_points WHERE recorded_at < now() - interval '30 days'`
    );
  }

  // Overland 要求收到 {"result":"ok"} 才认为上报成功,否则会一直重试
  return json({ result: 'ok' });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
