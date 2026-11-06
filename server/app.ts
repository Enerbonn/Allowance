import { createSetupRecord, isSetupKind } from './setup.ts';
import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { Store } from './store.ts';
import { categories, requestSchema, policySchema, units, offlineReview, validateReview, money, type Person, type Policy, type SpendRequest, type Task } from './domain.ts';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { dataDirectory } from './protected-storage.ts';
import { z } from 'zod';
import { installWorkspace, publicMember, assistantMember } from './workspace.ts';
import { redact, requestsOverride, reviewInstructions } from './assistant-safety.ts';
import { createAiClient } from './ai.ts';
import {installTestnet} from './testnet.ts';

export function createApp(store: Store, options: { aiEndpoint?: string; aiToken?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const publicOrigin = process.env.ALLOWANCE_PUBLIC_ORIGIN;
  const allowedOrigins = publicOrigin ? [publicOrigin] : ['http://localhost:4310', 'http://127.0.0.1:4310'];
  const proxyToken = Buffer.from(process.env.ALLOWANCE_PROXY_TOKEN || '');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cache-Control', 'no-store');
    if (req.path.startsWith('/api')) {
      const isHealth = req.path === '/api/health' && req.method === 'GET';
      if (publicOrigin && !isHealth) {
        const supplied = Buffer.from(req.get('x-allowance-proxy') || '');
        if (proxyToken.length < 24 || supplied.length !== proxyToken.length || !timingSafeEqual(supplied, proxyToken)) {
          return res.status(403).json({ error: 'Use the Allowance website to access this workspace.' });
        }
      } else if (!publicOrigin && !['localhost', '127.0.0.1'].includes(req.hostname)) {
        return res.status(403).json({ error: 'This workspace accepts loopback access only.' });
      }
      const origin = req.get('origin');
      if (origin && !allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Origin not allowed.' });
      if (!['GET', 'HEAD'].includes(req.method) && req.get('x-allowance-client') !== 'local-prototype') {
        return res.status(403).json({ error: 'Use the Allowance application to make changes.' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '1500kb' }));
  const person = (req: Request): Person | undefined => { const c = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('allowance_session=')); const account = c ? store.personForSession(c.slice('allowance_session='.length)) : undefined; return account?.email ? account : undefined; };
  const auth = (req: Request, res: Response, next: NextFunction) => { const p = person(req); if (!p?.active) return res.status(401).json({ error: 'Sign in to continue.' }); res.locals.person = p; next(); };
  const owner = (_req: Request, res: Response, next: NextFunction) => res.locals.person.role === 'owner' ? next() : res.status(403).json({ error: 'Only the owner can do this.' });
  const visible = (res: Response, r: SpendRequest) => res.locals.person.role === 'owner' || r.requesterId === res.locals.person.id;
  const ai = createAiClient(options);
  let aiState = { provider: ai.provider, connected: false, lastChecked: null as string | null, model: null as string | null, message: ai.message };
  const aiConnected = (model?: string) => {
    aiState = { ...aiState, connected: true, lastChecked: new Date().toISOString(), model: model || null, message: `Received a valid response through ${ai.provider}.` };
  };
  const aiFailed = (error: unknown) => {
    aiState = { ...aiState, connected: false, lastChecked: new Date().toISOString(), model: null, message: ai.errorMessage(error) };
  };
  async function review(r: SpendRequest) {
    try {
      if (requestsOverride(r.title + ' ' + r.purpose)) {
        store.setReview(r.id, { ...offlineReview(), summary: 'This request asks to bypass the spending rules. The owner must review it.' });
        return;
      }
      const raw = await ai.call({ agentInstructions: reviewInstructions, checks: store.checks(r), request: { title: r.title, purpose: r.purpose, amount: money(r.amount), currency: 'XLM', category: r.category, requester: assistantMember(store, store.get<Person>('people',r.requesterId)!), evidenceSupplied: !!(r.evidenceUrl || r.evidenceId), attachment: r.evidenceId ? 'File retained for human review; contents not inspected by the AI.' : null }, task: store.get('tasks', r.taskId), supplier: store.suppliers().find(s => s.id === r.supplierId), policy: { description: store.policy().description, perRequest: money(store.policy().perRequest), autoLimit: money(store.policy().autoLimit) } });
      const result = validateReview(raw, ai.provider ?? undefined);
      aiConnected(result.model);
      store.setReview(r.id, { ...result, summary: redact(result.summary), reasoning: result.reasoning.map(redact), missingInformation: result.missingInformation.map(redact) });
    } catch (error) {
      aiFailed(error);
      store.setReview(r.id, offlineReview());
    }
  }
  const testnet = installTestnet(app,store,auth,owner);
  installWorkspace(app, store, { auth, owner, sessionPerson: person, callAI: ai.call, connected: aiConnected, failed: aiFailed, testnet });
  app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Allowance', paymentMode: 'simulated' }));
  app.delete('/api/session', auth, (req, res) => { const p = req.headers.cookie?.match(/allowance_session=([^;]+)/)?.[1]; if (p) store.db.prepare('DELETE FROM sessions WHERE token=?').run(p); res.clearCookie('allowance_session', { httpOnly:true, secure:!!publicOrigin, sameSite:'strict' }); res.json({ ok: true }); });
  app.post('/api/evidence', auth, (req, res) => {
    const v = z.object({ name: z.string().min(1).max(120), mime: z.enum(['image/png', 'image/jpeg', 'application/pdf']), data: z.string().max(1400000) }).parse(req.body);
    const bytes = Buffer.from(v.data, 'base64'); if (!bytes.length || bytes.length > 1000000) return res.status(400).json({ error: 'Use a PNG, JPEG, or PDF under 1 MB.' });
    const magic = bytes.subarray(0, 4).toString('hex'); if ((v.mime === 'image/png' && magic !== '89504e47') || (v.mime === 'image/jpeg' && !magic.startsWith('ffd8ff')) || (v.mime === 'application/pdf' && bytes.subarray(0, 5).toString() !== '%PDF-')) return res.status(400).json({ error: 'The file contents do not match its type.' });
    const id = randomUUID(); mkdirSync(resolve(dataDirectory(), 'evidence'), { recursive: true }); writeFileSync(resolve(dataDirectory(), 'evidence', id+'.bin'), bytes, { mode: 0o600 });
    const record = { id, name: v.name.replace(/[^a-zA-Z0-9 ._-]/g, '_'), mime: v.mime, size: bytes.length, personId: res.locals.person.id, sha256: createHash('sha256').update(bytes).digest('hex') };
    store.put('evidence', id, record); res.json(record);
  });
  app.get('/api/evidence/:id', auth, (req, res) => { const record = store.get<any>('evidence', String(req.params.id)); if (!record || (res.locals.person.role !== 'owner' && record.personId !== res.locals.person.id)) return res.status(404).json({ error: 'Evidence not found.' }); res.setHeader('content-type', record.mime); res.setHeader('content-disposition', `attachment; filename="${record.name}"`); res.send(readFileSync(resolve(dataDirectory(), 'evidence', record.id+'.bin'))); });
  app.get('/api/bootstrap', auth, (_req, res) => {
    const p = res.locals.person as Person; const requests = store.requests().filter(r => p.role === 'owner' || r.requesterId === p.id);
    const tasks = store.tasks().filter(t => p.role === 'owner' || t.assigneeId === p.id);
    const projectIds = new Set(tasks.map(t => t.projectId));
    res.json({ messages: store.list<any>('chat').filter(m => m.personId === p.id).sort((a,b) => a.createdAt.localeCompare(b.createdAt)).slice(-40).map(message => ({ ...message, proposals: message.proposals?.map((proposal: { id: string }) => store.get('proposals', proposal.id) || proposal) })), person: publicMember(store,p), people: p.role === 'owner' ? store.people().map(x=>publicMember(store,x)) : [publicMember(store,p)], projects: store.projects().filter(pr => p.role === 'owner' || projectIds.has(pr.id)).map(pr => ({ ...pr, committed: store.committed(pr.id) })), tasks, suppliers: store.suppliers(), policy: store.policy(), requests: requests.map(r => ({ ...r, checks: store.checks(r) })), events: store.events().filter(e => p.role === 'owner' || (e.requestId && requests.some(r => r.id === e.requestId))), categories, ai: aiState, integrations: { payments: 'simulated', wallet: false, velo: false, noir: false, n8nUrl: 'http://localhost:5679', sampleWorkspace: store.setting('workspace-kind') !== 'blank' } });
  });
  app.post('/api/requests', auth, (req, res) => {
    const input = requestSchema.parse(req.body); const p = res.locals.person as Person;
    const task = store.get<Task>('tasks', input.taskId); if (!task || task.assigneeId !== p.id) return res.status(403).json({ error: 'Choose a task assigned to your member account.' });
    if (input.evidenceId && store.get<any>('evidence', input.evidenceId)?.personId !== p.id) return res.status(400).json({ error: 'Attach evidence uploaded by your own identity.' });
    const now = new Date().toISOString();
    const r: SpendRequest = { ...input, title: redact(input.title), purpose: redact(input.purpose), id: `REQ-${randomUUID().slice(0, 8).toUpperCase()}`, projectId: task.projectId, requesterId: p.id, amount: units(input.amount), status: 'analyzing', createdAt: now, updatedAt: now, policyVersion: store.policy().version, profileVersion:p.profileVersion||0, reasons: [], ai: null, mode: input.mode, receipt: null, comment: '' };
    const created = store.create(r); if (!created.duplicate) void review(r);
    res.status(created.duplicate ? 200 : 202).json(created);
  });
  app.post('/api/requests/:id/review', auth, (req, res) => { const r = store.request(String(req.params.id)); if (!r || !visible(res, r)) return res.status(404).json({ error: 'Request not found.' }); if (!['needs_review', 'blocked'].includes(r.status)) return res.status(409).json({ error: 'This request cannot be reviewed again.' }); r.status = 'analyzing'; store.saveRequest(r); void review(r); res.json(r); });
  app.post('/api/requests/:id/decision', auth, owner, (req, res) => {
    const r = store.request(String(req.params.id)); if (!r) return res.status(404).json({ error: 'Request not found.' });
    const action = req.body.action; const note = String(req.body.note || '').trim().slice(0, 1500);
    if (action === 'approve') { if (!note) return res.status(400).json({ error: 'Add an approval note for the audit record.' }); const paid = store.pay(r.id, res.locals.person.name); paid.comment = note; store.saveRequest(paid); return res.json(paid); }
    if (action === 'decline') { if (!['needs_review', 'blocked'].includes(r.status)) return res.status(409).json({ error: 'This request cannot be declined now.' }); if (!note) return res.status(400).json({ error: 'Explain why the request is declined.' }); r.status = 'declined'; r.comment = note; store.saveRequest(r); store.event('Request declined', note, res.locals.person.name, r.id, 'review'); return res.json(r); }
    return res.status(400).json({ error: 'Choose approve or decline.' });
  });
  app.post('/api/requests/:id/cancel', auth, (req, res) => { const r = store.request(String(req.params.id)); if (!r || !visible(res, r)) return res.status(404).json({ error: 'Request not found.' }); if (!['analyzing', 'needs_review', 'blocked'].includes(r.status)) return res.status(409).json({ error: 'A completed or declined request cannot be cancelled.' }); r.status = 'cancelled'; store.saveRequest(r); store.event('Request cancelled', 'No simulated payment was made.', res.locals.person.name, r.id); res.json(r); });
  app.put('/api/policy', auth, owner, (req, res) => {
    const input = policySchema.parse(req.body); const perRequest = units(input.perRequest), autoLimit = units(input.autoLimit), projectLimit = units(input.projectLimit);
    if (autoLimit > perRequest || perRequest > projectLimit) return res.status(400).json({ error: 'Automatic limit must not exceed the request limit, and request limit must not exceed the project limit.' });
    const policy: Policy = { ...input, id: 'main', version: store.policy().version + 1, perRequest, autoLimit, projectLimit };
    store.put('policy', 'main', policy); store.event('Spending policy updated', `Version ${policy.version} is active. ${policy.paused ? 'New spending is paused.' : 'Spending checks use the latest rules.'}`, res.locals.person.name, null, 'policy'); res.json(policy);
  });
  app.post('/api/team/:id/toggle', auth, owner, (req, res) => { const p = store.get<Person>('people', String(req.params.id)); if (!p || p.role === 'owner') return res.status(400).json({ error: 'Choose a team member.' }); p.active = !p.active; store.put('people', p.id, p); store.event(p.active ? 'Member access restored' : 'Member access paused', p.name, res.locals.person.name, null, 'policy'); res.json(p); });
  app.post('/api/setup/:kind', auth, owner, (req, res) => {
    const kind = String(req.params.kind);
    if (!isSetupKind(kind)) return res.status(404).json({ error: 'Setup record type not found.' });
    if (kind === 'people' && typeof req.body.email === 'string' && store.people().some(p => p.email === req.body.email.trim().toLowerCase())) {
      return res.status(409).json({ error: 'That email is already assigned in this workspace.' });
    }
    res.status(201).json(createSetupRecord(store, kind, req.body, res.locals.person.name));
  });
  app.post('/api/ai/test', auth, owner, async (_req, res) => {
    try {
      const raw = await ai.call({ connectionTest: true });
      const result = z.object({ summary: z.string().min(1).max(1200), model: z.string().max(120).optional() }).parse(raw);
      aiConnected(result.model);
      res.json(aiState);
    } catch (error) {
      aiFailed(error);
      res.status(503).json({ ...aiState, error: aiState.message });
    }
  });
  app.get('/api/export', auth, owner, (_req, res) => { res.setHeader('content-type', 'text/csv; charset=utf-8'); res.setHeader('content-disposition', 'attachment; filename="allowance-expenses.csv"'); const esc = (v: unknown) => '"' + String(v ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"'; res.send([['Request', 'Title', 'Person', 'Project', 'Amount XLM', 'Status', 'Mode', 'Receipt', 'Created'], ...store.requests().map(r => [r.id, r.title, store.get<Person>('people', r.requesterId)?.name, r.projectId, money(r.amount), r.status, r.mode, r.receipt, r.createdAt])].map(row => row.map(esc).join(',')).join('\r\n')); });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { const e = error as { name?: string; issues?: { message: string }[]; message?: string }; if (e.name === 'ZodError') return res.status(400).json({ error: e.issues?.map(i => i.message).join(' ') || 'Check the form values.' }); return res.status(400).json({ error: e.message || 'The request could not be completed.' }); });
  return app;
}
