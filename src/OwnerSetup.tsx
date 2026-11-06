import { useEffect, useState } from 'react';
import { ArrowRight, Check, Circle, Sparkles } from 'lucide-react';
import type { Person, Policy, Project, Supplier, Task } from '../server/domain';
import { getTestnetStatus, type TestnetStatus } from './Testnet';

type SetupData = {
  people: (Person & { codeSet?: boolean })[];
  policy: Policy;
  projects: Project[];
  tasks: Task[];
  suppliers: Supplier[];
  ai: { provider: string | null };
};
export type SetupAction = 'policy' | 'people' | 'team' | 'projects' | 'tasks' | 'suppliers' | 'wallet' | 'agent' | 'escrow' | 'velo';

export function OwnerSetup({ data, open, ask }: { data: SetupData; open: (action: SetupAction) => void; ask: (prompt: string) => void }) {
  const [chain, setChain] = useState<TestnetStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  useEffect(() => {
    let active = true;
    void getTestnetStatus().then(status => { if (active) setChain(status); }).catch(() => { if (active) setStatusError(true); });
    return () => { active = false; };
  }, []);

  const members = data.people.filter(person => person.role === 'member' && person.active);
  const teamReady = members.some(person => person.email && person.codeSet && person.description?.trim());
  const projects = data.projects.filter(project => project.active && project.budget > 0);
  const assigned = data.tasks.some(task => task.active && members.some(member => member.id === task.assigneeId) && projects.some(project => project.id === task.projectId));
  const policy = chain?.checks?.policy;
  const settings = chain?.agentSettings;
  const expiryMatches = !settings || (settings.expiresAt === null
    ? policy?.expiresAt === null
    : !!policy?.expiresAt && Math.abs(Date.parse(settings.expiresAt) - Date.parse(policy.expiresAt)) < 1000);
  const agentReady = !!chain?.agent && chain.checks?.deviceOwner === chain.owner && policy?.agent === chain.agent && policy.asset === chain.asset
    && (!policy.expiresAt || Date.parse(policy.expiresAt) > Date.now())
    && (!settings || (settings.maxAmount === null ? 0 : Math.round(Number(settings.maxAmount) * 1e7)) === Number(policy.maxAmount))
    && expiryMatches;
  const contractsPresent = chain?.checks?.contracts.length === 3 && chain.checks.contracts.every(contract => contract.exists);
  const workspace = [
    { title: 'Spending rules', detail: 'Keep or edit the suggested limits, purchase categories, and team agreement, then save them.', done: data.policy.version > 1 && !data.policy.paused, action: 'policy', button: 'Review rules', prompt: 'Help me set up the spending rules. Ask about purchase categories, request and project limits, quote requirements, and exceptions, then draft a policy proposal.' },
    { title: 'Team and access', detail: 'Add a member, describe their work, and issue their access code.', done: teamReady, action: members.length ? 'team' : 'people', button: members.length ? 'Review team' : 'Add a member', prompt: 'Help me set up my team. Ask for the name, position, responsibilities, goal, allowed expenses and budget for a member. Draft a member proposal or update an existing profile. I will enter their email when I review it.' },
    { title: 'Projects and assignments', detail: 'Create a project budget and assign work to a team member.', done: assigned, action: !projects.length ? 'projects' : members.length ? 'tasks' : 'people', button: !projects.length ? 'Add a project' : members.length ? 'Assign a task' : 'Add a member first', prompt: 'Help me set up a project and its assigned work. Ask what outcome I want and what I can spend, then draft the next record that is missing.' },
    { title: 'Approved suppliers', detail: 'Approve a supplier for the kinds of expenses you allow.', done: data.suppliers.some(s => s.approved && data.policy.allowedCategories.includes(s.category)), action: 'suppliers', button: 'Add a supplier', prompt: 'Help me add an approved supplier. Ask for its name, website domain, expense category and whether I approve it, then draft the supplier record.' },
  ] satisfies Step[];
  const testnet = [
    { title: 'Owner wallet', detail: 'Choose and connect the Stellar Testnet account you control.', done: !!chain?.owner, action: 'wallet', button: 'Open wallet setup', prompt: 'Guide me through connecting my Stellar Testnet owner wallet. Explain what I need to do in Connections.' },
    { title: 'Noir agent authorization', detail: 'Verify the contracts, register your agent, and sign its cap and expiry.', done: !!contractsPresent && agentReady, action: 'agent', button: 'Set agent terms', prompt: 'Help me set up the Noir agent. Ask what to call the managed agent, what per-transaction cap to use, and whether the authorization should expire. Draft the settings once I choose.' },
    { title: 'Escrow funding', detail: 'Choose a deposit and confirm that test XLM reached escrow.', done: chain?.checks?.deviceOwner === chain?.owner && Number(chain?.checks?.escrow || 0) > 0, action: 'escrow', button: 'Open escrow', prompt: 'Walk me through funding the Noir escrow for my first test purchase. Use my current setup to explain the next step.' },
    { title: 'Velo Gas and demo merchant', detail: 'Link the project, save a scoped Gas key, and link an approved supplier.', done: !!chain?.projectId && chain.gasKeyStored && chain.boundSuppliers.length > 0, action: 'velo', button: 'Open Velo setup', prompt: 'Guide me through linking my Velo project, configuring Gas Station, and linking the demo merchant. Tell me where to enter the Gas key privately.' },
  ] satisfies Step[];
  const done = workspace.filter(step => step.done).length;
  const testnetDone = testnet.filter(step => step.done).length;
  const nextStep = [...workspace, ...testnet].find(step => !step.done);

  return <section className="owner-setup" aria-labelledby="owner-setup-title">
    <div className="owner-setup-heading">
      <div><h2 id="owner-setup-title">Set up your workspace</h2><p>Complete the workspace steps before inviting your team to spend. Set up Testnet separately when you want to send test payments.</p></div>
      <div className="setup-step-actions">
      {nextStep && <button className="primary-btn" onClick={() => open(nextStep.action)}>Continue setup manually</button>}
      <button className="secondary-btn" disabled={!data.ai.provider} onClick={() => ask('Walk me through owner setup. Review my workspace and Testnet progress, then guide me through the first missing step.')}><Sparkles size={16} aria-hidden="true"/>Set up with Assistant</button>
      </div>
    </div>
    {!data.ai.provider && <p className="owner-setup-note">Connect an assistant provider in Connections to use guided setup.</p>}
    <Checklist title="Workspace" steps={workspace} count={done} open={open} ask={data.ai.provider ? ask : undefined}/>
    <Checklist title="Testnet payments" steps={testnet} count={testnetDone} open={open} ask={data.ai.provider ? ask : undefined}/>
    {statusError && <p className="owner-setup-note" role="status">Testnet progress couldn’t load. Open Connections to check again.</p>}
    {testnetDone === testnet.length && <p className="owner-setup-note">Setup is recorded. Confirm sponsorship in Velo Gas Station and run a test payment to verify settlement.</p>}
  </section>;
}

type Step = { title: string; detail: string; done: boolean; action: SetupAction; button: string; prompt: string };

function Checklist({ title, steps, count, open, ask }: { title: string; steps: Step[]; count: number; open: (action: SetupAction) => void; ask?: (prompt: string) => void }) {
  const next = steps.findIndex(step => !step.done);
  return <div className="setup-group">
    <div className="setup-group-heading"><h3>{title}</h3><span>{count} of {steps.length} complete</span></div>
    <progress aria-label={title + ' setup progress'} max={steps.length} value={count}/>
    <ol>{steps.map((step, index) => <li key={step.title} aria-current={index === next ? 'step' : undefined}>
      <span className={'setup-step-icon' + (step.done ? ' complete' : '')}>{step.done ? <Check size={16} aria-hidden="true"/> : <Circle size={14} aria-hidden="true"/>}</span>
      <div><h4>{step.title} <small>{step.done ? 'Complete' : index === next ? 'Next' : 'To do'}</small></h4><p>{step.detail}</p></div>
      <div className="setup-step-actions">
        <button className="text-btn" onClick={() => open(step.action)}>{step.button}<ArrowRight size={14} aria-hidden="true"/></button>
        {ask && !step.done && <button className="text-btn" aria-label={'Ask for help with ' + step.title} onClick={() => ask(step.prompt)}>Ask for help</button>}
      </div>
    </li>)}</ol>
  </div>;
}
