import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { openHostedPersistence } from './hosted-persistence.ts';
import { Store } from './store.ts';
import { createWorkspaceApp } from './workspace-router.ts';

const connection = process.env.ALLOWANCE_TEST_POSTGRES_URL;
test('Postgres restores signup, sessions and evidence and fences an older writer', { skip: !connection }, async () => {
  const scratch = resolve('.local');
  mkdirSync(scratch, { recursive: true });
  const temp = mkdtempSync(resolve(scratch, 'hosted-persistence-test-'));
  process.env.ALLOWANCE_STORAGE_KEY = randomBytes(32).toString('base64');
  const active: (() => Promise<void>)[] = [];
  async function launch() {
    const persistence = await openHostedPersistence(connection!, temp, true);
    process.env.ALLOWANCE_DATA_DIR = persistence.directory;
    const primary = new Store(resolve(persistence.directory, 'allowance.sqlite'), { sampleData: false });
    const { app, closeWorkspaces } = createWorkspaceApp(primary, { persistence });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    active.push(async () => {
      await new Promise<void>(done => server.close(() => done()));
      closeWorkspaces();
      primary.close();
      await persistence.close();
    });
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api';
    return (path: string, body?: object, cookie?: string) => fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-allowance-client': 'local-prototype', ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  const owner = { name: 'Hosted Owner', email: 'hosted@example.test', code: 'synthetic-access-code' };
  const other = { name: 'Second Owner', email: 'second@example.test', code: 'synthetic-other-code' };
  const getCookie = (reply: Response) => reply.headers.get('set-cookie')!.split(';')[0];
  try {
    const wrongLogin = new URL(connection!);
    wrongLogin.password = randomBytes(12).toString('hex');
    await assert.rejects(openHostedPersistence(wrongLogin.toString(), temp, true), /Postgres rejected the login/);
    const first = await launch();
    const signup = await first('/auth/signup', owner);
    assert.equal(signup.status, 200, await signup.clone().text());
    const ownerCookie = getCookie(signup);
    const secondSignup = await first('/auth/signup', other);
    assert.equal(secondSignup.status, 200, await secondSignup.clone().text());
    const otherCookie = getCookie(secondSignup);
    const memberEmail = 'member@example.test';
    const memberResponse = await first('/setup/people', { name: 'Hosted Member', title: 'Designer', email: memberEmail }, otherCookie);
    assert.equal(memberResponse.status, 201);
    const member = await memberResponse.json();
    const invite = await (await first('/team/' + member.id + '/code', {}, otherCookie)).json();
    const attachment = Buffer.from('%PDF-1.4\nfixture');
    const upload = await first('/evidence', { name: 'quote.pdf', mime: 'application/pdf', data: attachment.toString('base64') }, otherCookie);
    assert.equal(upload.status, 200);
    const { id } = await upload.json();
    const staleWriter = active.pop()!;
    // Open a new backend before shutting down the old one, as with rolling deploys.
    const second = await launch();
    active.unshift(staleWriter);
    assert.equal((await (await second('/bootstrap', undefined, ownerCookie)).json()).person.email, owner.email);
    const memberLogin = await second('/session', { email: memberEmail, code: invite.code, role: 'member' });
    assert.equal(memberLogin.status, 200);
    assert.equal((await (await second('/bootstrap', undefined, getCookie(memberLogin))).json()).person.id, member.id);
    assert.equal((await (await second('/bootstrap', undefined, otherCookie)).json()).person.email, other.email);
    const download = await second('/evidence/' + id, undefined, otherCookie);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), attachment);
    assert.equal((await second('/evidence/' + id, undefined, ownerCookie)).status, 404);
    const staleSignup = await first('/auth/signup', { ...other, email: 'stale@example.test' });
    assert.equal(staleSignup.status, 503);
    assert.equal(staleSignup.headers.get('set-cookie'), null);
    assert.equal((await first('/health')).status, 503);
  } finally {
    for (const close of active.reverse()) await close();
    delete process.env.ALLOWANCE_STORAGE_KEY;
    delete process.env.ALLOWANCE_DATA_DIR;
    rmSync(temp, { recursive: true });
  }
});
