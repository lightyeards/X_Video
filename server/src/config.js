import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const serverDir = path.resolve(currentDir, '..');
const rootDir = path.resolve(serverDir, '..');

dotenv.config({ path: path.join(rootDir, '.env'), override: true });
dotenv.config({ override: true });

export const config = {
  rootDir,
  port: Number(process.env.SERVER_PORT || 4399),
  downloadRoot: process.env.DOWNLOAD_ROOT || path.join(rootDir, 'downloads'),
  sessionFile: path.resolve(rootDir, process.env.X_SESSION_FILE || './data/x-session.json'),
  browserExecutablePath: process.env.BROWSER_EXECUTABLE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  browserUserDataDir: path.resolve(rootDir, process.env.BROWSER_USER_DATA_DIR || './data/browser-profile'),
};
