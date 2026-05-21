import fs from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { listVideos, upsertVideos, updateVideoPatch, batchUpdateVideoStatus, clearAllVideos } from '../db/videoRepository.js';
import { enqueueAllPending, enqueueDownload, hydrateFileSize, pauseDownload, pauseAllDownloads, markNetworkAutoPaused, resumeDownload, resumeAllPausedDownloads, resumeAfterNetworkRecovery, stopDownload, stopAllDownloads, subscribeProgress, emitSyncProgress } from '../services/downloadService.js';
import { pickFolder } from '../services/folderPickerService.js';
import { scrapeLikedVideos, abortSync } from '../services/xScraperService.js';
import { config } from '../config.js';
import { getScreenName } from '../services/cookieService.js';
import { getDownloadRoot, setDownloadRoot, getCookieCheckInterval, setCookieCheckInterval, getMaxDownloadSpeed, setMaxDownloadSpeed, getMinDownloadSpeed, setMinDownloadSpeed, getMaxConcurrentDownloads, setMaxConcurrentDownloads, getChunkMode, setChunkMode, getChunkFixedCount, setChunkFixedCount, getChunkSmartRules, setChunkSmartRules, getNetworkCheckUrl, setNetworkCheckUrl, getNetworkCheckInterval, setNetworkCheckInterval } from '../services/storeService.js';

const router = express.Router();

router.get('/videos', (_req, res) => {
  res.json({
    downloadRoot: getDownloadRoot(),
    items: listVideos()
  });
});

router.post('/videos/sync', async (req, res, next) => {
  try {
    const mode = req.body?.mode === 'full' ? 'full' : 'incremental';
    const result = await scrapeLikedVideos(mode);
    // Fetch file sizes for all items before upserting
    await batchFetchFileSizes(result.items);
    upsertVideos(result.items);
    res.json({
      synced: result.items.length,
      duplicates: result.duplicates,
      mode,
      items: listVideos()
    });
  } catch (error) {
    next(error);
  }
});

async function batchFetchFileSizes(items) {
  const needsSize = items.filter(item => item.media_url && !item.file_size);
  if (!needsSize.length) return;
  console.log(`[sync] fetching file sizes for ${needsSize.length} new videos`);
  const batchSize = 10;
  let fetched = 0;
  for (let i = 0; i < needsSize.length; i += batchSize) {
    const batch = needsSize.slice(i, i + batchSize);
    await Promise.all(batch.map(async (item) => {
      try {
        const size = await hydrateFileSize(item);
        if (size) item.file_size = size;
      } catch { /* skip */ }
    }));
    fetched += batch.length;
    emitSyncProgress({ page: 0, count: fetched, duplicates: 0 });
  }
  console.log(`[sync] file sizes fetched for ${needsSize.length} videos`);
}

async function hydrateAllFileSizes() {
  const videos = listVideos().filter(v => !v.file_size && v.media_url);
  if (!videos.length) return;
  console.log(`[hydrate] fetching file sizes for ${videos.length} videos`);
  let updated = 0;
  for (const video of videos) {
    try {
      const size = await hydrateFileSize(video);
      if (size) {
        updateVideoPatch(video.id, { file_size: size });
        updated++;
        if (updated % 20 === 0) {
          emitSyncProgress({ page: 0, count: updated, duplicates: 0 });
        }
      }
    } catch { /* skip */ }
  }
  // Final notification so frontend can reload
  emitSyncProgress({ page: -1, count: updated, duplicates: 0 });
  console.log(`[hydrate] done, ${updated} sizes fetched`);
}

router.post('/videos/sync/abort', (_req, res) => {
  abortSync();
  res.json({ aborted: true });
});

router.post('/videos/hydrate-sizes', async (_req, res) => {
  res.json({ started: true });
  hydrateAllFileSizes().catch(err => {
    console.error('[hydrate] unhandled error:', err.message);
    emitSyncProgress({ page: -1, count: 0, duplicates: 0 });
  });
});

router.get('/videos/download-estimate', (_req, res) => {
  const candidates = listVideos().filter(item =>
    (item.download_status === 'pending' || item.download_status === 'failed') && item.media_url
  );
  const totalNeeded = candidates.reduce((sum, v) => sum + (v.file_size || 0), 0);
  const unknown = candidates.filter(v => !v.file_size).length;
  let available = -1;
  try {
    const root = getDownloadRoot();
    const stats = fs.statfsSync(root);
    available = stats.bavail * stats.bsize;
  } catch { /* statfs unavailable */ }
  res.json({ count: candidates.length, totalSize: totalNeeded, unknown, available });
});

router.post('/videos/download-all', async (_req, res, next) => {
  try {
    const candidates = listVideos().filter(item =>
      (item.download_status === 'pending' || item.download_status === 'failed') && item.media_url
    );
    if (!candidates.length) {
      return res.json({ queued: 0 });
    }
    const root = getDownloadRoot();
    const totalNeeded = candidates.reduce((sum, v) => sum + (v.file_size || 0), 0);
    if (totalNeeded > 0) {
      try {
        const stats = fs.statfsSync(root);
        const available = stats.bavail * stats.bsize;
        if (available < totalNeeded) {
          return res.status(400).json({
            message: `磁盘空间不足：需要 ${formatSize(totalNeeded)}，剩余 ${formatSize(available)}`,
            required: totalNeeded,
            available,
          });
        }
      } catch { /* statfs unavailable, skip check */ }
    }
    const count = enqueueAllPending(candidates);
    res.json({ queued: count });
  } catch (error) {
    next(error);
  }
});

router.post('/videos/stop-all', (_req, res) => {
  const stopped = stopAllDownloads();
  res.json({ stopped });
});

router.post('/videos/pause-all', (_req, res) => {
  const paused = pauseAllDownloads();
  res.json({ paused });
});

router.post('/videos/network-pause-all', (_req, res) => {
  markNetworkAutoPaused();
  const paused = pauseAllDownloads();
  res.json({ paused });
});

router.post('/videos/resume-all', (_req, res) => {
  const resumed = resumeAllPausedDownloads();
  res.json({ resumed });
});

router.post('/videos/resume-after-network', (_req, res) => {
  const resumed = resumeAfterNetworkRecovery();
  res.json({ resumed });
});

router.post('/videos/retry-failed', (_req, res, next) => {
  try {
    const failed = listVideos().filter(item => item.download_status === 'failed' && item.media_url);
    if (failed.length) {
      batchUpdateVideoStatus(failed.map(v => v.id), 'pending');
      enqueueAllPending(failed);
    }
    res.json({ retried: failed.length });
  } catch (error) {
    next(error);
  }
});

router.post('/videos/:id/download', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    void enqueueDownload(id);
    res.json({ queued: true, id });
  } catch (error) {
    next(error);
  }
});

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

router.post('/videos/:id/pause', (req, res) => {
  const id = Number(req.params.id);
  const ok = pauseDownload(id);
  res.json({ ok });
});

router.post('/videos/:id/resume', (req, res) => {
  const id = Number(req.params.id);
  const ok = resumeDownload(id);
  res.json({ ok });
});

router.post('/videos/:id/stop', (req, res) => {
  const id = Number(req.params.id);
  const ok = stopDownload(id);
  res.json({ ok });
});

router.delete('/videos', (_req, res) => {
  clearAllVideos();
  res.json({ cleared: true });
});

router.patch('/videos/batch-status', (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const status = req.body?.download_status;
    const allowedStatuses = new Set(['pending', 'queued', 'downloading', 'paused', 'downloaded', 'failed']);

    if (!ids.length) {
      return res.status(400).json({ message: 'ids 不能为空' });
    }
    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ message: '无效的下载状态' });
    }

    const updated = batchUpdateVideoStatus(ids, status);
    res.json({ updated, ids, download_status: status });
  } catch (error) {
    next(error);
  }
});

router.patch('/videos/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = updateVideoPatch(id, req.body || {});
    res.json(row);
  } catch (error) {
    next(error);
  }
});

const execAsync = promisify(exec);

router.get('/network-check', async (_req, res) => {
  const url = getNetworkCheckUrl();
  const start = Date.now();

  // Primary: HEAD request
  try {
    await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    return res.json({ online: true, latency: Date.now() - start });
  } catch { /* HEAD failed */ }

  // Fallback: ping the host
  try {
    const { hostname } = new URL(url);
    const cmd = process.platform === 'win32'
      ? `ping -n 1 -w 3000 ${hostname}`
      : `ping -c 1 -W 3 ${hostname}`;
    await execAsync(cmd, { timeout: 5000 });
    return res.json({ online: true, latency: Date.now() - start });
  } catch { /* ping failed */ }

  res.json({ online: false, latency: -1 });
});

router.get('/settings', (_req, res) => {
  res.json({
    downloadRoot: getDownloadRoot(),
    cookieCheckInterval: getCookieCheckInterval(),
    maxDownloadSpeed: getMaxDownloadSpeed(),
    minDownloadSpeed: getMinDownloadSpeed(),
    maxConcurrentDownloads: getMaxConcurrentDownloads(),
    chunkMode: getChunkMode(),
    chunkFixedCount: getChunkFixedCount(),
    chunkSmartRules: getChunkSmartRules(),
    networkCheckUrl: getNetworkCheckUrl(),
    networkCheckInterval: getNetworkCheckInterval(),
    targetUser: getScreenName() || 'USER',
  });
});

router.post('/settings/download-root', (req, res) => {
  const root = setDownloadRoot(req.body.root);
  res.json({ downloadRoot: root });
});

router.post('/settings/cookie-check-interval', (req, res) => {
  const minutes = Math.max(1, Number(req.body.minutes) || 2);
  setCookieCheckInterval(minutes);
  res.json({ cookieCheckInterval: minutes });
});

router.post('/settings/max-download-speed', (req, res) => {
  const kbps = Math.max(0, Number(req.body.kbps) || 0);
  setMaxDownloadSpeed(kbps);
  res.json({ maxDownloadSpeed: getMaxDownloadSpeed() });
});

router.post('/settings/min-download-speed', (req, res) => {
  const kbps = Math.max(0, Number(req.body.kbps) || 0);
  setMinDownloadSpeed(kbps);
  res.json({ minDownloadSpeed: getMinDownloadSpeed() });
});

router.post('/settings/max-concurrent-downloads', (req, res) => {
  const count = Math.max(1, Math.min(10, Number(req.body.count) || 2));
  setMaxConcurrentDownloads(count);
  res.json({ maxConcurrentDownloads: getMaxConcurrentDownloads() });
});

router.post('/settings/chunk-config', (req, res) => {
  const { mode, fixedCount, smartRules } = req.body || {};
  if (mode) setChunkMode(mode);
  if (fixedCount != null) setChunkFixedCount(fixedCount);
  if (Array.isArray(smartRules)) setChunkSmartRules(smartRules);
  res.json({
    chunkMode: getChunkMode(),
    chunkFixedCount: getChunkFixedCount(),
    chunkSmartRules: getChunkSmartRules(),
  });
});

router.post('/settings/network-check', (req, res) => {
  const { url, interval } = req.body || {};
  if (url !== undefined) setNetworkCheckUrl(url);
  if (interval !== undefined) setNetworkCheckInterval(interval);
  res.json({
    networkCheckUrl: getNetworkCheckUrl(),
    networkCheckInterval: getNetworkCheckInterval(),
  });
});

router.post('/settings/pick-folder', async (_req, res, next) => {
  try {
    const folder = await pickFolder();
    if (!folder) {
      res.json({ cancelled: true });
      return;
    }
    const root = setDownloadRoot(folder);
    res.json({ cancelled: false, downloadRoot: root });
  } catch (error) {
    next(error);
  }
});

router.get('/download-progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Keep-alive heartbeat every 15s
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  const unsubscribe = subscribeProgress((data) => {
    res.write(`data: ${data}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
