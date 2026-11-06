import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RequestHandler } from 'express';
import { createApp, type AppOptions } from './app.ts';
import { emailSchema, type Person } from './domain.ts';
import { dataDirectory, workspaceStorage } from './protected-storage.ts';
import { Store } from './store.ts';
import { ownerSignupSchema, validOwnerSetupToken } from './workspace.ts';

const workspaceId = (email: string) => createHash('sha256').update(email).digest('hex');

export function createWorkspaceApp(primary: Store, config: AppOptions = {}) {
  const options = { publicSignup: false, ...config };
  const root = resolve(dataDirectory(), 'workspaces');
  const secure = Boolean(process.env.ALLOWANCE_PUBLIC_ORIGIN);
  const workspaces = new Map<string, { store: Store; app: ReturnType<typeof createApp> }>();
  const signupAttempts = new Map<string, { count: number; until: number }>();

  const dispatch: RequestHandler = (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const primaryOwner = primary.get<Person>('people', 'owner');
    let id: string | undefined;
    let create = false;
    if (req.method === 'POST' && req.path === '/api/auth/signup') {
      const input = ownerSignupSchema.parse(req.body);
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
      const now = Date.now();
      for (const [ip, attempt] of signupAttempts) if (attempt.until <= now) signupAttempts.delete(ip);
      const ip = (secure && req.get('x-allowance-client-ip')) || req.ip || 'local';
      const attempt = signupAttempts.get(ip) || { count: 0, until: now + 15 * 60_000 };
      if (attempt.count >= 5) return res.status(429).json({ error: 'Too many signups. Try again in 15 minutes.' });
      signupAttempts.set(ip, { ...attempt, count: attempt.count + 1 });
      create = true;
    } else if (req.method === 'POST' && req.path === '/api/auth/owner-email') {
      const candidate = emailSchema.safeParse(req.body?.email);
      if (candidate.success && existsSync(resolve(root, workspaceId(candidate.data), 'allowance.sqlite'))) {
        return res.status(409).json({ error: 'An owner account already uses this email. Use a different email for the older workspace.' });
      }
    } else if (req.method === 'POST' && req.path === '/api/session') {
      const candidate = emailSchema.safeParse(req.body?.role === 'owner' ? req.body.email : req.body?.workspaceEmail);
      if (candidate.success && candidate.data !== primaryOwner?.email) id = workspaceId(candidate.data);
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
