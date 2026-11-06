import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from './store.ts';
import { units, money, offlineReview, type SpendRequest } from './domain.ts';

function candidate(s: Store, amount = '20', id = randomUUID()): SpendRequest {
  return { ...s.request('REQ-1044')!, id, idempotencyKey: randomUUID(), amount: units(amount), status: 'needs_review', receipt: null };
}
test('decimal money is exact down to the smallest unit and rejects exponent/negative/overflow', () => {
  assert.equal(units('0.0000001'), 1); assert.equal(units('0.1') + units('0.2'), units('0.3')); assert.equal(money(units('12.3456789')), '12.3456789');
  for (const input of ['-1', '0', '1e3', '1.12345678', '100001', 'NaN']) assert.throws(() => units(input));
});
test('repeated payment cannot create another expense or receipt', () => {
  const s = new Store(':memory:'); const r = candidate(s); s.create(r); const before = s.committed('launch');
  const paid = s.pay(r.id, 'Owner'); const again = s.pay(r.id, 'Owner');
  assert.equal(paid.receipt, again.receipt); assert.equal(s.committed('launch'), before + r.amount);
  assert.equal(s.events().filter(e => e.requestId === r.id && e.kind === 'payment').length, 1); s.close();
});
test('sequential competing payments cannot spend the same project allowance', () => {
  const s = new Store(':memory:'); const p = s.policy(); p.projectLimit = units('65'); s.put('policy', 'main', p);
  const a = candidate(s, '30'), b = candidate(s, '30'); s.create(a); s.create(b);
  s.pay(a.id, 'Owner'); assert.throws(() => s.pay(b.id, 'Owner'), /available/); assert.equal(s.request(b.id)!.status, 'needs_review');
  assert.equal(s.committed('launch'), units('58')); s.close();
});
test('owner cannot bypass hard category, budget, or paused-policy checks', () => {
  const s = new Store(':memory:'); assert.throws(() => s.pay('REQ-1045', 'Owner'), /Equipment/);
  const p = s.policy(); p.paused = true; s.put('policy', 'main', p); assert.throws(() => s.pay('REQ-1044', 'Owner'), /paused/);
  assert.equal(s.request('REQ-1044')!.status, 'needs_review'); s.close();
});
test('deactivated identity loses spending authority on existing requests', () => {
  const s = new Store(':memory:'); const p = s.people().find(p => p.id === 'maya')!; p.active = false; s.put('people', p.id, p);
  assert.throws(() => s.pay('REQ-1044', 'Owner'), /inactive/); s.close();
});
test('missing AI connection never silently approves or pays', () => {
  const s = new Store(':memory:'); const r = candidate(s); r.status = 'analyzing'; s.create(r); s.setReview(r.id, offlineReview());
  assert.equal(s.request(r.id)!.status, 'needs_review'); assert.equal(s.request(r.id)!.receipt, null); s.close();
});
test('automatic simulation requires real provider approval and no missing information', () => {
  const s = new Store(':memory:'); const r = candidate(s); r.status = 'analyzing'; s.create(r);
  s.setReview(r.id, { recommendation: 'approve', summary: 'Task related.', reasoning: [], missingInformation: ['Need quote details.'], provider: 'Relmio via local n8n' });
  assert.equal(s.request(r.id)!.status, 'needs_review'); s.close();
});
test('cancelled request is not revived by a late AI response', () => {
  const s = new Store(':memory:'); const r = candidate(s); r.status = 'cancelled'; s.create(r);
  s.setReview(r.id, { recommendation: 'approve', summary: 'Task related.', reasoning: [], missingInformation: [], provider: 'Relmio via local n8n' });
  assert.equal(s.request(r.id)!.status, 'cancelled'); assert.equal(s.request(r.id)!.receipt, null); s.close();
});
test('duplicate submit returns existing identity and refuses cross-user reuse', () => {
  const s = new Store(':memory:'); const r = candidate(s); s.create(r); const duplicate = s.create({ ...r, id: randomUUID() });
  assert.equal(duplicate.request.id, r.id); assert.equal(duplicate.duplicate, true);
  assert.throws(() => s.create({ ...r, id: randomUUID(), requesterId: 'leo' }), /another member/); s.close();
});
test('changed policy cannot silently reuse an in-flight AI approval', () => {
  const s = new Store(':memory:'); const r = candidate(s); r.status = 'analyzing'; s.create(r);
  const p = s.policy(); p.version++; p.description = 'All purchases need a fresh review.'; s.put('policy', 'main', p);
  s.setReview(r.id, { recommendation: 'approve', summary: 'Task related.', reasoning: [], missingInformation: [], provider: 'Relmio via local n8n' });
  assert.equal(s.request(r.id)!.status, 'needs_review'); assert.equal(s.request(r.id)!.receipt, null); s.close();
});
test('a complete model approval can trigger exactly one permitted simulated payment', () => {
  const s = new Store(':memory:'); const r = candidate(s, '20'); r.status = 'analyzing'; s.create(r);
  const result = s.setReview(r.id, { recommendation: 'approve', summary: 'Clear relevance to assigned work.', reasoning: ['All required context supplied.'], missingInformation: [], provider: 'Relmio via local n8n' });
  assert.equal(result.status, 'paid'); assert.match(result.receipt!, /^SIM-/); assert.equal(result.mode, 'simulated');
  s.setReview(r.id, { recommendation: 'approve', summary: 'Repeated result.', reasoning: [], missingInformation: [], provider: 'Relmio via local n8n' });
  assert.equal(s.committed('launch'), units('48')); s.close();
});

test('supplier category and quote host constrain automatic payments', () => {
  const store = new Store(':memory:');
  const approval = { recommendation: 'approve', summary: 'Approved', reasoning: [], missingInformation: [], provider: 'Relmio via local n8n' } as const;
  const reviewed = { ...approval, reasoning: [], missingInformation: [] };
  const misclassified = { ...candidate(store), category: 'Software', status: 'analyzing' } as SpendRequest;
  const mismatchedQuote = { ...candidate(store), evidenceUrl: 'https://framekit.example.unrelated.example/quote', status: 'analyzing' } as SpendRequest;
  store.create(misclassified);
  store.create(mismatchedQuote);
  assert.equal(store.setReview(misclassified.id, reviewed).status, 'blocked');
  assert.equal(store.setReview(mismatchedQuote.id, reviewed).status, 'needs_review');
  assert.equal(store.committed('launch'), units('28'));
  store.close();
});
