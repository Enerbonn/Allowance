import { z } from 'zod';

export const emailSchema = z.string().trim().max(254).email().transform(email => email.toLowerCase());

export const SCALE = 10_000_000;
export const money = (units: number) => (units / SCALE).toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
export function units(value: string): number {
  if (!/^\d{1,6}(\.\d{1,7})?$/.test(value)) throw new Error('Enter a positive amount with up to 7 decimals.');
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * SCALE + Number(fraction.padEnd(7, '0'));
  if (!Number.isSafeInteger(result) || result <= 0 || result > 100_000 * SCALE) throw new Error('Amount must be between 0 and 100,000 XLM.');
  return result;
}
export const categories = ['Software', 'Creative assets', 'Research', 'Services', 'Equipment'] as const;
export const requestSchema = z.object({
  title: z.string().trim().min(5).max(120), taskId: z.string().min(1), supplierId: z.string().min(1),
  category: z.enum(categories), amount: z.string(), purpose: z.string().trim().min(15).max(3000),
  evidenceUrl: z.union([z.literal(''), z.url().refine(v => new URL(v).protocol === 'https:', 'Use an HTTPS link.')]).default(''),
  evidenceId: z.string().max(80).optional(),
  mode: z.enum(['simulated','testnet']).default('simulated'),
  idempotencyKey: z.string().min(12).max(100),
});
export const policySchema = z.object({
  perRequest: z.string(), autoLimit: z.string(), projectLimit: z.string(),
  allowedCategories: z.array(z.enum(categories)).min(1), requireEvidence: z.boolean(),
  autoPay: z.boolean(), paused: z.boolean(), description: z.string().max(4000),
});
export type Policy = { id: string; version: number; perRequest: number; autoLimit: number; projectLimit: number; allowedCategories: string[]; requireEvidence: boolean; autoPay: boolean; paused: boolean; description: string };
export type Person = { id: string; name: string; role: 'owner' | 'member'; title: string; initials: string; active: boolean; email?: string; description?: string; goal?: string; spendingGuidance?: string; budget?: number; allowedCategories?: string[]; profileVersion?: number };
export type Project = { id: string; name: string; description: string; budget: number; active: boolean };
export type Task = { id: string; projectId: string; assigneeId: string; title: string; description: string; active: boolean };
export type Supplier = { id: string; name: string; category: string; domain: string; approved: boolean; destination: string };
export type Review = { recommendation: 'approve' | 'review' | 'decline'; summary: string; reasoning: string[]; missingInformation: string[]; model?: string; provider: string };
export type SpendRequest = { id: string; title: string; taskId: string; projectId: string; requesterId: string; supplierId: string; category: string; amount: number; purpose: string; evidenceUrl: string; status: 'analyzing' | 'needs_review' | 'blocked' | 'authorized' | 'paid' | 'declined' | 'cancelled'; createdAt: string; updatedAt: string; policyVersion: number; reasons: string[]; ai: Review | null; mode: 'simulated' | 'testnet'; receipt: string | null; idempotencyKey: string; comment: string; evidenceId?: string; profileVersion?: number; };
export type Event = { id: string; requestId: string | null; actor: string; title: string; detail: string; createdAt: string; kind: string };
export type Check = { label: string; pass: boolean; detail: string };

export function policyChecks(request: SpendRequest, person: Person, task: Task | undefined, supplier: Supplier | undefined, project: Project | undefined, policy: Policy, committed: number): Check[] {
  return [
    { label: 'Team membership', pass: person.active, detail: person.active ? `${person.name} is an active team member.` : 'This member is inactive.' },
    { label: 'Task assignment', pass: !!task?.active && task.assigneeId === person.id && task.projectId === request.projectId, detail: task?.assigneeId === person.id ? `Assigned to ${task.title}.` : 'The task must be assigned to the requester.' },
    { label: 'Active project', pass: !!project?.active, detail: project?.active ? project.name : 'The project is inactive.' },
    { label: 'Spending enabled', pass: !policy.paused, detail: policy.paused ? 'The owner paused spending.' : 'The owner has enabled spending.' },
    { label: 'Approved supplier', pass: !!supplier?.approved, detail: supplier?.approved ? `${supplier.name} is approved for the demo.` : 'This supplier needs owner verification.' },
    { label: 'Supplier category', pass: supplier?.category === request.category, detail: 'The purchase category must match the approved supplier.' },
    { label: 'Allowed expense', pass: policy.allowedCategories.includes(request.category), detail: policy.allowedCategories.includes(request.category) ? `${request.category} is permitted.` : `${request.category} is outside the approved policy.` },
    { label: 'Per-request limit', pass: request.amount <= policy.perRequest, detail: `${money(request.amount)} of ${money(policy.perRequest)} XLM allowed.` },
    { label: 'Project allowance', pass: !!project && committed + request.amount <= Math.min(project.budget, policy.projectLimit), detail: project ? `${money(Math.max(0, Math.min(project.budget, policy.projectLimit) - committed))} XLM available before this request.` : 'Project missing.' },
    { label: 'Supporting evidence', pass: !policy.requireEvidence || !!(request.evidenceUrl || request.evidenceId), detail: (request.evidenceUrl || request.evidenceId) ? 'Supporting evidence was supplied. Authenticity still needs verification.' : policy.requireEvidence ? 'Add a quote or purchase reference.' : 'A reference link is optional.' },
  ];
}

export function offlineReview(): Review {
  return { recommendation: 'review', summary: 'Your request is saved for owner review.', reasoning: ['Budget and access checks still run independently.', 'The request still needs a decision.'], missingInformation: [], provider: 'Owner review required' };
}

export const RELMIO_PROVIDER = 'Relmio via local n8n';
export const GEMINI_PROVIDER = 'Google Gemini';

export function validateReview(input: unknown, provider = RELMIO_PROVIDER): Review {
  const schema = z.object({ recommendation: z.enum(['approve', 'review', 'decline']), summary: z.string().min(1).max(1200), reasoning: z.array(z.string().max(800)).max(8), missingInformation: z.array(z.string().max(500)).max(8), model: z.string().max(120).optional() });
  return { ...schema.parse(input), provider };
}
