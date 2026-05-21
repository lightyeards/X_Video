<template>
  <div class="app">
    <main class="container">
      <header class="hero glass-panel">
        <div class="hero-copy">
          <div class="eyebrow-row">
            <span class="badge">X LIKES VIDEO WORKBENCH</span>
            <span class="soft-chip">媒体归档</span>
          </div>

          <h1 class="title">喜欢的视频管理台</h1>
          <p class="subtitle">
            同步<template v-if="targetUser"> @{{ targetUser }} </template>喜欢的视频，在一个清爽的媒体工作台里完成目录绑定、状态修正与批量下载。
          </p>

          <div class="meta-row">
            <span class="meta-pill">
              <el-icon><Collection /></el-icon>
              {{ state.items.length }} 条记录
            </span>
            <span class="meta-pill cookie-status" :class="cookieStatusClass">
              <span class="dot"></span>
              {{ cookieStatusLabel }}
              <template v-if="lastCheckTime"> · {{ lastCheckTime }}</template>
              <button class="icon-btn" aria-label="重新检测 Cookie" @click="checkCookieValidity">
                <el-icon><RefreshRight /></el-icon>
              </button>
            </span>
            <span class="meta-pill network-status" :class="networkOnline ? 'status-valid' : 'status-expired'">
              <span class="dot"></span>
              {{ networkOnline ? '网络正常' : '网络异常' }}
              <template v-if="networkOnline && networkLatency >= 0"> · {{ networkLatency }}ms</template>
            </span>
            <span class="meta-pill" :title="state.downloadRoot || '尚未设置下载目录'">
              <el-icon><FolderOpened /></el-icon>
              {{ state.downloadRoot ? '目录已绑定' : '目录未设置' }}
            </span>
          </div>
        </div>

        <div class="command-deck">
          <div class="deck-meter">
            <span>归档完成度</span>
            <strong>{{ completionRate }}%</strong>
          </div>
          <div class="deck-track">
            <span :style="{ width: completionRate + '%' }"></span>
          </div>
          <div class="hero-actions">
            <button class="btn btn-ghost" @click="showAuthDialog = true">
              <el-icon><Connection /></el-icon>
              登录设置
            </button>
            <button class="btn btn-ghost" @click="showSettingsDialog = true">
              <el-icon><Setting /></el-icon>
              配置
            </button>
            <button class="btn btn-primary" :disabled="syncing || !authState.configured" @click="syncVideos('incremental')">
              <span v-if="syncing && syncMode === 'incremental'" class="spinner"></span>
              <el-icon v-else><Refresh /></el-icon>
              增量同步
            </button>
            <button class="btn btn-accent" :disabled="syncing || !authState.configured" @click="syncVideos('full')">
              <span v-if="syncing && syncMode === 'full'" class="spinner"></span>
              <el-icon v-else><Refresh /></el-icon>
              全量同步
            </button>
            <button class="btn btn-accent download-all" :disabled="bulkDownloading" @click="downloadAll">
              <span v-if="bulkDownloading" class="spinner"></span>
              <el-icon v-else><Download /></el-icon>
              全部未下载一键下载
            </button>
            <button class="btn btn-ghost" @click="stopAll">
              <el-icon><CircleClose /></el-icon>
              全部停止
            </button>
            <button class="btn btn-ghost" @click="togglePauseAll">
              <span v-if="pauseAllLoading" class="spinner" style="border-top-color:var(--accent)"></span>
              <el-icon v-else-if="canResumeAll"><VideoPlay /></el-icon>
              <el-icon v-else><VideoPause /></el-icon>
              {{ canResumeAll ? '全部恢复' : '全部暂停' }}
            </button>
            <button class="btn btn-ghost" :disabled="!failedCount" @click="retryFailed">
              <el-icon><RefreshRight /></el-icon>
              失败重试
            </button>
            <button class="btn btn-danger-ghost" @click="clearDatabase">
              <el-icon><Delete /></el-icon>
              清空数据库
            </button>
          </div>
        </div>
      </header>

      <section class="overview-grid">
        <article class="stat-card tone-blue">
          <div class="stat-top">
            <span class="stat-icon">
              <el-icon><Collection /></el-icon>
            </span>
            <span>视频总量</span>
          </div>
          <div class="stat-value">{{ state.items.length }}</div>
          <p class="stat-note">喜欢的媒体资产</p>
        </article>

        <article class="stat-card tone-green">
          <div class="stat-top">
            <span class="stat-icon">
              <el-icon><CircleCheckFilled /></el-icon>
            </span>
            <span>已完成</span>
          </div>
          <div class="stat-value">{{ downloadedCount }}</div>
          <p class="stat-note">{{ completionRate }}% 已归档</p>
        </article>

        <article class="stat-card tone-status status-dashboard">
          <div class="stat-top status-top">
            <span class="stat-icon">
              <el-icon><WarningFilled /></el-icon>
            </span>
            <span>状态分布</span>
          </div>
          <div class="status-summary">
            <div class="status-summary-number">
              <span>处理中</span>
              <strong>{{ workingCount }}</strong>
            </div>
            <div class="status-summary-copy">
              <span class="status-summary-chip">{{ statusCaption }}</span>
              <p>{{ attentionCount }} 条等待归档处理</p>
            </div>
          </div>
          <div class="status-meters">
            <div
              v-for="item in statusOverview"
              :key="item.key"
              class="status-meter"
              :class="`meter-${item.key}`"
            >
              <div class="status-meter-head">
                <span class="status-meter-label">
                  <i></i>
                  {{ item.label }}
                </span>
                <strong>{{ item.count }}</strong>
              </div>
              <div class="status-meter-track">
                <span :style="{ width: item.width }"></span>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section class="library-section glass-panel">
        <div class="library-head">
          <div>
            <span class="section-label">Library</span>
            <h2 class="section-title">视频记录总览</h2>
          </div>
          <div class="table-meta">
            <span>{{ downloadedCount }} 已完成</span>
            <span>{{ pendingCount }} 待处理</span>
            <span>{{ failedCount }} 失败</span>
          </div>
        </div>

        <div class="library-toolbar">
          <div class="toolbar-copy">
            <el-checkbox v-model="selectAllPage" @change="toggleSelectAll" size="small" />
            <span>媒体列表视图</span>
          </div>
          <div v-if="selectedIds.size" class="batch-actions">
            <span class="batch-count">已选 {{ selectedIds.size }} 项</span>
            <button class="btn btn-sm btn-primary" @click="batchDownload">批量下载</button>
            <button class="btn btn-sm btn-warning" @click="batchSetStatus('pending')">重置为未下载</button>
            <button class="btn btn-sm btn-danger-ghost" @click="batchClear">取消选择</button>
          </div>
          <template v-else>
            <div class="toolbar-search">
              <input v-model="searchHandle" type="text" class="search-input" placeholder="搜索 @用户名" />
            </div>
            <div class="toolbar-filter">
              <button v-for="f in statusFilters" :key="f.value" class="filter-btn" :class="{ active: searchStatus === f.value }" @click="searchStatus = f.value">{{ f.label }}</button>
            </div>
          </template>
          <span class="toolbar-chip">每页 {{ page.size }} 条</span>
        </div>

        <div class="video-list-wrap" v-loading="loading">
          <div v-if="pagedItems.length" class="video-list">
            <article
              v-for="row in pagedItems"
              :key="row.id"
              class="video-row"
              :class="[statusClass(row), { 'row-selected': selectedIds.has(row.id) }]"
            >
              <div class="row-check">
                <el-checkbox :model-value="selectedIds.has(row.id)" @change="(v) => toggleSelect(row.id, v)" size="small" />
              </div>
              <div class="thumb-wrap">
                <template v-if="row.thumbnail_url">
                  <div v-if="!row._imgLoaded && !row._imgError" class="thumb-loading">
                    <span class="spinner-sm"></span>
                  </div>
                  <img
                    :data-src="row.thumbnail_url"
                    class="thumb lazy-img"
                    :class="{ 'thumb-hidden': !row._imgLoaded }"
                    alt=""
                    @load="row._imgLoaded = true"
                    @error="row._imgError = true; row._imgLoaded = false"
                  />
                  <div v-if="row._imgError" class="thumb-empty">
                    <el-icon><Film /></el-icon>
                    失败
                  </div>
                </template>
                <div v-else class="thumb-empty">
                  <el-icon><Film /></el-icon>
                  无图
                </div>
                <span class="thumb-badge">
                  <el-icon><VideoPlay /></el-icon>
                </span>
              </div>

              <div class="video-main">
                <div class="video-title-row">
                  <div>
                    <span class="handle">@{{ row.author_handle || 'unknown' }}</span>
                  </div>
                  <span class="status-pill" :class="statusClass(row)">{{ statusLabel(row.download_status) }}</span>
                </div>

                <div class="video-meta-grid">
                  <span>
                    <el-icon><DataLine /></el-icon>
                    {{ formatBytes(row.file_size) }}
                  </span>
                  <span>
                    <el-icon><Timer /></el-icon>
                    {{ formatDate(row.source_created_at || row.created_at) }}
                  </span>
                  <span>
                    <el-icon><Operation /></el-icon>
                    ID {{ row.tweet_id || row.id }}
                  </span>
                </div>

                <div class="progress-line" :class="{ muted: row.download_status !== 'downloading' }">
                  <div class="progress-bar">
                    <div class="progress-fill" :style="{ width: progressWidth(row) + '%' }"></div>
                  </div>
                  <span>{{ progressText(row) }}</span>
                </div>

                <p v-if="row.last_error" class="error-note">{{ row.last_error }}</p>
              </div>

              <div class="row-actions">
                <button
                  v-if="row.download_status === 'pending' || row.download_status === 'failed'"
                  class="btn btn-sm btn-primary"
                  @click="downloadOne(row)"
                >
                  <el-icon><Download /></el-icon>
                  下载
                </button>
                <button v-if="row.download_status === 'downloading'" class="btn btn-sm btn-warning" @click="pauseOne(row)">
                  <el-icon><VideoPause /></el-icon>
                  暂停
                </button>
                <button v-if="row.download_status === 'paused'" class="btn btn-sm btn-primary" @click="resumeOne(row)">
                  <el-icon><VideoPlay /></el-icon>
                  继续
                </button>
                <button
                  v-if="row.download_status === 'downloading' || row.download_status === 'paused' || row.download_status === 'queued'"
                  class="btn btn-sm btn-danger-ghost"
                  @click="stopOne(row)"
                >
                  停止
                </button>
                <a v-if="row.tweet_url" :href="row.tweet_url" target="_blank" rel="noreferrer" class="link-btn btn-blue">
                  <el-icon><Link /></el-icon>
                  原帖
                </a>
                <el-select
                  :model-value="row.download_status"
                  size="small"
                  class="status-select"
                  @change="(value) => updateStatus(row, value)"
                >
                  <el-option label="未下载" value="pending" />
                  <el-option label="已暂停" value="paused" />
                  <el-option label="已下载" value="downloaded" />
                  <el-option label="失败" value="failed" />
                </el-select>
              </div>
            </article>
          </div>

          <div v-else class="empty-state">
            <span class="empty-icon"><el-icon><VideoCamera /></el-icon></span>
            <h3>还没有视频记录</h3>
            <p>同步喜欢的视频后，这里会以媒体卡片行展示每条视频。</p>
          </div>
        </div>

        <div class="pagination-wrap">
          <el-pagination
            v-model:current-page="page.current"
            v-model:page-size="page.size"
            :page-sizes="[20, 50, 100, 200]"
            :total="filteredItems.length"
            layout="total, sizes, prev, pager, next"
            background
          />
        </div>
      </section>

      <el-dialog v-model="showAuthDialog" title="X 登录设置" width="500px" :close-on-click-modal="false">
        <div class="auth-section">
          <p class="auth-tip">
            需要提供 X 的 Cookie 才能同步喜欢的视频。从浏览器复制 Cookie 粘贴到下方，自动解析保存。
          </p>
          <div class="auth-status" v-if="authState.configured">
            <span class="tag tag-success">已配置 Cookie（{{ authState.savedAt }}）</span>
            <button class="btn btn-sm btn-danger-ghost" @click="clearAuth">清除</button>
          </div>
          <div class="auth-status" v-else>
            <span class="tag tag-warning">未配置 Cookie</span>
          </div>
          <el-form label-position="top" @submit.prevent="parseAndSaveCookie">
            <el-form-item label="粘贴 Cookie">
              <el-input
                v-model="authForm.cookieText"
                type="textarea"
                :rows="5"
                placeholder="从浏览器 DevTools → Network → 任意 x.com 请求 → Headers → 复制请求头（含 cookie、referer）粘贴到此处"
              />
            </el-form-item>
            <el-form-item>
              <button type="button" class="btn btn-primary" :disabled="!authForm.cookieText.trim()" @click="parseAndSaveCookie">
                解析并保存
              </button>
            </el-form-item>
          </el-form>
          <el-collapse>
            <el-collapse-item title="如何获取请求头？" name="guide">
              <ol class="guide-list">
                <li>在 Edge 浏览器中打开 <a href="https://x.com" target="_blank">x.com</a> 并登录</li>
                <li>按 <kbd>F12</kbd> 打开开发者工具，切换到 <strong>Network</strong> 标签页</li>
                <li>刷新页面，点击任意一个 <strong>x.com</strong> 的请求</li>
                <li>在 <strong>Headers</strong> 标签下找到 <strong>Request Headers</strong> 区域</li>
                <li>选中 <code>cookie</code>、<code>origin</code>、<code>referer</code> 三行，右键复制粘贴到上方</li>
              </ol>
            </el-collapse-item>
          </el-collapse>
        </div>
      </el-dialog>

      <el-dialog v-model="showSyncDialog" :title="syncMode === 'full' ? '全量同步中...' : '增量同步中...'" width="420px" :close-on-click-modal="false" :show-close="false">
        <div class="sync-content">
          <div class="sync-spinner"><el-icon :size="28"><Loading /></el-icon></div>
          <p class="sync-text">{{ syncMode === 'full' ? '全量获取所有喜欢的视频' : '获取新喜欢的视频' }}</p>
          <div class="sync-stats">
            <span>新增 <strong>{{ syncProgress.count }}</strong> 条</span>
            <span>重复 <strong>{{ syncProgress.duplicates }}</strong> 条</span>
            <span>第 <strong>{{ syncProgress.page }}</strong> 页</span>
          </div>
          <button class="btn btn-danger-ghost" style="margin-top: 16px; width: 100%;" @click="stopSync">停止同步</button>
        </div>
      </el-dialog>

      <el-dialog v-model="showSettingsDialog" title="系统配置" width="560px" :close-on-click-modal="false">
        <el-tabs v-model="settingsTab">
          <el-tab-pane label="系统设置" name="system">
            <div class="settings-section">
              <h3 class="settings-title">下载目录</h3>
              <el-input v-model="state.downloadRoot" placeholder="输入或选择下载目录路径" clearable>
                <template #append>
                  <el-button @click="pickFolder">浏览</el-button>
                </template>
              </el-input>
              <div class="settings-row">
                <span class="settings-hint">视频文件会统一写入这个目录</span>
                <button class="btn btn-sm btn-primary" :disabled="!state.downloadRoot" @click="saveFolder">保存目录</button>
              </div>
            </div>

            <el-divider />

            <div class="settings-section">
              <h3 class="settings-title">Cookie 检测</h3>
              <div class="settings-row">
                <span class="settings-label">定时检测间隔</span>
                <el-input-number v-model="settingsForm.cookieCheckInterval" :min="1" :max="60" :step="1" size="small" />
                <span class="settings-unit">分钟</span>
              </div>
              <div class="settings-row">
                <span class="settings-hint">自动检测 Cookie 有效性的时间间隔，修改后立即生效</span>
                <button class="btn btn-sm btn-primary" @click="saveCheckInterval">保存</button>
              </div>
            </div>

            <el-divider />

            <div class="settings-section">
              <h3 class="settings-title">网络检测</h3>
              <div class="settings-row">
                <span class="settings-label">检测地址</span>
                <el-input v-model="settingsForm.networkCheckUrl" placeholder="https://www.google.com/generate_204" size="small" style="flex:1" />
              </div>
              <div class="settings-row">
                <span class="settings-label">检测间隔</span>
                <el-input-number v-model="settingsForm.networkCheckInterval" :min="5" :max="300" :step="5" size="small" />
                <span class="settings-unit">秒</span>
              </div>
              <div class="settings-row">
                <span class="settings-hint">HEAD 请求检测连通性，失败后 ping 兜底，断网自动暂停下载</span>
                <button class="btn btn-sm btn-primary" @click="saveNetworkCheckConfig">保存</button>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="下载设置" name="download">
            <div class="settings-section">
              <h3 class="settings-title">下载配置</h3>
              <div class="settings-row">
                <span class="settings-label">最高限速</span>
                <el-input-number v-model="settingsForm.maxDownloadSpeed" :min="0" :max="102400" :step="256" size="small" />
                <span class="settings-unit">KB/s（0 = 不限速）</span>
              </div>
              <div class="settings-row">
                <span class="settings-label">任务最低速度</span>
                <el-input-number v-model="settingsForm.minDownloadSpeed" :min="0" :max="102400" :step="64" size="small" />
                <span class="settings-unit">KB/s（0 = 不检测）</span>
              </div>
              <div class="settings-row">
                <span class="settings-label">同时下载数</span>
                <el-input-number v-model="settingsForm.maxConcurrentDownloads" :min="1" :max="10" :step="1" size="small" />
                <span class="settings-unit">个任务</span>
              </div>
              <div class="settings-row">
                <span class="settings-hint">最低速度按 30 秒平均值检测，低速任务会自动让位后再优先恢复</span>
                <button class="btn btn-sm btn-primary" @click="saveDownloadConfig">保存</button>
              </div>
            </div>

            <el-divider />

            <div class="settings-section">
              <h3 class="settings-title">分片下载</h3>
              <div class="settings-row">
                <span class="settings-label">分片策略</span>
                <el-radio-group v-model="settingsForm.chunkMode" size="small">
                  <el-radio-button value="fixed">固定分片</el-radio-button>
                  <el-radio-button value="smart">智能分片</el-radio-button>
                </el-radio-group>
              </div>
              <div v-if="settingsForm.chunkMode === 'fixed'" class="settings-row">
                <span class="settings-label">分片数量</span>
                <el-input-number v-model="settingsForm.chunkFixedCount" :min="1" :max="32" :step="1" size="small" />
                <span class="settings-unit">段（固定值，所有文件统一）</span>
              </div>
              <template v-else>
                <div v-for="(rule, idx) in settingsForm.chunkSmartRules" :key="idx" class="settings-row">
                  <span class="settings-label">≥ {{ rule.sizeMB }} MB</span>
                  <el-input-number v-model="rule.chunks" :min="1" :max="32" :step="1" size="small" />
                  <span class="settings-unit">段</span>
                </div>
                <div class="settings-row">
                  <span class="settings-hint">按文件大小自动选择分片数，新下载立即生效</span>
                </div>
              </template>
              <div class="settings-row">
                <span class="settings-hint">仅对 > 5MB 的文件启用分片，且服务器支持 Range 时生效</span>
                <button class="btn btn-sm btn-primary" @click="saveChunkConfig">保存</button>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </el-dialog>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  CircleCheckFilled,
  Collection,
  Connection,
  DataLine,
  Delete,
  Download,
  Film,
  FolderOpened,
  CircleClose,
  Link,
  Loading,
  Operation,
  Refresh,
  RefreshRight,
  Setting,
  Timer,
  VideoCamera,
  VideoPause,
  VideoPlay,
  WarningFilled,
} from '@element-plus/icons-vue';
import axios from 'axios';

const targetUser = ref('');
const loading = ref(false);
const syncing = ref(false);
const bulkDownloading = ref(false);
const settingsTab = ref('system');
const pauseAllLoading = ref(false);
const selectedIds = reactive(new Set());
const selectAllPage = ref(false);
const showAuthDialog = ref(false);
const showSyncDialog = ref(false);
const showSettingsDialog = ref(false);
const syncProgress = reactive({ page: 0, count: 0, duplicates: 0 });
const syncMode = ref('incremental');
let hydrateResolve = null;

const authState = reactive({ configured: false, savedAt: '' });
const authForm = reactive({ cookieText: '' });
const cookieValid = ref(null);
const lastCheckTime = ref('');
const networkOnline = ref(true);
const networkLatency = ref(-1);
const settingsForm = reactive({ cookieCheckInterval: 2, maxDownloadSpeed: 0, minDownloadSpeed: 0, maxConcurrentDownloads: 2, chunkMode: 'smart', chunkFixedCount: 4, chunkSmartRules: [], networkCheckUrl: 'https://www.google.com/generate_204', networkCheckInterval: 30 });

const page = reactive({ current: 1, size: 50 });
const state = reactive({ items: [], downloadRoot: '' });
const searchHandle = ref('');
const searchStatus = ref('all');
watch([searchHandle, searchStatus], () => { page.current = 1; });

const statusFilters = [
  { label: '全部', value: 'all' },
  { label: '未下载', value: 'pending' },
  { label: '队列中', value: 'queued' },
  { label: '下载中', value: 'downloading' },
  { label: '已暂停', value: 'paused' },
  { label: '已下载', value: 'downloaded' },
  { label: '失败', value: 'failed' },
];

const filteredItems = computed(() => {
  let list = state.items;
  if (searchStatus.value !== 'all') {
    list = list.filter(item => (item.download_status || 'pending') === searchStatus.value);
  }
  const q = searchHandle.value.trim().replace(/^@/, '').toLowerCase();
  if (q) {
    list = list.filter(item => (item.author_handle || '').toLowerCase().includes(q));
  }
  return list;
});

const pagedItems = computed(() => {
  const start = (page.current - 1) * page.size;
  return filteredItems.value.slice(start, start + page.size);
});

watch(pagedItems, () => { nextTick(observeLazyImages); });

const statusCount = computed(() => state.items.reduce((acc, item) => {
  const key = item.download_status || 'pending';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, { pending: 0, queued: 0, downloading: 0, downloaded: 0, paused: 0, failed: 0 }));

const pendingCount = computed(() => statusCount.value.pending || 0);
const queuedCount = computed(() => statusCount.value.queued || 0);
const downloadedCount = computed(() => statusCount.value.downloaded || 0);
const pausedCount = computed(() => statusCount.value.paused || 0);
const failedCount = computed(() => statusCount.value.failed || 0);
const activeCount = computed(() => statusCount.value.downloading || 0);
const canPauseAll = computed(() => activeCount.value > 0);
const canResumeAll = computed(() => activeCount.value === 0 && pausedCount.value > 0);
const workingCount = computed(() => activeCount.value + queuedCount.value);
const attentionCount = computed(() => pendingCount.value + failedCount.value);
const completionRate = computed(() => {
  if (!state.items.length) return 0;
  return Math.round((downloadedCount.value / state.items.length) * 100);
});
const statusCaption = computed(() => {
  if (failedCount.value) return `${failedCount.value} 条失败待处理`;
  if (workingCount.value) return '下载队列正在推进';
  if (pausedCount.value) return '有任务处于暂停';
  if (pendingCount.value) return '等待选择下载';
  if (state.items.length) return '全部归档完成';
  return '等待同步数据';
});
const statusOverview = computed(() => {
  const total = Math.max(state.items.length, 1);
  return [
    { key: 'downloading', label: '下载中', count: activeCount.value },
    { key: 'queued', label: '队列中', count: queuedCount.value },
    { key: 'paused', label: '已暂停', count: pausedCount.value },
    { key: 'failed', label: '失败', count: failedCount.value },
    { key: 'pending', label: '未下载', count: pendingCount.value },
  ].map(item => ({
    ...item,
    width: item.count ? `${Math.max(8, Math.round((item.count / total) * 100))}%` : '0%',
  }));
});

const cookieStatusLabel = computed(() => {
  if (!authState.configured) return 'Cookie 待配置';
  if (cookieValid.value === null) return 'Cookie 验证中...';
  if (cookieValid.value === true) return 'Cookie 有效';
  if (cookieValid.value === 'not_configured') return 'Cookie 待配置';
  return 'Cookie 已过期';
});

const cookieStatusClass = computed(() => {
  if (!authState.configured || cookieValid.value === 'not_configured') return 'status-unknown';
  if (cookieValid.value === null) return 'status-checking';
  if (cookieValid.value === true) return 'status-valid';
  return 'status-expired';
});

const progressMap = reactive({});

let eventSource = null;
let cookieCheckTimer = null;
let networkCheckTimer = null;
let imgObserver = null;

function observeLazyImages() {
  if (imgObserver) imgObserver.disconnect();
  imgObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
        }
        imgObserver.unobserve(img);
      }
    });
  }, { rootMargin: '200px' });
  requestAnimationFrame(() => {
    document.querySelectorAll('.lazy-img[data-src]').forEach(img => imgObserver.observe(img));
  });
}

function connectSSE() {
  if (eventSource) return;
  eventSource = new EventSource('/api/download-progress');
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'sync') {
        if (data.page === -1) {
          // File size hydration done, reload data
          loadVideos();
          if (hydrateResolve) {
            hydrateResolve(data.count);
            hydrateResolve = null;
          }
          return;
        }
        syncProgress.page = data.page;
        syncProgress.count = data.count;
        if (data.duplicates !== undefined) syncProgress.duplicates = data.duplicates;
        return;
      }
      const item = state.items.find(r => r.id === data.id);
      if (item) {
        item.download_status = data.status;
        if (data.progress !== undefined) {
          item._progress = data.progress;
        }
      }
      progressMap[data.id] = data;
    } catch { /* ignore */ }
  };
  eventSource.onerror = () => {
    eventSource.close();
    eventSource = null;
    setTimeout(connectSSE, 3000);
  };
}

function formatBytes(bytes) {
  if (!bytes) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function formatDate(value) {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function statusLabel(status = 'pending') {
  return {
    pending: '未下载',
    queued: '队列中',
    downloading: '下载中',
    paused: '已暂停',
    downloaded: '已下载',
    failed: '失败',
  }[status] || '未下载';
}

function statusClass(rowOrStatus) {
  const status = typeof rowOrStatus === 'string' ? rowOrStatus : rowOrStatus?.download_status;
  return `status-${status || 'pending'}`;
}

function progressWidth(row) {
  if (row.download_status === 'downloaded') return 100;
  if (row.download_status === 'downloading' || row.download_status === 'paused' || row.download_status === 'queued') return row._progress || 0;
  return 0;
}

function progressText(row) {
  if (row.download_status === 'downloaded') return '已完整保存';
  if (row.download_status === 'downloading') return `${row._progress || 0}%`;
  if (row.download_status === 'paused') return '任务已暂停';
  if (row.download_status === 'queued') return '排队中';
  if (row.download_status === 'failed') return '需要重试';
  return '等待下载';
}

async function loadVideos() {
  loading.value = true;
  try {
    const { data } = await axios.get('/api/videos');
    state.items = data.items.map(item => ({ ...item, _progress: 0, _imgLoaded: false, _imgError: false }));
    state.downloadRoot = data.downloadRoot;
    axios.get('/api/settings').then(({ data: s }) => {
      if (s.cookieCheckInterval) settingsForm.cookieCheckInterval = s.cookieCheckInterval;
      if (s.maxDownloadSpeed !== undefined) settingsForm.maxDownloadSpeed = s.maxDownloadSpeed;
      if (s.minDownloadSpeed !== undefined) settingsForm.minDownloadSpeed = s.minDownloadSpeed;
      if (s.maxConcurrentDownloads !== undefined) settingsForm.maxConcurrentDownloads = s.maxConcurrentDownloads;
      if (s.chunkMode) settingsForm.chunkMode = s.chunkMode;
      if (s.chunkFixedCount !== undefined) settingsForm.chunkFixedCount = s.chunkFixedCount;
      if (s.chunkSmartRules?.length) settingsForm.chunkSmartRules = s.chunkSmartRules;
      if (s.networkCheckUrl) settingsForm.networkCheckUrl = s.networkCheckUrl;
      if (s.networkCheckInterval) settingsForm.networkCheckInterval = s.networkCheckInterval;
      if (s.targetUser) targetUser.value = s.targetUser;
    }).catch(() => {});
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  } finally {
    loading.value = false;
  }
}

async function syncVideos(mode) {
  syncing.value = true;
  syncMode.value = mode;
  syncProgress.page = 0;
  syncProgress.count = 0;
  syncProgress.duplicates = 0;
  showSyncDialog.value = true;
  try {
    const { data } = await axios.post('/api/videos/sync', { mode });
    state.items = data.items.map(item => ({ ...item, _progress: 0, _imgLoaded: false, _imgError: false }));
    const msg = data.synced > 0
      ? `${mode === 'full' ? '全量' : '增量'}同步完成：新增 ${data.synced} 条` + (data.duplicates > 0 ? `，重复 ${data.duplicates} 条` : '')
      : `没有新视频` + (data.duplicates > 0 ? `，全部 ${data.duplicates} 条均重复` : '');
    ElMessage.success(msg);
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  } finally {
    showSyncDialog.value = false;
    syncing.value = false;
  }
}

async function stopSync() {
  try {
    await axios.post('/api/videos/sync/abort');
    ElMessage.info('正在停止同步...');
  } catch { /* ignore */ }
}

async function downloadOne(row) {
  try {
    await axios.post(`/api/videos/${row.id}/download`);
    row.download_status = 'downloading';
    row._progress = 0;
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function pauseOne(row) {
  try {
    await axios.post(`/api/videos/${row.id}/pause`);
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function resumeOne(row) {
  try {
    await axios.post(`/api/videos/${row.id}/resume`);
    row.download_status = 'downloading';
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function stopOne(row) {
  try {
    if (row.download_status !== 'queued') {
      await ElMessageBox.confirm('停止下载将丢弃已下载的进度，确定？', '确认停止', {
        confirmButtonText: '确定停止',
        cancelButtonText: '取消',
        type: 'warning',
      });
    }
    if (row.download_status === 'queued') {
      await axios.patch(`/api/videos/${row.id}`, { download_status: 'pending' });
      row.download_status = 'pending';
      row._progress = 0;
    } else {
      await axios.post(`/api/videos/${row.id}/stop`);
    }
  } catch (error) {
    if (error !== 'cancel' && error?.message) {
      ElMessage.error(error.response?.data?.message || error.message);
    }
  }
}

function toggleSelect(id, checked) {
  if (checked) selectedIds.add(id); else selectedIds.delete(id);
  selectAllPage.value = pagedItems.value.every(r => selectedIds.has(r.id));
}

function toggleSelectAll(checked) {
  if (checked) {
    for (const r of pagedItems.value) selectedIds.add(r.id);
  } else {
    for (const r of pagedItems.value) selectedIds.delete(r.id);
  }
}

function batchClear() {
  selectedIds.clear();
  selectAllPage.value = false;
}

async function batchDownload() {
  const ids = [...selectedIds].filter(id => {
    const item = state.items.find(v => v.id === id);
    return item && (item.download_status === 'pending' || item.download_status === 'failed') && item.media_url;
  });
  if (!ids.length) { ElMessage.info('选中的项目中没有可下载的'); return; }
  for (const id of ids) {
    try { await axios.post(`/api/videos/${id}/download`); } catch { /* skip */ }
  }
  ElMessage.success(`已加入队列：${ids.length} 条`);
  batchClear();
  await loadVideos();
}

async function batchSetStatus(status) {
  const ids = [...selectedIds];
  if (!ids.length) return;
  try {
    const { data } = await axios.patch('/api/videos/batch-status', {
      ids,
      download_status: status,
    });
    const idSet = new Set(ids);
    state.items.forEach((item) => {
      if (idSet.has(item.id)) {
        item.download_status = status;
        item.last_error = null;
        if (status === 'pending') item._progress = 0;
      }
    });
    ElMessage.success(`已将 ${data.updated ?? ids.length} 项状态修改为「${statusLabel(status)}」`);
    batchClear();
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function downloadAll() {
  bulkDownloading.value = true;
  try {
    const { data: est } = await axios.get('/api/videos/download-estimate');
    if (!est.count) {
      ElMessage.info('没有待下载的任务');
      return;
    }
    if (est.unknown) {
      await ElMessageBox.alert(`有 ${est.unknown} 条视频文件大小未知，正在获取...`, '检测文件大小', { type: 'info', confirmButtonText: '确定' });
      await axios.post('/api/videos/hydrate-sizes');
      // Wait for hydration to complete via SSE (page === -1) with timeout
      const hydrated = await Promise.race([
        new Promise(resolve => { hydrateResolve = resolve; }),
        new Promise(resolve => setTimeout(() => resolve(false), 30000)),
      ]);
      if (hydrateResolve) { hydrateResolve = null; }
      // Re-fetch estimate with updated sizes
      const { data: est2 } = await axios.get('/api/videos/download-estimate');
      Object.assign(est, est2);
      if (hydrated === false) {
        ElMessage.info('文件大小获取超时，部分文件大小可能仍为未知');
      }
    }
    const totalStr = formatBytes(est.totalSize);
    const availStr = est.available >= 0 ? formatBytes(est.available) : '未知';
    const insufficient = est.available >= 0 && est.totalSize > 0 && est.available < est.totalSize;
    const msg = `即将下载 ${est.count} 条视频，预估占用 ${totalStr}，磁盘剩余 ${availStr}`;
    if (insufficient) {
      await ElMessageBox.alert(msg, '磁盘空间不足', { type: 'warning', confirmButtonText: '知道了' });
      return;
    }
    await ElMessageBox.confirm(msg, '确认下载', {
      confirmButtonText: '开始下载',
      cancelButtonText: '取消',
      type: 'info',
    });
    const { data } = await axios.post('/api/videos/download-all');
    ElMessage.success(`已加入队列：${data.queued} 条`);
  } catch (error) {
    if (error === 'cancel') return;
    const msg = error.response?.data?.message || error.message;
    if (msg) ElMessage.error(msg);
  } finally {
    bulkDownloading.value = false;
  }
}

async function stopAll() {
  try {
    await ElMessageBox.confirm('确定停止所有下载任务？已下载进度将丢失。', '确认全部停止', {
      confirmButtonText: '确定停止',
      cancelButtonText: '取消',
      type: 'warning',
    });
    const { data } = await axios.post('/api/videos/stop-all');
    if (data.stopped > 0) {
      ElMessage.success(`已停止 ${data.stopped} 个下载任务`);
    } else {
      ElMessage.info('没有正在进行的下载任务');
    }
  } catch { /* cancelled */ }
}

async function togglePauseAll() {
  pauseAllLoading.value = true;
  try {
    if (canResumeAll.value) {
      const { data } = await axios.post('/api/videos/resume-all');
      if (data.resumed > 0) {
        ElMessage.success(`已恢复 ${data.resumed} 个下载任务`);
      } else {
        ElMessage.info('没有已暂停的下载任务');
      }
    } else {
      const { data } = await axios.post('/api/videos/pause-all');
      if (data.paused > 0) {
        ElMessage.success(`已暂停 ${data.paused} 个下载任务`);
      } else {
        ElMessage.info('没有正在进行的下载任务');
      }
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  } finally {
    pauseAllLoading.value = false;
  }
}

async function retryFailed() {
  try {
    const { data } = await axios.post('/api/videos/retry-failed');
    if (data.retried > 0) {
      ElMessage.success(`已重新入队 ${data.retried} 条失败任务`);
    } else {
      ElMessage.info('没有失败的任务');
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function updateStatus(row, value) {
  try {
    const { data } = await axios.patch(`/api/videos/${row.id}`, { download_status: value });
    Object.assign(row, data);
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function pickFolder() {
  try {
    const { data } = await axios.post('/api/settings/pick-folder');
    if (data.cancelled) return;
    state.downloadRoot = data.downloadRoot;
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function saveFolder() {
  try {
    const { data } = await axios.post('/api/settings/download-root', { root: state.downloadRoot });
    state.downloadRoot = data.downloadRoot;
    ElMessage.success('目录已保存');
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function checkAuthStatus() {
  try {
    const { data } = await axios.get('/api/auth/status');
    authState.configured = data.configured;
    authState.savedAt = data.saved_at ? new Date(data.saved_at).toLocaleString() : '';
    if (data.configured) checkCookieValidity();
  } catch { /* ignore */ }
}

async function checkCookieValidity() {
  if (!authState.configured) {
    cookieValid.value = 'not_configured';
    lastCheckTime.value = '';
    return;
  }
  cookieValid.value = null;
  try {
    const { data } = await axios.get('/api/auth/check');
    cookieValid.value = data.valid;
    lastCheckTime.value = new Date().toLocaleTimeString();
  } catch {
    cookieValid.value = false;
    lastCheckTime.value = new Date().toLocaleTimeString();
  }
}

async function parseAndSaveCookie() {
  const text = authForm.cookieText.trim();
  if (!text) return;

  // Parse DevTools headers: supports "key\nvalue" and "key: value" formats
  const headers = {};
  const lines = text.split(/\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    // Try "key: value" on same line
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const k = line.substring(0, colonIdx).trim().toLowerCase();
      const v = line.substring(colonIdx + 1).trim();
      if (k && v) { headers[k] = v; i++; continue; }
    }
    // Try "key\nvalue" on separate lines
    const key = line.toLowerCase();
    const val = lines[i + 1]?.trim();
    if (key && val && !key.includes('=') && !key.includes(';')) {
      headers[key] = val;
      i += 2;
    } else {
      i++;
    }
  }

  // Extract cookie values — from parsed header or from raw text
  const cookieStr = headers['cookie'] || text;
  const cookies = {};
  for (const pair of cookieStr.split(/;\s*/)) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    cookies[pair.substring(0, eqIdx).trim()] = pair.substring(eqIdx + 1).trim();
  }

  const authToken = cookies['auth_token'];
  const ct0 = cookies['ct0'];
  const twidRaw = cookies['twid'];
  const missing = [];
  if (!authToken) missing.push('auth_token');
  if (!ct0) missing.push('ct0');
  if (missing.length > 0) {
    ElMessage.error(`未找到 ${missing.join('、')}，请确认粘贴的是 x.com 的完整请求头`);
    return;
  }

  // Parse screen_name from referer header
  const referer = headers['referer'] || '';
  const refererMatch = referer.match(/x\.com\/([A-Za-z0-9_]+)/);
  const screenName = refererMatch ? refererMatch[1] : '';

  // Parse twid → user_id
  let twid = '';
  if (twidRaw) {
    try { twid = decodeURIComponent(twidRaw).replace('u=', ''); } catch { twid = twidRaw; }
  }

  if (!screenName && !twid) {
    ElMessage.error('未找到 referer 或 twid，请确认复制的是完整的请求头（含 referer 行）');
    return;
  }

  // Check network first
  try {
    const { data: net } = await axios.get('/api/network-check', { timeout: 8000 });
    if (!net.online) {
      ElMessage.error('网络连接异常，请检查网络后重试');
      return;
    }
  } catch {
    ElMessage.error('无法连接服务器，请检查网络后重试');
    return;
  }

  // Save and verify
  try {
    const { data } = await axios.post('/api/auth/save-cookies', {
      auth_token: authToken, ct0, screen_name: screenName, twid,
    });
    if (data.success) {
      authState.configured = true;
      authState.savedAt = new Date().toLocaleString();
      authForm.cookieText = '';
      showAuthDialog.value = false;
      ElMessage.success(`Cookie 验证成功，当前用户：@${data.screen_name}`);
      targetUser.value = data.screen_name;
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function clearAuth() {
  try {
    await axios.post('/api/auth/clear-cookies');
    authState.configured = false;
    authState.savedAt = '';
    cookieValid.value = 'not_configured';
    ElMessage.success('Cookie 已清除');
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function clearDatabase() {
  try {
    await ElMessageBox.confirm(
      '此操作将清空数据库中的所有视频记录，不可恢复。确定继续？',
      '确认清空',
      { confirmButtonText: '确定清空', cancelButtonText: '取消', type: 'warning' }
    );
    await axios.delete('/api/videos');
    state.items = [];
    ElMessage.success('数据库已清空');
  } catch {
    // cancelled or error
  }
}

function restartCookieTimer() {
  if (cookieCheckTimer) clearInterval(cookieCheckTimer);
  cookieCheckTimer = setInterval(() => {
    if (authState.configured) checkCookieValidity();
  }, settingsForm.cookieCheckInterval * 60 * 1000);
}

async function checkNetwork() {
  try {
    const { data } = await axios.get('/api/network-check', { timeout: 8000 });
    const wasOnline = networkOnline.value;
    networkOnline.value = data.online;
    networkLatency.value = data.latency;
    if (!data.online && wasOnline) {
      // Network just went offline — auto-pause all downloads
      try {
        const { data: pd } = await axios.post('/api/videos/network-pause-all');
        if (pd.paused > 0) {
          ElMessage.warning(`网络连接异常，已自动暂停 ${pd.paused} 个下载任务`);
        } else {
          ElMessage.warning('网络连接异常');
        }
      } catch { /* backend unreachable */ }
    } else if (data.online && !wasOnline) {
      // Network just recovered — auto-resume if auto-paused for network
      try {
        const { data: rd } = await axios.post('/api/videos/resume-after-network');
        if (rd.resumed > 0) {
          ElMessage.success(`网络已恢复，自动恢复 ${rd.resumed} 个下载任务`);
        }
      } catch { /* backend unreachable */ }
    }
  } catch {
    const wasOnline = networkOnline.value;
    networkOnline.value = false;
    networkLatency.value = -1;
    if (wasOnline) {
      ElMessage.warning('无法连接服务器，网络可能异常');
    }
  }
}

function startNetworkCheck() {
  if (networkCheckTimer) clearInterval(networkCheckTimer);
  checkNetwork();
  networkCheckTimer = setInterval(checkNetwork, settingsForm.networkCheckInterval * 1000);
}

async function saveCheckInterval() {
  try {
    const { data } = await axios.post('/api/settings/cookie-check-interval', {
      minutes: settingsForm.cookieCheckInterval,
    });
    settingsForm.cookieCheckInterval = data.cookieCheckInterval;
    restartCookieTimer();
    ElMessage.success(`检测间隔已设为 ${data.cookieCheckInterval} 分钟`);
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function saveDownloadConfig() {
  try {
    const [speedRes, minSpeedRes, concurrentRes] = await Promise.all([
      axios.post('/api/settings/max-download-speed', { kbps: settingsForm.maxDownloadSpeed }),
      axios.post('/api/settings/min-download-speed', { kbps: settingsForm.minDownloadSpeed }),
      axios.post('/api/settings/max-concurrent-downloads', { count: settingsForm.maxConcurrentDownloads }),
    ]);
    settingsForm.maxDownloadSpeed = speedRes.data.maxDownloadSpeed;
    settingsForm.minDownloadSpeed = minSpeedRes.data.minDownloadSpeed;
    settingsForm.maxConcurrentDownloads = concurrentRes.data.maxConcurrentDownloads;
    ElMessage.success('下载配置已保存');
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function saveChunkConfig() {
  try {
    const { data } = await axios.post('/api/settings/chunk-config', {
      mode: settingsForm.chunkMode,
      fixedCount: settingsForm.chunkFixedCount,
      smartRules: settingsForm.chunkSmartRules,
    });
    settingsForm.chunkMode = data.chunkMode;
    settingsForm.chunkFixedCount = data.chunkFixedCount;
    settingsForm.chunkSmartRules = data.chunkSmartRules;
    ElMessage.success('分片配置已保存');
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

async function saveNetworkCheckConfig() {
  try {
    const { data } = await axios.post('/api/settings/network-check', {
      url: settingsForm.networkCheckUrl,
      interval: settingsForm.networkCheckInterval,
    });
    settingsForm.networkCheckUrl = data.networkCheckUrl;
    settingsForm.networkCheckInterval = data.networkCheckInterval;
    startNetworkCheck();
    ElMessage.success('网络检测配置已保存');
  } catch (error) {
    ElMessage.error(error.response?.data?.message || error.message);
  }
}

onMounted(() => {
  loadVideos();
  checkAuthStatus();
  connectSSE();
  restartCookieTimer();
  startNetworkCheck();
});

onUnmounted(() => {
  if (eventSource) eventSource.close();
  if (cookieCheckTimer) clearInterval(cookieCheckTimer);
  if (networkCheckTimer) clearInterval(networkCheckTimer);
  if (imgObserver) imgObserver.disconnect();
});
</script>
