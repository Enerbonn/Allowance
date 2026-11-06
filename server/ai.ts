import { existsSync, readFileSync } from 'node:fs';

import { sanitize, reviewInstructions } from './assistant-safety.ts';
import { GEMINI_PROVIDER, RELMIO_PROVIDER } from './domain.ts';

class AiConnectionError extends Error {}

type AiBody = Record<string, unknown>;

export function createAiClient(options: { aiEndpoint?: string; aiToken?: string }) {
  const geminiKey = options.aiEndpoint ? '' : process.env.GEMINI_API_KEY?.trim();
  const geminiModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';
  const endpoint = options.aiEndpoint || process.env.N8N_REVIEW_URL || 'http://127.0.0.1:5679/webhook/allowance-review-v1';
  const n8nToken = geminiKey ? '' : options.aiToken || process.env.ALLOWANCE_N8N_TOKEN || (existsSync('.local/n8n-token.bin') ? readFileSync('.local/n8n-token.bin', 'utf8').trim() : '');
  const provider = geminiKey ? GEMINI_PROVIDER : n8nToken ? RELMIO_PROVIDER : null;
  const missing = 'Connect an assistant provider to enable conversations and purchase assessments.';
  const fallback = geminiKey ? 'Gemini could not return a usable response. Check your API key, model, quota and internet connection.' : 'Check the n8n webhook, token and Relmio account connection.';

  async function call(body: AiBody) {
    if (!provider) throw new AiConnectionError(missing);
    const { agentInstructions, ...context } = body;
    const safeContext = sanitize(context);
    const signal = AbortSignal.timeout(110000);
    if (!geminiKey) {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-allowance-token': n8nToken },
        body: JSON.stringify({ ...safeContext, agentInstructions }), signal,
      });
      if (!response.ok) throw new AiConnectionError(`n8n returned HTTP ${response.status}. ${fallback}`);
      return response.json();
    }

    const instruction = body.connectionTest
      ? 'Return a JSON object with one summary string confirming the connection.'
      : typeof agentInstructions === 'string'
        ? agentInstructions
        : reviewInstructions;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(safeContext) }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal,
    });
    if (response.status === 429) throw new AiConnectionError('Gemini quota or rate limit reached. Check the project limits in Google AI Studio and retry when quota is available.');
    if (!response.ok) throw new AiConnectionError(`Gemini returned HTTP ${response.status}. ${fallback}`);
    const data = await response.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const result = JSON.parse(parts.filter(part => !part.thought).map(part => part.text ?? '').join(''));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected a JSON object.');
    return { ...result, model: geminiModel };
  }
  return { provider, call, message: provider ? 'Connection has not been tested yet.' : missing, errorMessage: (error: unknown) => error instanceof AiConnectionError ? error.message : fallback };
}
