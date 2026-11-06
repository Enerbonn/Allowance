import type { Express, Request, RequestHandler } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { isConfirmedTestnetPayment, ledgerAnswer, retrieve, spendingSummary, type LedgerQuestion } from './assistant-context.ts';
import { redact, requestsOverride, sanitize } from './assistant-safety.ts';
import { createSetupRecord, memberBudget, memberProfileFields, setupSchemas } from './setup.ts';
import { agentSettingsSchema, parseAgentSettings, type installTestnet } from './testnet.ts';
import { Store, manilaWeek } from './store.ts';
import { categories, emailSchema, units, money, type Person } from './domain.ts';

const instructions = readFileSync(new URL('./agent-instructions.md', import.meta.url), 'utf8');
const profileFields = memberProfileFields.partial();
const recordKinds = { member: 'people', project: 'projects', task: 'tasks', supplier: 'suppliers' } as const;
const proposalFields = {
  member: memberProfileFields,
  project: setupSchemas.projects,
  task: setupSchemas.tasks,
  supplier: setupSchemas.suppliers,
  agent: agentSettingsSchema,
};
const policyFields = z.object({requireEvidence:z.boolean().optional(),description:z.string().max(4000).optional(),perRequest:z.string().optional(),autoLimit:z.string().optional(),projectLimit:z.string().optional(),allowedCategories:z.array(z.enum(categories)).min(1).optional()}).strict();
const memoryFields = z.object({text:z.string().trim().min(3).max(2000)}).strict();
const proposalSchema = z.object({type:z.enum(['profile','policy','memory','member','project','task','supplier','agent']),targetId:z.string().max(100),summary:z.string().max(1000),fields:z.record(z.string(),z.unknown())});
const draftSchema = z.object({title:z.string().max(120),taskId:z.string(),supplierId:z.string(),category:z.enum(categories),amount:z.string().max(30),purpose:z.string().max(3000),evidenceUrl:z.string().max(2000).default('')});
export function setAccessCode(store:Store,id:string,code:string) {
  if (code.length<8 || code.length>128) throw new Error('Use a private code of 8 to 128 characters.');
  const salt=randomBytes(16).toString('hex'); store.put('credentials',id,{salt,hash:scryptSync(code,salt,32).toString('hex')});
  store.db.prepare('DELETE FROM sessions WHERE person_id=?').run(id);
}
type AccessHash = { salt: string; hash: string };
function matchesAccessCode(credential: AccessHash | undefined, code: string) {
  const hash = scryptSync(code.slice(0, 128), credential?.salt || 'not-an-account', 32);
  return !!credential && timingSafeEqual(hash, Buffer.from(credential.hash, 'hex'));
}
export function verifyAccessCode(store: Store, id: string, code: string) {
  return matchesAccessCode(store.get<AccessHash>('credentials', id), code);
}
export function matchesMemberLogin(db: DatabaseSync, email: string, code: string) {
  const row = db.prepare(
    "SELECT c.data FROM records p JOIN records c ON c.id=p.id AND c.kind='credentials' WHERE p.kind='people' AND json_extract(p.data,'$.email')=? AND json_extract(p.data,'$.role')='member' AND json_extract(p.data,'$.active')=1",
  ).get(email) as { data: string } | undefined;
  return !!row && matchesAccessCode(JSON.parse(row.data) as AccessHash, code);
}
export function publicMember(store:Store,p:Person) { return {...p,codeSet:!!store.get('credentials',p.id),spent:store.memberSpent(p.id),weeklySpent:store.weeklySpent(p.id),weeklyResetAt:manilaWeek().end,description:p.description||store.tasks().filter(t=>t.assigneeId===p.id).map(t=>t.description).join(' ')}; }
export function assistantMember(store:Store,p:Person) {
  const {email, codeSet, ...profile}=publicMember(store,p);
  return profile;
}

export const ownerSignupSchema = z.object({ name: z.string().trim().min(2).max(80), email: emailSchema, code: z.string().min(8).max(128), setupToken: z.string().max(128).optional() });

export function validOwnerSetupToken(token?: string) {
  const expected = Buffer.from(process.env.ALLOWANCE_OWNER_SETUP_TOKEN || '');
  const provided = Buffer.from(token || '');
  return expected.length >= 24 && provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function installWorkspace(app:Express,store:Store,o:{auth:RequestHandler;owner:RequestHandler;sessionPerson:(req:Request)=>Person|undefined;callAI:(body:Record<string,unknown>)=>Promise<any>;connected:(model?:string)=>void;failed:(error:unknown)=>void;testnet:ReturnType<typeof installTestnet>;publicSignup?:boolean}) {
  // One-time migration removes the old identity-only demo sessions.
  if (!store.setting('access-v2')) {store.db.prepare('DELETE FROM sessions').run();store.setSetting('access-v2','enabled');}
  const workspaceOwner=store.get<Person>('people','owner');if(workspaceOwner?.title==='Studio owner'){workspaceOwner.title='Workspace owner';store.put('people','owner',workspaceOwner);}
  const attempts = new Map<string, {count: number; until: number}>();
  const accessCode = z.string().min(8).max(128);
  const loginSchema = z.object({email:emailSchema,code:z.string().min(1).max(128),role:z.enum(['owner','member'])});
  const secure = Boolean(process.env.ALLOWANCE_PUBLIC_ORIGIN);
  const clientIp = (req: Request) => secure ? req.get('x-allowance-client-ip') || req.ip : req.ip;
  function signIn(res: import('express').Response,p: Person) {
    const token = store.session(p.id);
    const session = res.locals.workspaceId ? res.locals.workspaceId + '.' + token : token;
    res.cookie('allowance_session',session,{httpOnly:true,secure,sameSite:'strict',maxAge:12*3600000});
    res.json({person:p});
  }
  function allowAttempt(keys: string[]) {
    const now = Date.now();
    if(attempts.size > 2000) for(const [key,value] of attempts) if(value.until<=now)attempts.delete(key);
    if(attempts.size > 3000)return false;
    const entries=keys.map(key=>{const current=attempts.get(key);return current&&current.until>now?current:{count:0,until:now+15*60000};});
    if(entries.some((entry,index)=>entry.count>=(index===0?25:5)))return false;
    keys.forEach((key,index)=>{entries[index].count++;attempts.set(key,entries[index]);});
    return true;
  }
  function uniqueEmail(email:string,id:string) {
    if(store.people().some(person=>person.id!==id&&person.email===email))throw new Error('That email is already assigned in this workspace.');
  }
  app.get('/api/auth/status',(req,res)=>{
    const session=o.sessionPerson(req), account=store.get<Person>('people','owner');
    const setupRequired=!store.get('credentials','owner');
    res.json({setupRequired,setupTokenRequired:setupRequired&&secure,...(o.publicSignup === undefined ? {} : {signupTokenRequired:secure&&!o.publicSignup}),ownerNeedsEmail:!setupRequired&&!account?.email,sessionRole:session?.active&&session.email?session.role:undefined});
  });
  app.post(['/api/auth/setup', '/api/auth/signup'],(req,res)=>{
    if(store.get('credentials','owner'))return res.status(409).json({error:'Owner access is already configured.'});
    if(!allowAttempt([`ip:${clientIp(req)}`,`setup:${clientIp(req)}`]))return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});
    const v=ownerSignupSchema.parse(req.body);
    if(secure && !(o.publicSignup && req.path === '/api/auth/signup') && !validOwnerSetupToken(v.setupToken)){
      return res.status(403).json({error:'Enter the owner setup token supplied by the deployment operator.'});
    }
    uniqueEmail(v.email,'owner');
    const p=store.get<Person>('people','owner')!;
    p.name=v.name;p.email=v.email;p.initials=v.name.split(/\s+/).map(v=>v[0]).slice(0,2).join('').toUpperCase();
    store.db.exec('BEGIN IMMEDIATE');
    try {
      store.put('people',p.id,p);setAccessCode(store,p.id,v.code);
      store.db.exec('COMMIT');
    } catch(error) { store.db.exec('ROLLBACK');throw error; }
    attempts.delete(`setup:${clientIp(req)}`);
    signIn(res,p);
  });
  app.post('/api/auth/owner-email',(req,res)=>{
    const p=store.get<Person>('people','owner');
    if(!p||p.email||!store.get('credentials','owner'))return res.status(409).json({error:'Use the email already assigned to your owner account.'});
    if(!allowAttempt([`ip:${clientIp(req)}`,`upgrade:${clientIp(req)}`]))return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});
    const v=z.object({email:emailSchema,code:accessCode}).parse(req.body);
    if(!verifyAccessCode(store,p.id,v.code))return res.status(401).json({error:'The current owner code is incorrect.'});
    uniqueEmail(v.email,p.id);
    p.email=v.email;
    store.put('people',p.id,p);
    attempts.delete(`upgrade:${clientIp(req)}`);
    signIn(res,p);
  });
  app.post('/api/session',(req,res)=>{
    const v=loginSchema.safeParse(req.body);
    if(!v.success)return res.status(401).json({error:'Sign in with your email and private access code.'});
    const key=`email:${clientIp(req)}:${v.data.email}`;
    if(!allowAttempt([`ip:${clientIp(req)}`,key]))return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});
    const p=store.people().find(person=>person.email===v.data.email);
    const valid=verifyAccessCode(store,p?.id||'',v.data.code);
    if(!valid||!p?.active||p.role!==v.data.role)return res.status(401).json({error:'The email or private code is incorrect, or access is paused.'});
    attempts.delete(key);
    signIn(res,p);
  });
  app.get('/api/team-directory',o.auth,o.owner,(_req,res)=>res.json(store.people().map(p=>publicMember(store,p))));
  app.post('/api/team/:id/code',o.auth,o.owner,(req,res)=>{
    const id=String(req.params.id);const p=store.get<Person>('people',id);if(!p||p.role==='owner')return res.status(400).json({error:'Choose a team member.'});
    if(!p.active)return res.status(409).json({error:'Restore member access before issuing a new code.'});
    if(!p.email)return res.status(400).json({error:'Add the member’s sign-in email before issuing a code.'});
    const code='allowance_'+randomBytes(18).toString('base64url');setAccessCode(store,id,code);store.event('Member code reset',`New private access issued for ${p.name}; prior sessions ended.`,res.locals.person.name,null,'access');res.json({email:p.email,code});
  });
  app.put('/api/team/:id/profile',o.auth,o.owner,(req,res)=>{
    const id=String(req.params.id);const p=store.get<Person>('people',id);if(!p||p.role==='owner')return res.status(400).json({error:'Choose a team member.'});
    const fields=profileFields.extend({email:emailSchema.optional()}).parse(req.body);if(fields.email)uniqueEmail(fields.email,p.id);const emailChanged=!!fields.email&&fields.email!==p.email;const next={...p,...fields,budget:memberBudget(fields.budget,p.budget),weeklyBudget:memberBudget(fields.weeklyBudget,p.weeklyBudget),profileVersion:(p.profileVersion||0)+1};
    next.initials=next.name.split(/\s+/).map(v=>v[0]).slice(0,2).join('').toUpperCase();store.db.exec('BEGIN IMMEDIATE');
    try {
      store.put('people',id,next);
      if(emailChanged){store.db.prepare("DELETE FROM records WHERE kind='credentials' AND id=?").run(id);store.db.prepare('DELETE FROM sessions WHERE person_id=?').run(id);}
      store.db.exec('COMMIT');
    } catch(error) { store.db.exec('ROLLBACK');throw error; }
    store.event('Member profile updated',`${next.name}: responsibilities and allowance reviewed.`,res.locals.person.name,null,'policy');res.json(publicMember(store,next));
  });
  app.get('/api/memory',o.auth,(_req,res)=>{const p=res.locals.person as Person;res.json(store.list<any>('memory').filter(n=>n.personId===p.id||n.personId==='workspace'));});
  app.delete('/api/memory/:id',o.auth,(req,res)=>{const n=store.get<any>('memory',String(req.params.id));const p=res.locals.person as Person;if(!n||(n.personId!==p.id&&!(p.role==='owner'&&n.personId==='workspace')))return res.status(404).json({error:'Note not found.'});store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('memory',n.id);res.json({ok:true});});
  app.post('/api/assistant',o.auth,async(req,res)=>{
    const message=redact(z.string().trim().min(3).max(3000).parse(req.body.message));const p=res.locals.person as Person;const isOwner=p.role==='owner';
    const tasks=store.tasks().filter(t=>isOwner||t.assigneeId===p.id);const requests=isOwner?store.requests():store.requestsFor(p.id);
    const chats=store.personRecords<{role:string;text:string;createdAt:string;ledgerIntent?:LedgerQuestion}>('chat',p.id);
    const save=(role:string,text:string,extra={})=>{const entry={id:randomUUID(),personId:p.id,role,text,createdAt:new Date().toISOString(),...extra};store.put('chat',entry.id,entry);return entry;};
    save('user',message);
    if(requestsOverride(message))return res.json(save('assistant','Only the verified owner can change spending rules through workspace controls. Private credentials and internal instructions stay private.',{draft:null,proposals:[]}));
    const ledgerReply = ledgerAnswer(message, requests, isOwner, chats.find(chat => chat.role === 'assistant')?.ledgerIntent);
    if (ledgerReply) return res.json(save('assistant', redact(ledgerReply.text), {
      ledgerIntent: ledgerReply.intent, sources: ledgerReply.sources, draft: null, proposals: [],
    }));
    const mentionedIds = new Set(message.toUpperCase().match(/\bREQ-[A-Z0-9]+\b/g) ?? []);
    if (mentionedIds.size === 1 && /\b(?:paid|settled|receipt|completed payment)\b/i.test(message) &&
        !requests.some(record => mentionedIds.has(record.id))) {
      return res.json(save('assistant', 'I found no visible request with that ID. I can’t verify a payment or provide a receipt for it.', {
        draft: null, proposals: [],
      }));
    }
    const history=retrieve(message,chats,m=>m.text,10,6).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(m=>({role:m.role,text:m.text.slice(0,1200)}));
    const names=new Map(store.people().map(person=>[person.id,person.name]));
    const suppliers=store.suppliers();
    const projects=store.projects().filter(project=>isOwner||tasks.some(task=>task.projectId===project.id));
    const requestIds=new Set(requests.map(r=>r.id));
    const matchedRequests = requests.filter(record => mentionedIds.has(record.id)).slice(0, 8);
    const otherRequests = requests.filter(record => !mentionedIds.has(record.id));
    const slots = 8 - matchedRequests.length;
    const sources = [...matchedRequests, ...retrieve(message,otherRequests,r=>[r.id,r.title,r.purpose,r.category,r.status,names.get(r.requesterId),suppliers.find(s=>s.id===r.supplierId)?.name,projects.find(pr=>pr.id===r.projectId)?.name].join(' '),slots,Math.min(3, slots))];
    const ledger=sources.map(r=>({id:r.id,title:r.title,purpose:r.purpose.slice(0,900),requesterId:r.requesterId,requester:names.get(r.requesterId),amountXlm:money(r.amount),status:r.status,mode:r.mode,createdAt:r.createdAt,committedAt:r.committedAt,receipt:r.receipt}));
    const activity=retrieve(message,store.events().filter(e=>isOwner||Boolean(e.requestId&&requestIds.has(e.requestId))),e=>[e.requestId,e.title,e.detail].join(' '),5,2).map(({requestId,title,detail,createdAt})=>({requestId,title,detail:detail.slice(0,400),createdAt}));
    const notes=[...store.personRecords<{text:string;createdAt:string}>('memory',p.id),...store.personRecords<{text:string;createdAt:string}>('memory','workspace')].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const memory=retrieve(message,notes,n=>n.text,6,2).map(n=>n.text.slice(0,900));
    try {
      const paymentSetup = isOwner ? o.testnet.setupStatus() : null;
      const result=await o.callAI({mode:'workspace',agentInstructions:instructions,message,setup:paymentSetup && {
        walletSelected:!!paymentSetup.owner, agentInitialized:paymentSetup.initialized,
        agentSettings:paymentSetup.agentSettings, veloProjectLinked:!!paymentSetup.projectId,
        gasKeySaved:paymentSetup.gasKeyStored, contractStatus:paymentSetup.checks,
        merchantLinked:paymentSetup.boundSuppliers.length>0, currentTime:new Date().toISOString(),
      },history,authenticatedPerson:assistantMember(store,p),people:isOwner?store.people().map(x=>assistantMember(store,x)):[assistantMember(store,p)],tasks,projects:projects.map(project=>({...project,committed:isOwner?store.committed(project.id):undefined})),suppliers,categories,policy:store.policy(),requests:ledger,activity,memory,spendingTotals:spendingSummary(requests),ledgerCoverage:{
        totalRequests: requests.length,
        retrievedRequests: ledger.length,
        confirmedTestnetPayments: requests.filter(isConfirmedTestnetPayment).length,
      },moneyUnits:'Stored budgets, committed project totals, and member usage are integer stroops. Fields ending in Xlm and proposal amounts are already decimal XLM. Weekly caps reset Mondays in Manila.'});

      const safeResult = sanitize(result);
      const scope = z.object({scope:z.literal('workspace')}).safeParse(safeResult);
      if (!scope.success) {
        return res.json(save('assistant', 'I can help with workspace setup, assignments, spending rules, requests, and payment records. Open How it works for guidance.', {
          draft: null, proposals: [], showHelp: true,
        }));
      }
      const answer=z.object({reply:z.string().min(1).max(7000),draft:draftSchema.nullable().default(null),proposals:z.array(proposalSchema).max(3).default([]),model:z.string().optional()}).parse(safeResult);
      if(isOwner)answer.draft=null;
      if(answer.draft&&(!tasks.some(t=>t.id===answer.draft!.taskId&&t.active&&t.assigneeId===p.id)||!store.suppliers().some(s=>s.id===answer.draft!.supplierId&&s.approved&&s.category===answer.draft!.category)))answer.draft=null;
      if(answer.draft){
        try {
          units(answer.draft.amount);
          if(answer.draft.title.trim().length<5||answer.draft.purpose.trim().length<15)answer.draft=null;
        } catch { answer.draft=null; }
      }
      if(answer.draft?.evidenceUrl&&!z.url().refine(value=>new URL(value).protocol==='https:').safeParse(answer.draft.evidenceUrl).success)answer.draft.evidenceUrl='';
      const noteRequested = /^(?:(?:please|i want (?:you |the assistant )?to|can you|could you|help me)\s+)?(?:remember\b|tandaan\b|make (?:a )?note\b|(?:save|add|i-save)\b[^.!?]*\b(?:note|memory)\b)/i.test(message);
      const proposals=[];
      for(const proposal of answer.proposals){
        if(!isOwner&&proposal.type!=='memory')continue;
        if(proposal.type==='profile'&&(!profileFields.safeParse(proposal.fields).success||!store.people().some(x=>x.id===proposal.targetId&&x.role==='member')))continue;
        if(proposal.type==='profile'||proposal.type==='member'){
          try { memberBudget(proposal.fields.budget as string|null|undefined); memberBudget(proposal.fields.weeklyBudget as string|null|undefined); } catch { continue; }
        }
        if(proposal.type==='policy'&&!policyFields.safeParse(proposal.fields).success)continue;
        if(proposal.type==='memory'&&(!noteRequested||!memoryFields.safeParse(proposal.fields).success||(proposal.targetId!==p.id&&!(isOwner&&proposal.targetId==='workspace'))))continue;
        if(Object.hasOwn(proposalFields,proposal.type)&&!proposalFields[proposal.type as keyof typeof proposalFields].safeParse(proposal.fields).success)continue;
        if(proposal.type==='agent'){
          if(!paymentSetup?.owner)continue;
          try { parseAgentSettings(proposal.fields); } catch { continue; }
          proposal.targetId=paymentSetup.owner;
        }
        const stored={...proposal,id:randomUUID(),personId:p.id,state:'pending',policyVersion:store.policy().version,profileVersion:store.get<Person>('people',proposal.targetId)?.profileVersion||0};store.put('proposals',stored.id,stored);proposals.push(stored);
      }
      o.connected(answer.model);res.json(save('assistant',redact(answer.reply),{draft:answer.draft,proposals,model:answer.model,sources:ledger.map(({id,title})=>({id,title}))}));
    }catch(error){o.failed(error);res.status(503).json(save('assistant','The assistant couldn’t complete this response. Your message is saved. Check Connections or continue setting up your workspace.',{draft:null,error:'The assistant couldn’t complete the response. See Connections.'}));}
  });
  app.post('/api/proposals/:id/apply',o.auth,(req,res)=>{
    const v=store.get<any>('proposals',String(req.params.id));const p=res.locals.person as Person;
    if(!v||v.personId!==p.id)return res.status(404).json({error:'Proposal not found.'});if(v.state!=='pending')return res.status(409).json({error:'This proposal was already handled.'});
    if(v.type!=='memory'&&p.role!=='owner')return res.status(403).json({error:'Only the owner can apply this change.'});
    store.db.exec('BEGIN IMMEDIATE');
    try {
      if(v.type==='profile'){const member=store.get<Person>('people',v.targetId);if(!member||member.role==='owner')throw new Error('Member not found.');if((member.profileVersion||0)!==v.profileVersion)throw new Error('Profile changed. Ask for a fresh proposal.');const f=profileFields.parse(v.fields);store.put('people',member.id,{...member,...f,budget:memberBudget(f.budget,member.budget),weeklyBudget:memberBudget(f.weeklyBudget,member.weeklyBudget),profileVersion:(member.profileVersion||0)+1});}
      if(v.type==='policy'){if(store.policy().version!==v.policyVersion)throw new Error('Policy changed. Ask for a fresh proposal.');const f=policyFields.parse(v.fields),policy={...store.policy(),...f,version:store.policy().version+1};for(const field of ['perRequest','autoLimit','projectLimit'] as const)policy[field]=f[field]===undefined?store.policy()[field]:units(f[field]!);if(policy.autoLimit>policy.perRequest||policy.perRequest>policy.projectLimit)throw new Error('Automatic limit must be within request and project limits.');store.put('policy','main',policy);}
      if(v.type==='memory'){const f=memoryFields.parse(v.fields);if(v.targetId!==p.id&&!(p.role==='owner'&&v.targetId==='workspace'))throw new Error('Note access denied.');if(store.list('memory').length>=200)throw new Error('Remove an old memory note first.');const id=randomUUID();store.put('memory',id,{id,personId:v.targetId,text:redact(f.text),createdAt:new Date().toISOString()});}
      if(v.type==='agent')o.testnet.saveAgentSettings(v.targetId,v.fields);
      if(Object.hasOwn(recordKinds,v.type)){
        const kind=recordKinds[v.type as keyof typeof recordKinds];
        const fields=v.type==='member'?{...memberProfileFields.parse(v.fields),email:emailSchema.parse(req.body?.email)}:v.fields;
        createSetupRecord(store,kind,fields,p.name);
      }
      v.state='applied';store.put('proposals',v.id,v);store.event('Suggestion applied',v.summary,p.name,null,'policy');
      store.db.exec('COMMIT');
    } catch (error) {
      store.db.exec('ROLLBACK');
      throw error;
    }
    res.json({ok:true});
  });
}
