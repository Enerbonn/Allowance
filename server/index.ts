import { existsSync } from 'node:fs';
import { Store } from './store.ts';
import { createWorkspaceApp } from './workspace-router.ts';
import { resolve } from 'node:path';
import express from 'express';
import { openHostedPersistence } from './hosted-persistence.ts';
import { dataDirectory, protectedStorageReady } from './protected-storage.ts';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const hostedOrigin = process.env.ALLOWANCE_PUBLIC_ORIGIN;
if (process.env.RENDER === 'true' && !hostedOrigin) {
  throw new Error('Render deployment requires ALLOWANCE_PUBLIC_ORIGIN. Set it in Render Environment to your Vercel production HTTPS URL, without a trailing slash.');
}
if (hostedOrigin) {
  if (!URL.canParse(hostedOrigin)) throw new Error('Set ALLOWANCE_PUBLIC_ORIGIN to the HTTPS frontend origin.');
  const url = new URL(hostedOrigin);
  if (url.protocol !== 'https:' || url.origin !== hostedOrigin) throw new Error('Set ALLOWANCE_PUBLIC_ORIGIN to the HTTPS frontend origin.');
  if (!process.env.ALLOWANCE_DATA_DIR) throw new Error('Hosted mode requires ALLOWANCE_DATA_DIR.');
  if (!process.env.ALLOWANCE_STORAGE_KEY || !protectedStorageReady()) throw new Error('Set ALLOWANCE_STORAGE_KEY to a 32-byte base64 key.');
  for (const name of ['ALLOWANCE_PROXY_TOKEN', 'ALLOWANCE_OWNER_SETUP_TOKEN']) {
    if ((process.env[name]?.length || 0) < 24) throw new Error(`Set ${name} to a random token of at least 24 characters.`);
  }
  if (process.env.ALLOWANCE_PROXY_TOKEN === process.env.ALLOWANCE_OWNER_SETUP_TOKEN) throw new Error('Use different proxy and owner setup tokens.');
}
const databaseUrl = process.env.SUPABASE_DATABASE_URL?.trim();
if (databaseUrl && (!hostedOrigin || process.env.ALLOWANCE_DB)) {
  throw new Error('Supabase persistence requires hosted mode and the default workspace database path.');
}
const persistence = databaseUrl ? await openHostedPersistence(databaseUrl, dataDirectory()) : undefined;
if (persistence) process.env.ALLOWANCE_DATA_DIR = persistence.directory;

const store = new Store(process.env.ALLOWANCE_DB || resolve(dataDirectory(), 'allowance.sqlite'), { sampleData: !hostedOrigin && process.env.ALLOWANCE_SAMPLE_DATA === '1' });
const { app, closeWorkspaces } = createWorkspaceApp(store, { persistence });
await persistence?.checkpoint();
if (hostedOrigin) {
  app.get('/', (_req, res) => res.type('text/plain').send('Allowance API'));
} else if (process.argv.includes('--production')) {
  app.use(express.static(resolve('dist')));
  app.use((_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = hostedOrigin ? Number(process.env.PORT || 4310) : 4310;
const server = app.listen(port, hostedOrigin ? '0.0.0.0' : '127.0.0.1', () => console.log(hostedOrigin ? `Allowance API listening on port ${port}` : 'Allowance: http://127.0.0.1:4310'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => {
  closeWorkspaces();
  store.close();
  void (async () => {
    try {
      await persistence?.checkpoint();
    } finally {
      await persistence?.close();
    }
  })().then(() => process.exit(0), () => process.exit(1));
}));
