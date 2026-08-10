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
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 按时间查询 + 按时间删除都靠这个索引,30 天清理才够快
CREATE INDEX IF NOT EXISTS idx_track_points_recorded_at
  ON track_points (recorded_at);
