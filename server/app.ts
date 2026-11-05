import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { Store } from './store.ts';
import { categories, requestSchema, policySchema, units, offlineReview, validateReview, money, type Person, type Policy, type SpendRequest, type Task } from './domain.ts';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { installWorkspace, publicMember } from './workspace.ts';
import {installTestnet} from './testnet.ts';

export function createApp(store: Store, options: { aiEndpoint?: string; aiToken?: string } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cache-Control', 'no-store');
    if (req.path.startsWith('/api') && !['localhost', '127.0.0.1'].includes(req.hostname)) return res.status(403).json({ error: 'This prototype accepts loopback access only.' });
    const origin = req.get('origin');
    if (req.path.startsWith('/api') && origin && !['http://localhost:4310', 'http://127.0.0.1:4310'].includes(origin)) return res.status(403).json({ error: 'Origin not allowed.' });
    if (req.path.startsWith('/api') && !['GET', 'HEAD'].includes(req.method) && req.get('x-allowance-client') !== 'local-prototype') return res.status(403).json({ error: 'Use the local application to make changes.' });
    next();
  });
  app.use(express.json({ limit: '1500kb' }));
  const person = (req: Request): Person | undefined => { const c = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('allowance_session=')); return c ? store.personForSession(c.slice('allowance_session='.length)) : undefined; };
  const auth = (req: Request, res: Response, next: NextFunction) => { const p = person(req); if (!p?.active) return res.status(401).json({ error: 'Sign in to continue.' }); res.locals.person = p; next(); };
  const owner = (_req: Request, res: Response, next: NextFunction) => res.locals.person.role === 'owner' ? next() : res.status(403).json({ error: 'Only the owner can do this.' });
  const visible = (res: Response, r: SpendRequest) => res.locals.person.role === 'owner' || r.requesterId === res.locals.person.id;
  let aiState: { connected: boolean; lastChecked: string | null; model: string | null; message: string } = { connected: false, lastChecked: null, model: null, message: 'Connection has not been tested yet.' };
  const endpoint = () => options.aiEndpoint || process.env.N8N_REVIEW_URL || 'http://127.0.0.1:5679/webhook/allowance-review-v1';
  const aiToken = () => options.aiToken || process.env.ALLOWANCE_N8N_TOKEN || (existsSync('.local/n8n-token.bin') ? readFileSync('.local/n8n-token.bin', 'utf8').trim() : '');
  async function review(r: SpendRequest) {
    try {
      const response = await fetch(endpoint(), {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-allowance-token': aiToken() },
        body: JSON.stringify({ request: { title: r.title, purpose: r.purpose, amount: money(r.amount), currency: 'XLM', category: r.category, requester: store.get('people',r.requesterId), evidenceSupplied: !!(r.evidenceUrl || r.evidenceId), attachment: r.evidenceId ? 'File retained for human review; contents not inspected by the AI.' : null }, task: store.get('tasks', r.taskId), supplier: store.suppliers().find(s => s.id === r.supplierId), policy: { description: store.policy().description, perRequest: money(store.policy().perRequest), autoLimit: money(store.policy().autoLimit) } }),
        signal: AbortSignal.timeout(110000),
      });
      if (!response.ok) throw new Error(`n8n returned HTTP ${response.status}.`);
      const raw = await response.json(); const result = validateReview(raw);
      aiState = { connected: true, lastChecked: new Date().toISOString(), model: result.model || null, message: 'A real model review completed through local n8n and Relmio.' };
      store.setReview(r.id, result);
    } catch (e) {
      aiState = { connected: false, lastChecked: new Date().toISOString(), model: null, message: e instanceof Error && /HTTP/.test(e.message) ? e.message : 'AI connection unavailable. Check n8n and Relmio sign-in.' };
      store.setReview(r.id, offlineReview());
    }
  }
  installWorkspace(app, store, { auth, owner, callAI: async body => {
    const response = await fetch(endpoint(), {method:'POST',headers:{'content-type':'application/json','x-allowance-token':aiToken()},body:JSON.stringify(body),signal:AbortSignal.timeout(110000)});
    if(!response.ok) throw new Error('AI service unavailable.'); return response.json();
  }, connected: model => {aiState={connected:true,lastChecked:new Date().toISOString(),model:model||null,message:'Real role-aware response completed through Relmio and n8n.'};} });
  installTestnet(app,store,auth,owner);
  app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Allowance', paymentMode: 'simulated' }));
  app.delete('/api/session', auth, (req, res) => { const p = req.headers.cookie?.match(/allowance_session=([^;]+)/)?.[1]; if (p) store.db.prepare('DELETE FROM sessions WHERE token=?').run(p); res.clearCookie('allowance_session'); res.json({ ok: true }); });
  app.post('/api/evidence', auth, (req, res) => {
    const v = z.object({ name: z.string().min(1).max(120), mime: z.enum(['image/png', 'image/jpeg', 'application/pdf']), data: z.string().max(1400000) }).parse(req.body);
    const bytes = Buffer.from(v.data, 'base64'); if (!bytes.length || bytes.length > 1000000) return res.status(400).json({ error: 'Use a PNG, JPEG, or PDF under 1 MB.' });
    const magic = bytes.subarray(0, 4).toString('hex'); if ((v.mime === 'image/png' && magic !== '89504e47') || (v.mime === 'image/jpeg' && !magic.startsWith('ffd8ff')) || (v.mime === 'application/pdf' && bytes.subarray(0, 5).toString() !== '%PDF-')) return res.status(400).json({ error: 'The file contents do not match its type.' });
    const id = randomUUID(); mkdirSync('.local/evidence', { recursive: true }); writeFileSync(`.local/evidence/${id}.bin`, bytes, { mode: 0o600 });
    const record = { id, name: v.name.replace(/[^a-zA-Z0-9 ._-]/g, '_'), mime: v.mime, size: bytes.length, personId: res.locals.person.id, sha256: createHash('sha256').update(bytes).digest('hex') };
    store.put('evidence', id, record); res.json(record);
  });
  app.get('/api/evidence/:id', auth, (req, res) => { const record = store.get<any>('evidence', String(req.params.id)); if (!record || (res.locals.person.role !== 'owner' && record.personId !== res.locals.person.id)) return res.status(404).json({ error: 'Evidence not found.' }); res.setHeader('content-type', record.mime); res.setHeader('content-disposition', `attachment; filename="${record.name}"`); res.send(readFileSync(`.local/evidence/${record.id}.bin`)); });
  app.get('/api/bootstrap', auth, (_req, res) => {
    const p = res.locals.person as Person; const requests = store.requests().filter(r => p.role === 'owner' || r.requesterId === p.id);
    const tasks = store.tasks().filter(t => p.role === 'owner' || t.assigneeId === p.id);
    const projectIds = new Set(tasks.map(t => t.projectId));
    res.json({ messages: store.list<any>('chat').filter(m => m.personId === p.id).sort((a,b) => a.createdAt.localeCompare(b.createdAt)).slice(-40), person: publicMember(store,p), people: p.role === 'owner' ? store.people().map(x=>publicMember(store,x)) : [publicMember(store,p)], projects: store.projects().filter(pr => p.role === 'owner' || projectIds.has(pr.id)).map(pr => ({ ...pr, committed: store.committed(pr.id) })), tasks, suppliers: store.suppliers(), policy: store.policy(), requests: requests.map(r => ({ ...r, checks: store.checks(r) })), events: store.events().filter(e => p.role === 'owner' || (e.requestId && requests.some(r => r.id === e.requestId))), categories, ai: aiState, integrations: { payments: 'simulated', wallet: false, velo: false, noir: false, n8nUrl: 'http://localhost:5679', allDataIsFictional: true } });
  });
  app.post('/api/requests', auth, (req, res) => {
    const input = requestSchema.parse(req.body); const p = res.locals.person as Person;
    const task = store.get<Task>('tasks', input.taskId); if (!task || task.assigneeId !== p.id) return res.status(403).json({ error: 'Choose a task assigned to your member account.' });
    if (input.evidenceId && store.get<any>('evidence', input.evidenceId)?.personId !== p.id) return res.status(400).json({ error: 'Attach evidence uploaded by your own identity.' });
    const now = new Date().toISOString();
    const r: SpendRequest = { ...input, id: `REQ-${randomUUID().slice(0, 8).toUpperCase()}`, projectId: task.projectId, requesterId: p.id, amount: units(input.amount), status: 'analyzing', createdAt: now, updatedAt: now, policyVersion: store.policy().version, profileVersion:p.profileVersion||0, reasons: [], ai: null, mode: input.mode, receipt: null, comment: '' };
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
    const kind = String(req.params.kind), id = randomUUID(); let record: unknown;
    if (kind === 'people') { const v = z.object({ name: z.string().trim().min(2).max(80), title: z.string().trim().min(2).max(100) }).parse(req.body); record = { ...v, id, role: 'member', initials: v.name.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase(), active: true }; }
    else if (kind === 'projects') { const v = z.object({ name: z.string().trim().min(3).max(100), description: z.string().trim().min(5).max(600), budget: z.string() }).parse(req.body); record = { ...v, id, budget: units(v.budget), active: true }; }
    else if (kind === 'tasks') { const v = z.object({ title: z.string().trim().min(3).max(120), description: z.string().trim().min(10).max(1200), projectId: z.string(), assigneeId: z.string() }).parse(req.body); if (!store.projects().some(p => p.id === v.projectId && p.active) || !store.people().some(p => p.id === v.assigneeId && p.active && p.role === 'member')) return res.status(400).json({ error: 'Choose an active project and team member.' }); record = { ...v, id, active: true }; }
    else if (kind === 'suppliers') { const v = z.object({ name: z.string().trim().min(2).max(100), domain: z.string().trim().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i), category: z.enum(categories), approved: z.boolean() }).parse(req.body); record = { ...v, id, destination: 'Demo merchant record; wallet not connected' }; }
    else return res.status(404).json({ error: 'Setup record type not found.' });
    if (store.list(kind).length >= 200) return res.status(400).json({ error: 'This local prototype supports up to 200 records of each type.' });
    store.put(kind, id, record); store.event('Workspace setup updated', `Added ${kind} record. No account invitation, supplier message, or payment was sent.`, res.locals.person.name, null, 'policy'); res.status(201).json(record);
  });
  app.post('/api/ai/test', auth, owner, async (_req, res) => {
    try {
      const response = await fetch(endpoint(), { method: 'POST', headers: { 'content-type': 'application/json', 'x-allowance-token': aiToken() }, body: JSON.stringify({ connectionTest: true }), signal: AbortSignal.timeout(110000) });
      if (!response.ok) throw new Error(`n8n returned HTTP ${response.status}.`);
      const raw = await response.json(); if (!raw.summary) throw new Error('No model response returned.');
      aiState = { connected: true, lastChecked: new Date().toISOString(), model: raw.model || null, message: raw.summary }; res.json(aiState);
    } catch (e) { aiState = { connected: false, lastChecked: new Date().toISOString(), model: null, message: e instanceof Error && /HTTP/.test(e.message) ? e.message : 'Start local n8n and check the Relmio account grant.' }; res.status(503).json({ ...aiState, error: aiState.message }); }
  });
  app.get('/api/export', auth, owner, (_req, res) => { res.setHeader('content-type', 'text/csv; charset=utf-8'); res.setHeader('content-disposition', 'attachment; filename="allowance-expenses.csv"'); const esc = (v: unknown) => '"' + String(v ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"'; res.send([['Request', 'Title', 'Person', 'Project', 'Amount XLM', 'Status', 'Mode', 'Receipt', 'Created'], ...store.requests().map(r => [r.id, r.title, store.get<Person>('people', r.requesterId)?.name, r.projectId, money(r.amount), r.status, r.mode, r.receipt, r.createdAt])].map(row => row.map(esc).join(',')).join('\r\n')); });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { const e = error as { name?: string; issues?: { message: string }[]; message?: string }; if (e.name === 'ZodError') return res.status(400).json({ error: e.issues?.map(i => i.message).join(' ') || 'Check the form values.' }); return res.status(400).json({ error: e.message || 'The request could not be completed.' }); });
  return app;
}
