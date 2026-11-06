import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { categories, emailSchema, units, type Person } from './domain.ts';
import type { Store } from './store.ts';

export const memberProfileFields = z.object({
  name: z.string().trim().min(2).max(80),
  title: z.string().trim().min(2).max(100),
  description: z.string().trim().max(3000).optional(),
  goal: z.string().trim().max(1000).optional(),
  spendingGuidance: z.string().trim().max(1000).optional(),
  budget: z.string().nullable().optional(),
  allowedCategories: z.array(z.enum(categories)).min(1).optional(),
}).strict();

export const setupSchemas = {
  people: memberProfileFields.extend({ email: emailSchema }),
  projects: z.object({ name: z.string().trim().min(3).max(100), description: z.string().trim().min(5).max(600), budget: z.string() }).strict(),
  tasks: z.object({ title: z.string().trim().min(3).max(120), description: z.string().trim().min(10).max(1200), projectId: z.string(), assigneeId: z.string() }).strict(),
  suppliers: z.object({ name: z.string().trim().min(2).max(100), domain: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/), category: z.enum(categories), approved: z.boolean() }).strict(),
};

export type SetupKind = keyof typeof setupSchemas;
export const isSetupKind = (kind: string): kind is SetupKind => Object.hasOwn(setupSchemas, kind);

export function memberBudget(value: string | null | undefined, current?: number) {
  if (value === undefined) return current;
  if (value === null) return undefined;
  return /^0(?:\.0{1,7})?$/.test(value) ? 0 : units(value);
}

export function createSetupRecord(store: Store, kind: SetupKind, fields: unknown, actor: string) {
  if (store.list(kind).length >= 200) throw new Error('This workspace supports up to 200 records of each type.');
  const id = randomUUID();
  let record;
  switch (kind) {
    case 'people': {
      const member = setupSchemas.people.parse(fields);
      if (store.people().some(p => p.email === member.email)) throw new Error('That email is already assigned in this workspace.');
      record = {
        ...member, id, role: 'member', active: true,
        initials: member.name.split(/\s+/).map(word => word[0]).slice(0, 2).join('').toUpperCase(),
        budget: memberBudget(member.budget),
      } satisfies Person;
      break;
    }
    case 'projects': {
      const project = setupSchemas.projects.parse(fields);
      record = { ...project, id, budget: units(project.budget), active: true };
      break;
    }
    case 'tasks': {
      const task = setupSchemas.tasks.parse(fields);
      if (!store.projects().some(p => p.id === task.projectId && p.active) ||
          !store.people().some(p => p.id === task.assigneeId && p.active && p.role === 'member')) {
        throw new Error('Choose an active project and team member.');
      }
      record = { ...task, id, active: true };
      break;
    }
    case 'suppliers':
      record = { ...setupSchemas.suppliers.parse(fields), id, destination: 'Demo merchant record; wallet not connected' };
  }
  store.put(kind, id, record);
  store.event('Workspace setup updated', 'Added a workspace record.', actor, null, 'policy');
  return record;
}
