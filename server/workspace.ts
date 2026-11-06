import type { Express, Request, RequestHandler } from 'express';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { Store } from './store.ts';
import { categories, units, money, type Person } from './domain.ts';

const instructions = readFileSync(new URL('./agent-instructions.md', import.meta.url), 'utf8');
const profileFields = z.object({name:z.string().trim().min(2).max(80).optional(),title:z.string().trim().min(2).max(100).optional(),description:z.string().max(3000).optional(),budget:z.string().nullable().optional(),allowedCategories:z.array(z.enum(categories)).min(1).optional()}).strict();
const policyFields = z.object({description:z.string().max(4000).optional(),perRequest:z.string().optional(),autoLimit:z.string().optional(),projectLimit:z.string().optional(),allowedCategories:z.array(z.enum(categories)).min(1).optional()}).strict();
const memoryFields = z.object({text:z.string().trim().min(3).max(2000)}).strict();
const proposalSchema = z.object({type:z.enum(['profile','policy','memory']),targetId:z.string().max(100),summary:z.string().max(1000),fields:z.record(z.string(),z.unknown())});
const draftSchema = z.object({title:z.string().max(120),taskId:z.string(),supplierId:z.string(),category:z.enum(categories),amount:z.string().max(30),purpose:z.string().max(3000),evidenceUrl:z.string().max(2000).default('')});
export function setAccessCode(store:Store,id:string,code:string) {
  if (code.length<8 || code.length>128) throw new Error('Use a private code of 8 to 128 characters.');
  const salt=randomBytes(16).toString('hex'); store.put('credentials',id,{salt,hash:scryptSync(code,salt,32).toString('hex')});
  store.db.prepare('DELETE FROM sessions WHERE person_id=?').run(id);
}
export function verifyAccessCode(store:Store,id:string,code:string) {
  const c=store.get<{salt:string;hash:string}>('credentials',id);
  const hash=scryptSync(code.slice(0,128),c?.salt||'not-an-account',32);
  return !!c && timingSafeEqual(hash,Buffer.from(c.hash,'hex'));
}
export function publicMember(store:Store,p:Person) { return {...p,codeSet:!!store.get('credentials',p.id),spent:store.memberSpent(p.id),description:p.description||store.tasks().filter(t=>t.assigneeId===p.id).map(t=>t.description).join(' ')}; }
const redact = (text:string) => text.replace(/\btg_test_[a-f0-9]{32}\b/gi,'[credential removed]').replace(/\b(?:code|password|passcode)\s*[:=]\s*\S+/gi,'[private code removed]');

export function installWorkspace(app:Express,store:Store,o:{auth:RequestHandler;owner:RequestHandler;sessionPerson:(req:Request)=>Person|undefined;callAI:(body:Record<string,unknown>)=>Promise<any>;connected:(model?:string)=>void;failed:(error:unknown)=>void}) {
  // One-time migration removes the old identity-only demo sessions.
  if (!store.setting('access-v2')) {store.db.prepare('DELETE FROM sessions').run();store.setSetting('access-v2','enabled');}
  const workspaceOwner=store.get<Person>('people','owner');if(workspaceOwner?.title==='Studio owner'){workspaceOwner.title='Workspace owner';store.put('people','owner',workspaceOwner);}
  const attempts=new Map<string,{count:number;until:number}>();
  app.get('/api/auth/status',(req,res)=>{const session=o.sessionPerson(req);res.json({setupRequired:!store.get('credentials','owner'),sessionRole:session?.active?session.role:undefined});});
  app.get('/api/demo-identities',(_req,res)=>res.json([]));
  app.post('/api/auth/setup',(req,res)=>{
    if(store.get('credentials','owner')) return res.status(409).json({error:'Owner access is already configured.'});
    const v=z.object({name:z.string().trim().min(2).max(80),code:z.string().min(8).max(128)}).parse(req.body);
    const p=store.get<Person>('people','owner')!;p.name=v.name;p.initials=v.name.split(/\s+/).map(v=>v[0]).slice(0,2).join('').toUpperCase();store.put('people',p.id,p);setAccessCode(store,p.id,v.code);
    res.cookie('allowance_session',store.session(p.id),{httpOnly:true,sameSite:'strict',maxAge:12*3600000});res.json({person:p});
  });
  app.post('/api/session',(req,res)=>{
    const v=z.object({personId:z.string().max(100),code:z.string().min(1).max(128),role:z.enum(['owner','member']).optional()}).safeParse(req.body);
    if(!v.success)return res.status(401).json({error:'Sign in with your member ID and private code.'});
    const key=`${req.ip}:${v.data.personId}`; const prior=attempts.get(key); const a=prior&&prior.until>Date.now()?prior:{count:0,until:Date.now()+15*60000};attempts.set(key,a);
    if(a.count>=5)return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});a.count++;
    const p=store.get<Person>('people',v.data.personId);
    if(!verifyAccessCode(store,v.data.personId,v.data.code)||!p?.active||(v.data.role&&p.role!==v.data.role))return res.status(401).json({error:'Member ID or private code is incorrect, or access is paused.'});
    attempts.delete(key);res.cookie('allowance_session',store.session(p.id),{httpOnly:true,sameSite:'strict',maxAge:12*3600000});res.json({person:p});
  });
  app.get('/api/team-directory',o.auth,o.owner,(_req,res)=>res.json(store.people().map(p=>publicMember(store,p))));
  app.post('/api/team/:id/code',o.auth,o.owner,(req,res)=>{
    const id=String(req.params.id);const p=store.get<Person>('people',id);if(!p||p.role==='owner')return res.status(400).json({error:'Choose a team member.'});
    const code=randomBytes(12).toString('base64url');setAccessCode(store,id,code);store.event('Member code reset',`New private access issued for ${p.name}; prior sessions ended.`,res.locals.person.name,null,'access');res.json({personId:id,code});
  });
  app.put('/api/team/:id/profile',o.auth,o.owner,(req,res)=>{
    const id=String(req.params.id);const p=store.get<Person>('people',id);if(!p||p.role==='owner')return res.status(400).json({error:'Choose a team member.'});
    const fields=profileFields.parse(req.body);const next={...p,...fields,budget:fields.budget===undefined?p.budget:(fields.budget===null?undefined:/^0(?:\.0{1,7})?$/.test(fields.budget)?0:units(fields.budget)),profileVersion:(p.profileVersion||0)+1};
    next.initials=next.name.split(/\s+/).map(v=>v[0]).slice(0,2).join('').toUpperCase();store.put('people',id,next);store.event('Member profile updated',`${next.name}: responsibilities and allowance reviewed.`,res.locals.person.name,null,'policy');res.json(publicMember(store,next));
  });
  app.get('/api/memory',o.auth,(_req,res)=>{const p=res.locals.person as Person;res.json(store.list<any>('memory').filter(n=>n.personId===p.id||n.personId==='workspace'));});
  app.delete('/api/memory/:id',o.auth,(req,res)=>{const n=store.get<any>('memory',String(req.params.id));const p=res.locals.person as Person;if(!n||(n.personId!==p.id&&!(p.role==='owner'&&n.personId==='workspace')))return res.status(404).json({error:'Note not found.'});store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('memory',n.id);res.json({ok:true});});
  app.post('/api/assistant',o.auth,async(req,res)=>{
    const message=redact(z.string().trim().min(3).max(3000).parse(req.body.message));const p=res.locals.person as Person;const isOwner=p.role==='owner';
    const tasks=store.tasks().filter(t=>isOwner||t.assigneeId===p.id);const requests=store.requests().filter(r=>isOwner||r.requesterId===p.id);
    const history=store.list<any>('chat').filter(m=>m.personId===p.id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-10).map(m=>({role:m.role,text:m.text}));
    const save=(role:string,text:string,extra={})=>{const entry={id:randomUUID(),personId:p.id,role,text,createdAt:new Date().toISOString(),...extra};store.put('chat',entry.id,entry);return entry;};
    save('user',message);
    try {
      const result=await o.callAI({mode:'workspace',agentInstructions:instructions,message,history,authenticatedPerson:publicMember(store,p),people:isOwner?store.people().map(x=>publicMember(store,x)):[publicMember(store,p)],tasks,projects:store.projects().filter(project=>isOwner||tasks.some(task=>task.projectId===project.id)).map(project=>({...project,committed:store.committed(project.id)})),suppliers:store.suppliers(),categories,policy:store.policy(),requests:requests.slice(0,30),activity:store.events().filter(e=>isOwner||requests.some(r=>r.id===e.requestId)).slice(0,20),memory:store.list<any>('memory').filter(n=>n.personId===p.id||n.personId==='workspace'),moneyUnits:'All numeric stored budgets are integer stroops. Divide by 10000000 for XLM. Proposal amounts must be decimal XLM strings.'});
      const answer=z.object({reply:z.string().min(1).max(7000),draft:draftSchema.nullable().default(null),proposals:z.array(proposalSchema).max(3).default([]),model:z.string().optional()}).parse(result);
      if(isOwner)answer.draft=null;
      if(answer.draft&&(!tasks.some(t=>t.id===answer.draft!.taskId&&t.assigneeId===p.id)||!store.suppliers().some(s=>s.id===answer.draft!.supplierId)))answer.draft=null;
      if(answer.draft?.evidenceUrl&&!answer.draft.evidenceUrl.startsWith('https://'))answer.draft.evidenceUrl='';
      const proposals=[];
      for(const proposal of answer.proposals){
        if(!isOwner&&proposal.type!=='memory')continue;
        if(proposal.type==='profile'){profileFields.parse(proposal.fields);if(!store.people().some(x=>x.id===proposal.targetId&&x.role==='member'))continue;}
        if(proposal.type==='policy')policyFields.parse(proposal.fields);
        if(proposal.type==='memory'){memoryFields.parse(proposal.fields);if(proposal.targetId!==p.id&&!(isOwner&&proposal.targetId==='workspace'))continue;}
        const stored={...proposal,id:randomUUID(),personId:p.id,state:'pending',policyVersion:store.policy().version,profileVersion:store.get<Person>('people',proposal.targetId)?.profileVersion||0};store.put('proposals',stored.id,stored);proposals.push(stored);
      }
      o.connected(answer.model);res.json(save('assistant',redact(answer.reply),{draft:answer.draft,proposals,model:answer.model}));
    }catch(error){o.failed(error);res.status(503).json(save('assistant','I couldn’t reach the AI service. Your message is saved. Check Connections and try again; profiles, rules and requests are still available manually.',{draft:null,error:'AI connection unavailable. See Connections for details.'}));}
  });
  app.post('/api/proposals/:id/apply',o.auth,(req,res)=>{
    const v=store.get<any>('proposals',String(req.params.id));const p=res.locals.person as Person;
    if(!v||v.personId!==p.id)return res.status(404).json({error:'Proposal not found.'});if(v.state!=='pending')return res.status(409).json({error:'This proposal was already handled.'});
    if(v.type!=='memory'&&p.role!=='owner')return res.status(403).json({error:'Only the owner can apply this change.'});
    if(v.type==='profile'){const member=store.get<Person>('people',v.targetId);if(!member||member.role==='owner')throw new Error('Member not found.');if((member.profileVersion||0)!==v.profileVersion)throw new Error('Profile changed. Ask for a fresh proposal.');const f=profileFields.parse(v.fields);store.put('people',member.id,{...member,...f,budget:f.budget===undefined?member.budget:(f.budget===null?undefined:/^0(?:\.0{1,7})?$/.test(f.budget)?0:units(f.budget)),profileVersion:(member.profileVersion||0)+1});}
    if(v.type==='policy'){if(store.policy().version!==v.policyVersion)throw new Error('Policy changed. Ask for a fresh proposal.');const f=policyFields.parse(v.fields),policy={...store.policy(),...f,version:store.policy().version+1};for(const field of ['perRequest','autoLimit','projectLimit'] as const)policy[field]=f[field]===undefined?store.policy()[field]:units(f[field]!);if(policy.autoLimit>policy.perRequest||policy.perRequest>policy.projectLimit)throw new Error('Automatic limit must be within request and project limits.');store.put('policy','main',policy);}
    if(v.type==='memory'){const f=memoryFields.parse(v.fields);if(v.targetId!==p.id&&!(p.role==='owner'&&v.targetId==='workspace'))throw new Error('Note access denied.');if(store.list('memory').length>=200)throw new Error('Remove an old memory note first.');const id=randomUUID();store.put('memory',id,{id,personId:v.targetId,text:redact(f.text),createdAt:new Date().toISOString()});}
    v.state='applied';store.put('proposals',v.id,v);store.event('Reviewed AI proposal applied',v.summary,p.name,null,'policy');res.json({ok:true});
  });
}
