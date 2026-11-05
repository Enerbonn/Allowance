import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { money, policyChecks, SCALE, type Policy, type Person, type Project, type Task, type Supplier, type SpendRequest, type Event, type Review } from './domain.ts';

export class Store {
  db: DatabaseSync;
  constructor(path = '.local/allowance.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY,idempotency TEXT UNIQUE NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commitments(request_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,person_id TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    if (!this.list('people').length) this.seed();
    // An interrupted review remains visible and does not create an untracked payment.
    for (const r of this.requests()) if (r.status === 'analyzing') { r.status = 'needs_review'; r.reasons = ['Review was interrupted. Retry AI review or ask the owner.']; this.saveRequest(r); }
  }
  close() { this.db.close(); }
  list<T>(kind: string): T[] { return (this.db.prepare('SELECT data FROM records WHERE kind=?').all(kind) as { data: string }[]).map(r => JSON.parse(r.data)); }
  get<T>(kind: string, id: string): T | undefined { const r = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id) as { data: string } | undefined; return r ? JSON.parse(r.data) : undefined; }
  put(kind: string, id: string, value: unknown) { this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind, id, JSON.stringify(value)); }
  people() { return this.list<Person>('people').sort((a,b) => Number(b.role === 'owner') - Number(a.role === 'owner') || a.name.localeCompare(b.name)); }
  projects() { return this.list<Project>('projects'); }
  tasks() { return this.list<Task>('tasks'); }
  suppliers() { return this.list<Supplier>('suppliers'); }
  policy() { return this.get<Policy>('policy', 'main')!; }
  requests(): SpendRequest[] { return (this.db.prepare('SELECT data FROM requests ORDER BY rowid DESC').all() as { data: string }[]).map(r => JSON.parse(r.data)); }
  request(id: string) { const r = this.db.prepare('SELECT data FROM requests WHERE id=?').get(id) as { data: string } | undefined; return r ? JSON.parse(r.data) as SpendRequest : undefined; }
  saveRequest(r: SpendRequest) { r.updatedAt = new Date().toISOString(); this.db.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(r), r.id); }
  events(): Event[] { return (this.db.prepare('SELECT data FROM events ORDER BY rowid DESC LIMIT 200').all() as { data: string }[]).map(r => JSON.parse(r.data)); }
  event(title: string, detail: string, actor: string, requestId: string | null = null, kind = 'info') {
    const e: Event = { id: randomUUID(), requestId, title, detail, actor, kind, createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO events VALUES(?,?)').run(e.id, JSON.stringify(e)); return e;
  }
  committed(projectId: string, excluding?: string) { const r = this.db.prepare("SELECT COALESCE(SUM(amount),0) total FROM commitments WHERE project_id=? AND state IN ('reserved','paid') AND request_id<>?").get(projectId, excluding ?? '') as { total: number }; return r.total; }
  memberSpent(personId: string, excluding = '') { return this.requests().filter(r => r.requesterId === personId && r.id !== excluding && ['paid','authorized'].includes(r.status)).reduce((sum,r) => sum + r.amount, 0); }
  checks(r: SpendRequest) { const p = this.get<Person>('people', r.requesterId)!; return [...policyChecks(r, p, this.get<Task>('tasks', r.taskId), this.get<Supplier>('suppliers', r.supplierId), this.get<Project>('projects', r.projectId), this.policy(), this.committed(r.projectId, r.id)), {label:'Member allowance',pass:p.budget === undefined || this.memberSpent(p.id,r.id)+r.amount<=p.budget,detail:p.budget === undefined ? 'Workspace limits apply.' : `${money(Math.max(0,p.budget-this.memberSpent(p.id,r.id)))} XLM of this member’s total allowance remains.`}, {label:'Member purchasing categories',pass:!p.allowedCategories || p.allowedCategories.includes(r.category),detail:'The member’s permitted categories also apply.'}]; }
  create(r: SpendRequest) {
    const prior = this.db.prepare('SELECT data FROM requests WHERE idempotency=?').get(r.idempotencyKey) as { data: string } | undefined;
    if (prior) { const old = JSON.parse(prior.data) as SpendRequest; if (old.requesterId !== r.requesterId) throw new Error('Request key belongs to another member.'); return { request: old, duplicate: true }; }
    this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(r.id, r.idempotencyKey, JSON.stringify(r));
    this.event('Request received', r.title, this.get<Person>('people', r.requesterId)!.name, r.id); return { request: r, duplicate: false };
  }
  setReview(id: string, ai: Review) {
    const r = this.request(id)!; if (r.status !== 'analyzing') return r;
    r.ai = ai; const checks = this.checks(r); r.reasons = checks.filter(c => !c.pass).map(c => c.detail);
    r.status = r.reasons.length ? 'blocked' : 'needs_review';
    this.saveRequest(r); this.event('Review completed', ai.summary, ai.provider, r.id, 'review');
    const p = this.policy();
    if (r.policyVersion !== p.version || (r.profileVersion!==undefined && r.profileVersion!==(this.get<Person>('people',r.requesterId)?.profileVersion||0))) { r.status = 'needs_review'; r.reasons.push('Policy changed during the review. The owner must review the current rules.'); this.saveRequest(r); return r; }
    if (r.mode === 'simulated' && r.status === 'needs_review' && ai.provider === 'Relmio via local n8n' && ai.recommendation === 'approve' && !ai.missingInformation.length && p.autoPay && r.amount <= p.autoLimit) return this.pay(id, 'Policy-approved assistant');
    return r;
  }
  pay(id: string, actor: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = this.request(id); if (!r) throw new Error('Request not found.');
      if (r.mode === 'testnet') throw new Error('Use the Testnet payment action. A simulator cannot settle this request.');
      if (r.status === 'paid') { this.db.exec('COMMIT'); return r; }
      if (!['needs_review', 'blocked'].includes(r.status)) throw new Error('This request is not available for payment.');
      const checks = this.checks(r); const failed = checks.filter(c => !c.pass);
      if (failed.length) throw new Error(failed.map(c => c.detail).join(' '));
      if (r.policyVersion !== this.policy().version) { r.policyVersion = this.policy().version; }
      this.db.prepare("INSERT INTO commitments VALUES(?,?,?,'paid') ON CONFLICT(request_id) DO NOTHING").run(r.id, r.projectId, r.amount);
      r.status = 'paid'; r.mode = 'simulated'; r.receipt = `SIM-${randomUUID().slice(0, 8).toUpperCase()}`; r.reasons = [];
      this.saveRequest(r);
      this.event('Simulated payment completed', `${money(r.amount)} XLM allocated to ${this.get<Supplier>('suppliers', r.supplierId)!.name}. No blockchain transaction occurred.`, actor, r.id, 'payment');
      this.db.exec('COMMIT'); return r;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  session(personId: string) { const token = randomBytes(32).toString('hex'); this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token, personId, Date.now() + 12 * 3600000); return token; }
  personForSession(token: string) { const s = this.db.prepare('SELECT person_id FROM sessions WHERE token=? AND expires>?').get(token, Date.now()) as { person_id: string } | undefined; return s ? this.get<Person>('people', s.person_id) : undefined; }
  setting(key: string) { const s = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined; return s?.value; }
  setSetting(key: string, value: string) { this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  seed() {
    const people: Person[] = [
      { id: 'owner', name: 'Alex Morgan', role: 'owner', title: 'Studio owner', initials: 'AM', active: true },
      { id: 'maya', name: 'Maya Chen', role: 'member', title: 'Brand designer', initials: 'MC', active: true },
      { id: 'leo', name: 'Leo Santos', role: 'member', title: 'Video editor', initials: 'LS', active: true },
    ]; people.forEach(p => this.put('people', p.id, p));
    const projects: Project[] = [
      { id: 'launch', name: 'Northstar brand launch', description: 'Identity, launch assets, and a story worth sharing.', budget: 500 * SCALE, active: true },
      { id: 'motion', name: 'Fieldnotes film', description: 'A short documentary for an independent brand.', budget: 300 * SCALE, active: true },
    ]; projects.forEach(p => this.put('projects', p.id, p));
    const tasks: Task[] = [
      { id: 'identity', projectId: 'launch', assigneeId: 'maya', title: 'Build the launch identity', description: 'Create visual identity and presentation assets. Licensed fonts, imagery, and design software are relevant.', active: true },
      { id: 'campaign', projectId: 'launch', assigneeId: 'maya', title: 'Prepare campaign artwork', description: 'Prepare social images and launch graphics.', active: true },
      { id: 'edit', projectId: 'motion', assigneeId: 'leo', title: 'Edit the brand film', description: 'Edit recorded footage, transcribe interviews, and license music.', active: true },
    ]; tasks.forEach(t => this.put('tasks', t.id, t));
    const suppliers: Supplier[] = [
      { id: 'typefoundry', name: 'Type Foundry', category: 'Creative assets', domain: 'typefoundry.example', approved: true, destination: 'Demo merchant A' },
      { id: 'framekit', name: 'Framekit', category: 'Creative assets', domain: 'framekit.example', approved: true, destination: 'Demo merchant B' },
      { id: 'transcribe', name: 'Clearword', category: 'Software', domain: 'clearword.example', approved: true, destination: 'Demo merchant C' },
      { id: 'unverified', name: 'New supplier', category: 'Services', domain: 'unverified.example', approved: false, destination: 'Not verified' },
    ]; suppliers.forEach(s => this.put('suppliers', s.id, s));
    this.put('policy', 'main', { id: 'main', version: 1, perRequest: 100 * SCALE, autoLimit: 40 * SCALE, projectLimit: 500 * SCALE, allowedCategories: ['Software', 'Creative assets', 'Research', 'Services'], requireEvidence: true, autoPay: true, paused: false, description: 'Work resources must directly support an assigned, active task. Use approved suppliers. Personal purchases, account sharing, and unlicensed assets are not permitted. Unknown or ambiguous requests go to the owner.' } satisfies Policy);
    const examples = [
      { id: 'REQ-1042', title: 'Commercial font license', taskId: 'identity', projectId: 'launch', requesterId: 'maya', supplierId: 'typefoundry', category: 'Creative assets', amount: 28 * SCALE, purpose: 'A commercial font license for the Northstar brand identity and presentation.', status: 'paid', receipt: 'SIM-SAMPLE-1042', ai: null },
      { id: 'REQ-1043', title: 'Interview transcription credits', taskId: 'edit', projectId: 'motion', requesterId: 'leo', supplierId: 'transcribe', category: 'Software', amount: 62 * SCALE, purpose: 'Transcribe the client interviews so I can edit the Fieldnotes brand film accurately.', status: 'needs_review', receipt: null, ai: null },
      { id: 'REQ-1044', title: 'Campaign image collection', taskId: 'campaign', projectId: 'launch', requesterId: 'maya', supplierId: 'framekit', category: 'Creative assets', amount: 34 * SCALE, purpose: 'Licensed product and lifestyle images for the approved campaign artwork.', status: 'needs_review', receipt: null, ai: null },
      { id: 'REQ-1045', title: 'Personal workstation upgrade', taskId: 'edit', projectId: 'motion', requesterId: 'leo', supplierId: 'unverified', category: 'Equipment', amount: 160 * SCALE, purpose: 'An equipment upgrade that has not been approved in the project scope.', status: 'blocked', receipt: null, ai: null },
    ];
    examples.forEach((e, i) => {
      const r = { ...e, evidenceUrl: `https://${suppliers.find(s => s.id === e.supplierId)!.domain}/quote/sample`, createdAt: new Date(Date.now() - (4 - i) * 3600000).toISOString(), updatedAt: new Date().toISOString(), policyVersion: 1, reasons: e.status === 'blocked' ? ['Equipment is outside the approved policy.', 'This supplier needs owner verification.'] : [], mode: 'simulated', idempotencyKey: `sample-${e.id}`, comment: '' } as SpendRequest;
      this.create(r); if (r.status === 'paid') this.db.prepare("INSERT INTO commitments VALUES(?,?,?,'paid')").run(r.id, r.projectId, r.amount);
    });
    this.event('Sample workspace ready', 'All people, projects, suppliers, balances, and purchases in this workspace are fictional demonstration data.', 'Allowance', null, 'system');
  }
}
