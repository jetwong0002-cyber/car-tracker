# 行车轨迹记录 — 部署指南

架构:iPhone 上的 Overland app(后台采 GPS)→ POST 到 Cloudflare Pages Function → 存 Neon Postgres → 网页地图查看。30 天前的数据在每次上报时自动删除,无需 cron。

## 项目结构

```
car-tracker/
├── functions/
│   └── api/
│       ├── track.js          ← 接收 Overland(iPhone)上报
│       ├── track-android.js  ← 接收 GPSLogger(Android 车机)上报
│       └── history.js        ← 查询轨迹(GeoJSON)、车辆清单、最新位置
├── public/
│   └── index.html            ← 地图查看页
├── package.json
└── schema.sql                ← Neon 建表脚本
```

## 车辆标识 `veh`

两个上报接口都支持在 URL 上带 `&veh=名字`(会转成大写,最长 20 字符),前端据此筛选。
省略时:`/api/track` 记为 `IPHONE`,`/api/track-android` 记为 `DEFAULT`。
只有一台设备在上报的话不用管它。

## 第一步:Neon 建表

在 Neon 控制台开一个新 database(或用现有的开个新 schema 也行,但建议分开,别跟招聘管线混一起),SQL Editor 里跑 `schema.sql`。

复制连接串(形如 `postgresql://user:pass@ep-xxx.aws.neon.tech/dbname?sslmode=require`)。

**已经在用的库**:`schema.sql` 末尾那两句迁移也要跑一次(补 `vehicle` 列、把历史上没有车辆标识的点回填成 `IPHONE`),不然车辆下拉会多出一个查不到东西的空白项:

```sql
ALTER TABLE track_points ADD COLUMN IF NOT EXISTS vehicle TEXT;
UPDATE track_points SET vehicle = 'IPHONE' WHERE vehicle IS NULL;
```

## 第二步:推代码到 GitHub

1. GitHub 新建 repo,比如 `car-tracker`(**设为 Private**,虽然代码里没密钥,但没必要公开)
2. 用 github.dev(老办法):repo 页面按 `.` 键进编辑器,把这几个文件建好、commit

## 第三步:Cloudflare Pages 部署

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → 选 `car-tracker`
2. Build settings:
   - Framework preset: **None**
   - Build command: 留空
   - Build output directory: `public`
3. 部署完成后,Settings → Environment variables 加两个(**Production** 环境):
   - `DATABASE_URL` = Neon 连接串
   - `TRACK_TOKEN` = 自己生成一串长随机字符(比如在电脑跑 `openssl rand -hex 24`,或随便用密码生成器,32 位以上)
4. Settings → Functions 确认没报错;再 Retry deployment 一次让环境变量生效

⚠️ `@neondatabase/serverless` 依赖:repo 根目录要有 `package.json` 声明它,Pages 构建时会自动装。

## 第四步:iPhone 装 Overland

App Store 搜 **Overland GPS Tracker**(开发者 Aaron Parecki,免费开源)。

设置:
- **Receiver Endpoint URL**:
  `https://你的项目.pages.dev/api/track?token=你的TRACK_TOKEN&veh=IPHONE`
- **Tracking**: On
- **Desired Accuracy**: Best(开车场景)
- **Significant Location / Motion**: 保持默认即可,它会自动在移动时密集采点、静止时省电
- **Batch Size**: 100 左右(存够 100 个点才上报一次,省流量省电)
- 定位权限给 **Always(始终)**,不然后台记不了

上车开一圈,回来打开 `https://你的项目.pages.dev`,输入 token,选"今天",轨迹就出来了。

## 第四步(替代方案):Android 车机装 GPSLogger

如果不想用手机记录,车机是 Android 的话可以直接在车机上跑:

1. 车机连热点,装 **GPSLogger**(F-Droid 或 Google Play,开发者 mendhak)
2. 设置 → Logging details → **Log to custom URL**,URL 填:
   ```
   https://你的项目.pages.dev/api/track-android?token=你的TRACK_TOKEN&lat=%LAT&lon=%LON&time=%TIME&spd=%SPD&alt=%ALT&acc=%ACC&batt=%BATT
   ```
3. Performance → **Logging interval** 设 5–10 秒(开车轨迹够顺滑)
4. 打开 **Start on bootup**(车机通电自动开始记录)和 **Start on app launch**
5. 没网时点会进本地队列,等你下次开热点自动补传

注意:车机时间可能不准,但上报用的 %TIME 是 GPS 时间,不受影响。

## 日常使用

- 什么都不用管,Overland 后台自动跑
- 想看轨迹:打开网页 → 输 token → 选「今天/昨天/最近 N 天」或直接挑一个日期
- 底部抽屉列出当天每段行程(时间、里程、时长、均速),点一条就跳到那段
- 橙色脉冲点是车辆最后上报的位置;勾上「自动刷新」每分钟更新一次
- 两段行程之间停车超过 10 分钟会标一个 P,点开看停了多久
- 数据自动滚动保留 30 天,想改成 60 天就改 `track.js` 里的 `interval '30 days'`

## 费用

全部 $0:Overland 免费、Cloudflare Pages 免费额度足够(GPS 上报一天也就几十次请求)、Neon 免费层 0.5GB,30 天 GPS 点也就几 MB。

## 注意事项

- Token 别提交到 repo 里(现在的代码全部从环境变量读,是安全的)
- iPhone 低电量模式会降低后台定位频率,轨迹可能变稀疏
- 隧道/室内停车场没 GPS,轨迹会断,属正常
