import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { RequestHandler } from 'express';
import { createApp, type AppOptions } from './app.ts';
import { emailSchema, type Event, type Person, type SpendRequest } from './domain.ts';
import { dataDirectory, workspaceStorage } from './protected-storage.ts';
import { Store } from './store.ts';
import { matchesMemberLogin, ownerSignupSchema, setAccessCode, validOwnerSetupToken, verifyAccessCode } from './workspace.ts';

const workspaceId = (email: string) => createHash('sha256').update(email).digest('hex');
const demoOwnerEmail = 'owner@allowance.example';

const demoRecordKinds = new Set(['people', 'policy', 'projects', 'tasks', 'suppliers', 'chat', 'memory']);
type DemoRecords = { records: {kind: string; id: string; data: unknown}[]; requests: SpendRequest[]; events: Event[] };

export function provisionHostedDemo(primary: Store, ownerCode?: string, memberCode?: string, recorded?: DemoRecords) {
  if (!ownerCode && !memberCode) return;
  if (!ownerCode || !memberCode || [ownerCode, memberCode].some(code => code.length < 8 || code.length > 128)) {
    console.warn('Hosted demo needs both access codes, each 8 to 128 characters.');
    return;
  }
  const path = resolve(dataDirectory(), 'workspaces', workspaceId(demoOwnerEmail), 'allowance.sqlite');
  const primaryIsDemo = primary.get<Person>('people', 'owner')?.email === demoOwnerEmail;
  const exists = primaryIsDemo || existsSync(path);
  const store = primaryIsDemo ? primary : new Store(path, { sampleData: !recorded, testnetSamples: true });
  try {
    if (exists) {
      if (!verifyAccessCode(store, 'owner', ownerCode) || !verifyAccessCode(store, 'maya', memberCode)) {
        console.warn('Hosted demo workspace already exists. Its credentials and records were kept.');
        return;
      }
      if (!recorded || store.setting('local-demo-records-imported')) return;
    }
    store.db.exec('BEGIN IMMEDIATE');
    try {
      if (recorded) {
        for (const {kind, id, data} of recorded.records) {
          if (!demoRecordKinds.has(kind) || (exists && store.get(kind, id))) continue;
          store.put(kind, id, kind === 'policy' ? { ...(data as object), autoTestnet: false } : data);
        }
        const addRequest = store.db.prepare('INSERT OR IGNORE INTO requests VALUES(?,?,?)');
        for (const request of recorded.requests) {
          if (request.mode !== 'testnet' || request.receipt || request.evidenceId ||
              !['declined', 'needs_review', 'blocked', 'cancelled'].includes(request.status)) continue;
          addRequest.run(request.id, request.idempotencyKey, JSON.stringify(request));
        }
        const addEvent = store.db.prepare('INSERT OR IGNORE INTO events VALUES(?,?)');
        for (const event of recorded.events) addEvent.run(event.id, JSON.stringify(event));
        store.setSetting('workspace-kind', 'sample');
        store.setSetting('local-demo-records-imported', '1');
      }
      if (!exists) {
        setAccessCode(store, 'owner', ownerCode);
        setAccessCode(store, 'maya', memberCode);
      }
      store.db.exec('COMMIT');
    } catch (error) {
      store.db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    if (!primaryIsDemo) store.close();
  }
}

export function createWorkspaceApp(primary: Store, config: AppOptions = {}) {
  const options = { publicSignup: true, ...config };
  const root = resolve(dataDirectory(), 'workspaces');
  const secure = Boolean(process.env.ALLOWANCE_PUBLIC_ORIGIN);
  const workspaces = new Map<string, { store: Store; app: ReturnType<typeof createApp> }>();
  const attempts = new Map<string, { count: number; until: number }>();
  function allowAttempt(key: string, limit: number) {
    const now = Date.now();
    if (attempts.size >= 2000) {
      for (const [id, attempt] of attempts) if (attempt.until <= now) attempts.delete(id);
      if (attempts.size >= 3000) return false;
    }
    const saved = attempts.get(key);
    const attempt = saved && saved.until > now ? saved : { count: 0, until: now + 15 * 60_000 };
    if (attempt.count >= limit) return false;
    attempts.set(key, { ...attempt, count: attempt.count + 1 });
    return true;
  }

  function memberWorkspace(email: string, code: string) {
    const candidates = existsSync(root) ? readdirSync(root, { withFileTypes: true }) : [];
    for (const entry of candidates) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const cached = workspaces.get(entry.name);
      if (cached) {
        if (matchesMemberLogin(cached.store.db, email, code)) return entry.name;
        continue;
      }
      const path = resolve(root, entry.name, 'allowance.sqlite');
      if (!existsSync(path)) continue;
      const db = new DatabaseSync(path, { readOnly: true });
      try {
        if (matchesMemberLogin(db, email, code)) return entry.name;
      } finally {
        db.close();
      }
    }
  }

  const dispatch: RequestHandler = (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const primaryOwner = primary.get<Person>('people', 'owner');
    const ip = (secure && req.get('x-allowance-client-ip')) || req.ip || 'local';
    let id: string | undefined;
    let create = false;
    if (req.method === 'POST' && req.path === '/api/auth/signup') {
      const input = ownerSignupSchema.parse(req.body);
      if (secure && input.email === demoOwnerEmail) {
        return res.status(409).json({ error: 'This email is reserved for the demo. Use your own email to create a workspace.' });
      }
      if (secure && !options.publicSignup && !validOwnerSetupToken(input.setupToken)) {
        return res.status(403).json({ error: 'Enter the owner setup token supplied by the deployment operator.' });
      }
      if (primaryOwner?.email === input.email && primary.get('credentials', 'owner')) {
        return res.status(409).json({ error: 'An owner account already uses this email. Choose Sign in.' });
      }
      id = workspaceId(input.email);
      if (existsSync(resolve(root, id, 'allowance.sqlite'))) {
        return res.status(409).json({ error: 'An owner account already uses this email. Choose Sign in.' });
      }
      if (!primary.get('credentials', 'owner')) return next();
      if (existsSync(root) && readdirSync(root).length >= 64) {
        return res.status(429).json({ error: 'This instance has reached its workspace limit.' });
      }
      if (!allowAttempt('signup:' + ip, 5)) {
        return res.status(429).json({ error: 'Too many signups. Try again in 15 minutes.' });
      }
      create = true;
    } else if (req.method === 'POST' && req.path === '/api/auth/owner-email') {
      const candidate = emailSchema.safeParse(req.body?.email);
      if (candidate.success && existsSync(resolve(root, workspaceId(candidate.data), 'allowance.sqlite'))) {
        return res.status(409).json({ error: 'An owner account already uses this email. Use a different email for the older workspace.' });
      }
    } else if (req.method === 'POST' && req.path === '/api/session') {
      const candidate = emailSchema.safeParse(req.body?.email);
      if (candidate.success && req.body.role === 'owner' && candidate.data !== primaryOwner?.email) {
        id = workspaceId(candidate.data);
      } else if (candidate.success && req.body.role === 'member') {
        const code = req.body.code;
        if (typeof code !== 'string' || !code || code.length > 128) return next();
        if (!allowAttempt('member:' + ip, 25)) {
          return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
        }
        if (matchesMemberLogin(primary.db, candidate.data, code)) return next();
        id = memberWorkspace(candidate.data, code);
      }
    } else {
      const match = req.headers.cookie?.match(/(?:^|;\s*)allowance_session=([a-f0-9]{64})\.([a-f0-9]{64})(?=;|$)/);
      if (match) {
        id = match[1];
        req.headers.cookie = req.headers.cookie!.replace(match[1] + '.' + match[2], match[2]);
      }
    }
    if (!id) return next();

    const directory = resolve(root, id);
    const database = resolve(directory, 'allowance.sqlite');
    let workspace = workspaces.get(id);
    if (!workspace) {
      if (!create && !existsSync(database)) {
        return res.status(401).json({ error: 'The email or private code is incorrect, or access is paused.' });
      }
      const store = new Store(database, { sampleData: false });
      workspace = { store, app: createApp(store, options) };
      workspaces.set(id, workspace);
    }

    res.locals.workspaceId = id;
    return workspaceStorage.run({ directory, id }, () => workspace.app(req, res, next));
  };

  return {
    app: createApp(primary, options, dispatch),
    closeWorkspaces: () => { for (const { store } of workspaces.values()) store.close(); },
  };
}
