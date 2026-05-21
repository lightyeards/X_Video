import path from 'node:path';
import { config } from '../config.js';
import { getSetting, setSetting } from '../db/database.js';
import { ensureDir } from '../utils/fs.js';

export function getDownloadRoot() {
  const root = getSetting('download_root', config.downloadRoot);
  ensureDir(root);
  return root;
}

export function setDownloadRoot(root) {
  ensureDir(root);
  setSetting('download_root', root);
  return root;
}

export function getSessionFile() {
  return path.resolve(config.sessionFile);
}

export function getCookieCheckInterval() {
  return Number(getSetting('cookie_check_interval', '2'));
}

export function setCookieCheckInterval(minutes) {
  setSetting('cookie_check_interval', String(minutes));
}

export function getMaxDownloadSpeed() {
  return Number(getSetting('max_download_speed', '0'));
}

export function setMaxDownloadSpeed(kbps) {
  setSetting('max_download_speed', String(Math.max(0, Math.round(kbps))));
}

export function getMinDownloadSpeed() {
  return Number(getSetting('min_download_speed', '0'));
}

export function setMinDownloadSpeed(kbps) {
  setSetting('min_download_speed', String(Math.max(0, Math.round(kbps))));
}

export function getMaxConcurrentDownloads() {
  return Number(getSetting('max_concurrent_downloads', '2'));
}

export function setMaxConcurrentDownloads(count) {
  setSetting('max_concurrent_downloads', String(Math.max(1, Math.min(10, Math.round(count)))));
}

// chunk_mode: 'fixed' | 'smart'
export function getChunkMode() {
  return getSetting('chunk_mode', 'smart');
}

export function setChunkMode(mode) {
  setSetting('chunk_mode', mode === 'fixed' ? 'fixed' : 'smart');
}

// Fixed mode: single chunk count
export function getChunkFixedCount() {
  return Number(getSetting('chunk_fixed_count', '4'));
}

export function setChunkFixedCount(count) {
  setSetting('chunk_fixed_count', String(Math.max(1, Math.min(32, Math.round(count)))));
}

// Smart mode: thresholds { sizeMB: chunkCount }
export function getChunkSmartRules() {
  const raw = getSetting('chunk_smart_rules', '');
  if (!raw) return [
    { sizeMB: 0, chunks: 2 },
    { sizeMB: 10, chunks: 4 },
    { sizeMB: 100, chunks: 8 },
    { sizeMB: 500, chunks: 16 },
  ];
  return JSON.parse(raw);
}

export function setChunkSmartRules(rules) {
  setSetting('chunk_smart_rules', JSON.stringify(rules));
}

export function getNetworkCheckUrl() {
  return getSetting('network_check_url', 'https://www.google.com/generate_204');
}

export function setNetworkCheckUrl(url) {
  setSetting('network_check_url', url || 'https://www.google.com/generate_204');
}

export function getNetworkCheckInterval() {
  return Number(getSetting('network_check_interval', '30'));
}

export function setNetworkCheckInterval(seconds) {
  setSetting('network_check_interval', String(Math.max(5, Math.round(seconds))));
}
