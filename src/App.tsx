import React, { useEffect, useState, useRef } from 'react';
import { ArrowUpRight, ArrowRight, ArrowDownToLine, Plus, Search, X, Check, ChevronRight, ChevronDown, ShieldCheck, Wallet, LayoutDashboard, FileText, Users, SlidersHorizontal, Activity, Settings, Command, CircleHelp, Sparkles, Clock3, CheckCircle2, CircleAlert, Layers3, LogOut, Pause, Play, ExternalLink, LoaderCircle, RefreshCw, ReceiptText, LockKeyhole, PanelRightClose, Menu, Link, Send, CreditCard, FolderOpen, CircleDot, MessageSquare, Upload } from 'lucide-react';
import '@fontsource-variable/manrope';
import './style.css';
import './responsive-fixes.css';
import './koaspend.css';
import { Brand, AuthBrandingPanel } from './Brand';
import {SignIn,TeamConsole,ProposalCard} from './Workspace';
import {TestnetPanel, getTestnetStatus, type TestnetStatus, type PaymentStep} from './Testnet';
import {OwnerSetup, type SetupAction} from './OwnerSetup';
import { pagePath, projectRequestsPath, readRoute, requestPath, type Page } from './routes';
import type { SpendRequest, Person, Policy, Project, Task, Supplier, Event, Check as PolicyCheck } from '../server/domain';

type RequestItem = SpendRequest & { checks: PolicyCheck[]; paymentProgress?: {canCheck:boolean;label:string;detail:string} };
type Draft = { draftId?: string; supplierName?: string; title: string; taskId: string; supplierId: string; category: string; amount: string; purpose: string; evidenceUrl: string };
type ChatMessage = { id: string; role: string; text: string; model?: string; showHelp?: boolean; draftUnavailable?: boolean; draft?: Draft | null; proposals?: any[]; sources?: {id:string;title:string}[] };
type MemberRecord = Person & {weeklySpent:number; weeklyResetAt:string};
type Data = { messages: ChatMessage[]; person: MemberRecord; people: MemberRecord[]; projects: (Project & { committed: number })[]; tasks: Task[]; suppliers: Supplier[]; policy: Policy; requests: RequestItem[]; events: Event[]; categories: string[]; ai: { provider: string | null; connected: boolean; model: string | null; lastChecked: string | null; message: string }; integrations: { payments: string; wallet: boolean; velo: boolean; noir: boolean; n8nUrl: string; sampleWorkspace: boolean } };
const amount = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 7 }).format(n / 1e7);
const relative = (date: string) => { const m = Math.floor((Date.now() - new Date(date).getTime()) / 60000); return m < 1 ? 'Just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : new Date(date).toLocaleDateString('en', { month: 'short', day: 'numeric' }); };
const statusLabels: Record<string, string> = { needs_review: 'Needs review', analyzing: 'Reviewing', paid: 'Paid', blocked: 'Blocked by policy', authorized: 'Payment pending', payment_failed: 'Payment failed', declined: 'Declined', cancelled: 'Cancelled' };
async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-allowance-client': 'local-prototype', ...init.headers } });
  const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Something went wrong. Try again.'); return data;
}
function Avatar({ person, small = false }: { person?: Person; small?: boolean }) { return <span className={`avatar ${small ? 'small' : ''} ${person?.id || ''}`}>{person?.initials || 'KS'}</span>; }
function Badge({ status, mode }: { status: string; mode?: string }) { return <span className={`badge ${status}`}>{status === 'analyzing' ? <LoaderCircle size={12} className="spin"/> : status === 'paid' ? <Check size={12}/> : status === 'blocked' ? <LockKeyhole size={11}/> : <span className="badge-dot"/>}{status==='paid'?(mode==='testnet'?'Paid on Testnet':'Paid in demo'):(statusLabels[status] || status)}</span>; }
function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const active = document.activeElement as HTMLElement; ref.current?.showModal(); return () => active?.focus(); }, []);
  return <dialog ref={ref} aria-label={title} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-btn" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}

const primaryNav = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Requests', icon: FileText },
  { name: 'Assistant', icon: MessageSquare },
  { name: 'Projects', icon: Layers3 },
] as const;

function App() {
  const [data, setData] = useState<Data | null>(null);
  const activeRole = useRef<Person['role'] | null>(null);
  const [route, setRoute] = useState(() => readRoute(window.location.pathname, window.location.search));
  const memberRouteDenied = data?.person.role === 'member' && !primaryNav.some(item => item.name === route.page);
  const { page, requestId: selected, projectId } = memberRouteDenied ? { page: 'Overview' as const } : route;
  const projectFilter = projectId ?? '';
  const [checkingSession, setCheckingSession] = useState(true);
  const [filter, setFilter] = useState('all'), [search, setSearch] = useState('');
  const [modal, setModal] = useState<'new' | 'identity' | 'help' | 'people' | 'projects' | 'tasks' | 'suppliers' | null>(null), [error, setError] = useState(''), [toast, setToast] = useState(''), [mobileNav, setMobileNav] = useState(false);
  const [busy, setBusy] = useState('');
  const [paymentStep, setPaymentStep] = useState<PaymentStep>();
  const [draft, setDraft] = useState<Draft | null>(null);
  async function load() {
    const role = activeRole.current;
    try {
      const next = await api<Data>('/bootstrap');
      if (role && role === activeRole.current && next.person.role === role) {
        setData(next);
        setError('');
      } else if (role === activeRole.current) {
        activeRole.current = null;
        setData(null);
      }
    } catch (e) {
      if (role !== activeRole.current) return;
      if ((e as Error).message.includes('Sign in to continue')) {
        activeRole.current = null;
        setData(null);
      } else setError((e as Error).message);
    }
  }
  async function enter(role: Person['role']) {
    const next = await api<Data>('/bootstrap');
    if (next.person.role !== role) throw new Error('That session belongs to a different role. Sign in with your private code.');
    activeRole.current = role;
    setData(next);
    setError('');
  }
  useEffect(() => {
    let active = true;
    void api<Data>('/bootstrap').then(next => {
      if (!active) return;
      activeRole.current = next.person.role;
      setData(next);
    }).catch(() => {
      // The role picker handles sign-in when there is no usable session.
    }).finally(() => { if (active) setCheckingSession(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!memberRouteDenied) return;
    window.history.replaceState(null, '', pagePath('Overview'));
    setRoute({ page: 'Overview' });
  }, [memberRouteDenied]);

  useEffect(() => {
    function restoreRoute() {
      setRoute(readRoute(window.location.pathname, window.location.search));
      setMobileNav(false);
      setSearch('');
      setFilter('all');
      setModal(null);
    }
    window.addEventListener('popstate', restoreRoute);
    return () => window.removeEventListener('popstate', restoreRoute);
  }, []);
  useEffect(() => { const timer = setInterval(() => { if (data) void load(); }, data?.requests.some(r => r.status === 'analyzing') ? 2000 : 15000); return () => clearInterval(timer); }, [!!data, data?.requests.some(r => r.status === 'analyzing')]);
  const pendingPayments = JSON.stringify(data?.requests.filter(r => r.paymentProgress?.canCheck).map(r => r.id) || []);
  useEffect(() => {
    const ids: string[] = JSON.parse(pendingPayments);
    if (!ids.length) return;
    let next = 0, active = true, checking = false;
    const check = async () => {
      if (checking || document.hidden) return;
      checking = true;
      try {
        const result = await api<{updated:boolean}>(`/requests/${encodeURIComponent(ids[next++ % ids.length])}/payment-status`, { method: 'POST' });
        if (active && result.updated) await load();
      } catch { /* A temporary outage will be checked again on the next pass. */ }
      finally { checking = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 15000);
    return () => { active = false; clearInterval(timer); };
  }, [pendingPayments]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); document.getElementById('global-search')?.focus(); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  async function run(label: string, action: () => Promise<unknown>, success?: string) { setBusy(label); setError(''); try { await action(); await load(); if (success) setToast(success); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } }
  const owner = data?.person.role === 'owner';
  const assistantLabel = owner ? 'Workspace Assistant' : 'Purchase Assistant';
  const setupAssistant = owner && route.setupAssistant;
  const assistantTitle = setupAssistant ? 'Workspace Setup Assistant' : assistantLabel;
  const workspaceNav = [
    { name: 'Team', icon: Users },
    { name: 'Spending policy', icon: SlidersHorizontal },
    { name: 'Activity', icon: Activity },
  ] as const;
  const connectionsNav = { name: 'Connections', icon: Settings } as const;
  const project = data?.projects.find(p => p.id === projectId);
  const request = data?.requests.find(r => r.id === selected && (!projectId || (project && r.projectId === projectId)));
  const reviewCount = data?.requests.filter(r => r.status === 'needs_review').length || 0;
  const paid = data?.requests.filter(r => r.status === 'paid') || [];
  const totalSpent = (data?.person.role==='owner' ? data?.projects.reduce((a, p) => a + p.committed, 0) : data?.requests.filter(r=>r.status==='paid'||r.status==='authorized').reduce((a,r)=>a+r.amount,0)) || 0;
  const totalBudget = data?.projects.reduce((a, p) => a + Math.min(p.budget, data.policy.projectLimit), 0) || 0;
  function go(path: string, replace = false) {
    if (window.location.pathname + window.location.search !== path) {
      if (replace) window.history.replaceState(null, '', path);
      else window.history.pushState(null, '', path);
      setRoute(readRoute(window.location.pathname, window.location.search));
    }
    setMobileNav(false);
  }
  function navigate(name: Page) {
    go(pagePath(name));
    setSearch('');
    setFilter('all');
  }
  function showProject(id: string) {
    setSearch('');
    setFilter('all');
    go(projectRequestsPath(id));
  }
  function showRequest(id: string, project?: string) {
    go(requestPath(id, project));
  }

  function askForSetup(prompt: string) {
    sessionStorage.setItem('assistant-prefill', prompt);
    go(pagePath('Assistant') + '?mode=setup');
  }
  function openSetup(action: SetupAction) {
    if (action === 'policy') navigate('Spending policy');
    else if (action === 'team') navigate('Team');
    else if (action === 'people' || action === 'projects' || action === 'tasks' || action === 'suppliers') setModal(action);
    else {
      setPaymentStep(action);
      navigate('Connections');
    }
  }

  if (checkingSession) return <main className="loading-page" role="status"><LoaderCircle size={22} className="spin" aria-hidden="true"/>Opening your workspace…</main>;

  if (!data) return <div className="welcome">
    <AuthBrandingPanel />
    <main className="welcome-form" id="main"><SignIn ready={enter}/></main>
  </div>;

  function renderNavItem({ name, icon: Icon }: typeof primaryNav[number] | typeof workspaceNav[number] | typeof connectionsNav) {
    return <button key={name} aria-current={page === name ? 'page' : undefined} className={page === name ? 'active' : ''} onClick={() => navigate(name)}>
      <Icon size={18} aria-hidden="true"/>
      <span>{name === 'Assistant' ? assistantLabel : name}</span>
      {name === 'Requests' && reviewCount > 0 && <span className="nav-count">{reviewCount}</span>}
    </button>;
  }

  return <><a className="skip-link" href="#main">Skip to main content</a><div className={`shell ${owner ? 'owner-dashboard' : 'member-dashboard'} ${request ? 'has-detail' : ''}`}>
    {mobileNav && <button type="button" className="workspace-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)}/>}
    <aside id="workspace-navigation" className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <div className="sidebar-brand-row">
        <Brand/>
        <button className="icon-btn mobile-menu" aria-label="Close navigation" onClick={() => { setMobileNav(false); document.getElementById('workspace-menu')?.focus(); }}><X size={20}/></button>
      </div>
      <div className="nav-label">Workspace</div>
      <nav aria-label={owner ? 'Main navigation' : 'Member navigation'}>
        {primaryNav.map(renderNavItem)}
        {owner && workspaceNav.map(renderNavItem)}
        {owner && renderNavItem(connectionsNav)}
      </nav>
      <div className="sidebar-bottom">
        {!owner && <div className="allowance-note">
          <span className="small-symbol"><ShieldCheck size={17}/></span>
          <strong>Clear rules. More freedom.</strong>
          <p>See what you can spend and follow each request to its receipt.</p>
        </div>}
        <button className="bottom-link" onClick={() => setModal('help')}><CircleHelp size={18}/>How it works</button>
        <button className="profile" onClick={() => setModal('identity')}>
          <Avatar person={data.person} small/>
          <span>{data.person.name}<small>{owner ? 'Business owner' : 'Team member'}</small></span>
          <ChevronDown size={14} aria-hidden="true"/>
        </button>
      </div>
    </aside>
    <div className="app-body"><header className="topbar">
      <div className="breadcrumbs">
        <button id="workspace-menu" className="icon-btn mobile-menu" aria-label="Toggle navigation" aria-expanded={mobileNav} aria-controls="workspace-navigation" onClick={() => setMobileNav(!mobileNav)}><Menu size={20}/></button>
        <span>Workspace</span><ChevronRight size={13} aria-hidden="true"/>
        <strong>{page === 'Assistant' ? assistantTitle : page}</strong>
      </div>
      <div className="top-actions">
        <div className="search-box" role="search">
          <Search size={15} aria-hidden="true"/>
          <input id="global-search" aria-label="Search requests" placeholder="Search requests…" value={search} onChange={e => { if (page !== 'Requests') navigate('Requests'); setSearch(e.target.value); }}/>
          <kbd>Ctrl K</kbd>
        </div>
        <span className="local-label"><CircleDot size={12} aria-hidden="true"/>Stellar Testnet</span>
      </div>
    </header>
    <div className="prototype-strip"><span><span className="live-dot"/>{data.integrations.sampleWorkspace ? 'Sample workspace' : 'Your workspace'}</span><p>{data.integrations.sampleWorkspace ? 'Sample records. Spending follows the workspace rules.' : 'Eligible purchases can proceed within the rules you set.'}</p>{owner && <button onClick={() => navigate('Connections')}>Connection status <ArrowUpRight size={12}/></button>}</div>
    {error && <div role="alert" className="error-banner floating-error"><CircleAlert size={18}/><span>{error}</span><button className="icon-btn" onClick={() => setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
    <div className="workspace-body"><main className="main-content" id="main">
      {page === 'Overview' && <>
        <div className="page-heading"><div>{!owner && <div className="greeting">Everything you need to move forward</div>}<h1>{owner ? 'Spending overview' : `Hello, ${data.person.name.split(' ')[0]}.`}</h1><p>{owner ? 'Track requests, project budgets and payments.' : 'Ask for a work resource. We’ll check the details and keep you posted.'}</p></div><button className="primary-btn" onClick={() => { setDraft(null); if(owner)navigate('Assistant');else setModal('new'); }}><Plus size={17}/>{owner ? 'Ask your assistant' : 'New request'}</button></div>
        {owner && <OwnerSetup data={data} open={openSetup} ask={askForSetup}/>}
        <div className="overview-band"><div className="spend-total"><span>{owner ? 'Allocated to purchases' : 'Your purchase commitments'}</span><strong>{amount(totalSpent)} <small>XLM</small></strong><p><span className="subtle-dot"/>Stellar Testnet workspace</p></div>{owner && <div className="budget-track"><div><span>{amount(Math.max(0,totalBudget - totalSpent))} XLM available</span><span>{amount(totalBudget)} XLM allocated</span></div><div className="progress"><span style={{ width: `${Math.min(100, totalSpent / Math.max(totalBudget, 1) * 100)}%` }}/></div><p>Your approved project allowances, together.</p></div>}</div>
        <SpendingMonitor data={data} openEscrow={() => openSetup('escrow')}/>
        <div className="stat-row"><div><span className="stat-icon"><Clock3 size={18}/></span><span><strong>{reviewCount}</strong><small>Awaiting review</small></span></div><div><span className="stat-icon"><CheckCircle2 size={18}/></span><span><strong>{paid.length}</strong><small>Completed requests</small></span></div><div><span className="stat-icon"><ShieldCheck size={18}/></span><span><strong>{data.policy.paused ? 'Paused' : 'Active'}</strong><small>Spending policy · v{data.policy.version}</small></span></div></div>
        <div className="section-head"><div><h2>{owner ? 'On your desk' : 'Your requests'}</h2><p>{owner ? 'A little context for every decision.' : 'Every update, from request to receipt.'}</p></div><button className="text-btn" onClick={() => navigate('Requests')}>All requests <ArrowRight size={15}/></button></div>
        <RequestTable data={data} requests={data.requests.slice(0, 5)} selected={selected} onSelect={id => showRequest(id)}/>
        <div className="section-head project-section"><div><h2>Projects</h2><p>Resources follow the work they support.</p></div><button className="text-btn" onClick={() => navigate('Projects')}>Projects <ArrowRight size={15}/></button></div><div className="project-grid">{data.projects.map((p, i) => <ProjectCard key={p.id} p={p} i={i} limit={data.policy.projectLimit} onClick={() => showProject(p.id)}/>)}</div>
        <div className="quiet-footer"><ShieldCheck size={14}/><span>Every purchase has a purpose, a policy, and a record.</span></div>
      </>}
      {page === 'Requests' && <>{projectId && !project ? <p role="status">Project unavailable.</p> : selected && !request ? <p role="status">Request unavailable.</p> : null}<div className="page-heading"><div><h1>{project ? project.name + ' requests' : 'Requests'}</h1><p>{owner ? 'Review team purchases and track payments.' : 'Track your requests from submission to payment.'}</p></div>{!owner && <button className="primary-btn" onClick={() => { setDraft(null); setModal('new'); }}><Plus size={17}/>New request</button>}</div><div className="filter-bar"><div className="tabs" role="group" aria-label="Request status">{[['all', 'All requests'], ['needs_review', 'Needs review'], ['paid', 'Completed'], ['blocked', 'Blocked']].map(([id, label]) => <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{label}{id === 'needs_review' && <span>{reviewCount}</span>}</button>)}</div><select aria-label="Filter by project" value={projectFilter} onChange={e => e.target.value ? showProject(e.target.value) : navigate('Requests')}><option value="">All projects</option>{data.projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></div><RequestTable data={data} requests={data.requests.filter(r => (filter === 'all' || r.status === filter) && (!projectFilter || r.projectId === projectFilter) && `${r.title} ${r.id} ${r.purpose}`.toLowerCase().includes(search.toLowerCase()))} selected={selected} onSelect={id => showRequest(id, project?.id)}/></>}
      {page === 'Assistant' && <AssistantPage data={data} title={assistantTitle} onDraft={d => { setDraft(d); setModal('new'); }} refresh={load} openSetup={openSetup} onHelp={() => setModal('help')} onRequest={id => { setSearch(''); setFilter('all'); showRequest(id); }}/> }
      {page === 'Projects' && <><div className="page-heading"><div><h1>Projects and allowances</h1><p>Keep resources connected to the work.</p></div>{owner && <button className="primary-btn" onClick={() => setModal('projects')}><Plus size={16}/>New project</button>}</div><div className="project-grid large">{data.projects.map((p, i) => <ProjectCard key={p.id} p={p} i={i} limit={data.policy.projectLimit} onClick={() => showProject(p.id)}/>)}</div><div className="section-head"><h2>Assigned work</h2>{owner && <button className="secondary-btn" onClick={() => setModal('tasks')}><Plus size={14}/>Assign task</button>}</div><div className="surface-list">{data.tasks.map(t => <div className="task-row" key={t.id}><span className="task-mark"><FolderOpen size={19}/></span><span><strong>{t.title}</strong><p>{t.description}</p><small>{data.projects.find(p => p.id === t.projectId)?.name}</small></span><Avatar person={data.people.find(p => p.id === t.assigneeId)}/></div>)}</div></>}
      {page === 'Team' && <TeamConsole data={data} refresh={load} add={()=>setModal('people')} ask={text=>{sessionStorage.setItem('assistant-prefill',text);navigate('Assistant');}}/>}
      {page === 'Spending policy' && <PolicyPage data={data} busy={busy} addSupplier={() => setModal('suppliers')} approveSupplier={id => run('supplier', () => api('/suppliers/' + encodeURIComponent(id) + '/approve', { method: 'POST' }), 'Supplier approved.')} saveQuoteHosts={(id,hosts)=>run('supplier',()=>api('/suppliers/'+encodeURIComponent(id)+'/quote-websites',{method:'PUT',body:JSON.stringify({hosts})}),'Quote websites saved.')} save={p => run('policy', () => api('/policy', { method: 'PUT', body: JSON.stringify(p) }), 'Spending policy saved. New decisions use these rules.')}/>}
      {page === 'Activity' && <><div className="page-heading"><div><h1>Activity</h1><p>Requests, decisions, and payments in one timeline.</p></div>{owner && <a className="secondary-btn" href="/api/export" download><ArrowDownToLine size={15}/>Export expenses</a>}</div><ActivityList data={data} onSelect={id => { setSearch(''); setFilter('all'); showRequest(id); }}/></>}
      {page === 'Connections' && <><Connections data={data} busy={busy} test={() => run('ai', () => api('/ai/test', { method: 'POST' }), 'Assistant connection verified.')} />{owner&&<TestnetPanel data={data} focus={paymentStep} addSupplier={() => setModal('suppliers')}/>}</>}
    </main>{request && ['Overview', 'Requests'].includes(page) && <RequestDetail data={data} request={request} busy={busy} close={() => go(project ? projectRequestsPath(project.id) : pagePath('Requests'), true)} action={(a, note) => run('decision', () => api(`/requests/${request.id}/${request.mode==='testnet'&&a==='approve'?'testnet':'decision'}`, { method: 'POST', body: JSON.stringify({ action: a, note }) }), a === 'approve' ? (request.mode==='testnet'?'Testnet operation updated. Check settlement status.':'Testnet payments use the authorized wallet.') : 'Request declined.')} retry={() => run('review', () => api(`/requests/${request.id}/review`, { method: 'POST' }))} cancel={() => run('cancel', () => api(`/requests/${request.id}/cancel`, { method: 'POST' }), 'Request cancelled.')}/>}</div></div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={18}/>{toast}<button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15}/></button></div>}
    {modal && ['people','projects','tasks','suppliers'].includes(modal) && <SetupRecord kind={modal} data={data} close={() => setModal(null)} saved={async () => { await load(); setModal(null); setToast('Workspace updated.'); }}/>}
    {modal === 'identity' && <Modal title="Your verified session" subtitle="Sign out here to switch accounts." onClose={()=>setModal(null)}><p>Signed in as <strong>{data.person.name}</strong> · {data.person.title}</p><p>Sign-in email: {data.person.email}</p><button className="secondary-btn" onClick={async()=>{await api('/session',{method:'DELETE'});activeRole.current=null;setData(null);setModal(null);go(pagePath('Overview'), true);}}>Sign out to use another account</button></Modal>}
    {modal === 'new' && <NewRequest data={data} initial={draft} close={() => { setDraft(null); setModal(null); }} created={async id => { setModal(null); setSearch(''); setFilter('all'); await load(); showRequest(id); setToast('Request saved. We’re checking the details.'); }}/ >}
    {modal === 'help' && <Modal title="How spending works" onClose={() => setModal(null)}><div className="help-steps">{[['The owner sets the rules', 'Assign work, approve suppliers, and decide the spending limits.'], ['A teammate asks for a resource', 'Include the task, supplier, amount, purpose, and a quote link.'], ['The assistant gathers context', 'The assistant checks the request against the task, supplier and policy.'], ['A clear decision follows', 'Eligible purchases can proceed automatically within the rules. Uncertain requests wait for the owner.'], ['Every outcome leaves a record', 'The expense, decision, and receipt stay linked to the work.']].map(([t, p], i) => <div key={t}><span>{i + 1}</span><section><h3>{t}</h3><p>{p}</p></section></div>)}</div><div className="notice"><CircleAlert size={18}/><p>Payments require the owner to complete Stellar Testnet wallet, escrow, and Velo Gas setup in Connections. Purchasing instructions are operational rules, not a reviewed legal agreement.</p></div></Modal>}
  </div></>;
}

function ErrorMessage({ message }: { message: string }) { const ref = useRef<HTMLDivElement>(null); useEffect(() => { if (message) ref.current?.focus(); }, [message]); return <div ref={ref} tabIndex={-1} role="alert" className="error-banner">{message}</div>; }

function SpendingMonitor({data,openEscrow}:{data:Data;openEscrow:()=>void}) {
  const owner=data.person.role==='owner';
  const [chain,setChain]=useState<TestnetStatus|null>(null);
  const [unavailable,setUnavailable]=useState(false);
  useEffect(()=>{
    if(!owner)return;
    let active=true;
    void getTestnetStatus().then(value=>{if(active)setChain(value);}).catch(()=>{if(active)setUnavailable(true);});
    return ()=>{active=false;};
  },[owner,data.requests]);
  const sum=(status:SpendRequest['status'],mode:SpendRequest['mode'])=>amount(data.requests.reduce((n,r)=>n+(r.status===status&&r.mode===mode?r.amount:0),0));
  const check=chain?.checks;
  const expiry=check?.policy?.expiresAt;
  const confirmed=check&&!check.error&&check.deviceOwner===chain?.owner;
  const weekly=data.person.weeklyBudget;
  return <section className="spending-monitor" aria-labelledby="spending-monitor-title">
    <div className="section-head"><div><h2 id="spending-monitor-title">{owner?'Spending and escrow':'Your spending limits'}</h2><p>{owner?'Track confirmed payments, pending requests, and the last checked escrow balance.':'Paid and pending purchases count toward your weekly cap.'}</p></div>{owner&&<button className="text-btn" onClick={openEscrow}>Manage escrow <ArrowRight size={15}/></button>}</div>
    <dl className="spending-monitor-grid">
      <div><dt>Paid on Testnet</dt><dd>{sum('paid','testnet')} XLM</dd><small>{sum('authorized','testnet')} XLM pending</small></div>
      {owner ? <>
        <div><dt>Noir escrow</dt><dd>{confirmed&&check.escrow!==undefined?amount(Number(check.escrow))+' XLM':unavailable?'Unavailable':chain?.owner?'Check on Testnet':chain?'No active wallet':'Loading'}</dd>{check?.checkedAt&&<small>Last checked {new Date(check.checkedAt).toLocaleString()}</small>}</div>
        <div><dt>Agent authorization</dt><dd>{confirmed&&check.policy?(expiry?Date.parse(expiry)<=Date.now()?'Expired':new Date(expiry).toLocaleDateString():'No expiry'):'Not verified'}</dd>{expiry&&<small>{new Date(expiry).toLocaleString()}</small>}</div>
      </> : <div><dt>Weekly allowance left</dt><dd>{weekly===undefined?'No weekly cap':amount(Math.max(0,weekly-data.person.weeklySpent))+' XLM'}</dd>{weekly!==undefined&&<small>Resets Monday at midnight, Manila time</small>}</div>}
    </dl>
  </section>;
}

function RequestTable({ data, requests, selected, onSelect }: { data: Data; requests: RequestItem[]; selected?: string; onSelect: (id: string) => void }) {
  return <div className="request-table"><div className="table-head"><span>Request / team member</span><span>Amount</span><span>Status</span><span/></div>{requests.length ? requests.map(r => <button key={r.id} className={`request-row ${selected === r.id ? 'selected' : ''}`} onClick={() => onSelect(r.id)}><span className="request-name"><span className={`request-icon ${r.category === 'Software' ? 'software' : ''}`}>{r.category === 'Software' ? <Command size={17}/> : r.category === 'Equipment' ? <CreditCard size={17}/> : <Layers3 size={17}/>}</span><span><strong>{r.title}</strong><small>{data.people.find(p => p.id === r.requesterId)?.name || 'Team member'}<span> / </span>{data.projects.find(p => p.id === r.projectId)?.name}</small></span></span><span className="table-amount">{amount(r.amount)}<small>XLM</small></span><Badge status={r.status} mode={r.mode}/><ChevronRight className="row-chevron" size={15}/></button>) : <div className="empty-state"><FileText size={30}/><h3>No matching requests</h3><p>Change the filters or submit a request from a team identity.</p></div>}</div>;
}
function ProjectCard({ p, i, limit, onClick }: { p: Project & { committed: number }; i: number; limit: number; onClick: () => void }) { const cap = Math.min(p.budget, limit); return <button className={`project-card project-${i}`} onClick={onClick}><div className="project-card-top"><span className="project-monogram">{i === 0 ? <Sparkles size={21}/> : <Layers3 size={21}/>}</span><ArrowUpRight size={17}/></div><h3>{p.name}</h3><p>{p.description}</p><div className="project-budget"><strong>{amount(Math.max(0, cap - p.committed))} <small>XLM left</small></strong><span>{amount(p.committed)} committed</span></div><div className="progress"><span style={{ width: `${Math.min(100, p.committed / Math.max(1, cap) * 100)}%` }}/></div></button>; }

function RequestDetail({ data, request: r, busy, close, action, retry, cancel }: { data: Data; request: RequestItem; busy: string; close: () => void; action: (a: string, note: string) => Promise<void>; retry: () => Promise<void>; cancel: () => Promise<void> }) {
  const [note, setNote] = useState(''); const [tab, setTab] = useState('Details');
  useEffect(() => { setNote(''); setTab('Details'); }, [r.id]);
  const requester = data.people.find(p => p.id === r.requesterId); const failed = r.checks.filter(c => !c.pass);
  return <aside className="detail-pane" aria-label={`Details for ${r.title}`}><div className="detail-header"><span>Request details</span><button className="icon-btn" onClick={close} aria-label="Close request details"><PanelRightClose size={19}/></button></div><div className="detail-scroll"><div className="detail-id">{r.id}<span>{relative(r.createdAt)}</span></div><h2>{r.title}</h2><Badge status={r.status} mode={r.mode}/><div className="detail-amount">{amount(r.amount)} <span>XLM</span><small>{r.mode==='testnet'?'Stellar Testnet purchase':'Simulated purchase amount'}</small></div><div className="requester-line"><Avatar person={requester} small/><span><strong>{requester?.name}</strong><small>{requester?.title}</small></span></div><div className="detail-tabs" role="group" aria-label="Request information">{['Details', 'Policy checks', 'Timeline'].map(t => <button className={tab === t ? 'active' : ''} key={t} onClick={() => setTab(t)}>{t}</button>)}</div>
    {tab === 'Details' && <><dl className="detail-facts"><div><dt>Project</dt><dd>{data.projects.find(p => p.id === r.projectId)?.name}</dd></div><div><dt>Task</dt><dd>{data.tasks.find(t => t.id === r.taskId)?.title}</dd></div><div><dt>Supplier</dt><dd>{data.suppliers.find(s => s.id === r.supplierId)?.name || r.supplierName || 'Not provided'}</dd></div><div><dt>Category</dt><dd>{r.category}</dd></div><div><dt>Policy</dt><dd>Version {r.policyVersion}</dd></div></dl><section className="detail-section"><h3>Why it’s needed</h3><p>{r.purpose}</p></section><section className="detail-section"><h3>Supporting reference</h3>{r.evidenceId && <a className="evidence-link" href={'/api/evidence/'+r.evidenceId} download><FileText size={15}/><span>Download attached evidence<small>Available for the owner to review.</small></span><ArrowDownToLine size={14}/></a>}{r.evidenceUrl ? <a className="evidence-link" href={r.evidenceUrl} target="_blank" rel="noreferrer"><Link size={15}/><span>{new URL(r.evidenceUrl).hostname}<small>Supplied link · not independently verified</small></span><ExternalLink size={13}/></a> : <p>No quote link supplied.</p>}</section><section className={`ai-note ${r.ai ? 'reviewed' : ''}`}><div><Sparkles size={17}/><strong>{r.status === 'analyzing' ? 'Looking into the details…' : r.ai ? 'Assistant’s assessment' : 'Ready for your judgment'}</strong></div><p>{r.ai?.summary || (r.status === 'analyzing' ? 'Checking the task, purchase purpose, and approved policy.' : 'Review the policy checks or ask the assistant for an assessment.')}</p>{r.ai?.reasoning?.length ? <ul>{r.ai.reasoning.map((s, i) => <li key={i}>{s}</li>)}</ul> : null}{r.ai?.model && <small>{r.ai.model} · {r.ai.provider}</small>}</section>{r.status==='needs_review' && r.reasons.length>0 && <section className="detail-section"><h3>Why review is needed</h3><ul>{r.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></section>}{r.ai?.missingInformation.length ? <section className="detail-section"><h3>Information needed</h3><ul>{r.ai.missingInformation.map(s => <li key={s}>{s}</li>)}</ul></section> : null}{r.comment && <section className="detail-section"><h3>Decision note</h3><p>{r.comment}</p></section>}{r.receipt && <div className="receipt"><ReceiptText size={20}/><div><strong>{r.receipt}</strong><small>{r.mode==='testnet'?'Confirmed Testnet merchant claim':'Local simulation receipt. Not a blockchain transaction.'}</small></div></div>}</>}
    {tab === 'Policy checks' && <div className="checks-list"><p className="muted">Current rules are checked again before every payment. Evidence presence does not prove authenticity.</p>{r.checks.map(c => <div key={c.label} className={c.pass ? 'check-pass' : 'check-fail'}>{c.pass ? <CheckCircle2 size={17}/> : <CircleAlert size={17}/>}<span><strong>{c.label}</strong><p>{c.detail}</p></span></div>)}</div>}
    {tab === 'Timeline' && <div className="mini-timeline">{data.events.filter(e => e.requestId === r.id).map(e => <div key={e.id}><span className="timeline-dot"/><strong>{e.title}</strong><p>{e.detail}</p><small>{e.actor} · {new Date(e.createdAt).toLocaleString()}</small></div>)}</div>}
    </div><div className="detail-actions">{r.paymentProgress && <p role="status"><strong>{r.paymentProgress.label}</strong><br/>{r.paymentProgress.detail}</p>}{['needs_review', 'blocked','authorized'].includes(r.status) && data.person.role === 'owner' ? <><label htmlFor="decision-note">Your decision note</label><textarea id="decision-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Explain the decision for the team…" maxLength={1500}/>{r.status!=='authorized' && failed.length > 0 && <p className="inline-warning"><LockKeyhole size={13}/>Resolve {failed.length} policy check{failed.length > 1 ? 's' : ''} before approving.</p>}<div className="decision-buttons"><button className="secondary-btn" disabled={r.status==='authorized' || !!busy || !note.trim()} onClick={() => void action('decline', note)}>Decline</button><button className="primary-btn" disabled={r.mode!=='testnet' || !!busy || (r.status!=='authorized' && (!note.trim() || failed.length > 0))} onClick={() => void action('approve', note)}>{busy === 'decision' ? <LoaderCircle size={15} className="spin"/> : <Check size={16}/>}{r.status==='authorized'?'Check payment status':'Authorize Testnet payment'}</button></div><button className="text-btn retry" disabled={!!busy} onClick={() => void retry()}><RefreshCw size={13}/>Request assessment</button></> : r.status === 'analyzing' ? <div className="analyzing-state"><LoaderCircle size={17} className="spin"/>Review in progress<button className="text-btn" disabled={!!busy} onClick={() => void cancel()}>Cancel</button></div> : r.status === 'paid' ? <p className="completed-note"><ShieldCheck size={17}/>Recorded in your local expense ledger.</p> : ['needs_review', 'blocked'].includes(r.status) ? <><button className="secondary-btn" disabled={!!busy} onClick={() => void retry()}><RefreshCw size={14}/>Retry assessment</button><button className="text-btn" disabled={!!busy} onClick={() => void cancel()}>Cancel request</button></> : r.paymentProgress ? null : <p className="muted">This request is closed.</p>}</div></aside>;
}

function NewRequest({ data, initial, close, created }: { data: Data; initial?: Draft | null; close: () => void; created: (id: string) => Promise<void> }) {
  const [form, setForm] = useState({ title: '', taskId: data.tasks.find(t => t.assigneeId === data.person.id && t.active)?.id || '', supplierId: '', supplierName: '', category: 'Creative assets', amount: '', purpose: '', evidenceUrl: '', mode:'testnet', ...initial });
  const [attachment, setAttachment] = useState<File | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false); const key = useRef(initial?.draftId || crypto.randomUUID());
  const field = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }));
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { let evidenceId: string | undefined; if (attachment) { const fileData = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(attachment); }); const evidence = await api('/evidence', { method: 'POST', body: JSON.stringify({ name: attachment.name, mime: attachment.type, data: fileData }) }); evidenceId = evidence.id; } const result = await api('/requests', { method: 'POST', body: JSON.stringify({ ...form, evidenceId, idempotencyKey: key.current }) }); await created(result.request.id); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Modal title={initial ? "Review purchase request" : "What do you need for the work?"} subtitle={initial ? "Check the details before you submit. You can edit any field." : "A little context helps the right purchase move forward."} onClose={close} wide><form onSubmit={submit} className="request-form"><label>Request title<input required minLength={5} maxLength={120} value={form.title} onChange={e => field('title', e.target.value)} placeholder="e.g. Commercial font license" autoFocus={window.matchMedia('(min-width:761px)').matches}/></label><label>Assigned task<select required value={form.taskId} onChange={e => field('taskId', e.target.value)}>{data.tasks.filter(t => t.assigneeId === data.person.id && t.active).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label><div className="form-pair"><label>Supplier<select value={form.supplierId} onChange={e => field('supplierId', e.target.value)}><option value="">Other or no supplier yet</option>{data.suppliers.map(s => <option value={s.id} key={s.id}>{s.name}{!s.approved ? ' (unverified)' : ''}</option>)}</select></label><label>Category<select value={form.category} onChange={e => field('category', e.target.value)}>{data.categories.map(c => <option key={c}>{c}</option>)}</select></label></div>{!form.supplierId && <label>Supplier name (optional)<input maxLength={120} value={form.supplierName} onChange={e => field('supplierName', e.target.value)} placeholder="e.g. Adobe Stock"/></label>}<label>Purchase amount<div className="input-unit"><input required inputMode="decimal" value={form.amount} onChange={e => field('amount', e.target.value)} placeholder="0.00"/><span>XLM</span></div><small>Automatic review limit: {amount(data.policy.autoLimit)} XLM. Per request: {amount(data.policy.perRequest)} XLM.</small></label><label>How does it support your task?<textarea required minLength={15} maxLength={3000} rows={3} value={form.purpose} onChange={e => field('purpose', e.target.value)} placeholder="Describe the resource, why you need it, and what it helps deliver."/></label><p><strong>Payment network</strong> · Stellar Testnet</p><label>Quote or purchase link (optional)<input type="url" value={form.evidenceUrl} onChange={e => field('evidenceUrl', e.target.value)} placeholder="https://supplier.example/quote"/><small>{data.policy.requireEvidence ? "You can submit without a link. Your workspace requires a link or attachment before payment." : "Add a link if you have one. Allowance does not inspect the linked page."}</small></label><label>Or attach a quote or screenshot<input type="file" accept="image/png,image/jpeg,application/pdf" onChange={e => { const file = e.target.files?.[0] || null; if (file && file.size > 1000000) { setError('Use a file under 1 MB.'); e.target.value = ''; setAttachment(null); } else { setAttachment(file); setError(''); } }}/><small>PNG, JPEG, or PDF under 1 MB. The owner can open the attachment when reviewing your request.</small></label><div className="notice compact"><ShieldCheck size={16}/><p>This request uses your verified member identity and assigned task. Payments use test XLM.</p></div>{error && <ErrorMessage message={error}/>}<div className="modal-footer"><button type="button" className="secondary-btn" onClick={close}>Cancel</button><button className="primary-btn" disabled={busy || !form.taskId}>{busy ? <LoaderCircle size={16} className="spin"/> : <Send size={16}/>}{busy ? "Submitting…" : "Submit request"}</button></div></form></Modal>;
}

function PolicyPage({ data, busy, save, addSupplier, approveSupplier, saveQuoteHosts }: { data: Data; busy: string; addSupplier: () => void; approveSupplier: (id: string) => Promise<void>; saveQuoteHosts:(id:string,hosts:string[])=>Promise<void>; save: (p: unknown) => Promise<void> }) {
  const p = data.policy; const [form, setForm] = useState({ ...p, perRequest: String(p.perRequest / 1e7), autoLimit: String(p.autoLimit / 1e7), projectLimit: String(p.projectLimit / 1e7) });
  const [quoteEdits,setQuoteEdits]=useState<Record<string,string>>({});
  const owner = data.person.role === 'owner'; useEffect(() => { setForm({ ...p, perRequest: String(p.perRequest / 1e7), autoLimit: String(p.autoLimit / 1e7), projectLimit: String(p.projectLimit / 1e7) }); }, [p.version]);
  return <><div className="page-heading"><div><h1>Spending policy</h1><p>{owner && p.version === 1 ? 'Review the suggested limits and team agreement. Keep them or make changes before saving.' : 'Set limits, review purchasing rules and approve suppliers.'}</p></div><span className="version-chip">Policy v{p.version}</span></div><form onSubmit={e => { e.preventDefault(); void save(form); }} className="policy-form"><section className="policy-section"><div><h2>Spending boundaries</h2><p>These limits apply to every purchase.</p></div><div className="policy-fields"><div className="form-three">{[['autoLimit', 'Automatic purchase limit'], ['perRequest', 'Maximum per request'], ['projectLimit', 'Maximum per project']].map(([key, label]) => <label key={key}>{label}<div className="input-unit"><input disabled={!owner} required inputMode="decimal" value={form[key as 'autoLimit']} onChange={e => setForm({ ...form, [key]: e.target.value })}/><span>XLM</span></div></label>)}</div><label className="switch-row"><span><strong>Allow automatic Testnet payments</strong><small>Eligible requests under the automatic limit can use the authorized Testnet agent. Complete wallet, escrow and Velo setup first.</small></span><input type="checkbox" disabled={!owner} checked={form.autoTestnet ?? false} onChange={e => setForm({ ...form, autoTestnet: e.target.checked })}/></label><label className="switch-row"><span><strong>Pause all new spending</strong><small>Existing records remain visible. New payments cannot proceed.</small></span><input type="checkbox" disabled={!owner} checked={form.paused} onChange={e => setForm({ ...form, paused: e.target.checked })}/></label></div></section><section className="policy-section"><div><h2>Permitted resources</h2><p>Choose what the team can request within assigned work.</p></div><div className="policy-fields"><div className="category-options">{data.categories.map(c => <label key={c}><input disabled={!owner} type="checkbox" checked={form.allowedCategories.includes(c)} onChange={e => setForm({ ...form, allowedCategories: e.target.checked ? [...form.allowedCategories, c] : form.allowedCategories.filter(v => v !== c) })}/>{c}</label>)}</div><label className="switch-row"><span><strong>Require a supporting reference</strong><small>Requests can be submitted without a reference. Payment requires a link or an attachment when this setting is on.</small></span><input disabled={!owner} type="checkbox" checked={form.requireEvidence} onChange={e => setForm({ ...form, requireEvidence: e.target.checked })}/></label></div></section><section className="policy-section"><div><h2>Your team’s agreement</h2><p>Operational instructions for the assistant. Review any legal agreement separately.</p></div><label className="policy-fields">Purchasing instructions<textarea disabled={!owner} rows={6} maxLength={4000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/><small>Instructions cannot grant permissions beyond the enforced limits above.</small></label></section><section className="policy-section">
    <div><h2>Supplier directory</h2><p>Optional during setup. Approve a supplier when you’re ready to use it for test purchases.</p></div>
    <div className="policy-fields">
      {data.suppliers.map(supplier => <div className="supplier-row" key={supplier.id}>
        <span><strong>{supplier.name}</strong><small>{supplier.domain}</small></span>
        <span className={'badge ' + (supplier.approved ? 'paid' : 'blocked')}>{supplier.approved ? 'Approved' : 'Awaiting approval'}</span>
        {owner && !supplier.approved && <button type="button" className="secondary-btn" disabled={!!busy} onClick={() => void approveSupplier(supplier.id)}>Approve for test purchases</button>}
      </div>)}
      {owner && data.suppliers.filter(s=>s.approved).map(supplier=><details key={supplier.id}>
        <summary>Quote websites for {supplier.name}</summary>
        <label>Additional approved websites<input maxLength={1270} value={quoteEdits[supplier.id] ?? (supplier.quoteHosts || []).join(', ')} onChange={e=>setQuoteEdits({...quoteEdits,[supplier.id]:e.target.value})} placeholder="checkout.example.com"/></label>
        <small>Separate up to five hostnames with commas. Add only websites you trust for this supplier’s quotes.</small>
        <button type="button" className="secondary-btn" disabled={!!busy} onClick={()=>void saveQuoteHosts(supplier.id,(quoteEdits[supplier.id] ?? (supplier.quoteHosts || []).join(',')).split(',').map(v=>v.trim()).filter(Boolean))}>Save quote websites</button>
      </details>)}
      {owner && <button type="button" className="secondary-btn" onClick={addSupplier}><Plus size={14}/>Add supplier</button>}
    </div>
  </section>
  {owner && <div className="policy-save"><span><LockKeyhole size={14}/>Only the owner can change this policy.</span><button disabled={!!busy} className="primary-btn">{busy === 'policy' && <LoaderCircle size={16} className="spin"/>}{p.version === 1 ? 'Save and confirm policy' : 'Save policy'}</button></div>}</form></>;
}

function ActivityList({ data, onSelect }: { data: Data; onSelect: (id: string) => void }) { return <div className="activity-list">{data.events.map(e => <div className="activity-row" key={e.id}><span className={`activity-symbol ${e.kind}`}>{e.kind === 'payment' ? <ReceiptText size={18}/> : e.kind === 'policy' ? <ShieldCheck size={18}/> : <Activity size={18}/>}</span><div><strong>{e.title}</strong><p>{e.detail}</p><small>{e.actor}{e.requestId && <> · <button className="inline-link" onClick={() => onSelect(e.requestId!)}>{e.requestId}</button></>}</small></div><time dateTime={e.createdAt}>{relative(e.createdAt)}</time></div>)}</div>; }
function Connections({ data, busy, test }: { data: Data; busy: string; test: () => Promise<void> }) { return <><div className="page-heading"><div><h1>Connections</h1><p>Check the assistant connection and set up Testnet payments.</p></div></div><div className="connection-hero"><ShieldCheck size={30}/><div><h2>Workspace services</h2><p>Connect an assistant provider for request reviews and conversations.</p></div></div><div className="connections-list"><section><span className="connection-icon"><Sparkles size={24}/></span><div className="grow"><h3>{data.ai.provider || 'Assistant provider'}</h3><p>Use your own Gemini API key or connect a Relmio-backed n8n workflow.</p><div className={`connection-status ${data.ai.connected ? 'connected' : ''}`}><span/>{data.ai.connected ? `Verified response${data.ai.model ? ' · ' + data.ai.model : ''}` : 'Not verified'}</div><small>{data.ai.message}</small>{data.ai.lastChecked && <small>Last checked: {new Date(data.ai.lastChecked).toLocaleString()}</small>}</div><button className="secondary-btn" disabled={!!busy} onClick={() => void test()}>{busy === 'ai' ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>}Test connection</button></section><section><span className="connection-icon"><Wallet size={24}/></span><div className="grow"><h3>Stellar wallet</h3><p>Owner wallet setup is available below.</p><small>Choose a Stellar Testnet wallet below. Your wallet handles every owner signature.</small></div><span className="badge neutral">Testnet setup</span></section><section><span className="connection-icon"><Command size={24}/></span><div className="grow"><h3>Velo + Noir</h3><p>Testnet requests use a separate authorization and merchant-claim flow.</p><small>The organizer-provided contracts are present on Testnet. Owner registration, agent permission, escrow funding and Velo Gas readiness are required before a payment can complete.</small></div><a href="https://www.velo-build.dev" target="_blank" rel="noreferrer" className="secondary-btn">Open Velo <ExternalLink size={14}/></a></section></div><div className="notice"><LockKeyhole size={18}/><p>The server verifies sign-in codes. Keep codes and wallet recovery phrases private.</p></div></>; }

function AssistantPage({ data, title, onDraft, refresh, openSetup, onHelp, onRequest }: { data: Data; title: string; onDraft: (draft: Draft | null) => void; refresh: () => Promise<void>; openSetup: (action: SetupAction) => void; onHelp: () => void; onRequest:(id:string)=>void }) {
  const [message, setMessage] = useState(()=>sessionStorage.getItem('assistant-prefill')||''), [waiting, setWaiting] = useState(false), [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const names = Object.fromEntries([...data.people, ...data.projects].map(record => [record.id, record.name]));
  useEffect(()=>{sessionStorage.removeItem('assistant-prefill');},[]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' }); }, [data.messages.length, waiting]);
  async function send(e: React.FormEvent) { e.preventDefault(); if (!message.trim()) return; const text = message; setMessage(''); setWaiting(true); setError(''); try { await api('/assistant', { method: 'POST', body: JSON.stringify({ message: text }) }); } catch (e) { setError((e as Error).message); } finally { await refresh(); setWaiting(false); } }
  return <><div className="page-heading"><div><h1>{title}</h1><p>{data.person.role==='owner'?'Build profiles, shape spending rules and ask for an update.':'Get help preparing a request for your assigned work.'}</p></div></div><div className="assistant-workspace">{data.person.role==='owner' && <div className="assistant-setup-links"><button className="text-btn" onClick={() => openSetup('wallet')}>Connect wallet</button><button className="text-btn" onClick={() => openSetup('escrow')}>Fund escrow</button><button className="text-btn" onClick={() => openSetup('velo')}>Link Velo</button></div>}<div className="chat-messages">{!data.messages.length && <div className="chat-intro"><span><Sparkles size={30}/></span><h2>{data.person.role==='owner'?'Set up your workspace':'Tell us what you need'}</h2><p>{data.person.role==='owner'?'I can help draft team profiles and spending rules, explain requests, and prepare an update. You review changes before they apply.':'Tell me what you’re working on and the resource you need. I can help prepare a purchase request for you to review.'}</p><div className="prompt-options">{(data.person.role==='owner'?['Give me an update on pending requests and remaining budgets.','Help me define responsibilities and purchasing guidance for my team.','Help me improve our purchasing rules.','Set a 500 XLM weekly cap for a team member.']:['What can I purchase for my current task?', 'I need a commercial font license for 25 XLM from Type Foundry for my brand work.', 'What happens if a purchase is over my allowance?']).map(p => <button key={p} onClick={() => setMessage(p)}>{p}<ArrowUpRight size={14}/></button>)}</div></div>}{data.messages.map(m => <div key={m.id} className={`chat-message ${m.role}`}><span className="chat-avatar">{m.role === 'assistant' ? <Sparkles size={17}/> : data.person.initials}</span><div><strong>{m.role === 'assistant' ? 'Allowance' : data.person.name}</strong><p>{m.text}</p>{m.showHelp && <button type="button" className="text-btn" onClick={onHelp}>How it works <ArrowRight size={14}/></button>}{!!m.sources?.length && <details className="chat-sources"><summary>Requests checked</summary><ul>{m.sources.map(s=><li key={s.id}><button className="text-btn" onClick={()=>onRequest(s.id)}>{s.title}</button></li>)}</ul></details>}{m.proposals?.map(p=><ProposalCard key={p.id} proposal={p} refresh={refresh} names={names} openAgent={() => openSetup('agent')}/>)}{m.draftUnavailable && <button className="secondary-btn" onClick={() => onDraft(null)}>Open request form <ArrowRight size={14}/></button>}{m.draft && <div className="draft-card"><span><FileText size={17}/>Purchase request draft</span><h3>{m.draft.title}</h3><p>{m.draft.amount} XLM · {data.suppliers.find(s => s.id === m.draft!.supplierId)?.name || m.draft.supplierName || 'Supplier not provided'}</p><p>{data.tasks.find(t => t.id === m.draft!.taskId)?.title}</p><button className="primary-btn" onClick={() => onDraft({...m.draft!, draftId: m.id})}>Preview request <ArrowRight size={14}/></button><small>Nothing is approved or paid until you submit and the checks pass.</small></div>}</div></div>)}{waiting && <div className="chat-message assistant"><span className="chat-avatar"><LoaderCircle size={17} className="spin"/></span><p>Gathering the context…</p></div>}<div ref={end}/></div><form className="chat-composer" onSubmit={send}><label className="sr-only" htmlFor="assistant-message">Message the spending assistant</label><textarea id="assistant-message" rows={2} maxLength={3000} value={message} onChange={e => setMessage(e.target.value)} placeholder="I’m working on… and I need…" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!waiting) void send(e); } }}/><button className="primary-btn" disabled={waiting || message.trim().length < 3} aria-label="Send message">{waiting ? <LoaderCircle size={17} className="spin"/> : <ArrowRight size={18}/>}</button></form><div className="chat-disclosure"><ShieldCheck size={12}/>The assistant knows your verified role. Reviewed rules and backend checks control spending.</div></div>{error && <ErrorMessage message={error}/>}</>;
}

function SetupRecord({ kind, data, close, saved }: { kind: string; data: Data; close: () => void; saved: () => Promise<void> }) {
  const [form, setForm] = useState<Record<string, string | boolean>>({ name: '', title: '', email: '', description: '', goal: '', spendingGuidance: '', budget: '', weeklyBudget:'', domain: '', category: 'Services', approved: false, projectId: data.projects[0]?.id || '', assigneeId: data.people.find(p => p.role === 'member' && p.active)?.id || '' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const set = (key: string, value: string | boolean) => setForm(f => ({ ...f, [key]: value }));
  const [allowedCategories, setAllowedCategories] = useState<string[]>([]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { name, title, email, description, goal, spendingGuidance, budget, weeklyBudget, projectId, assigneeId, domain, category, approved } = form;
    const payloads = {
      people: { name, title, email, description, goal, spendingGuidance, budget: budget || null, weeklyBudget: weeklyBudget || null, allowedCategories: allowedCategories.length ? allowedCategories : undefined },
      projects: { name, description, budget },
      tasks: { title, description, projectId, assigneeId },
      suppliers: { name, domain, category, approved },
    };
    try { await api(`/setup/${kind}`, { method: 'POST', body: JSON.stringify(payloads[kind as keyof typeof payloads]) }); await saved(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const titles: Record<string,string> = { people: 'Add a team member', projects: 'Give the work an allowance', tasks: 'Assign a piece of work', suppliers: 'Add a supplier record' };
  return <Modal title={titles[kind]} subtitle={kind === 'people' ? 'Issue a private code from Team when you’re ready.' : undefined} onClose={close}><form onSubmit={submit} className="request-form">{kind !== 'tasks' && <label>{kind === 'people' ? 'Full name' : 'Name'}<input required minLength={2} maxLength={100} value={String(form.name)} onChange={e => set('name', e.target.value)}/></label>}{kind === 'people' && <><label>Sign-in email<input type="email" required maxLength={254} value={String(form.email || '')} onChange={e => set('email', e.target.value)}/><small>Use the email this person gave you.</small></label><label>Role or specialty<input required minLength={2} maxLength={100} value={String(form.title)} onChange={e => set('title', e.target.value)} placeholder="e.g. Researcher, editor, event coordinator"/></label>
    <label>Responsibilities<textarea rows={3} maxLength={3000} value={String(form.description)} onChange={e => set('description', e.target.value)} placeholder="What should they do?"/></label>
    <label>Goal<textarea rows={2} maxLength={1000} value={String(form.goal)} onChange={e => set('goal', e.target.value)} placeholder="What outcome should they deliver?"/></label>
    <label>Spending guidance<textarea rows={2} maxLength={1000} value={String(form.spendingGuidance)} onChange={e => set('spendingGuidance', e.target.value)} placeholder="What expenses are relevant to the work?"/></label>
    <label>Member allowance (XLM)<input inputMode="decimal" value={String(form.budget)} onChange={e => set('budget', e.target.value)}/><small>All-time limit across projects. Leave blank to use other limits.</small></label>
    <label>Weekly cap (XLM)<input inputMode="decimal" value={String(form.weeklyBudget)} onChange={e => set('weeklyBudget',e.target.value)}/><small>Optional. Resets Mondays in Manila.</small></label>
    <fieldset><legend>Allowed expense categories</legend><div className="category-options">{data.categories.map(category => <label key={category}><input type="checkbox" checked={allowedCategories.includes(category)} onChange={e => setAllowedCategories(e.target.checked ? [...allowedCategories, category] : allowedCategories.filter(value => value !== category))}/>{category}</label>)}</div><small>Leave all unchecked to use the workspace categories.</small></fieldset></>}{kind === 'tasks' && <><label>Task title<input required minLength={3} maxLength={120} value={String(form.title)} onChange={e => set('title', e.target.value)}/></label><label>Project<select value={String(form.projectId)} onChange={e => set('projectId', e.target.value)}>{data.projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>Assigned team member<select value={String(form.assigneeId)} onChange={e => set('assigneeId', e.target.value)}>{data.people.filter(p => p.role === 'member' && p.active).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label></>}{['projects','tasks'].includes(kind) && <label>Work description<textarea required minLength={kind === 'tasks' ? 10 : 5} maxLength={600} rows={3} value={String(form.description)} onChange={e => set('description', e.target.value)}/></label>}{kind === 'projects' && <label>Project allowance<div className="input-unit"><input required inputMode="decimal" value={String(form.budget)} onChange={e => set('budget', e.target.value)}/><span>XLM</span></div><small>The spending policy’s project ceiling also applies.</small></label>}{kind === 'suppliers' && <><label>Website domain<input required value={String(form.domain)} onChange={e => set('domain', e.target.value)} placeholder="supplier.example"/><small>Domain only. No URL is fetched and no wallet is connected.</small></label><label>Category<select value={String(form.category)} onChange={e => set('category', e.target.value)}>{data.categories.map(c => <option key={c}>{c}</option>)}</select></label><label className="switch-row"><span><strong>Approve this demo supplier</strong><small>In a real system, verify the business and payment destination before approval.</small></span><input type="checkbox" checked={!!form.approved} onChange={e => set('approved', e.target.checked)}/></label></>}{error && <ErrorMessage message={error}/>}<div className="modal-footer"><button type="button" className="secondary-btn" onClick={close}>Cancel</button><button className="primary-btn" disabled={busy}>{busy && <LoaderCircle className="spin" size={15}/>}Save record</button></div></form></Modal>;
}

export default App;
