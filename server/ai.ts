import { sanitize, reviewInstructions } from './assistant-safety.ts';
import { GEMINI_PROVIDER } from './domain.ts';

class AiConnectionError extends Error {}

type AiBody = Record<string, unknown>;

export type AiOptions = { geminiApiKey?: string; geminiFetch?: typeof fetch };

export function createAiClient(options: AiOptions = {}) {
  const geminiKey = (options.geminiApiKey ?? process.env.GEMINI_API_KEY)?.trim();
  const request = options.geminiFetch ?? fetch;
  const geminiModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';
  const provider = geminiKey ? GEMINI_PROVIDER : null;
  const missing = 'Set GEMINI_API_KEY on the server to enable conversations and purchase assessments.';
  const fallback = 'Gemini could not return a usable response. Check your API key, model, quota and internet connection.';

  async function call(body: AiBody) {
    if (!geminiKey) throw new AiConnectionError(missing);
    const { agentInstructions, ...context } = body;
    const safeContext = sanitize(context);
    const signal = AbortSignal.timeout(110000);
    const instruction = body.connectionTest
      ? 'Return a JSON object with one summary string confirming the connection.'
      : typeof agentInstructions === 'string'
        ? agentInstructions
        : reviewInstructions;
    const response = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`, {
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
