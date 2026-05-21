# X Likes Video Workbench

<p align="center">
  <strong>本地运行的 X/Twitter 喜欢的视频归档工具</strong><br>
  同步 · 管理 · 批量下载 · 一站式搞定
</p>

---

## 截图

![X Likes Video Workbench](screenshot.png)

## 功能特性

### 同步
- **增量同步** — 仅抓取新增的喜欢视频
- **全量同步** — 重新抓取全部喜欢的视频
- 自动获取视频文件大小，同步即可见预估空间占用

### 下载
- **一键批量下载** — 自动入队，显示空间估算确认弹窗
- **分片下载** — 大文件自动多连接分片加速
- **速度限速** — 可配置最高下载速度，避免占满带宽
- **并发控制** — 可配置同时下载任务数（1-10）
- **断点续传** — 暂停/中断后可从已下载位置继续
- **慢速自动暂停** — 单个任务速度不达标自动让出队列位置

### 网络
- **网络状态监测** — 实时显示网络连接状态和延迟
- **断网自动暂停** — 网络中断自动暂停全部下载任务
- **恢复自动继续** — 网络恢复后自动恢复因网络问题暂停的任务
- **全局慢速识别** — 多任务同时慢速时识别为网络问题，避免误暂停

### 管理
- **下载状态跟踪** — pending / queued / downloading / paused / downloaded / failed
- **失败重试** — 一键重试所有失败任务
- **Cookie 健康检测** — 定时检测 Cookie 有效性，过期自动提醒
- **视频缩略图** — 懒加载视频封面预览
- **批量状态修改** — 支持批量选择修改下载状态

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + Element Plus + Vite |
| 后端 | Express.js (ESM) |
| 数据库 | SQLite (WAL) — Node.js 内置 `node:sqlite` |
| 下载 | 原生 `fetch` + 分片 Range + Transform Stream 限速 |
| 同步 | X GraphQL API（无 Playwright 依赖） |
| 通信 | SSE (Server-Sent Events) 实时进度推送 |

## 快速开始

### 环境要求

- **Node.js >= 22**（使用内置 SQLite 和 `--watch`）
- **npm >= 9**
- **Windows**（目录选择器使用了 Windows API）

### 安装

```bash
git clone <repo-url>
cd X_Video
npm install
```

### 配置

复制环境变量模板并按需修改：

```bash
copy .env.example .env
```

`.env` 主要配置项：

```env
SERVER_PORT=4399                      # 后端端口
DOWNLOAD_ROOT=                        # 下载目录（空则在界面中设置）
BROWSER_EXECUTABLE_PATH=C:\...\msedge.exe  # 浏览器路径（用于备用的 Cookie 提取）
```

### 启动

双击 `start-dev.bat` 或手动运行：

```bash
npm run dev
```

打开 [http://localhost:5173](http://localhost:5173) 即可使用。

## 使用流程

### 1. 配置 Cookie

在浏览器中登录 [x.com](https://x.com)，按 `F12` 打开开发者工具：

1. 切换到 **Network** 标签页，刷新页面
2. 点击任意一个 `x.com` 请求
3. 在 **Headers → Request Headers** 中复制 `cookie`、`origin`、`referer` 三行
4. 粘贴到工具的登录设置对话框中，点击解析并保存

工具会自动从 `referer` 提取用户名，并验证 Cookie 有效性。

### 2. 同步喜欢的视频

- 点击 **增量同步** — 抓取上次同步后新喜欢的视频
- 点击 **全量同步** — 重新抓取全部喜欢的视频

同步过程会自动获取视频文件大小。

### 3. 下载

- 点击 **全部未下载一键下载** — 弹窗显示数量和空间占用，确认后批量入队
- 或单条点击下载按钮

### 4. 运行时设置

在 **设置** 对话框中可以调整：

**系统设置**
- 下载目录
- Cookie 检测间隔
- 网络检测地址和间隔

**下载设置**
- 最高下载速度（KB/s，0 = 不限速）
- 最低下载速度（低于此速度自动暂停，KB/s）
- 同时下载数（1-10）
- 分片模式（自动/固定分片数）

## 项目结构

```
X_Video/
├── server/                    # 后端
│   └── src/
│       ├── index.js           # 入口，Express 启动
│       ├── config.js          # 环境变量配置
│       ├── db/
│       │   ├── database.js    # SQLite 连接与通用查询
│       │   └── videoRepository.js  # 视频数据 CRUD
│       ├── routes/
│       │   ├── auth.js        # Cookie 保存与验证
│       │   └── videos.js      # 视频/下载/设置 API
│       ├── services/
│       │   ├── downloadService.js  # 下载引擎（队列/分片/限速/网络检测）
│       │   ├── xApiScraper.js      # X GraphQL API 抓取
│       │   ├── xScraperService.js  # 同步调度
│       │   ├── cookieService.js    # Cookie 存取
│       │   ├── storeService.js     # 配置持久化
│       │   └── folderPickerService.js  # 目录选择
│       └── utils/
│           └── fs.js          # 文件系统工具
├── web/                       # 前端
│   └── src/
│       ├── App.vue            # 单页应用主组件
│       ├── main.js            # 入口
│       └── styles/
│           └── app.css        # 全局样式
├── .env.example               # 环境变量模板
├── start-dev.bat              # 一键启动脚本
└── package.json               # npm workspaces 根配置
```

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/videos` | 获取视频列表 |
| POST | `/api/videos/sync` | 同步喜欢的视频（`{ mode: 'full'|'incremental' }`）|
| POST | `/api/videos/download-all` | 批量入队下载 |
| POST | `/api/videos/:id/download` | 单条入队 |
| POST | `/api/videos/pause-all` | 全部暂停 |
| POST | `/api/videos/resume-all` | 全部恢复 |
| POST | `/api/videos/stop-all` | 全部停止 |
| POST | `/api/videos/retry-failed` | 失败重试 |
| GET | `/api/download-progress` | SSE 实时进度流 |
| GET | `/api/settings` | 获取全部配置 |
| GET | `/api/network-check` | 网络连通性检测 |
| POST | `/api/auth/save-cookies` | 保存并验证 Cookie |

## 下载引擎架构

```
用户点击下载
    │
    ▼
requestedQueue ──► backupQueue ──► Active Slots (N 个并发)
                                     │
                          ┌──────────┼──────────┐
                          ▼          ▼          ▼
                       下载任务    下载任务    下载任务
                          │          │          │
                          ▼          ▼          ▼
                    速度检测 ── 不达标 ──► 移入 slowPausedQueue
                    同时多任务慢 ──► 识别为网络问题，继续下载
                    网络中断 ──► 全部暂停，等待恢复
```

- **活跃槽位**：由「同时下载数」控制
- **替补队列**：活跃槽位空出时自动补充
- **慢速队列**：单个任务速度不达标时让位给替补，冷却期内避免级联暂停

## License

MIT
