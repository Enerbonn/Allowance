import { existsSync } from 'node:fs';
import { Store } from './store.ts';
import { createApp } from './app.ts';
import { resolve } from 'node:path';
import express from 'express';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const store = new Store(process.env.ALLOWANCE_DB || '.local/allowance.sqlite');
const app = createApp(store);
if (process.argv.includes('--production')) {
  app.use(express.static(resolve('dist')));
  app.use((_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const server = app.listen(4310, '127.0.0.1', () => console.log('Allowance local prototype: http://127.0.0.1:4310\nPayments: SIMULATED. No real funds are moved.'));
process.on('SIGINT', () => server.close(() => { store.close(); process.exit(0); }));
