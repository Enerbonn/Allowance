import { readFileSync } from 'node:fs';

export const reviewInstructions = readFileSync(new URL('./review-instructions.md', import.meta.url), 'utf8');

const credentialPatterns = [
  /(?<![\w-])(?:allowance_[\w-]{24}|tg_test_[a-f0-9]{32}|AIza[\w-]{30,}|sk-[\w-]{20,}|S[A-Z2-7]{55})(?![\w-])/gi,
  /\b(?:access code|private code|code|password|passcode|api key|recovery phrase|seed phrase)\s*(?:is\s+|[:=]\s*)[^\n,;]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
export function redact(text: string) {
  return credentialPatterns.reduce((result, pattern) => result.replace(pattern, '[private information removed]'), text)
    .replace(/\b[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}\b/gi, '[email removed]');
}

export function sanitize<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map(item => sanitize(item)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)])) as T;
  return value;
}

export function requestsOverride(text: string) {
  return /\b(?:ignore|disregard|override|bypass|disable|forget|supersede)\b[\s\S]{0,45}\b(?:instructions?|rules?|policy|limits?|checks?|guardrails?|approval)\b|\b(?:system prompt|developer message|act as (?:the )?owner|i am (?:the )?owner now|approve without review|mark (?:this|it|the request) (?:as )?paid)\b|\[(?:system|developer)\]|<\|(?:system|developer|im_start)\|>/i.test(text);
}
