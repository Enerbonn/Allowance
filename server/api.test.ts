import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from './store.ts';
import { createApp } from './app.ts';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { units } from './domain.ts';
import {setAccessCode} from './workspace.ts';

test('API isolates identities, owner controls, and cross-origin writes', async () => {
  const store = new Store(':memory:'); setAccessCode(store,'maya','demo-test-code');setAccessCode(store,'owner','owner-test-code'); const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise<void>(r => server.on('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const headers = { 'content-type': 'application/json', 'x-allowance-client': 'local-prototype' };
  try {
    assert.equal((await fetch(base + '/bootstrap')).status, 401);
    const login = await fetch(base + '/session', { method: 'POST', headers, body: JSON.stringify({ personId: 'maya', code:'demo-test-code' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]; const memberHeaders = { ...headers, cookie };
    const bootstrap = await (await fetch(base + '/bootstrap', { headers: memberHeaders })).json();
    assert.equal(bootstrap.person.id, 'maya'); assert.ok(bootstrap.requests.every((r: any) => r.requesterId === 'maya')); assert.ok(bootstrap.tasks.every((t: any) => t.assigneeId === 'maya'));
    assert.equal((await fetch(base + '/requests/REQ-1043/cancel', { method: 'POST', headers: memberHeaders })).status, 404);
    assert.equal((await fetch(base + '/requests/REQ-1044/decision', { method: 'POST', headers: memberHeaders, body: JSON.stringify({ action: 'approve', note: 'Attempt' }) })).status, 403);
    assert.equal((await fetch(base + '/policy', { method: 'PUT', headers: memberHeaders, body: '{}' })).status, 403);
    assert.equal((await fetch(base + '/session', { method: 'POST', headers: { ...headers, origin: 'https://untrusted.example' }, body: JSON.stringify({ personId: 'owner', code:'owner-test-code' }) })).status, 403);
    assert.equal((await fetch(base + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personId: 'owner', code:'owner-test-code' }) })).status, 403);
    const badAssignment = await fetch(base + '/requests', { method: 'POST', headers: memberHeaders, body: JSON.stringify({ title: 'Task mismatch', taskId: 'edit', supplierId: 'framekit', category: 'Creative assets', amount: '20', purpose: 'A purchase request for someone else’s assignment.', evidenceUrl: 'https://framekit.example/quote', idempotencyKey: 'test-assignment-unique' }) });
    assert.equal(badAssignment.status, 403);
    const fakeEvidence = await fetch(base + '/requests', { method: 'POST', headers: memberHeaders, body: JSON.stringify({ title: 'Font purchase', taskId: 'identity', supplierId: 'typefoundry', category: 'Creative assets', amount: '20', purpose: 'A commercial font for the assigned brand identity.', evidenceUrl: '', evidenceId: 'another-members-evidence', idempotencyKey: 'test-evidence-unique' }) });
    assert.equal(fakeEvidence.status, 400);
    const spoofFile = await fetch(base + '/evidence', { method: 'POST', headers: memberHeaders, body: JSON.stringify({ name: 'quote.png', mime: 'image/png', data: Buffer.from('<script>not an image</script>').toString('base64') }) });
    assert.equal(spoofFile.status, 400);
    assert.equal((await fetch(base + '/evidence/unknown', { headers: memberHeaders })).status, 404);
    assert.equal((await fetch(base + '/setup/people', { method: 'POST', headers: memberHeaders, body: JSON.stringify({ name: 'Test Member', title: 'Designer' }) })).status, 403);
    const ownerLogin = await fetch(base + '/session', { method: 'POST', headers, body: JSON.stringify({ personId: 'owner', code:'owner-test-code' }) });
    const ownerHeaders = { ...headers, cookie: ownerLogin.headers.get('set-cookie')!.split(';')[0] };
    const createdMember = await fetch(base + '/setup/people', { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ name: 'Demo Researcher', title: 'Research contractor' }) });
    assert.equal(createdMember.status, 201); const member = await createdMember.json(); assert.equal(member.role, 'member');
    const createdProject = await fetch(base + '/setup/projects', { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ name: 'Demo research project', description: 'A synthetic project for access verification.', budget: '150' }) });
    assert.equal(createdProject.status, 201); const project = await createdProject.json();
    const createdTask = await fetch(base + '/setup/tasks', { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ title: 'Prepare the research brief', description: 'Gather sources for the synthetic project.', projectId: project.id, assigneeId: member.id }) });
    assert.equal(createdTask.status, 201);
    const badTask = await fetch(base + '/setup/tasks', { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ title: 'Invalid task assignment', description: 'This task must not be created for an absent person.', projectId: project.id, assigneeId: 'missing' }) });
    assert.equal(badTask.status, 400);
    const policy = store.policy(); policy.projectLimit = units('65'); store.put('policy', 'main', policy);
    const competing = [randomUUID(), randomUUID()].map(id => ({ ...store.request('REQ-1044')!, id, idempotencyKey: randomUUID(), amount: units('30') }));
    competing.forEach(r => store.create(r));
    const results = await Promise.all(competing.map(r => fetch(base + `/requests/${r.id}/decision`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ action: 'approve', note: 'Synthetic concurrent budget verification.' }) })));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
    assert.equal(store.committed('launch'), units('58'));
  } finally { await new Promise<void>(r => server.close(() => r())); store.close(); }
});

test('Gemini powers the connection check, scoped assistant and purchase review', async t => {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = 'synthetic-test-key';
  delete process.env.GEMINI_MODEL;
  const store = new Store(':memory:');
  setAccessCode(store, 'owner', 'owner-test-code');
  setAccessCode(store, 'maya', 'member-test-code');
  const localFetch = globalThis.fetch;
  let rateLimited = false;
  const providerCalls = t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
    if (String(url).startsWith('http://127.0.0.1:')) return localFetch(url, options);
    assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent');
    assert.equal(new Headers(options?.headers).get('x-goog-api-key'), 'synthetic-test-key');
    if (rateLimited) return new Response(null, { status: 429 });
    const payload = JSON.parse(String(options?.body));
    const context = JSON.parse(payload.contents[0].parts[0].text);
    assert.equal(payload.generationConfig.responseMimeType, 'application/json');
    assert.ok(!JSON.stringify(payload).includes('member-test-code'));
    let result;
    if (context.connectionTest) {
      result = { summary: 'Connected' };
    } else if (context.mode === 'workspace') {
      assert.equal(context.authenticatedPerson.id, 'maya');
      assert.ok(context.tasks.every((task: { assigneeId: string }) => task.assigneeId === 'maya'));
      assert.match(payload.systemInstruction.parts[0].text, /Spending assistant/);
      result = { reply: 'Here is a summary of your assigned work.', draft: null, proposals: [] };
    } else {
      assert.ok(context.request.title);
      result = { recommendation: 'review', summary: 'Owner review needed.', reasoning: [], missingInformation: [] };
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
  });
  const server = createApp(store).listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const headers = { 'content-type': 'application/json', 'x-allowance-client': 'local-prototype' };
    async function signIn(personId: string, code: string) {
      const response = await localFetch(base + '/session', { method: 'POST', headers, body: JSON.stringify({ personId, code }) });
      assert.equal(response.status, 200);
      return { ...headers, cookie: response.headers.get('set-cookie')!.split(';')[0] };
    }
    const ownerHeaders = await signIn('owner', 'owner-test-code');
    const memberHeaders = await signIn('maya', 'member-test-code');
    const check = await localFetch(base + '/ai/test', { method: 'POST', headers: ownerHeaders });
    assert.equal(check.status, 200);
    const state = await check.json();
    assert.equal(state.provider, 'Google Gemini');
    assert.equal(state.model, 'gemini-3.1-flash-lite');
    assert.ok(!JSON.stringify(state).includes('synthetic-test-key'));

    const chat = await localFetch(base + '/assistant', { method: 'POST', headers: memberHeaders, body: JSON.stringify({ message: 'What am I working on?' }) });
    assert.equal(chat.status, 200);
    assert.match((await chat.json()).text, /assigned work/);

    const review = await localFetch(base + '/requests/REQ-1044/review', { method: 'POST', headers: ownerHeaders });
    assert.equal(review.status, 200);
    assert.equal(store.request('REQ-1044')?.ai?.provider, 'Google Gemini');

    rateLimited = true;
    const fallback = await localFetch(base + '/requests/REQ-1044/review', { method: 'POST', headers: ownerHeaders });
    assert.equal(fallback.status, 200);
    assert.equal(store.request('REQ-1044')?.ai?.provider, 'Owner review required');
    const quota = await localFetch(base + '/ai/test', { method: 'POST', headers: ownerHeaders });
    assert.equal(quota.status, 503);
    assert.match((await quota.json()).error, /Gemini quota/);
    assert.equal(providerCalls.mock.callCount(), 5);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
    if (key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = key;
    if (model === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = model;
  }
});

test('blank workspace starts with owner signup and supports a separately issued member login', async () => {
  const store = new Store(':memory:', { sampleData: false });
  const server = createApp(store).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const client = { 'content-type': 'application/json', 'x-allowance-client': 'local-prototype' };
  const post = (path: string, payload: unknown, cookie?: string) => fetch(base + path, {
    method: 'POST', headers: cookie ? { ...client, cookie } : client, body: JSON.stringify(payload),
  });
  try {
    assert.deepEqual(await (await fetch(base + '/auth/status')).json(), { setupRequired: true });
    const owner = await post('/auth/setup', { name: 'Test Business Owner', code: 'synthetic-owner-code' });
    assert.equal(owner.status, 200);
    const ownerCookie = owner.headers.get('set-cookie')!.split(';')[0];
    const data = await (await fetch(base + '/bootstrap', { headers: { cookie: ownerCookie } })).json();
    assert.equal(data.person.id, 'owner');
    assert.equal(data.integrations.sampleWorkspace, false);
    assert.equal(data.policy.autoPay, false);
    assert.deepEqual(data.people.map((person: { id: string }) => person.id), ['owner']);
    for (const key of ['projects', 'tasks', 'suppliers', 'requests', 'events', 'messages']) assert.deepEqual(data[key], [], key);
    assert.equal((await post('/auth/setup', { name: 'Second Owner', code: 'synthetic-other-code' })).status, 409);
    const created = await post('/setup/people', { name: 'Test Team Member', title: 'Designer' }, ownerCookie);
    assert.equal(created.status, 201);
    const member = await created.json();
    const issued = await post(`/team/${member.id}/code`, {}, ownerCookie);
    assert.equal(issued.status, 200);
    const { personId, code } = await issued.json();
    assert.equal(personId, member.id);
    const signedIn = await post('/session', { personId, code });
    assert.equal(signedIn.status, 200);
    assert.equal((await signedIn.json()).person.role, 'member');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
  }
});
