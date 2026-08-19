# car-tracker 修复与优化方案（第一期）

> 本文件自包含：不需要任何对话上下文，读完本文件和仓库代码即可动工。
> 执行者：Claude（Opus）。逐条完成 P0 → P1，P2 可选。完成后按「验收清单」自查。

## 背景与架构（60 秒版）

个人行车轨迹记录项目，马来西亚使用（时区 UTC+8）：

- **上报端**：iPhone 上的 Overland app → `POST /api/track`（GeoJSON 批量）；Android 车机 GPSLogger → `GET/POST /api/track-android`（URL 参数单点）
- **后端**：Cloudflare Pages Functions（`functions/api/*.js`），数据存 Neon Postgres（`@neondatabase/serverless`），表见 `schema.sql`，数据滚动保留 30 天（上报时顺手 DELETE）
- **前端**：`public/index.html` 单文件 vanilla JS + Leaflet，深色 carto 底图，行程按 10 分钟间隔在服务端拆段，支持 OSRM 公共服务贴路
- **鉴权**：环境变量 `TRACK_TOKEN`（上报+查看）、`VIEW_PASSWORD`（仅查看），token 走 URL query
- **部署**：push 到 GitHub main 即自动部署 Cloudflare Pages

## 执行须知（重要，先读）

1. **线上数据库是 Neon，schema 变更代码改不动它**。涉及数据库的改动要把 SQL 写进 `schema.sql`（保持可重放，用 `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`），并在本文件末尾「需要手动执行的 SQL」一节列出，由用户自己去 Neon SQL Editor 跑。
2. **不要破坏已在设备上配好的 URL**：车机 GPSLogger 和 iPhone Overland 的 endpoint URL 已经写死在设备里。所有新增 URL 参数必须**可选、带默认值**，老 URL 打进来必须照常工作。
3. **Overland 的重试语义**：`/api/track` 必须返回 `{"result":"ok"}` 它才认为成功，否则无限重试——别改这个响应结构。
4. **保持现有代码风格**：单文件、无构建步骤、无框架、中文注释。不要引入 npm 前端依赖，Leaflet 继续走 CDN。
5. **git 规范**：author 是用户本人，**commit 不加任何 Co-Authored-By trailer**。仓库当前是 public，**绝不能提交任何真实 token**。全部改完、自查通过后再一次性 push（push 即触发线上部署）。
6. 本地没有可连的数据库，改动靠代码审查 + 逻辑推演自查；前端纯 UI 部分可以本地起静态服务器 mock `/api/history` 看效果（可选）。

---

## P0 — 缺陷修复（必做）

### P0-1 删除无鉴权的 debug 端点

`functions/api/debug.js` 没有任何 token 校验，公网可访问，暴露数据库连通性、总行数，出错时还会返回原始错误信息。**直接删除该文件**。

### P0-2 schema.sql 补上 vehicle 列

`history.js`（`SELECT DISTINCT vehicle`、`WHERE vehicle = $2`）和 `track-android.js`（INSERT 含 vehicle）都在用 `vehicle` 列，但 `schema.sql` 里没有——按这份脚本重建数据库会直接报错。修改 `schema.sql`：

- `CREATE TABLE` 里加 `vehicle TEXT`（放 battery 之后即可）
- 文件末尾追加一段“已有库的迁移”注释块，内容见「需要手动执行的 SQL」

### P0-3 iPhone 上报路径写入 vehicle

`functions/api/track.js` 插入时没有 vehicle 字段，Overland 来的点全是 NULL。后果：前端车辆下拉出现空白选项（选中查不到任何东西）、iPhone 轨迹无法单独筛选。

改法（对齐 `track-android.js` 的做法）：

- 从 URL 读可选参数 `veh`：`const vehicle = (url.searchParams.get('veh') || 'IPHONE').toUpperCase().slice(0, 20);`
- INSERT 列表加上 `vehicle`（注意批量插入的占位符步长要从 8 改 9）
- `SETUP.md` 里 Overland 的 Receiver Endpoint URL 示例改为 `.../api/track?token=...&veh=IPHONE`

### P0-4 “今天”语义 + 单日查询时区

两个问题一起修：

**(a) 前端**：现在“今天”传 `days=1`，实际是“过去 24 小时”，早上打开会混入昨晚的行程。API 早已支持 `day=YYYY-MM-DD`（`history.js`）但前端没用。改 `public/index.html` 的控制条：

- `#days` 下拉改为：`今天`（→ `day=当地今天`）、`昨天`（→ `day=当地昨天`）、`最近3天`、`最近7天`、`最近30天`（后三个仍走 `days=`）
- 再加一个 `<input type="date" id="pickDay">`（样式对齐现有 select），选了具体日期就优先走 `day=`，并把下拉重置回占位状态（或两者互斥，实现从简，交互别绕）
- “当地今天”用浏览器本地时间算（用户就在马来西亚），注意别用 `toISOString()` 直接截断——那是 UTC，会差 8 小时。用 `new Date()` 的本地 年/月/日 拼 `YYYY-MM-DD`

**(b) 后端**：`history.js` 的单日查询用 `$1::date` 切界，Neon 默认时区 UTC，马来西亚早上 8 点前的行程会被切到前一天。改为按 +08:00 切界：

```sql
WHERE recorded_at >= ($1 || 'T00:00:00+08:00')::timestamptz
  AND recorded_at <  ($1 || 'T00:00:00+08:00')::timestamptz + interval '1 day'
```

### P0-5 登录框键盘

`public/index.html` 登录输入框有 `inputmode="numeric"`，手机会调出纯数字键盘，但 token 是随机字符串。删掉该属性。

---

## P1 — 核心体验提升（必做）

### P1-1 行程列表面板

现状：想知道有哪些行程只能挨个点地图上的线。目标：一屏看清当天所有行程。

- 前端新增一个可折叠面板：手机上是底部抽屉（收起时只露一条把手/摘要行），桌面上是左侧或右下卡片；风格沿用现有 `--card` 玻璃拟态变量
- 每行显示：`行程 N · 08:12 → 08:43 · 12.4 km · 31 min · 均速 24 km/h`
- 里程用页面里现成的 `distM()` 对原始坐标逐点累加（**用贴路前的原始 coords 算**，贴路结果会改变长度）；时长 = end − start；均速 = 里程/时长
- 点击一行：`map.fitBounds` 到该段并打开它的 popup；当前选中行高亮
- 数据来源就是现有 `/api/history` 返回的 features，不需要新 API

### P1-2 行程 popup 补里程/时长/均速

P1-1 算出的数字同样塞进每段线的 popup（现在只有出发/到达时间）。

### P1-3 最新位置（“车在哪”）

现在的 ◎ 按钮定位的是**看图的人**，不是车。加“找车”能力：

- **后端** `history.js`：支持 `?latest=1`（可与 `veh=` 组合），返回最后一个点：`{ latest: { recorded_at, lat, lng, speed, vehicle, battery } }`（按 recorded_at 倒序 LIMIT 1）
- **前端**：登录后自动请求一次，在地图上画一个区别于起终点的车辆标记（可复用 `.me-pulse` 思路换个颜色），popup 显示“最后上报：x 分钟前 · 电量 xx%”；相对时间前端算
- 控制条加一个“自动刷新”开关：开启后每 60 秒重新拉 latest（只拉 latest，不重拉整个轨迹），标记原地更新；页面不可见时（`document.hidden`）暂停，退出登录时停止并清除。注意复用现有 `gen` 代号机制防止退出后旧请求回写

### P1-4 停车点标记

相邻两段行程之间就是一次停车（数据已有，纯前端算）：

- 对 features 按 start 排序，第 i 段终点与第 i+1 段起点之间：在第 i 段终点位置画一个 P 标记（divIcon，样式对齐 `.ep`），popup 显示“停车 · 2 小时 15 分（08:43 → 10:58）”
- 停车时长 < 10 分钟的不画（跟服务端 10 分钟拆段阈值呼应，避免噪音）

### P1-5 长轨迹性能兜底

看 30 天轨迹时箭头 marker 会有几百上千个 DOM 节点。两个小改动：

- `L.map('map', { zoomControl: false, preferCanvas: true })`
- 全局箭头总数设上限（比如所有段合计 ≤ 120 个：段数多时每段少画甚至不画箭头）

---

## P2 — 可选增强（时间富余再做，按序）

1. **浅色主题切换**：控制条加个 ☀/🌙 按钮，切换 carto `dark_all`/`light_all` 底图 + 一套浅色 CSS 变量，记住选择（localStorage）
2. **统计卡片**：行程列表面板顶部加一行汇总：当日总里程 / 总时长 / 行程数（P1-1 的数字求和即得，不需要新 API）
3. **PWA service worker**：manifest 已有；加一个最简 SW 缓存静态 shell（index.html + CDN 资源不缓存也行），让“添加到主屏幕”真正可用

**明确不做**（本期范围外，别顺手加）：速度着色、行程回放、热力图、Telegram 提醒、GPX 导出、只读分享链接、里程归档表。

---

## 需要手动执行的 SQL（交付时原样提示用户去 Neon SQL Editor 跑）

```sql
ALTER TABLE track_points ADD COLUMN IF NOT EXISTS vehicle TEXT;
UPDATE track_points SET vehicle = 'IPHONE' WHERE vehicle IS NULL;
```

（如果线上库早已有 vehicle 列，第一句是 no-op，无害。）

## 验收清单

- [ ] `functions/api/debug.js` 已删除
- [ ] `schema.sql` 从零建库后，四个 API 的每条 SQL 语句引用的列都存在（逐条核对）
- [ ] 老的上报 URL（不带 veh 参数）打到 `/api/track` 和 `/api/track-android` 仍然 2xx 且 `/api/track` 返回 `{"result":"ok"}`
- [ ] `/api/track` 批量插入的占位符编号与参数数组一一对应（步长 9，手工数一遍）
- [ ] 选“今天”只包含当地日历今天的行程；`day=` 查询边界按 +08:00 切
- [ ] 前端拼 `YYYY-MM-DD` 没有用 `toISOString()`（UTC 陷阱）
- [ ] 行程列表数字（里程/时长/均速）与 popup 一致，且用原始坐标而非贴路结果计算
- [ ] 退出登录后：轨迹、行程列表、最新位置标记、自动刷新定时器全部清除（对照现有 `clearToken()` 的 gen 机制）
- [ ] 自动刷新在页面隐藏时暂停、退出后不再发请求
- [ ] 全部 commit 无 Co-Authored-By trailer，无任何真实 token 入库
- [ ] SETUP.md 已同步：Overland URL 带 `&veh=`、删除 debug 相关描述（如有）、手动 SQL 提示

## 交付物

1. 一次性 push 的完整改动（P0 + P1，P2 视情况）
2. 给用户的一段话：需要去 Neon 跑的 SQL、Overland 里 URL 要加的 `&veh=IPHONE`、以及本次改了什么
