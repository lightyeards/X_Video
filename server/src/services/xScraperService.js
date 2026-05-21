import { loadCookies, getScreenName } from './cookieService.js';
import { fetchLikedVideos, abortSync } from './xApiScraper.js';
import { emitSyncProgress } from './downloadService.js';
import { getAllTweetIds } from '../db/videoRepository.js';

export { abortSync };

export async function scrapeLikedVideos(mode = 'incremental') {
  const cookies = loadCookies();
  if (!cookies) {
    throw new Error('未配置 X 登录凭证。请先在设置中获取或输入 Cookie。');
  }

  const screenName = cookies.screen_name || getScreenName();
  if (!screenName) {
    throw new Error('未获取到当前用户名，请先验证 Cookie。');
  }

  const knownTweetIds = getAllTweetIds();
  console.log(`[scraper] ${mode} sync for @${screenName} (${knownTweetIds.size} existing in DB)`);
  return fetchLikedVideos(cookies.auth_token, cookies.ct0, screenName, knownTweetIds, mode, (info) => {
    emitSyncProgress(info);
  });
}
