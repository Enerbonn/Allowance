import React, { useEffect, useState } from 'react';
import { Wallet, RefreshCw, ShieldCheck, ExternalLink, LoaderCircle } from 'lucide-react';
import { getNetworkDetails } from '@stellar/freighter-api';
import { restoreWalletSession, TESTNET } from './wallet-session';

let walletKit: Promise<typeof import('@creit.tech/stellar-wallets-kit/sdk').StellarWalletsKit> | undefined;
function getWalletKit() {
  walletKit ??= Promise.all([
    import('@creit.tech/stellar-wallets-kit/sdk'),
    import('@creit.tech/stellar-wallets-kit/modules/utils'),
    import('@stellar/stellar-sdk'),
  ]).then(([{ StellarWalletsKit }, { defaultModules }, { Networks }]) => {
    StellarWalletsKit.init({ modules: defaultModules(), network: Networks.TESTNET });
    return StellarWalletsKit;
  });
  return walletKit;
}

function restoreSavedWallet(owner: string) {
  return restoreWalletSession(owner, async () => (await getWalletKit()).selectedModule);
}

export type TestnetStatus = {
  owner: string;
  wallets: {owner: string; projectId: string}[];
  projectId: string;
  asset: string;
  agentSettings: { label: string; maxAmount: string | null; expiresAt: string | null } | null;
  boundSuppliers: string[];
  gasStationUrl: string;
  initialized: boolean;
  gasKeyStored: boolean;
  agent?: string;
  merchant?: string;
  checks: { checkedAt?: string; contracts: {name: string; exists: boolean}[]; error?: string; deviceOwner?: string; escrow?: string; policy?: {agent: string; asset: string; maxAmount: string; expiresAt: string | null} } | null;
  operations: { id: string; state: string; error?: string; transactionHash?: string; claimHash?: string }[];
};
type Supplier = { id: string; name: string; approved: boolean };

async function api(path: string, body?: unknown) {
  const response = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-allowance-client': 'local-prototype' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Testnet operation failed.');
  return value;
}

export async function getTestnetStatus(): Promise<TestnetStatus> {
  return api('/testnet');
}
export type PaymentStep = 'wallet' | 'agent' | 'escrow' | 'velo';

function toLocalInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function projectIdFrom(input: string) {
  const value = input.trim();
  if (!value.includes('/')) return value;
  const url = new URL(value);
  const id = url.pathname.match(/^\/projects\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1];
  if (url.protocol !== 'https:' || !['www.velo-build.dev', 'velo-build.dev'].includes(url.hostname) || !id) {
    throw new Error('Paste a Velo project page URL or project ID.');
  }
  return id;
}

export function TestnetPanel({ data, focus, addSupplier }: { data: { suppliers: Supplier[]; policy: { perRequest: number } }; focus?: PaymentStep; addSupplier: () => void }) {
  const [state, setState] = useState<TestnetStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [wallet, setWallet] = useState('');
  const [deposit, setDeposit] = useState('');
  const [withdrawal, setWithdrawal] = useState('');
  const [supplier, setSupplier] = useState('');
  const [message, setMessage] = useState('');
  const [actionStep, setActionStep] = useState<PaymentStep>('wallet');
  const [projectInput, setProjectInput] = useState('');
  const [gasKey, setGasKey] = useState('');
  const [agentLabel, setAgentLabel] = useState('Allowance purchasing agent');
  const [cap, setCap] = useState(String(data.policy.perRequest / 1e7));
  const [capEnabled, setCapEnabled] = useState(true);
  const [expiry, setExpiry] = useState(() => toLocalInput(new Date(Date.now() + 48 * 3600_000)));
  const [expiryEnabled, setExpiryEnabled] = useState(true);
  function loadAgentTerms(value: TestnetStatus) {
    const saved = value.agentSettings;
    const verified = value.checks?.policy;
    setAgentLabel(saved?.label || 'Allowance purchasing agent');
    setCapEnabled(saved ? saved.maxAmount !== null : !verified || Number(verified.maxAmount) > 0);
    setCap(saved?.maxAmount ?? (verified && Number(verified.maxAmount) > 0 ? String(Number(verified.maxAmount) / 1e7) : String(data.policy.perRequest / 1e7)));
    setExpiryEnabled(saved ? saved.expiresAt !== null : !verified || verified.expiresAt !== null);
    const date = saved?.expiresAt ?? verified?.expiresAt;
    setExpiry(toLocalInput(date ? new Date(date) : new Date(Date.now() + 48 * 3600_000)));
  }
  const approved = data.suppliers.filter(s => s.approved);
  const supplierId = approved.some(s => s.id === supplier) ? supplier : approved[0]?.id || '';

  useEffect(() => {
    let active = true;
    void getTestnetStatus().then(async value => {
      if (!active) return;
      const restored = await restoreSavedWallet(value.owner);
      if (!active) return;
      setWallet(restored);
      setState(value);
      setProjectInput(value.projectId);
      loadAgentTerms(value);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (focus && state) document.getElementById('testnet-step-' + focus)?.scrollIntoView({block:'start'});
  }, [focus, Boolean(state)]);

  async function run(label: string, operation: () => Promise<{hash?: string} | void>, step: PaymentStep = 'wallet', success = 'Done.') {
    setActionStep(step);
    setBusy(label);
    setError('');
    setMessage('');
    try {
      const result = await operation();
      setState(await getTestnetStatus());
      if (result?.hash) setMessage(success + ' Testnet transaction: ' + result.hash);
      else if (step !== 'wallet') setMessage(success);
    } catch (e) {
      setError(e && typeof e === 'object' && 'message' in e ? String(e.message) : 'The wallet operation did not complete.');
    } finally {
      setBusy('');
    }
  }

  async function checkTestnet(provider: string) {
    if (provider !== 'varial') return;
    const network = await getNetworkDetails();
    if (network.networkPassphrase !== TESTNET) throw new Error('Switch your wallet to Stellar Testnet.');
  }

  async function connect() {
    const kit = await getWalletKit();
    const { address } = await kit.authModal();
    await checkTestnet(kit.selectedModule.productId);
    const selected: TestnetStatus = await api('/testnet/wallet', { address });
    setWallet(address);
    setProjectInput(selected.projectId);
    loadAgentTerms(selected);
    setGasKey('');
    setDeposit('');setWithdrawal('');
    setMessage('Testnet wallet connected. You can switch accounts from your wallet extension.');
  }

  async function sign(kind: string) {
    if (!state || wallet !== state.owner) throw new Error('Connect the active owner wallet first.');
    const kit = await getWalletKit();
    const current = await kit.fetchAddress();
    if (current.address !== wallet) throw new Error('Your wallet account changed. Click Connect owner wallet to use it.');
    await checkTestnet(kit.selectedModule.productId);
    if (kind === 'registerAgent') {
      await api('/testnet/agent-settings', { address: wallet, settings: {
        label: agentLabel,
        maxAmount: capEnabled ? cap : null,
        expiresAt: expiryEnabled ? new Date(expiry).toISOString() : null,
      }});
    }
    const pending = await api('/testnet/prepare', { kind, amount: kind === 'defundEscrow' ? withdrawal : deposit });
    setBusy('waiting for your approval in the wallet extension');
    const signed = await kit.signTransaction(pending.unsignedXdr, { networkPassphrase: pending.networkPassphrase, address: pending.owner });
    if (!signed.signedTxXdr) throw new Error('The wallet did not sign.');
    setBusy('confirming your update on Stellar Testnet');
    return api('/testnet/submit-setup', { id: pending.id, signedXdr: signed.signedTxXdr });
  }

  if (!state) return error ? <p role="alert" className="form-error">{error}</p> : <p role="status">Loading Testnet setup…</p>;
  const connected = !!wallet && wallet === state.owner;
  const checks = state.checks;
  const deviceRegistered = !!state.owner && checks?.deviceOwner === state.owner;
  const spendingPermission = checks?.policy;
  const permissionExpired = !!spendingPermission?.expiresAt && Date.parse(spendingPermission.expiresAt) <= Date.now();
  const canApproveSpending = !busy && connected && state.initialized && deviceRegistered && !spendingPermission;
  const balance = checks?.escrow === undefined || checks.error ? null : Number(checks.escrow) / 1e7;
  const supplierLinked = state.boundSuppliers.includes(supplierId);
  const walletHint = state.owner ? 'Reconnect the saved wallet in step 1 to make changes.' : 'Connect your owner wallet in step 1 to get started.';
  function feedback(step: PaymentStep) {
    if (actionStep !== step) return null;
    return <div className="payment-feedback">
      <div role="status">{!busy && message && <p className="notice">{message}</p>}</div>
      {error && <p role="alert" className="form-error">{error}</p>}
    </div>;
  }
  return <section className="testnet-panel">
    <div className="section-head">
      <div><h2>Set up test payments</h2><p>Use Stellar Testnet to try team spending with test XLM.</p></div>
      <span className="badge neutral">Testnet</span>
    </div>
    <div className="notice"><ShieldCheck size={18}/><p>Start with your wallet, then set spending limits, add test funds, and set up payment fees. Approve changes in your wallet when prompted.</p></div>
    <ol className="testnet-steps">
      <li id="testnet-step-wallet">
        <h3>Choose your owner wallet</h3>
        <p>Add a supported Stellar Testnet account or select a saved wallet to manage.</p>
        <button className="secondary-btn" disabled={!!busy} onClick={() => void run('wallet connection', connect)}><Wallet size={15}/>{state.owner ? 'Connect or add wallet' : 'Connect owner wallet'}</button>
        {state.wallets.length > 0 && <label>Saved wallet<select value={state.owner} disabled={!!busy} onChange={e => {const address=e.target.value;if(!address)return;void run('wallet switch',async()=>{
          const next:TestnetStatus=await api('/testnet/wallet',{address});setWallet('');setProjectInput(next.projectId);setGasKey('');setDeposit('');setWithdrawal('');loadAgentTerms(next);
          setWallet(await restoreSavedWallet(next.owner));
        });}}><option value="" disabled>Choose a saved wallet</option>{state.wallets.map(w => <option key={w.owner} value={w.owner}>{w.owner.slice(0,8)}…{w.owner.slice(-6)}{w.projectId ? ' · Velo linked' : ''}</option>)}</select></label>}
        {state.owner && <button className="text-btn" disabled={!!busy} onClick={() => void run('wallet disconnect',async()=>{
          await api('/testnet/disconnect',{});setWallet('');setProjectInput('');setGasKey('');setDeposit('');setWithdrawal('');if(walletKit)await walletKit.then(kit=>kit.disconnect()).catch(()=>{});
          setMessage('Wallet disconnected. Saved settings and past payments are still available.');
        })}>Disconnect active wallet</button>}
        {state.owner && <small>{connected ? 'Connected' : 'Saved wallet'} · {state.owner}</small>}
        {state.owner && !connected && <p>To enable wallet actions, unlock the saved account on Stellar Testnet, then choose <strong>Connect or add wallet</strong>. Your saved setup is still here.</p>}
        {connected && <a className="text-btn" href={'https://friendbot.stellar.org/?addr=' + encodeURIComponent(wallet)} target="_blank" rel="noreferrer">Fund a new wallet with Friendbot <ExternalLink size={14}/></a>}
        {feedback('wallet')}
      </li>
      <li id="testnet-step-agent">
        <h3>Set spending permission</h3>
        <p>Noir records on Stellar what Allowance can spend on your behalf. You decide the maximum per payment and when that permission ends.</p>
        <p className="payment-step-status"><strong>{checks?.error ? 'Status unavailable' : permissionExpired ? 'Permission expired' : spendingPermission ? 'Permission recorded' : deviceRegistered ? 'Ready to authorize' : state.initialized ? 'Test accounts created' : 'Setup needed'}</strong>
          {' · '}{checks?.error ? 'Refresh the payment setup to try again.' : spendingPermission ? `${spendingPermission.maxAmount === '0' ? 'No separate limit per payment' : `${Number(spendingPermission.maxAmount) / 1e7} XLM per payment`} · ${spendingPermission.expiresAt ? `${permissionExpired ? 'Expired' : 'Ends'} ${new Date(spendingPermission.expiresAt).toLocaleString()}` : 'No end date'}` : deviceRegistered ? 'Set a limit and approve it in your wallet.' : state.initialized ? 'Register your wallet and check its status.' : 'Create the accounts used to send and receive test payments.'}
        </p>
        {!connected && <p>{walletHint}</p>}
        <div className="testnet-actions">
          <button className="secondary-btn" disabled={!!busy || !connected} onClick={() => void run('preparing test payment accounts', () => api('/testnet/initialize', {}), 'agent', 'Test payment accounts are ready.')}>{state.initialized ? 'Check and fund test accounts' : 'Create test payment accounts'}</button>
          <button className="secondary-btn" disabled={!!busy} onClick={() => void run('checking Noir on Stellar Testnet', () => api('/testnet/inspect', {}), 'agent', 'Setup status refreshed.') }><RefreshCw size={15}/>Refresh setup status</button>
        </div>
        {(state.agent || checks) && <details className="payment-details">
          <summary>Technical details</summary>
          {state.agent && <small>Agent: {state.agent}<br/>Test payment recipient: {state.merchant}</small>}
          {checks && <><ul>{checks.contracts.map(c => <li key={c.name}>{c.name}: {c.exists ? 'Present on Testnet' : 'Unverified'}</li>)}</ul>
          <small>{checks.error || `Registered wallet: ${checks.deviceOwner || 'Pending registration'}`}</small></>}
        </details>}
        <div className="testnet-actions">
          <button className="secondary-btn" disabled={!!busy || !connected || !state.initialized || deviceRegistered} onClick={() => void run('preparing wallet registration', () => sign('registerDevice'), 'agent', 'Wallet registration confirmed.')}>{deviceRegistered ? 'Wallet registered with Noir' : 'Register wallet with Noir'}</button>
        </div>
        <form className="agent-terms" onSubmit={e => { e.preventDefault(); if (canApproveSpending) void run('preparing spending permission', () => sign('registerAgent'), 'agent', 'Spending permission confirmed.'); }}>
          <label>Payment agent name<input required minLength={2} maxLength={80} value={agentLabel} onChange={e => setAgentLabel(e.target.value)}/></label>
          <label className="agent-option"><input type="checkbox" checked={capEnabled} onChange={e => setCapEnabled(e.target.checked)}/>Limit each payment</label>
          {capEnabled && <label>Maximum per payment (test XLM)<input required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,7})?" value={cap} onChange={e => setCap(e.target.value)}/></label>}
          <p>Team and project spending limits also apply.</p>
          <label className="agent-option"><input type="checkbox" checked={expiryEnabled} onChange={e => setExpiryEnabled(e.target.checked)}/>Set an end date for spending permission</label>
          {expiryEnabled && <label>Permission ends (your local time)<input type="datetime-local" required value={expiry} onChange={e => setExpiry(e.target.value)}/></label>}
          {spendingPermission ? <>
            <p>To update the limit or end date, first remove the current permission, then approve the new settings. Spending pauses between those two approvals.</p>
            <button type="button" className="secondary-btn" disabled={!!busy || !connected} onClick={() => void run('preparing to remove spending permission', () => sign('revokeAgent'), 'agent', 'Previous permission removed. Review and approve the new settings when ready.')}>Remove current permission</button>
          </> : <button className="secondary-btn" disabled={!canApproveSpending}>Review and approve spending</button>}
        </form>
        {feedback('agent')}
      </li>
      <li id="testnet-step-escrow">
        <h3>Manage funds for team purchases</h3>
        <p>Noir escrow is where you set aside test XLM for eligible purchases. Add funds from your owner wallet or return unused funds to it. Approve each transfer in your wallet.</p>
        <p className="payment-step-status"><strong>{balance === null ? 'Balance unavailable' : balance > 0 ? 'Test funds available' : 'No test funds added'}</strong>
          {' · '}{balance === null ? (deviceRegistered ? 'Refresh the balance to check your funds.' : 'Complete wallet registration in step 2.') : `Last checked balance: ${balance} test XLM`}
        </p>
        {!connected && <p>{walletHint}</p>}
        <button className="text-btn" disabled={!!busy || !state.owner} onClick={() => void run('checking funds on Stellar Testnet', () => api('/testnet/inspect', {}), 'escrow', 'Balance check finished.') }><RefreshCw size={14}/>Refresh balance</button>
        <div className="testnet-actions">
          <label>Amount to add (test XLM)<input inputMode="decimal" value={deposit} onChange={e => setDeposit(e.target.value)}/></label>
          <button className="secondary-btn" disabled={!!busy || !connected || !deposit.trim() || !deviceRegistered} onClick={() => void run('preparing your deposit', async () => {const result=await sign('fundEscrow');setDeposit('');return result;}, 'escrow', 'Funds added.')}>Review and add funds</button>
        </div><div className="testnet-actions">
          <label>Amount to return (test XLM)<input inputMode="decimal" value={withdrawal} onChange={e => setWithdrawal(e.target.value)}/></label>
          <button className="secondary-btn" disabled={!!busy || !connected || !withdrawal.trim() || !deviceRegistered} onClick={() => void run('preparing your withdrawal', async () => {const result=await sign('defundEscrow');setWithdrawal('');return result;}, 'escrow', 'Funds returned to your wallet.')}>Review and return funds</button>
        </div>
        {feedback('escrow')}
      </li>
      <li id="testnet-step-velo">
        <h3>Set up payment fees with Velo</h3>
        <p>Velo Gas Station covers the Stellar network fees for eligible test payments. Link your Velo Testnet project and save its Gas Station key.</p>
        <p className="payment-step-status"><strong>{state.gasKeyStored ? 'Velo settings saved' : state.projectId ? 'Project saved' : 'Project needed'}</strong>
          {' · '}{state.gasKeyStored ? 'Velo checks the fee setup when a payment is sent.' : state.projectId ? 'Add the Gas Station key from your Velo project.' : 'Open Velo and paste the URL of your registered Testnet project.'}
        </p>
        {!connected && <p>{walletHint}</p>}
        <details className="payment-details"><summary>Gas Station requirements</summary><p>In Velo, fund your Testnet relayer, enable fee sponsorship, and allow the Noir contracts.</p></details>
        <form className="testnet-actions" onSubmit={e => {
          e.preventDefault();
          void run('Velo project link', async () => {
            const projectId = projectIdFrom(projectInput);
            const selected: TestnetStatus = await api('/testnet/wallet', { address: wallet, projectId });
            setProjectInput(selected.projectId);
            setGasKey('');
          }, 'velo', 'Velo project saved for this wallet.');
        }}>
          <label>Velo project URL or ID<input value={projectInput} onChange={e => setProjectInput(e.target.value)} required maxLength={400} placeholder="Paste the Velo project page URL"/></label>
          <button className="secondary-btn" disabled={!!busy || !connected || !projectInput.trim()}>Save project</button>
          <a className="secondary-btn" href={state.gasStationUrl || 'https://www.velo-build.dev/'} target="_blank" rel="noreferrer">Open Velo <ExternalLink size={14}/></a>
        </form>
        {state.projectId && <form className="testnet-actions" onSubmit={e => {
          e.preventDefault();
          void run('Gas key setup', async () => {
            await api('/testnet/gas-key', { address: wallet, projectId: state.projectId, key: gasKey });
            setGasKey('');
          }, 'velo', 'Gas Station key saved for this project.');
        }}>
          <label>Testnet Gas Station key<input type="password" autoComplete="off" value={gasKey} onChange={e => setGasKey(e.target.value)} maxLength={80} required placeholder={state.gasKeyStored ? 'Protected key saved' : 'Paste the key from Velo'}/></label>
          <button className="secondary-btn" disabled={!!busy || !connected || !gasKey.trim()}>Save key</button>
        </form>}
        <h4 className="payment-subheading">Optional setup for a test purchase</h4>
        <p>A supplier is a shop or service your team can request to buy from, such as a print shop or a design tool. Allowance sends test funds to a demo account when you link a supplier here. The actual business receives no payment.</p>
        <p className="payment-step-status"><strong>{supplierLinked ? 'Demo recipient linked' : 'Demo recipient for purchase testing'}</strong>
          {' · '}{supplierLinked ? 'Test payments for this supplier go to the demo account.' : !approved.length ? 'Add and approve a supplier first.' : !state.initialized ? 'Create test payment accounts in step 2 first.' : 'Choose a supplier and link the demo recipient.'}
        </p>
        <div className="testnet-actions">
          {approved.length > 0 && <label>Approved shop or service<select value={supplierId} disabled={!!busy} onChange={e => setSupplier(e.target.value)}>
            {approved.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>}
          {approved.length ? <button className="secondary-btn" disabled={!!busy || !state.initialized || !supplierId || supplierLinked} onClick={() => void run('linking the demo recipient', () => api('/testnet/bind-supplier', { supplierId }), 'velo', 'Demo recipient linked.')}>{supplierLinked ? 'Demo recipient linked' : 'Link demo recipient'}</button>
            : <button className="secondary-btn" disabled={!!busy} onClick={addSupplier}>Add a supplier</button>}
        </div>
        {feedback('velo')}
      </li>
    </ol>
    <div role="status">{busy && <div className="toast"><LoaderCircle size={16} className="spin" aria-hidden="true"/><span>In progress: {busy}…</span></div>}</div>
    {state.operations.length > 0 && <div className="surface-list">{state.operations.map(op => <div className="memory-note" key={op.id}><div><strong>{op.id}: {op.state}</strong><p>{op.error}</p><small>Authorization: {op.transactionHash || 'not submitted'}<br/>Merchant claim: {op.claimHash || 'not confirmed'}</small></div></div>)}</div>}
  </section>;
}
