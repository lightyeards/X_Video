import express from 'express';
import { loadCookies, saveCookies, clearCookies, setScreenName, getScreenName } from '../services/cookieService.js';
import { getUserIdByScreenName } from '../services/xApiScraper.js';

const router = express.Router();

router.post('/save-cookies', async (req, res, next) => {
  try {
    const { auth_token, ct0, screen_name, twid } = req.body || {};
    if (!auth_token || !ct0) {
      return res.status(400).json({ message: 'auth_token 和 ct0 不能为空' });
    }

    // Verify cookie by resolving screen_name → rest_id, optionally matching twid
    let resolvedName = screen_name || '';
    if (resolvedName) {
      try {
        const restId = await getUserIdByScreenName(auth_token, ct0, resolvedName);
        if (twid && String(restId) !== String(twid)) {
          return res.status(400).json({ message: `Cookie 与用户 @${resolvedName} 不匹配（twid 不一致）` });
        }
      } catch (e) {
        return res.status(400).json({ message: `Cookie 验证失败：${e.message}` });
      }
    } else if (twid) {
      // No screen_name from referer, but have twid — just save, user will be resolved on first sync
      console.log(`[auth] saved cookie with twid=${twid}, no screen_name from referer`);
    } else {
      return res.status(400).json({ message: '缺少 referer 中的用户名信息' });
    }

    saveCookies({ auth_token, ct0 });
    if (resolvedName) setScreenName(resolvedName);

    console.log(`[auth] cookie saved for @${resolvedName || 'unknown'}`);
    res.json({ success: true, auth_token, ct0, screen_name: resolvedName });
  } catch (error) {
    next(error);
  }
});

router.get('/status', (_req, res) => {
  const cookies = loadCookies();
  res.json({
    configured: !!cookies,
    saved_at: cookies?.saved_at || null,
  });
});

router.post('/clear-cookies', (_req, res) => {
  clearCookies();
  res.json({ success: true });
});

router.get('/check', async (_req, res) => {
  const cookies = loadCookies();
  if (!cookies) {
    return res.json({ valid: false, error: 'not_configured' });
  }
  const screenName = getScreenName() || cookies.screen_name;
  if (!screenName) {
    return res.json({ valid: false, error: '未获取到用户名，请重新保存 Cookie' });
  }
  try {
    await getUserIdByScreenName(cookies.auth_token, cookies.ct0, screenName);
    res.json({ valid: true, screen_name: screenName });
  } catch (error) {
    res.json({ valid: false, error: error.message });
  }
});

export default router;
