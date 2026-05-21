import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function safeFileName(value) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim() || 'video';
}

export function resolveMediaPath(rootDir, fileName) {
  return path.join(rootDir, fileName);
}

export function toMediaUrl(filePath) {
  return `/media/${encodeURIComponent(filePath)}`;
}
