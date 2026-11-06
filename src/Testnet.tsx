import React, { useEffect, useState } from 'react';
import { Wallet, RefreshCw, ShieldCheck, ExternalLink } from 'lucide-react';
import { getNetworkDetails } from '@stellar/freighter-api';

const TESTNET = 'Test SDF Network ; September 2015';

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

export function TestnetPanel({ data, focus }: { data: { suppliers: Supplier[]; policy: { perRequest: number } }; focus?: PaymentStep }) {
  const [state, setState] = useState<TestnetStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [wallet, setWallet] = useState('');
  const [deposit, setDeposit] = useState('');
  const [withdrawal, setWithdrawal] = useState('');
  const [supplier, setSupplier] = useState('');
  const [message, setMessage] = useState('');
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
    void getTestnetStatus().then((value) => {
      setState(value);
      setProjectInput(value.projectId);
      loadAgentTerms(value);
    }).catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (focus && state) document.getElementById('testnet-step-' + focus)?.scrollIntoView({block:'start'});
  }, [focus, Boolean(state)]);

  async function run(label: string, operation: () => Promise<{hash?: string} | void>) {
    setBusy(label);
    setError('');
    setMessage('');
    try {
      const result = await operation();
      setState(await getTestnetStatus());
      if (result?.hash) setMessage('Confirmed Testnet transaction: ' + result.hash);
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
    const signed = await kit.signTransaction(pending.unsignedXdr, { networkPassphrase: pending.networkPassphrase, address: pending.owner });
    if (!signed.signedTxXdr) throw new Error('The wallet did not sign.');
    return api('/testnet/submit-setup', { id: pending.id, signedXdr: signed.signedTxXdr });
  }

  if (!state) return error ? <p role="alert" className="form-error">{error}</p> : <p role="status">Loading Testnet setup…</p>;
  const connected = !!wallet && wallet === state.owner;
  return <section className="testnet-panel">
    <div className="section-head">
      <div><h2>Connect the payment path</h2><p>Stellar Testnet only. Owner signatures stay in your wallet.</p></div>
      <span className="badge neutral">Testnet</span>
    </div>
    <div className="notice"><ShieldCheck size={18}/><p>Connect a wallet to get started. Registration and escrow deposits each ask for a signature. The demo merchant receives test XLM.</p></div>
    <ol className="testnet-steps">
      <li id="testnet-step-wallet">
        <h3>Choose your owner wallet</h3>
        <p>Add any supported Stellar Testnet account. Select one saved wallet to manage at a time. Reconnect it to sign.</p>
        <button className="secondary-btn" disabled={!!busy} onClick={() => void run('wallet connection', connect)}><Wallet size={15}/>{state.owner ? 'Connect or add wallet' : 'Connect owner wallet'}</button>
        {state.wallets.length > 0 && <label>Saved wallet<select value={state.owner} disabled={!!busy} onChange={e => {const address=e.target.value;if(!address)return;void run('wallet switch',async()=>{
          const next:TestnetStatus=await api('/testnet/wallet',{address});setWallet('');setProjectInput(next.projectId);setGasKey('');setDeposit('');setWithdrawal('');loadAgentTerms(next);
        });}}><option value="" disabled>Choose a saved wallet</option>{state.wallets.map(w => <option key={w.owner} value={w.owner}>{w.owner.slice(0,8)}…{w.owner.slice(-6)}{w.projectId ? ' · Velo linked' : ''}</option>)}</select></label>}
        {state.owner && <button className="text-btn" disabled={!!busy} onClick={() => void run('wallet disconnect',async()=>{
          await api('/testnet/disconnect',{});setWallet('');setProjectInput('');setGasKey('');setDeposit('');setWithdrawal('');if(walletKit)await (await walletKit).disconnect().catch(()=>{});
          setMessage('Wallet disconnected. Saved settings and past payments are still available.');
        })}>Disconnect active wallet</button>}
        {state.owner && <small>{connected ? 'Connected' : 'Saved wallet'} · {state.owner}</small>}
        {connected && <a className="text-btn" href={'https://friendbot.stellar.org/?addr=' + encodeURIComponent(wallet)} target="_blank" rel="noreferrer">Fund a new wallet with Friendbot <ExternalLink size={14}/></a>}
      </li>
      <li id="testnet-step-agent">
        <h3>Set up the Noir agent</h3>
        <p>Allowance creates a dedicated agent and demo merchant for your wallet. Authorize the agent and deposit test XLM into its escrow.</p>
        <div className="testnet-actions">
          <button className="secondary-btn" disabled={!!busy || !connected} onClick={() => void run('demo accounts', () => api('/testnet/initialize', {}))}>{state.initialized ? 'Check / fund demo accounts' : 'Initialize demo accounts'}</button>
          <button className="secondary-btn" disabled={!!busy} onClick={() => void run('contract inspection', () => api('/testnet/inspect', {}))}><RefreshCw size={15}/>Inspect contracts</button>
        </div>
        {state.agent && <small>Agent: {state.agent}<br/>Demo merchant: {state.merchant}</small>}
        {state.checks && <>
          <ul>{state.checks.contracts.map(c => <li key={c.name}>{c.name}: {c.exists ? 'Present on Testnet' : 'Not verified / unavailable'}</li>)}</ul>
          <p>{state.checks.error || `Device owner: ${state.checks.deviceOwner || 'not registered'} · Escrow: ${Number(state.checks.escrow || 0) / 1e7} XLM`}</p>
          {state.checks.policy && <p>Confirmed terms · {state.checks.policy.maxAmount === '0' ? 'No contract cap' : `${Number(state.checks.policy.maxAmount) / 1e7} XLM per transaction`} · {state.checks.policy.expiresAt ? `Expires ${new Date(state.checks.policy.expiresAt).toLocaleString()}` : 'No expiry'}</p>}
        </>}
        <div className="testnet-actions">
          <button className="secondary-btn" disabled={!!busy || !connected || !state.initialized} onClick={() => void run('device registration', () => sign('registerDevice'))}>Register device</button>
        </div>
        <form className="agent-terms" onSubmit={e => { e.preventDefault(); void run('agent authorization', () => sign('registerAgent')); }}>
          <label>Agent name<input required minLength={2} maxLength={80} value={agentLabel} onChange={e => setAgentLabel(e.target.value)}/></label>
          <p>The authorization applies to the Allowance-managed agent shown above.</p>
          <label className="agent-option"><input type="checkbox" checked={capEnabled} onChange={e => setCapEnabled(e.target.checked)}/>Set a cap per transaction</label>
          {capEnabled && <label>Contract cap per transaction (XLM)<input required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,7})?" value={cap} onChange={e => setCap(e.target.value)}/></label>}
          {!capEnabled && <p>Workspace spending limits still apply.</p>}
          <label className="agent-option"><input type="checkbox" checked={expiryEnabled} onChange={e => setExpiryEnabled(e.target.checked)}/>Set an expiry</label>
          {expiryEnabled && <label>Authorization expiry (local time)<input type="datetime-local" required value={expiry} onChange={e => setExpiry(e.target.value)}/></label>}
          {!expiryEnabled && <p>The authorization will have no expiry date.</p>}
          {state.checks?.policy ? <>
            <p>Changing these terms takes two signatures. Revoke the current authorization, then sign the replacement. Agent spending pauses between signatures.</p>
            <button type="button" className="secondary-btn" disabled={!!busy || !connected} onClick={() => void run('agent revocation', () => sign('revokeAgent'))}>Review and sign revocation</button>
          </> : <button className="secondary-btn" disabled={!!busy || !connected || !state.initialized || state.checks?.deviceOwner !== state.owner}>Review and sign authorization</button>}
        </form>
      </li>
      <li id="testnet-step-escrow">
        <h3>Manage Noir escrow</h3>
        <p>Deposit test XLM or withdraw it back to the registered owner wallet. Each action requires your signature.</p>
        <div className="testnet-actions"><span>{state.checks?.escrow!==undefined&&!state.checks.error?`Last checked balance: ${Number(state.checks.escrow)/1e7} XLM`:'Check the current escrow balance on Testnet.'}</span><button className="text-btn" disabled={!!busy||!state.owner} onClick={() => void run('escrow balance', () => api('/testnet/inspect', {}))}><RefreshCw size={14}/>Refresh balance</button></div>
        <div className="testnet-actions">
          <label>Escrow deposit (XLM)<input inputMode="decimal" value={deposit} onChange={e => setDeposit(e.target.value)}/></label>
          <button className="secondary-btn" disabled={!!busy || !connected || !deposit.trim() || state.checks?.deviceOwner !== state.owner} onClick={() => void run('escrow deposit', async () => {const result=await sign('fundEscrow');setDeposit('');return result;})}>Review and sign deposit</button>
        </div><div className="testnet-actions">
          <label>Escrow withdrawal (XLM)<input inputMode="decimal" value={withdrawal} onChange={e => setWithdrawal(e.target.value)}/></label>
          <button className="secondary-btn" disabled={!!busy || !connected || !withdrawal.trim() || state.checks?.deviceOwner !== state.owner} onClick={() => void run('escrow withdrawal', async () => {const result=await sign('defundEscrow');setWithdrawal('');return result;})}>Review and sign withdrawal</button>
        </div>
      </li>
      <li id="testnet-step-velo">
        <h3>Link Velo Gas for sponsored payments</h3>
        <p>Use a registered Velo project for the selected wallet. Its Gas Station needs a funded Testnet relayer, enabled sponsorship and permissions for the Noir contracts.</p>
        <form className="testnet-actions" onSubmit={e => {
          e.preventDefault();
          void run('Velo project link', async () => {
            const projectId = projectIdFrom(projectInput);
            const selected: TestnetStatus = await api('/testnet/wallet', { address: wallet, projectId });
            setProjectInput(selected.projectId);
            setGasKey('');
            setMessage('Velo project saved for this wallet.');
          });
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
            setMessage('Testnet Gas key saved for this wallet and project.');
          });
        }}>
          <label>Scoped Testnet Gas key<input type="password" autoComplete="off" value={gasKey} onChange={e => setGasKey(e.target.value)} maxLength={80} required placeholder={state.gasKeyStored ? 'Protected key saved' : 'Paste the Testnet Gas key'}/></label>
          <button className="secondary-btn" disabled={!!busy || !connected || !gasKey.trim()}>Save Gas key</button>
        </form>}
        {state.gasKeyStored && <p>An encrypted Gas key is saved for this project.</p>}
        <div className="testnet-actions">
          <label>Approved demo supplier<select value={supplierId} onChange={e => setSupplier(e.target.value)}>
            {!approved.length && <option value="">Add an approved supplier first</option>}
            {approved.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
          <button className="secondary-btn" disabled={!!busy || !state.initialized || !supplierId} onClick={() => void run('merchant link', () => api('/testnet/bind-supplier', { supplierId }))}>Use dedicated demo merchant</button>
        </div>
      </li>
    </ol>
    {busy && <p role="status">Working on {busy}…</p>}
    {message && <p role="status" className="notice">{message}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {state.operations.length > 0 && <div className="surface-list">{state.operations.map(op => <div className="memory-note" key={op.id}><div><strong>{op.id}: {op.state}</strong><p>{op.error}</p><small>Authorization: {op.transactionHash || 'not submitted'}<br/>Merchant claim: {op.claimHash || 'not confirmed'}</small></div></div>)}</div>}
  </section>;
}
