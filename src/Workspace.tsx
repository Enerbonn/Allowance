import React,{useEffect,useState,useRef} from 'react';
import {KeyRound,Plus,Sparkles,ShieldCheck,Save,X,Copy,Trash2,LogIn,Users,LoaderCircle,ArrowLeft,ChevronRight} from 'lucide-react';
import './workspace.css';
const fmt=(v:number)=>new Intl.NumberFormat('en',{maximumFractionDigits:7}).format(v/1e7);
async function api(path:string,init:RequestInit={}){const r=await fetch('/api'+path,{...init,headers:{'content-type':'application/json','x-allowance-client':'local-prototype'}});const v=await r.json();if(!r.ok)throw new Error(v.error||'Please try again.');return v;}

function WorkspaceDialog({label,close,children}:{label:string;close:()=>void;children:React.ReactNode}) {const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const active=document.activeElement as HTMLElement;ref.current?.showModal();return()=>active?.focus();},[]);return <dialog ref={ref} className="workspace-dialog" aria-label={label} onCancel={close}>{children}</dialog>;}

type AccessRole = 'owner' | 'member';

export function SignIn({ ready }: { ready: (role: AccessRole) => Promise<void> }) {
  const [role, setRole] = useState<AccessRole | null>(null);
  const [status, setStatus] = useState<{ setupRequired: boolean; ownerNeedsEmail: boolean; setupTokenRequired: boolean; sessionRole?: AccessRole } | null>(null);
  const [email, setEmail] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setup = role === 'owner' && status?.setupRequired;
  const migrate = role === 'owner' && status?.ownerNeedsEmail;

  async function choose(nextRole: AccessRole) {
    setRole(nextRole);
    setStatus(null);
    setError('');
    setBusy(true);
    try { setStatus(await api('/auth/status')); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function enter(resume = false) {
    if (!role) return;
    setBusy(true);
    setError('');
    try {
      if (!resume) {
        const payload = setup ? { name, email, code, setupToken } : migrate ? { email, code } : { email, code, role };
        await api(setup ? '/auth/setup' : migrate ? '/auth/owner-email' : '/session', { method: 'POST', body: JSON.stringify(payload) });
      }
      await ready(role);
      setCode('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!role) return <section className="signin-panel" aria-labelledby="access-heading">
    <span className="access-symbol"><KeyRound size={25}/></span>
    <h2 id="access-heading">Choose how to enter</h2>
    <p>Open your business workspace or sign in to request a purchase.</p>
    <div className="role-options">
      <button className="secondary-btn role-option" type="button" onClick={() => void choose('owner')}>
        <ShieldCheck size={22} aria-hidden="true"/><span><strong>Business owner</strong><small>Create a workspace or manage your team and wallet.</small></span><ChevronRight size={17} aria-hidden="true"/>
      </button>
      <button className="secondary-btn role-option" type="button" onClick={() => void choose('member')}>
        <Users size={22} aria-hidden="true"/><span><strong>Team member</strong><small>Sign in with the email and private code your owner has on file.</small></span><ChevronRight size={17} aria-hidden="true"/>
      </button>
    </div>
  </section>;

  return <form className="signin-panel" onSubmit={e => { e.preventDefault(); void enter(); }}>
    <button className="text-btn role-back" type="button" disabled={busy} onClick={() => { setRole(null); setCode(''); setEmail(''); setSetupToken(''); setError(''); }}><ArrowLeft size={16}/>Choose a role</button>
    <h2>{setup ? 'Create your owner account' : migrate ? 'Set your owner sign-in email' : role === 'owner' ? 'Sign in as business owner' : 'Sign in as team member'}</h2>
    {!status && busy && <p role="status">Checking workspace access…</p>}
    {role === 'member' && status?.setupRequired && <p>The business owner needs to set up the workspace and add your email and issue a private code first.</p>}
    {status && (role === 'owner' || !status.setupRequired) && <>
      {status.sessionRole === role && <button className="secondary-btn" type="button" disabled={busy} onClick={() => void enter(true)}>Continue existing session</button>}
      <p>{setup ? 'Use an email you can share with your team and create a private access code.' : migrate ? 'Enter your current owner code once to add your email.' : 'Enter your sign-in email and private access code.'}</p>
      {setup && <label>Your name<input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)}/></label>}
      <label>Email<input type="email" autoComplete="username" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/></label>
      <label>Private access code<input type="password" autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup || migrate ? 8 : 1} maxLength={128} value={code} onChange={e => setCode(e.target.value)} placeholder={setup ? 'At least 8 characters' : undefined}/></label>
      {setup && status.setupTokenRequired && <label>Owner setup token<input type="password" autoComplete="off" required value={setupToken} onChange={e => setSetupToken(e.target.value)}/></label>}
      <button disabled={busy} className="primary-btn">{busy ? <LoaderCircle className="spin" size={16}/> : <LogIn size={16}/>} {setup ? 'Create account' : migrate ? 'Save email and sign in' : 'Sign in'}</button>
    </>}
    {error && <p role="alert" className="form-error">{error}</p>}
  </form>;
}

export function TeamConsole({data,refresh,add,ask}:{data:any;refresh:()=>Promise<void>;add:()=>void;ask:(text:string)=>void}){
 const owner=data.person.role==='owner';const [editing,setEditing]=useState<any>(null),[secret,setSecret]=useState<{email:string;code:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
 const members=data.people.filter((p:any)=>`${p.name} ${p.title} ${p.email || ''}`.toLowerCase().includes(query.toLowerCase()));
 async function reset(p:any){setBusy(true);setError('');try{setSecret(await api(`/team/${p.id}/code`,{method:'POST'}));await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{await api(`/team/${editing.id}/profile`,{method:'PUT',body:JSON.stringify({name:editing.name,title:editing.title,email:editing.email,description:editing.description,goal:editing.goal,spendingGuidance:editing.spendingGuidance,budget:editing.budget||null,allowedCategories:editing.allowedCategories})});setEditing(null);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <><div className="page-heading"><div><h1>{owner?'People, permissions & spending':'Your work profile'}</h1><p>{owner?'Give each person a clear role, a private entry code and room to work.':'The assistant checks these responsibilities and limits against your requests.'}</p></div>{owner&&<button className="primary-btn" onClick={add}><Plus size={16}/>Add member</button>}</div>
 {owner&&<div className="team-assist-banner"><Sparkles size={24}/><div><h2>Team profiles</h2><p>Tell the assistant what someone does. Review its suggested responsibilities and spending rules before applying.</p></div><button className="secondary-btn" onClick={()=>ask('Help me build clear responsibility profiles and spending limits for my team. Ask me about the business facts you need before proposing changes.')}>Draft a profile</button></div>}
 <div className="team-toolbar"><label>Find a person<input placeholder="Name, role or email" value={query} onChange={e=>setQuery(e.target.value)}/></label><span>{members.length} people · XLM allowances</span></div>
 <p className="table-scroll-hint">On a narrow screen, scroll the table sideways to see allowances and access controls.</p><div className="team-table-wrap" tabIndex={0} role="region" aria-label="Scrollable team directory"><table className="team-table"><caption className="sr-only">Team profiles, member access and spending allowances</caption><thead><tr><th>Name and email</th><th>Role & responsibilities</th><th>Total allowance</th><th>Access</th>{owner&&<th>Manage</th>}</tr></thead><tbody>{members.map((p:any)=><tr key={p.id}><td><strong>{p.name}</strong><small>{p.email || 'Email needed'}</small><span className="badge neutral">{p.role==='owner'?'Owner':'Team member'}</span></td><td><strong>{p.title}</strong><p>{p.description||(p.role==='owner'?'Sets team responsibilities, purchasing rules and budgets; reviews exceptions.':'Add a description so requests can be checked against their actual work.')}</p>{p.goal&&<small>Goal · {p.goal}</small>}{p.spendingGuidance&&<small>Spending · {p.spendingGuidance}</small>}<small>{data.tasks.filter((t:any)=>t.assigneeId===p.id).length} assigned tasks</small></td><td>{p.role==='owner'?<span>Workspace oversight</span>:<><strong>{p.budget===undefined?'Uses project limits':fmt(p.budget)+' XLM'}</strong><small>{fmt(p.spent||0)} spent{p.budget!==undefined?' · '+fmt(Math.max(0,p.budget-(p.spent||0)))+' left':''}</small><small>Total across all projects; does not reset automatically.</small></>}</td><td><span className={'badge '+(p.active?'paid':'blocked')}>{p.active?'Active':'Paused'}</span><small>{p.codeSet?'Private code set':'Code not issued'}</small></td>{owner&&<td>{p.role!=='owner'&&<div className="team-actions"><button className="secondary-btn" onClick={()=>setEditing({...p,budget:p.budget===undefined?'':String(p.budget/1e7),description:p.description||'',email:p.email||'',goal:p.goal||'',spendingGuidance:p.spendingGuidance||'',allowedCategories:p.allowedCategories||data.categories})}>Edit profile</button><button disabled={busy||!p.email} className="text-btn" onClick={()=>void reset(p)}><KeyRound size={13}/>{p.codeSet?'Reset code':'Issue code'}</button><button className="text-btn" onClick={()=>ask(`Help improve ${p.name}'s responsibilities and purchasing guidance. Use the saved profile, ask for missing facts, and propose changes for me to review.`)}><Sparkles size={13}/>Draft responsibilities</button><button className="text-btn" onClick={async()=>{await api(`/team/${p.id}/toggle`,{method:'POST'});await refresh();}}>{p.active?'Pause access':'Restore access'}</button></div>}</td>}</tr>)}</tbody></table>{!members.length&&<div className="empty-state"><Users/><p>No people match your search.</p></div>}</div>
 {error&&<p role="alert" className="form-error">{error}</p>}
 {secret&&<WorkspaceDialog label="New member access code" close={()=>setSecret(null)}><section className="access-card"><button className="icon-btn close-access" aria-label="Close access code" onClick={()=>setSecret(null)}><X/></button><KeyRound size={28}/><h2>Share this privately</h2><p>This code is shown once. A reset ends earlier sessions and replaces the previous code.</p><label>Sign-in email<input readOnly value={secret.email}/></label><label>Private code<input readOnly value={secret.code}/></label><button className="secondary-btn" onClick={()=>void navigator.clipboard.writeText(`Email: ${secret.email}\nPrivate code: ${secret.code}`)}><Copy size={15}/>Copy sign-in details</button><button className="primary-btn" onClick={()=>setSecret(null)}>I’ve saved the details</button></section></WorkspaceDialog>}
 {editing&&<WorkspaceDialog label="Edit team profile" close={()=>setEditing(null)}><form className="access-card profile-editor" onSubmit={save}><h2>Edit work profile</h2><p>These details help the assistant match requests to the member’s work.</p>{[['name','Name'],['title','Role']].map(([k,label])=><label key={k}>{label}<input required value={editing[k]} onChange={e=>setEditing({...editing,[k]:e.target.value})}/></label>)}<label>Sign-in email<input type="email" autoComplete="off" required maxLength={254} value={editing.email} onChange={e=>setEditing({...editing,email:e.target.value})}/><small>Changing this email ends their sessions and requires a new code.</small></label><label>Responsibilities & purchasing guidance<textarea rows={5} maxLength={3000} value={editing.description} onChange={e=>setEditing({...editing,description:e.target.value})}/></label><label>Goal<textarea rows={2} maxLength={1000} value={editing.goal} onChange={e=>setEditing({...editing,goal:e.target.value})}/></label><label>Spending guidance<textarea rows={2} maxLength={1000} value={editing.spendingGuidance} onChange={e=>setEditing({...editing,spendingGuidance:e.target.value})}/></label><label>Total spending allowance (XLM)<input inputMode="decimal" placeholder="Leave blank to use project limits" value={editing.budget} onChange={e=>setEditing({...editing,budget:e.target.value})}/><small>All-time total across projects. A new limit cannot undo earlier payments.</small></label><fieldset><legend>Permitted purchase categories</legend><div className="category-options">{data.categories.map((c:string)=><label key={c}><input type="checkbox" checked={editing.allowedCategories.includes(c)} onChange={e=>setEditing({...editing,allowedCategories:e.target.checked?[...editing.allowedCategories,c]:editing.allowedCategories.filter((x:string)=>x!==c)})}/>{c}</label>)}</div></fieldset>{error&&<p role="alert" className="form-error">{error}</p>}<div className="modal-footer"><button type="button" className="secondary-btn" onClick={()=>setEditing(null)}>Cancel</button><button disabled={busy} className="primary-btn"><Save size={15}/>Save profile</button></div></form></WorkspaceDialog>}
 </>;
}

export function AgentMemory({owner,ask}:{owner:boolean;ask:(text:string)=>void}){
 const [notes,setNotes]=useState<any[]>([]),[error,setError]=useState('');const load=()=>api('/memory').then(setNotes).catch(e=>setError(e.message));useEffect(()=>{void load();},[]);
 return <><div className="page-heading"><div><h1>Saved notes</h1><p>Reviewed notes, remembered conversations and clear boundaries.</p></div><button className="primary-btn" onClick={()=>ask('I want to save a useful memory note for future conversations. Ask me what should be remembered, then propose a note for review.')}><Plus size={16}/>Add with assistant</button></div><div className="memory-explainer"><ShieldCheck/><p>Your conversations are private to your sign-in. Notes saved for the workspace are shared business context. A note cannot change someone’s role, budget or access.</p></div><div className="surface-list">{notes.map(n=><div className="memory-note" key={n.id}><div><span className="badge neutral">{n.personId==='workspace'?'Shared workspace':'Private note'}</span><p>{n.text}</p><small>{new Date(n.createdAt).toLocaleString()}</small></div>{(n.personId!=='workspace'||owner)&&<button className="icon-btn" aria-label="Remove memory note" onClick={async()=>{await api(`/memory/${n.id}`,{method:'DELETE'});await load();}}><Trash2 size={17}/></button>}</div>)}{!notes.length&&<div className="empty-state"><Sparkles/><h3>No reviewed notes yet</h3><p>Ask the assistant to remember a business preference, then review its suggestion.</p></div>}</div>{error&&<p role="alert">{error}</p>}</>;
}

const proposalTitles: Record<string, string> = {
  profile: 'Profile suggestion', policy: 'Spending rules', memory: 'Note suggestion',
  member: 'New team member', project: 'New project', task: 'New assignment',
  supplier: 'Supplier record', agent: 'Agent authorization terms',
};
const proposalLabels: Record<string, string> = {
  description: 'Description', goal: 'Goal', spendingGuidance: 'Spending guidance',
  budget: 'Allowance (XLM)', title: 'Title', perRequest: 'Per request (XLM)',
  autoLimit: 'Automatic limit (XLM)', projectLimit: 'Project ceiling (XLM)',
  allowedCategories: 'Permitted categories', text: 'Note', name: 'Name',
  label: 'Agent name', maxAmount: 'Contract cap per transaction (XLM)',
  expiresAt: 'Authorization expiry', projectId: 'Project', assigneeId: 'Team member',
  category: 'Category', requireEvidence: 'Require a quote or attachment', domain: 'Website domain', approved: 'Approved',
};

export function ProposalCard({ proposal, refresh, names, openAgent }: {
  proposal: { id: string; type: string; state?: string; summary: string; fields: Record<string, unknown> };
  refresh: () => Promise<void>;
  names: Record<string, string>;
  openAgent: () => void;
}) {
  const [applied, setApplied] = useState(proposal.state === 'applied');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const createsMember = proposal.type === 'member';
  const agent = proposal.type === 'agent';
  function display(key: string, value: unknown) {
    if (value === null) return key === 'expiresAt' ? 'No expiry' : key === 'maxAmount' ? 'No contract cap' : 'Use project limits';
    if (key === 'expiresAt' && typeof value === 'string') return new Date(value).toLocaleString();
    if ((key === 'projectId' || key === 'assigneeId') && typeof value === 'string') return names[value] || 'Unavailable';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }
  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/proposals/${proposal.id}/apply`, { method: 'POST', body: JSON.stringify(createsMember ? { email } : {}) });
      setApplied(true);
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="proposal-card" onSubmit={apply}>
    <strong>{proposalTitles[proposal.type] || 'Setup suggestion'}</strong>
    <p>{proposal.summary}</p>
    <dl>{Object.entries(proposal.fields).map(([key, value]) => <React.Fragment key={key}><dt>{proposalLabels[key] || key}</dt><dd>{display(key, value)}</dd></React.Fragment>)}</dl>
    {createsMember && !applied && <label>Sign-in email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="off"/><small>Enter the email this member gave you.</small></label>}
    <small>{agent ? 'Review and save the terms, then sign the authorization in Connections.' : 'Review the details before applying.'}</small>
    <button disabled={busy || applied} className="primary-btn">{applied ? 'Applied' : 'Apply reviewed suggestion'}</button>
    {agent && applied && <button type="button" className="text-btn" onClick={openAgent}>Open agent authorization</button>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
