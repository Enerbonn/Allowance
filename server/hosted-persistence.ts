import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import pg from 'pg';
import { protect, unprotectValue } from './protected-storage.ts';

const maxWorkspaceBytes = 64 * 1024 * 1024;
const workspaceName = /^[a-f0-9]{64}$/;
const storedFile = /^(?:allowance\.sqlite(?:-wal)?|testnet-project\.json|(?:velo-gas|testnet-agent|testnet-merchant)(?:-[a-f0-9]{64})?\.dpapi)$/;
const evidenceFile = /^[a-f0-9-]{36}\.bin$/;

function validPath(path: string) {
  const parts = path.split('/');
  if (parts[0] === 'workspaces' && workspaceName.test(parts[1] || '')) parts.splice(0, 2);
  return (parts.length === 1 && storedFile.test(parts[0])) ||
    (parts.length === 2 && parts[0] === 'evidence' && evidenceFile.test(parts[1]));
}

function capture(directory: string) {
  const files = new Map<string, Buffer>();
  function add(path: string) {
    files.set(path, readFileSync(resolve(directory, path)));
  }
  function collect(prefix: string) {
    const folder = resolve(directory, prefix);
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      if (item.isFile() && storedFile.test(item.name)) add(prefix + item.name);
      if (item.isDirectory() && item.name === 'evidence') {
        for (const file of readdirSync(resolve(folder, 'evidence'), { withFileTypes: true })) {
          if (file.isFile() && evidenceFile.test(file.name)) add(prefix + 'evidence/' + file.name);
        }
      }
    }
  }
  collect('');
  const workspaces = resolve(directory, 'workspaces');
  if (existsSync(workspaces)) {
    for (const item of readdirSync(workspaces, { withFileTypes: true })) {
      if (item.isDirectory() && workspaceName.test(item.name)) collect('workspaces/' + item.name + '/');
    }
  }
  if ([...files.values()].reduce((sum, bytes) => sum + bytes.length, 0) > maxWorkspaceBytes) {
    throw new Error('Hosted workspace storage limit reached.');
  }
  return files;
}

export async function openHostedPersistence(connection: string, baseDirectory: string, allowTestConnection = false) {
  let url: URL;
  try { url = new URL(connection); }
  catch { throw new Error('Use a valid PostgreSQL connection string.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Use a PostgreSQL connection string.');
  url.search = '';
  const pool = new pg.Pool({
    connectionString: url.toString(),
    ssl: allowTestConnection ? false : { rejectUnauthorized: true },
    max: 2,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
  });
  pool.on('error', () => {});
  const epoch = randomUUID();
  mkdirSync(baseDirectory, { recursive: true });
  const directory = mkdtempSync(resolve(baseDirectory, 'supabase-'));
  let saved = new Map<string, string>();

  async function transaction<T>(run: (client: pg.PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  try {
    await transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(417250031)');
      await client.query('CREATE SCHEMA IF NOT EXISTS allowance_private');
      await client.query('REVOKE ALL ON SCHEMA allowance_private FROM PUBLIC');
      await client.query("CREATE TABLE IF NOT EXISTS allowance_private.writer (id integer PRIMARY KEY CHECK (id = 1), epoch uuid NOT NULL)");
      await client.query('CREATE TABLE IF NOT EXISTS allowance_private.files (path text PRIMARY KEY, digest text NOT NULL, content text NOT NULL)');
      await client.query('INSERT INTO allowance_private.writer VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET epoch = EXCLUDED.epoch', [epoch]);
      const { rows } = await client.query<{path: string; digest: string; content: string}>('SELECT path, digest, content FROM allowance_private.files');
      let restoredBytes = 0;
      for (const { path, digest, content } of rows) {
        if (!validPath(path)) throw new Error('Unexpected stored workspace path.');
        const bytes = gunzipSync(Buffer.from(unprotectValue(content), 'base64'), { maxOutputLength: maxWorkspaceBytes });
        restoredBytes += bytes.length;
        if (restoredBytes > maxWorkspaceBytes || createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('Stored workspace integrity check failed.');
        const target = resolve(directory, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes, { mode: 0o600 });
        saved.set(path, digest);
      }
    });
  } catch {
    await pool.end();
    throw new Error('Could not open Supabase persistence. Check the connection string, TLS and storage key.');
  }

  let pending = Promise.resolve();
  let available = true;
  function checkpoint() {
    if (!available) return Promise.reject(new Error('Hosted persistence is unavailable.'));
    let snapshot: Map<string, Buffer>;
    try { snapshot = capture(directory); }
    catch (error) { available = false; return Promise.reject(error); }
    pending = pending.then(async () => {
      const digests = new Map([...snapshot].map(([path, bytes]) => [path, createHash('sha256').update(bytes).digest('hex')]));
      const changed = [...digests].filter(([path, digest]) => saved.get(path) !== digest);
      const removed = [...saved.keys()].filter(path => !digests.has(path));
      if (!changed.length && !removed.length) return;
      await transaction(async client => {
        const { rows } = await client.query<{epoch: string}>('SELECT epoch FROM allowance_private.writer WHERE id = 1 FOR UPDATE');
        if (rows[0]?.epoch !== epoch) throw new Error('This deployment no longer owns the workspace.');
        for (const [path, digest] of changed) {
          const content = protect(gzipSync(snapshot.get(path)!).toString('base64'));
          await client.query(
            'INSERT INTO allowance_private.files VALUES ($1, $2, $3) ON CONFLICT (path) DO UPDATE SET digest = EXCLUDED.digest, content = EXCLUDED.content',
            [path, digest, content],
          );
        }
        if (removed.length) await client.query('DELETE FROM allowance_private.files WHERE path = ANY($1::text[])', [removed]);
      });
      saved = digests;
    }).catch(error => { available = false; throw error; });
    return pending;
  }

  return { directory, checkpoint, available: () => available, close: async () => { await pending.catch(() => {}); await pool.end(); } };
}

export type HostedPersistence = Awaited<ReturnType<typeof openHostedPersistence>>;
