import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiClient } from './ai.ts';

// Synthetic transport exercises the real Gemini request/response format without credentials.
test('Gemini keeps instructions separate and sanitizes scoped context', async () => {
  let sent: any;
  const client = createAiClient({ geminiApiKey: 'synthetic-key', geminiFetch: async (url, init) => {
    assert.ok(String(url).startsWith('https://generativelanguage.googleapis.com/v1beta/models/'));
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'synthetic-key');
    sent = JSON.parse(init!.body as string);
    return Response.json({ candidates: [{ content: { parts: [
      { thought: true, text: 'Internal reasoning is excluded.' },
      { text: JSON.stringify({ reply: 'Two recorded requests.', proposals: [] }) },
    ] } }] });
  } });
  const result = await client.call({ agentInstructions: 'Use database facts.', message: 'Email owner@example.com', count: 2 });
  assert.equal(client.provider, 'Google Gemini');
  assert.equal(sent.systemInstruction.parts[0].text, 'Use database facts.');
  assert.equal(sent.generationConfig.responseMimeType, 'application/json');
  const context = JSON.parse(sent.contents[0].parts[0].text);
  assert.equal(context.count, 2);
  assert.ok(!context.message.includes('owner@example.com'));
  assert.ok(!('agentInstructions' in context));
  assert.equal(result.reply, 'Two recorded requests.');
});

test('missing Gemini configuration never calls a provider', async () => {
  let called = false;
  const client = createAiClient({ geminiApiKey: '', geminiFetch: async () => { called = true; throw Error('Unexpected call'); } });
  assert.equal(client.provider, null);
  await assert.rejects(client.call({ message: 'Hello' }), /GEMINI_API_KEY/);
  assert.equal(called, false);
});

for (const status of [401, 429, 503]) {
  test(`Gemini HTTP ${status} has an actionable error`, async () => {
    const client = createAiClient({ geminiApiKey: 'synthetic-key', geminiFetch: async () => new Response('', { status }) });
    await assert.rejects(client.call({ connectionTest: true }), status === 429 ? /quota or rate limit/ : new RegExp(`HTTP ${status}`));
  });
}

test('Gemini rejects empty or non-object structured replies', async () => {
  for (const text of ['', '[]', 'null', 'not JSON']) {
    const client = createAiClient({ geminiApiKey: 'synthetic-key', geminiFetch: async () => Response.json({ candidates: [{ content: { parts: [{ text }] } }] }) });
    await assert.rejects(client.call({ message: 'Review this purchase' }));
  }
});
