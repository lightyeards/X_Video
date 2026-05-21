import { db } from './database.js';

const upsertVideoStmt = db.prepare(`
  INSERT INTO videos (
    tweet_id, author_name, author_handle, tweet_url, thumbnail_url, media_url,
    media_type, file_size, download_status, local_file, last_error, source_created_at, sort_order
  ) VALUES (
    @tweet_id, @author_name, @author_handle, @tweet_url, @thumbnail_url, @media_url,
    @media_type, @file_size, COALESCE(@download_status, 'pending'), @local_file, @last_error, @source_created_at, @sort_order
  )
  ON CONFLICT(tweet_id) DO UPDATE SET
    author_name = excluded.author_name,
    author_handle = excluded.author_handle,
    tweet_url = excluded.tweet_url,
    thumbnail_url = COALESCE(excluded.thumbnail_url, videos.thumbnail_url),
    media_url = COALESCE(excluded.media_url, videos.media_url),
    media_type = COALESCE(excluded.media_type, videos.media_type),
    file_size = COALESCE(excluded.file_size, videos.file_size),
    source_created_at = COALESCE(excluded.source_created_at, videos.source_created_at),
    sort_order = COALESCE(excluded.sort_order, videos.sort_order)
`);

export function upsertVideos(items) {
  db.exec('BEGIN');
  try {
    for (let i = 0; i < items.length; i++) {
      upsertVideoStmt.run({ ...items[i], sort_order: i });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listVideos() {
  return db.prepare('SELECT * FROM videos ORDER BY sort_order ASC').all();
}

export function getAllTweetIds() {
  const rows = db.prepare('SELECT tweet_id FROM videos').all();
  return new Set(rows.map(r => r.tweet_id));
}

export function getVideoById(id) {
  return db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
}

export function getVideoByTweetId(tweetId) {
  return db.prepare('SELECT * FROM videos WHERE tweet_id = ?').get(tweetId);
}

export function updateVideoStatus(id, status, error = null) {
  return db.prepare('UPDATE videos SET download_status = ?, last_error = ? WHERE id = ?').run(status, error, id);
}

export function updateVideoFile(id, localFile, fileSize) {
  return db.prepare('UPDATE videos SET local_file = ?, file_size = ?, download_status = \'downloaded\', temp_file = NULL WHERE id = ?').run(localFile, fileSize, id);
}

export function updateVideoTempFile(id, tempFile) {
  return db.prepare('UPDATE videos SET temp_file = ? WHERE id = ?').run(tempFile, id);
}

export function updateVideoPatch(id, patch) {
  const allowed = ['download_status', 'local_file', 'file_size', 'last_error'];
  const keys = Object.keys(patch).filter(k => allowed.includes(k));
  if (!keys.length) return getVideoById(id);
  const sets = keys.map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE videos SET ${sets} WHERE id = @id`).run({ ...patch, id });
  return getVideoById(id);
}

export function batchUpdateVideoStatus(ids, status) {
  const uniqueIds = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (!uniqueIds.length) return 0;

  const stmt = db.prepare('UPDATE videos SET download_status = ?, last_error = NULL WHERE id = ?');
  let changed = 0;
  db.exec('BEGIN');
  try {
    for (const id of uniqueIds) {
      changed += stmt.run(status, id).changes;
    }
    db.exec('COMMIT');
    return changed;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function clearAllVideos() {
  db.exec('DELETE FROM videos');
}
