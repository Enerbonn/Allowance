import { existsSync } from 'node:fs';
import { Store } from './store.ts';
import { createApp } from './app.ts';
import { resolve } from 'node:path';
import express from 'express';
import { dataDirectory, protectedStorageReady } from './protected-storage.ts';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const hostedOrigin = process.env.ALLOWANCE_PUBLIC_ORIGIN;
if (hostedOrigin) {
  const url = new URL(hostedOrigin);
  if (url.protocol !== 'https:' || url.origin !== hostedOrigin) throw new Error('Set ALLOWANCE_PUBLIC_ORIGIN to the HTTPS frontend origin.');
  if (!process.env.ALLOWANCE_DATA_DIR || !process.env.ALLOWANCE_STORAGE_KEY || !protectedStorageReady()) {
    throw new Error('Hosted mode requires a persistent data directory and a protected storage key.');
  }
  if ((process.env.ALLOWANCE_PROXY_TOKEN?.length || 0) < 24 || (process.env.ALLOWANCE_OWNER_SETUP_TOKEN?.length || 0) < 24) {
    throw new Error('Hosted mode requires independent proxy and owner setup tokens.');
  }
  if (process.env.ALLOWANCE_PROXY_TOKEN === process.env.ALLOWANCE_OWNER_SETUP_TOKEN) throw new Error('Use different proxy and owner setup tokens.');
}
const store = new Store(process.env.ALLOWANCE_DB || resolve(dataDirectory(), 'allowance.sqlite'), { sampleData: !hostedOrigin && process.env.ALLOWANCE_SAMPLE_DATA === '1' });
const app = createApp(store);
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
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
