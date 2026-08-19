-- 在 Neon SQL Editor 里跑一次即可
CREATE TABLE IF NOT EXISTS track_points (
  id          BIGSERIAL PRIMARY KEY,
  recorded_at TIMESTAMPTZ NOT NULL,      -- GPS 点的时间(Overland 提供)
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  speed       REAL,                      -- m/s,-1 表示未知
  altitude    REAL,
  h_accuracy  REAL,                      -- 水平精度(米),越小越准
  motion      TEXT,                      -- driving / walking / stationary...
  battery     REAL,
  vehicle     TEXT,                      -- 车辆标识(上报 URL 的 &veh=),前端按它筛选
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 按时间查询 + 按时间删除都靠这个索引,30 天清理才够快
CREATE INDEX IF NOT EXISTS idx_track_points_recorded_at
  ON track_points (recorded_at);

-- ---------------------------------------------------------------
-- 已有库的迁移:早期版本没有 vehicle 列,iPhone 上报的点也没写车辆。
-- 这两句可重复执行,库里已经有 vehicle 列的话第一句是空操作。
-- ---------------------------------------------------------------
ALTER TABLE track_points ADD COLUMN IF NOT EXISTS vehicle TEXT;
UPDATE track_points SET vehicle = 'IPHONE' WHERE vehicle IS NULL;
