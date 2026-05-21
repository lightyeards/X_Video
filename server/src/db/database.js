import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { config } from '../config.js';
import { ensureDir } from '../utils/fs.js';

ensureDir(path.join(config.rootDir, 'data'));

const dbPath = path.join(config.rootDir, 'data', 'app.db');
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tweet_id TEXT NOT NULL UNIQUE,
    author_name TEXT,
    author_handle TEXT,
    tweet_url TEXT,
    thumbnail_url TEXT,
    media_url TEXT,
    media_type TEXT,
    file_size INTEGER,
    download_status TEXT NOT NULL DEFAULT 'pending',
    local_file TEXT,
    last_error TEXT,
    source_created_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const updateTimestampTrigger = `
  CREATE TRIGGER IF NOT EXISTS trg_videos_updated_at
  AFTER UPDATE ON videos
  BEGIN
    UPDATE videos SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;
`;

db.exec(updateTimestampTrigger);

// Add temp_file column for partial downloads (safe to re-run)
try {
  db.exec('ALTER TABLE videos ADD COLUMN temp_file TEXT');
} catch {
  // Column already exists
}

// Add sort_order column for likes-list ordering (safe to re-run)
try {
  db.exec('ALTER TABLE videos ADD COLUMN sort_order INTEGER');
} catch {
  // Column already exists
}

const insertSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (@key, @value)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ?? fallback;
}

export function setSetting(key, value) {
  insertSetting.run({ key, value: String(value ?? '') });
}
