import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createWorkspaceApp } from './workspace-router.ts';
import { Store } from './store.ts';

test('new owners and invited members reach isolated workspaces', async () => {
  const scratch = resolve('.local');
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(resolve(scratch, 'signup-test-'));
  const previous = process.env.ALLOWANCE_DATA_DIR;
  process.env.ALLOWANCE_DATA_DIR = directory;
  process.env.ALLOWANCE_PUBLIC_ORIGIN = 'https://allowance.example.test';
  process.env.ALLOWANCE_PROXY_TOKEN = 'synthetic-test-proxy-secret';
  const primary = new Store(':memory:', { sampleData: false });
  const { app, closeWorkspaces } = createWorkspaceApp(primary);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api';
  const call = (path: string, body?: object, cookie?: string) => fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-allowance-client': 'local-prototype', 'x-allowance-proxy': 'synthetic-test-proxy-secret', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const getCookie = (reply: Response) => reply.headers.get('set-cookie')!.split(';')[0];
  const first = { name: 'First Owner', email: 'first@example.test', code: 'synthetic-owner-code' };
  const second = { name: 'Second Owner', email: 'second@example.test', code: 'synthetic-other-code' };
  try {
    assert.equal((await call('/auth/setup', first)).status, 403);
    const firstSignup = await call('/auth/signup', first);
    assert.equal(firstSignup.status, 200);
    const firstCookie = getCookie(firstSignup);
    const secondSignup = await call('/auth/signup', second, firstCookie);
    assert.equal(secondSignup.status, 200, await secondSignup.clone().text());
    const secondCookie = getCookie(secondSignup);
    assert.equal((await call('/auth/signup', { ...second, email: second.email.toUpperCase() })).status, 409);
    assert.equal((await call('/session', { email: second.email, code: first.code, role: 'owner' })).status, 401);

    const secondLogin = await call('/session', { email: second.email, code: second.code, role: 'owner' });
    assert.equal(secondLogin.status, 200);
    assert.equal((await (await call('/bootstrap', undefined, firstCookie)).json()).person.email, first.email);
    const secondData = await (await call('/bootstrap', undefined, secondCookie)).json();
    assert.equal(secondData.person.email, second.email);
    assert.deepEqual(secondData.requests, []);
    const forged = secondCookie.split('.')[0] + '.' + firstCookie.split('=')[1];
    assert.equal((await call('/bootstrap', undefined, forged)).status, 401);

    const memberEmail = 'member@example.test';
    const added = await call('/setup/people', { name: 'Team Member', title: 'Designer', email: memberEmail }, secondCookie);
    assert.equal(added.status, 201, await added.clone().text());
    const member = await added.json();
    const invite = await (await call('/team/' + member.id + '/code', {}, secondCookie)).json();
    assert.deepEqual(Object.keys(invite).sort(), ['code', 'email']);
    const primaryMember = await (await call('/setup/people', { name: 'Primary Member', title: 'Designer', email: memberEmail }, firstCookie)).json();
    const primaryInvite = await (await call('/team/' + primaryMember.id + '/code', {}, firstCookie)).json();
    const primaryMemberLogin = await call('/session', { email: memberEmail, code: primaryInvite.code, role: 'member' });
    assert.equal(primaryMemberLogin.status, 200);
    assert.equal((await (await call('/bootstrap', undefined, getCookie(primaryMemberLogin))).json()).person.id, primaryMember.id);
    const credentials = { email: memberEmail, code: invite.code, role: 'member' };
    assert.equal((await call('/session', { ...credentials, code: 'wrong-code' })).status, 401);
    const memberLogin = await call('/session', credentials);
    assert.equal(memberLogin.status, 200);
    const memberCookie = getCookie(memberLogin);
    assert.equal((await (await call('/bootstrap', undefined, memberCookie)).json()).person.id, member.id);
    assert.equal((await call('/team/' + member.id + '/code', {}, memberCookie)).status, 403);
    assert.equal((await (await call('/bootstrap', undefined, firstCookie)).json()).people.length, 2);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    closeWorkspaces();
    delete process.env.ALLOWANCE_PUBLIC_ORIGIN;
    delete process.env.ALLOWANCE_PROXY_TOKEN;
    primary.close();
    if (previous === undefined) delete process.env.ALLOWANCE_DATA_DIR;
    else process.env.ALLOWANCE_DATA_DIR = previous;
    rmSync(directory, { recursive: true });
  }
});
