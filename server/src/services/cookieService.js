import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config } from '../config.js';
import { ensureDir } from '../utils/fs.js';

const AUTH_FILE = path.join(config.rootDir, 'data', 'x-auth.json');

export function loadCookies() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    if (data.auth_token && data.ct0) return data;
    return null;
  } catch {
    return null;
  }
}

export function saveCookies({ auth_token, ct0, screen_name }) {
  ensureDir(path.dirname(AUTH_FILE));
  fs.writeFileSync(AUTH_FILE, JSON.stringify({
    auth_token,
    ct0,
    screen_name: screen_name || '',
    saved_at: new Date().toISOString()
  }, null, 2));
  return { auth_token, ct0, screen_name };
}

export function getScreenName() {
  const cookies = loadCookies();
  return cookies?.screen_name || '';
}

export function setScreenName(screenName) {
  const cookies = loadCookies();
  if (!cookies) return;
  cookies.screen_name = screenName;
  ensureDir(path.dirname(AUTH_FILE));
  fs.writeFileSync(AUTH_FILE, JSON.stringify(cookies, null, 2));
}

export function clearCookies() {
  try {
    if (fs.existsSync(AUTH_FILE)) fs.unlinkSync(AUTH_FILE);
  } catch { /* ignore */ }
}

export async function extractCookiesFromBrowser() {
  if (!config.browserExecutablePath) {
    throw new Error('未配置 BROWSER_EXECUTABLE_PATH');
  }

  let context;
  try {
    ensureDir(config.browserUserDataDir);
    context = await chromium.launchPersistentContext(config.browserUserDataDir, {
      headless: true,
      executablePath: config.browserExecutablePath,
    });

    // Navigate to x.com to ensure cookies are loaded for this domain
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const cookies = await context.cookies('https://x.com');
    const authToken = cookies.find(c => c.name === 'auth_token');
    const ct0 = cookies.find(c => c.name === 'ct0');

    if (authToken?.value && ct0?.value) {
      const result = saveCookies({ auth_token: authToken.value, ct0: ct0.value });
      return { success: true, ...result };
    }
    return { success: false, message: '浏览器中未找到 X 登录 Cookie（auth_token / ct0）' };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
