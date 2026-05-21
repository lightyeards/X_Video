import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { db } from '../db/database.js';
import { getVideoById, updateVideoFile, updateVideoStatus, updateVideoTempFile, batchUpdateVideoStatus } from '../db/videoRepository.js';
import { getDownloadRoot, getMaxDownloadSpeed, getMinDownloadSpeed, getMaxConcurrentDownloads, getChunkMode, getChunkFixedCount, getChunkSmartRules } from './storeService.js';
import { ensureDir, safeFileName } from '../utils/fs.js';

const activeJobs = new Map();
const startingJobs = new Set();
const progressSubscribers = new Set();
const requestedQueue = [];
const requestedIds = new Set();
const backupQueue = [];
const backupIds = new Set();
const slowPausedQueue = [];
const slowPausedIds = new Set();
const SPEED_CHECK_WINDOW_MS = 30_000;
const SLOW_PAUSE_COOLDOWN_MS = 60_000;
const SLOW_PAUSE_MAX_RECENT = 2;
const recentSlowPauses = [];

// ── Active queue (A) + hidden backup queue (B) scheduler ──
let queueFrozen = false;
let autoPausedForNetwork = false;

function activeJobCount() {
  return activeJobs.size + startingJobs.size;
}

function getBackupTargetSize() {
  return getMaxConcurrentDownloads();
}

function getScheduledWindowSize() {
  return getMaxConcurrentDownloads() + getBackupTargetSize();
}

function getScheduledCount() {
  return activeJobCount() + backupQueue.length;
}

function hasScheduledJob(id) {
  return activeJobs.has(id) || startingJobs.has(id) || backupIds.has(id);
}

function enqueueRequest(videoId, front = false) {
  const id = Number(videoId);
  if (!Number.isInteger(id) || requestedIds.has(id) || hasScheduledJob(id)) return false;
  const video = getVideoById(id);
  if (!video || !video.media_url) return false;
  if (!['pending', 'failed'].includes(video.download_status || 'pending')) return false;
  if (front) requestedQueue.unshift(id); else requestedQueue.push(id);
  requestedIds.add(id);
  updateVideoStatus(id, 'queued', null);
  emitProgress(id, { id, status: 'queued', progress: 0 });
  return true;
}

function nextRequestedId() {
  while (requestedQueue.length) {
    const id = requestedQueue.shift();
    requestedIds.delete(id);
    const video = getVideoById(id);
    if (video?.media_url && ['pending', 'failed'].includes(video.download_status || 'pending') && !hasScheduledJob(id)) {
      return id;
    }
  }
  return null;
}

function addBackup(videoId, front = false) {
  const id = Number(videoId);
  if (!Number.isInteger(id) || backupIds.has(id) || activeJobs.has(id) || startingJobs.has(id)) return false;
  const video = getVideoById(id);
  if (!video?.media_url) return false;
  if (!['pending', 'failed', 'queued', 'paused'].includes(video.download_status || 'pending')) return false;
  if (front) backupQueue.unshift(id); else backupQueue.push(id);
  backupIds.add(id);
  return true;
}

function nextBackupId() {
  while (backupQueue.length) {
    const id = backupQueue.shift();
    backupIds.delete(id);
    const video = getVideoById(id);
    if (video?.media_url && ['pending', 'failed', 'queued', 'paused'].includes(video.download_status || 'pending') && !activeJobs.has(id) && !startingJobs.has(id)) {
      return id;
    }
  }
  return null;
}

function rememberSlowPaused(videoId) {
  const id = Number(videoId);
  if (!Number.isInteger(id) || slowPausedIds.has(id)) return;
  slowPausedIds.add(id);
  slowPausedQueue.push(id);
}

function forgetSlowPaused(videoId) {
  slowPausedIds.delete(Number(videoId));
}

function nextSlowPausedId() {
  while (slowPausedQueue.length) {
    const id = slowPausedQueue.shift();
    slowPausedIds.delete(id);
    const video = getVideoById(id);
    if (video?.download_status === 'paused' && video.media_url && !activeJobs.has(id) && !startingJobs.has(id)) {
      return id;
    }
  }
  return null;
}

function nextActiveCandidate(preferSlow = true) {
  if (preferSlow) {
    const slowId = nextSlowPausedId();
    if (slowId) return { id: slowId, resumeByte: 1 };
  }

  const backupId = nextBackupId();
  if (backupId) return { id: backupId, resumeByte: 0 };

  const requestedId = nextRequestedId();
  if (requestedId) return { id: requestedId, resumeByte: 0 };

  if (!preferSlow && activeJobCount() === 0) {
    const slowId = nextSlowPausedId();
    if (slowId) return { id: slowId, resumeByte: 1 };
  }

  return null;
}

function refillBackupQueue() {
  while (backupQueue.length < getBackupTargetSize() && getScheduledCount() < getScheduledWindowSize()) {
    const id = nextRequestedId();
    if (!id) break;
    addBackup(id);
  }
}

function scheduleMoreDownloads({ preferSlow = true } = {}) {
  if (queueFrozen) return;
  const maxActive = getMaxConcurrentDownloads();
  while (activeJobCount() < maxActive) {
    const candidate = nextActiveCandidate(preferSlow);
    if (!candidate) break;
    markQueued(candidate.id);
    doEnqueue(candidate.id, candidate.resumeByte);
  }
  refillBackupQueue();
}

function freezeQueue() {
  queueFrozen = true;
}

function markQueued(videoId) {
  updateVideoStatus(videoId, 'queued', null);
  emitProgress(videoId, { id: videoId, status: 'queued', progress: 0 });
}

function unfreezeQueue(priorityIds = []) {
  queueFrozen = false;
  autoPausedForNetwork = false;
  // Re-enqueue items still marked as queued in DB, optionally prioritizing resumed paused jobs.
  const prioritySet = new Set(priorityIds.map(Number).filter(Number.isInteger));
  const rows = db.prepare("SELECT id FROM videos WHERE download_status = 'queued' ORDER BY COALESCE(sort_order, id), id").all();
  const orderedIds = [
    ...prioritySet,
    ...rows.map(row => row.id).filter(id => !prioritySet.has(id)),
  ];
  for (let i = orderedIds.length - 1; i >= 0; i--) {
    addBackup(orderedIds[i], true);
  }
  scheduleMoreDownloads({ preferSlow: false });
}

// ── Speed throttle Transform stream ──
class ThrottleStream extends Transform {
  constructor(bytesPerSecond) {
    super();
    this.bytesPerSecond = bytesPerSecond;
    this.bytesThisChunk = 0;
    this.chunkStart = Date.now();
  }

  _transform(chunk, _encoding, callback) {
    this.bytesThisChunk += chunk.length;
    this.push(chunk);

    const elapsed = Date.now() - this.chunkStart;
    const expectedMs = (this.bytesThisChunk / this.bytesPerSecond) * 1000;

    if (expectedMs > elapsed) {
      const delay = expectedMs - elapsed;
      this.bytesThisChunk = 0;
      this.chunkStart = Date.now();
      setTimeout(callback, delay);
    } else {
      callback();
    }
  }
}

function buildFileName(video) {
  const base = safeFileName(`${video.author_handle || 'user'}_${video.tweet_id}`);
  return `${base}.mp4`;
}

function cleanTempFiles(tempPath) {
  try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
  const dir = path.dirname(tempPath);
  const base = path.basename(tempPath);
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry === base || entry.startsWith(base + '.chunk')) {
        try { fs.unlinkSync(path.join(dir, entry)); } catch { /* skip */ }
      }
    }
  } catch { /* dir not found */ }
}

function isNetworkError(error) {
  const code = error.cause?.code || error.code;
  if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'EPIPE', 'EHOSTUNREACH'].includes(code)) {
    return true;
  }
  if (error.name === 'TypeError' && /fetch failed/i.test(error.message)) return true;
  return false;
}

function noteDownloadBytes(videoId, bytes) {
  const job = activeJobs.get(videoId);
  if (!job?.controller || job.controller.signal.aborted) return;

  job.downloadedBytes = (job.downloadedBytes || 0) + bytes;
  job.speedWindowBytes = (job.speedWindowBytes || 0) + bytes;
  checkDownloadSpeed(videoId);
}

function checkDownloadSpeed(videoId) {
  const job = activeJobs.get(videoId);
  if (!job?.controller || job.controller.signal.aborted) return;
  const minSpeed = getMinDownloadSpeed();
  if (minSpeed <= 0 || job.speedCheckDisabled) return;

  const now = Date.now();
  const elapsed = now - job.speedWindowStart;
  if (elapsed < SPEED_CHECK_WINDOW_MS) return;

  if (!job.speedWindowBytes) return;

  const avgKbps = job.speedWindowBytes / 1024 / (elapsed / 1000);
  job.speedWindowStart = now;
  job.speedWindowBytes = 0;

  if (avgKbps < minSpeed) {
    // Trim old entries and check cooldown
    while (recentSlowPauses.length && now - recentSlowPauses[0] > SLOW_PAUSE_COOLDOWN_MS) {
      recentSlowPauses.shift();
    }
    if (recentSlowPauses.length >= SLOW_PAUSE_MAX_RECENT) {
      console.log(`[download] video ${videoId} slow (${avgKbps.toFixed(1)} KB/s) but ${recentSlowPauses.length} recent slow-pauses, network is slow globally`);
      return;
    }
    recentSlowPauses.push(now);
    job.intent = 'slow-pause';
    job.controller.abort();
    console.log(`[download] auto paused slow video ${videoId}: ${avgKbps.toFixed(1)} KB/s < ${minSpeed} KB/s`);
  }
}

// ── Throttled progress emission ──
const lastProgress = new Map();

function emitProgress(videoId, data) {
  // Always emit terminal states
  const isTerminal = data.status === 'downloaded' || data.status === 'failed' || data.status === 'pending' || data.progress === 100;
  if (!isTerminal) {
    const last = lastProgress.get(videoId);
    const now = Date.now();
    if (last && now - last.time < 500 && Math.abs(data.progress - last.progress) < 2) return;
    lastProgress.set(videoId, { time: now, progress: data.progress });
  } else {
    lastProgress.delete(videoId);
  }
  const payload = JSON.stringify(data);
  for (const cb of progressSubscribers) {
    try { cb(payload); } catch { /* subscriber disconnected */ }
  }
}

export function subscribeProgress(callback) {
  progressSubscribers.add(callback);
  return () => progressSubscribers.delete(callback);
}

export function emitSyncProgress(data) {
  const payload = JSON.stringify({ type: 'sync', ...data });
  for (const cb of progressSubscribers) {
    try { cb(payload); } catch { /* subscriber disconnected */ }
  }
}

// ── Chunked (multipart) download ──
const CHUNK_THRESHOLD = 5 * 1024 * 1024; // only chunk files > 5 MB

function resolveChunkCount(fileSizeBytes) {
  const mode = getChunkMode();
  if (mode === 'fixed') return getChunkFixedCount();
  // Smart mode: match against rules sorted by sizeMB descending
  const sizeMB = fileSizeBytes / (1024 * 1024);
  const rules = getChunkSmartRules();
  for (let i = rules.length - 1; i >= 0; i--) {
    if (sizeMB >= rules[i].sizeMB) return rules[i].chunks;
  }
  return rules[0]?.chunks || 2;
}

async function probeRangeSupport(url) {
  try {
    const resp = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const acceptRanges = resp.headers.get('accept-ranges');
    const contentLength = Number(resp.headers.get('content-length') || 0);
    return { supported: acceptRanges === 'bytes' || resp.status === 206, totalSize: contentLength };
  } catch {
    return { supported: false, totalSize: 0 };
  }
}

async function downloadChunked(url, destination, videoId, totalSize, controller) {
  const chunkCount = resolveChunkCount(totalSize);
  const chunkSize = Math.ceil(totalSize / chunkCount);
  const chunks = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize - 1, totalSize - 1);
    if (start >= totalSize) break;
    chunks.push({ index: i, start, end, tempFile: `${destination}.chunk${i}` });
  }

  let totalDownloaded = 0;

  await Promise.all(chunks.map(async (chunk) => {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { Range: `bytes=${chunk.start}-${chunk.end}` },
      signal: controller?.signal,
    });
    if (response.status !== 206 && response.status !== 200) {
      throw new Error(`Chunk ${chunk.index} failed: HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('No response body for chunk');

    return new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(chunk.tempFile);
      const stream = Readable.fromWeb(response.body);
      let chunkDownloaded = 0;
      let settled = false;

      stream.on('data', (data) => {
        chunkDownloaded += data.length;
        totalDownloaded += data.length;
        noteDownloadBytes(videoId, data.length);
        const pct = totalSize > 0 ? Math.round((totalDownloaded / totalSize) * 100) : 0;
        emitProgress(videoId, {
          id: videoId,
          status: 'downloading',
          progress: Math.min(pct, 100),
          downloaded: totalDownloaded,
          total: totalSize,
        });
      });

      stream.pipe(ws);
      ws.on('finish', () => { if (!settled) { settled = true; resolve(); } });
      ws.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
      stream.on('error', (err) => {
        if (controller?.signal?.aborted) {
          if (!settled) { settled = true; ws.end(() => resolve()); }
        } else if (!settled) { settled = true; ws.close(); reject(err); }
      });
    });
  }));

  if (controller?.signal?.aborted) {
    // Clean up chunk temp files on abort
    for (const chunk of chunks) {
      try { fs.unlinkSync(chunk.tempFile); } catch { /* skip */ }
    }
    return { aborted: true, downloaded: totalDownloaded, total: totalSize };
  }

  // Concatenate chunks into final file using streaming
  const finalWs = fs.createWriteStream(destination);
  for (const chunk of chunks) {
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(chunk.tempFile);
      rs.pipe(finalWs, { end: false });
      rs.on('end', () => {
        try { fs.unlinkSync(chunk.tempFile); } catch { /* skip */ }
        resolve();
      });
      rs.on('error', reject);
    });
  }
  await new Promise(resolve => finalWs.end(resolve));

  return { aborted: false, downloaded: totalDownloaded, total: totalSize };
}

async function downloadBinaryWithProgress(url, destination, videoId, startByte, controller) {
  let downloaded = startByte;

  try {
    const headers = {};
    if (startByte > 0) {
      headers.Range = `bytes=${startByte}-`;
    }

    const response = await fetch(url, { redirect: 'follow', headers, signal: controller?.signal });
    if (!response.ok && response.status !== 206) {
      throw new Error(`Download failed with HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('No response body');

    // Server returned full content instead of partial — restart
    if (startByte > 0 && response.status !== 206) {
      startByte = 0;
      downloaded = 0;
    }

    // Determine total file size
    const contentLength = Number(response.headers.get('content-length') || 0);
    const contentRange = response.headers.get('content-range');
    let total = contentLength;
    if (contentRange) {
      const match = contentRange.match(/bytes \d+-\d+\/(\d+)/);
      if (match) total = Number(match[1]);
    } else if (startByte > 0) {
      total = startByte + contentLength;
    }

    return await new Promise((resolve, reject) => {
      const flags = startByte > 0 ? 'a' : 'w';
      const fileStream = fs.createWriteStream(destination, { flags });
      const stream = Readable.fromWeb(response.body);
      let settled = false;

      stream.on('data', (chunk) => {
        downloaded += chunk.length;
        noteDownloadBytes(videoId, chunk.length);
        const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        emitProgress(videoId, {
          id: videoId,
          status: 'downloading',
          progress: Math.min(pct, 100),
          downloaded,
          total,
        });
      });

      const maxSpeed = getMaxDownloadSpeed();
      if (maxSpeed > 0) {
        const throttle = new ThrottleStream(maxSpeed * 1024);
        stream.pipe(throttle).pipe(fileStream);
      } else {
        stream.pipe(fileStream);
      }

      fileStream.on('finish', () => {
        if (!settled) {
          settled = true;
          resolve({ aborted: false, downloaded, total });
        }
      });

      fileStream.on('error', (err) => {
        if (!settled) { settled = true; reject(err); }
      });

      stream.on('error', (err) => {
        if (controller?.signal?.aborted) {
          if (!settled) {
            settled = true;
            fileStream.end(() => resolve({ aborted: true, downloaded }));
          }
        } else if (!settled) {
          settled = true;
          fileStream.close();
          reject(err);
        }
      });
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return { aborted: true, downloaded };
    }
    throw err;
  }
}

async function runDownload(videoId, resumeFromByte = 0) {
  const video = getVideoById(videoId);
  if (!video) throw new Error('Video not found');
  if (!video.media_url) throw new Error('No downloadable media URL found');
  if (video.media_type && video.media_type !== 'mp4') {
    throw new Error(`Unsupported media type: ${video.media_type}`);
  }

  const root = getDownloadRoot();
  ensureDir(root);
  const finalPath = path.join(root, buildFileName(video));
  const tempPath = finalPath + '.part';

  const controller = new AbortController();
  const now = Date.now();
  const jobInfo = {
    controller,
    tempPath,
    finalPath,
    speedWindowStart: now,
    speedWindowBytes: 0,
    downloadedBytes: 0,
  };
  jobInfo.speedTimer = setInterval(() => checkDownloadSpeed(videoId), SPEED_CHECK_WINDOW_MS);
  startingJobs.delete(videoId);
  activeJobs.set(videoId, jobInfo);

  updateVideoStatus(videoId, 'downloading', null);

  // Determine start byte
  let startByte = resumeFromByte;
  if (startByte > 0 && fs.existsSync(tempPath)) {
    const stat = fs.statSync(tempPath);
    startByte = stat.size;
    console.log(`[download] resuming video ${videoId} from byte ${startByte}`);
  } else {
    startByte = 0;
  }

  updateVideoTempFile(videoId, tempPath);
  emitProgress(videoId, {
    id: videoId,
    status: 'downloading',
    progress: startByte > 0 && video.file_size > 0 ? Math.round((startByte / video.file_size) * 100) : 0,
    downloaded: startByte,
    total: video.file_size || 0,
  });

  // Use chunked download for fresh downloads of large files
  let result;
  if (startByte === 0 && video.file_size >= CHUNK_THRESHOLD) {
    const probe = await probeRangeSupport(video.media_url);
    if (probe.supported && probe.totalSize >= CHUNK_THRESHOLD) {
      const chunkCount = resolveChunkCount(probe.totalSize);
      console.log(`[download] chunked ${chunkCount}-part download for video ${videoId} (${(probe.totalSize / 1048576).toFixed(1)} MB)`);
      try {
        result = await downloadChunked(video.media_url, tempPath, videoId, probe.totalSize, controller);
      } catch (error) {
        if (controller.signal.aborted) {
          result = { aborted: true, downloaded: jobInfo.downloadedBytes };
        } else {
          console.log(`[download] chunked failed, fallback to single connection for video ${videoId}`);
          result = await downloadBinaryWithProgress(video.media_url, tempPath, videoId, 0, controller);
        }
      }
    } else {
      result = await downloadBinaryWithProgress(video.media_url, tempPath, videoId, 0, controller);
    }
  } else {
    result = await downloadBinaryWithProgress(video.media_url, tempPath, videoId, startByte, controller);
  }

  if (result.aborted || controller.signal.aborted) {
    if (jobInfo.speedTimer) clearInterval(jobInfo.speedTimer);
    if (jobInfo.intent === 'stop') {
      forgetSlowPaused(videoId);
      cleanTempFiles(tempPath);
      updateVideoStatus(videoId, 'pending', null);
      updateVideoTempFile(videoId, null, 'pending');
      emitProgress(videoId, { id: videoId, status: 'pending', progress: 0 });
    } else {
      updateVideoStatus(videoId, 'paused', null);
      updateVideoTempFile(videoId, tempPath);
      if (jobInfo.intent === 'slow-pause') rememberSlowPaused(videoId);
      emitProgress(videoId, { id: videoId, status: 'paused', progress: 0, downloaded: result.downloaded });
    }
    return { intent: jobInfo.intent || 'pause' };
  }

  // Download complete — rename temp to final
  if (jobInfo.speedTimer) clearInterval(jobInfo.speedTimer);
  fs.renameSync(tempPath, finalPath);
  const stat = fs.statSync(finalPath);
  updateVideoFile(videoId, finalPath, stat.size);

  emitProgress(videoId, {
    id: videoId,
    status: 'downloaded',
    progress: 100,
    downloaded: result.downloaded,
    total: result.total,
  });
  return { intent: 'complete' };
}

export function enqueueDownload(videoId, resumeByte = 0) {
  if (resumeByte > 0) {
    forgetSlowPaused(videoId);
    markQueued(videoId);
    return doEnqueue(videoId, resumeByte);
  }
  enqueueRequest(videoId);
  scheduleMoreDownloads();
  return Promise.resolve();
}

function doEnqueue(videoId, resumeByte) {
  const existing = activeJobs.get(videoId) || startingJobs.has(videoId);
  if (existing) return Promise.resolve();

  startingJobs.add(videoId);
  let lastIntent = null;
  const job = Promise.resolve()
    .then(() => {
      if (queueFrozen) {
        startingJobs.delete(videoId);
        if (autoPausedForNetwork) {
          updateVideoStatus(videoId, 'paused', null);
          emitProgress(videoId, { id: videoId, status: 'paused', progress: 0 });
        } else {
          updateVideoStatus(videoId, 'pending', null);
          emitProgress(videoId, { id: videoId, status: 'pending', progress: 0 });
        }
        return { intent: 'frozen' };
      }
      return runDownload(videoId, resumeByte);
    })
    .then((result) => {
      lastIntent = result?.intent || lastIntent;
    })
    .catch(async (error) => {
      const info = activeJobs.get(videoId);
      if (!info?.controller?.signal?.aborted) {
        startingJobs.delete(videoId);
        if (isNetworkError(error) && !autoPausedForNetwork) {
          console.log(`[download] network error for video ${videoId}, auto-pausing all downloads`);
          autoPausedForNetwork = true;
          updateVideoStatus(videoId, 'paused', null);
          emitProgress(videoId, { id: videoId, status: 'paused', progress: 0 });
          pauseAllDownloads();
        } else {
          updateVideoStatus(videoId, 'failed', error.message);
          emitProgress(videoId, { id: videoId, status: 'failed', progress: 0, error: error.message });
        }
      }
    })
    .finally(() => {
      lastIntent = activeJobs.get(videoId)?.intent || lastIntent;
      startingJobs.delete(videoId);
      activeJobs.delete(videoId);
      scheduleMoreDownloads({ preferSlow: lastIntent !== 'slow-pause' });
    });

  return job;
}

export { unfreezeQueue };

export function pauseDownload(videoId) {
  const job = activeJobs.get(videoId);
  if (!job?.controller) return false;
  job.intent = 'pause';
  job.controller.abort();
  return true;
}

export function pauseAllDownloads() {
  freezeQueue();
  const ids = [...activeJobs.keys()];
  let paused = 0;
  for (const id of ids) {
    const job = activeJobs.get(id);
    if (job?.controller) {
      job.intent = 'pause';
      job.controller.abort();
      paused++;
    }
  }
  // Mark starting jobs (not yet running) as paused too
  for (const id of startingJobs) {
    startingJobs.delete(id);
  }
  // Also mark all queued-but-waiting items as paused so the UI reflects the true state
  const allQueuedIds = [
    ...requestedQueue.splice(0),
    ...backupQueue.splice(0),
    ...slowPausedQueue.splice(0),
  ];
  requestedIds.clear();
  backupIds.clear();
  slowPausedIds.clear();
  if (allQueuedIds.length) {
    batchUpdateVideoStatus(allQueuedIds, 'paused');
    for (const id of allQueuedIds) {
      emitProgress(id, { id, status: 'paused', progress: 0 });
    }
  }
  return paused + allQueuedIds.length;
}

export function resumeDownload(videoId) {
  const video = getVideoById(videoId);
  if (!video || video.download_status !== 'paused') return false;
  if (activeJobs.has(videoId) || startingJobs.has(videoId)) return false;

  forgetSlowPaused(videoId);
  slowPausedQueue.unshift(Number(videoId));
  slowPausedIds.add(Number(videoId));
  updateVideoStatus(videoId, 'queued', null);
  emitProgress(videoId, { id: videoId, status: 'queued', progress: 0 });
  queueFrozen = false;
  scheduleMoreDownloads({ preferSlow: true });
  return true;
}

export function resumeAllPausedDownloads() {
  const rows = db.prepare("SELECT id FROM videos WHERE download_status = 'paused' ORDER BY COALESCE(sort_order, id), id").all();
  const ids = rows.map(row => row.id);
  if (!ids.length) return 0;
  for (const id of ids) {
    forgetSlowPaused(id);
    markQueued(id);
  }
  unfreezeQueue(ids);
  return ids.length;
}

export function markNetworkAutoPaused() {
  autoPausedForNetwork = true;
}

export function resumeAfterNetworkRecovery() {
  if (!autoPausedForNetwork) return 0;
  autoPausedForNetwork = false;
  return resumeAllPausedDownloads();
}

export function stopDownload(videoId) {
  const job = activeJobs.get(videoId);
  forgetSlowPaused(videoId);
  if (!job?.controller) return false;
  job.intent = 'stop';
  job.controller.abort();
  return true;
}

export function stopAllDownloads() {
  freezeQueue();
  requestedQueue.length = 0;
  requestedIds.clear();
  backupQueue.length = 0;
  backupIds.clear();
  slowPausedQueue.length = 0;
  slowPausedIds.clear();
  // Clear startingJobs — these haven't begun downloading yet
  for (const id of startingJobs) {
    startingJobs.delete(id);
  }
  // Abort all active jobs
  const ids = [...activeJobs.keys()];
  let stopped = 0;
  for (const id of ids) {
    const job = activeJobs.get(id);
    if (job?.controller) {
      job.intent = 'stop';
      job.controller.abort();
      stopped++;
    }
  }
  // Clean up orphaned .part and .part.chunk* files in download directory
  const root = getDownloadRoot();
  try {
    const entries = fs.readdirSync(root);
    for (const entry of entries) {
      if (entry.endsWith('.part') || /\.part\.chunk\d+$/.test(entry)) {
        try { fs.unlinkSync(path.join(root, entry)); } catch { /* skip */ }
      }
    }
  } catch { /* dir not found */ }
  // Reset all downloading/paused videos back to pending
  resetStaleDownloads();
  return stopped;
}

function resetStaleDownloads() {
  const stmt = db.prepare("UPDATE videos SET download_status = 'pending', temp_file = NULL WHERE download_status IN ('queued', 'downloading', 'paused')");
  const result = stmt.run();
  if (result.changes > 0) {
    console.log(`[stopAll] reset ${result.changes} stale downloads to pending`);
  }
}

export function enqueueAllPending(candidates) {
  queueFrozen = false;
  autoPausedForNetwork = false;
  const enqueued = [];
  for (const item of candidates) {
    const id = Number(item.id);
    if (!Number.isInteger(id) || requestedIds.has(id) || hasScheduledJob(id)) continue;
    requestedQueue.push(id);
    requestedIds.add(id);
    enqueued.push(id);
  }
  if (enqueued.length) {
    batchUpdateVideoStatus(enqueued, 'queued');
    for (const id of enqueued) {
      emitProgress(id, { id, status: 'queued', progress: 0 });
    }
  }
  scheduleMoreDownloads();
  return enqueued.length;
}

export async function hydrateFileSize(video) {
  if (video.file_size || !video.media_url) return video.file_size;
  try {
    const resp = await fetch(video.media_url, { method: 'HEAD', redirect: 'follow' });
    const val = resp.headers.get('content-length');
    return val ? Number(val) : null;
  } catch { return null; }
}
