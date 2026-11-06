import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, manilaWeek } from './store.ts';
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
test('clear declines close the request while uncertain or stale assessments go to the owner', () => {
  const store = new Store(':memory:');
  try {
    const decline = {
      recommendation: 'decline' as const, summary: 'This is a personal purchase.',
      reasoning: ['The request serves personal use.'], missingInformation: [],
      provider: 'Relmio via local n8n',
    };
    const clear = { ...candidate(store), status: 'analyzing' as const };
    const uncertain = { ...candidate(store), status: 'analyzing' as const };
    const stale = { ...candidate(store), status: 'analyzing' as const, policyVersion: 0 };
    for (const request of [clear, uncertain, stale]) store.create(request);
    assert.equal(store.setReview(clear.id, decline).status, 'declined');
    assert.deepEqual(store.request(clear.id)?.reasons, [decline.summary]);
    assert.equal(store.setReview(uncertain.id, { ...decline, missingInformation: ['What task needs this?'] }).status, 'needs_review');
    assert.equal(store.setReview(stale.id, decline).status, 'needs_review');
  } finally { store.close(); }
});
test('Testnet automation requires explicit opt-in and rechecks current spending authority', () => {
  const store = new Store(':memory:');
  try {
    const request = { ...candidate(store), status: 'analyzing' as const, mode: 'testnet' as const };
    store.create(request);
    const reviewed = store.setReview(request.id, {
      recommendation: 'approve', summary: 'Needed for the assigned work.',
      reasoning: ['Matches the assigned campaign.'], missingInformation: [],
      provider: 'Relmio via local n8n',
    });
    assert.equal(store.canAutoApprove(reviewed), false);
    const policy = { ...store.policy(), autoTestnet: true };
    store.put('policy', 'main', policy);
    assert.equal(store.canAutoApprove(reviewed), true);
    assert.equal(store.request(request.id)?.receipt, null);
    store.put('policy', 'main', { ...policy, paused: true });
    assert.equal(store.canAutoApprove(reviewed), false);
  } finally { store.close(); }
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
test('a clear assessment cannot produce a legacy simulated receipt', () => {
  const s = new Store(':memory:'); const r = candidate(s, '20'); r.status = 'analyzing'; s.create(r);
  const result = s.setReview(r.id, { recommendation: 'approve', summary: 'Clear relevance to assigned work.', reasoning: ['All required context supplied.'], missingInformation: [], provider: 'Relmio via local n8n' });
  assert.equal(result.status, 'needs_review'); assert.equal(result.receipt, null); assert.equal(s.canAutoApprove(result), false);
  s.setReview(r.id, { recommendation: 'approve', summary: 'Repeated result.', reasoning: [], missingInformation: [], provider: 'Relmio via local n8n' });
  assert.equal(s.committed('launch'), units('28')); s.close();
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
  const configured = { ...store.request(mismatchedQuote.id)!, mode: 'testnet' as const, evidenceUrl: 'https://fictional-checkout.example/quote' };
  store.put('policy', 'main', { ...store.policy(), autoTestnet: true });
  assert.equal(store.canAutoApprove(configured), false);
  const supplier=store.suppliers().find(s=>s.id===configured.supplierId)!;
  store.put('suppliers',supplier.id,{...supplier,quoteHosts:['fictional-checkout.example']});
  assert.equal(store.canAutoApprove(configured), true);
  assert.equal(store.canAutoApprove({...configured,evidenceUrl:'https://fictional-checkout.example.evil.example/quote'}),false);
  assert.equal(store.canAutoApprove({...configured,evidenceUrl:'https://fictional-checkout.example@evil.example/quote'}),false);
  assert.equal(store.committed('launch'), units('28'));
  store.close();
});

test('weekly cap counts reservations and payments and resets at Manila midnight', () => {
  const s = new Store(':memory:');
  try {
    s.db.prepare('DELETE FROM commitments WHERE request_id=?').run('REQ-1042');
    const member=s.people().find(p=>p.id==='maya')!;
    member.weeklyBudget=units('25');
    s.put('people',member.id,member);
    const old=candidate(s,'20');
    old.mode='testnet';old.status='authorized';old.committedAt='2020-11-01T15:59:59.999Z';
    s.create(old);
    s.db.prepare("INSERT INTO commitments VALUES(?,?,?,'reserved')").run(old.id,old.projectId,old.amount);
    const newWeek=new Date('2020-11-01T16:00:00Z');
    assert.equal(manilaWeek(newWeek).start,newWeek.toISOString());
    assert.equal(s.weeklySpent(member.id,'',new Date(newWeek.getTime()-1)),old.amount);
    assert.equal(s.weeklySpent(member.id,'',newWeek),0);
    const pending=candidate(s,'20');
    pending.mode='testnet';pending.status='authorized';pending.committedAt=new Date().toISOString();
    s.create(pending);
    s.db.prepare("INSERT INTO commitments VALUES(?,?,?,'reserved')").run(pending.id,pending.projectId,pending.amount);
    const second=candidate(s,'6');s.create(second);
    assert.throws(()=>s.pay(second.id,'Owner'),/weekly cap/);
    const exact=candidate(s,'5');s.create(exact);
    s.pay(exact.id,'Owner');
    assert.equal(s.weeklySpent(member.id),units('25'));
  } finally { s.close(); }
});
