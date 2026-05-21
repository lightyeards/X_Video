import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import './db/database.js';
import router from './routes/videos.js';
import authRouter from './routes/auth.js';
import { ensureDir } from './utils/fs.js';

ensureDir(path.join(config.rootDir, 'downloads'));

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.get('/media', (req, res) => {
  const target = String(req.query.path || '');
  if (!target || !path.isAbsolute(target) || !fs.existsSync(target)) {
    res.status(404).json({ message: 'Media file not found' });
    return;
  }
  res.sendFile(target);
});
app.use('/api', router);
app.use('/api/auth', authRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  res.status(500).json({
    message: error.message || 'Unknown server error'
  });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`server listening on http://0.0.0.0:${config.port}`);
});
