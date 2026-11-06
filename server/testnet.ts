import type {Express,RequestHandler} from 'express';
import {NoirAgentClient,TESTNET,type NoirOperation} from '@noirx402/agent-sdk';
import {Keypair,Networks,Asset,TransactionBuilder,xdr,StrKey,scValToNative} from '@stellar/stellar-sdk';
import {Velo,VeloError,type GasExecutionIdentity,type GasSubmitResult} from '@carts1024/velo-sdk';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Store} from './store.ts';
import {dataDirectory, protect, protectedStorageReady, unprotect, workspaceStorage} from './protected-storage.ts';
import { z } from 'zod';
import {money,units,type SpendRequest,type Supplier} from './domain.ts';

export const EVENT_CONTRACTS={deviceRegistry:'CB4DPMGOA374JIB2ZVD4AHW5GJKQUYNOFGRYNOJ75EFH2KCJSMHOWIRA',agentRegistry:'CBTDMJVCFQDIVWZBKAKZ2FQ3UEJNAAUFYCTJ3E4ON2MYXPLPSIXQ25JZ',paymentEscrow:'CA5S4S7QGHJHJWVJBYL3CXZXZTNGKXMNZVDAEQNN7NUXFP4D7BYK7HIX'};
const network={...TESTNET,contracts:EVENT_CONTRACTS};
const asset=Asset.native().contractId(Networks.TESTNET);
export function matchesMerchantClaim(events: xdr.ContractEvent[], merchant: string, amount: number) {
 return events.some(event => {
  const contract=event.contractId();
  if(!contract||!Buffer.isBuffer(contract)||StrKey.encodeContract(contract)!==EVENT_CONTRACTS.paymentEscrow) return false;
  const body=event.body().v0(), [kind, recipient]=body.topics();
  return !!kind && !!recipient && scValToNative(kind)==='claim' &&
    scValToNative(recipient)===merchant && scValToNative(body.data())===BigInt(amount);
 });
}
function settled(op: {state:string;result?:{status:string}}) {
 return op.state==='authorization_failed'||(op.state==='claimed'&&op.result?.status!=='claimed');
}
function sponsorshipFailure(error: unknown) {
 if(!(error instanceof VeloError))return 'Check the Noir setup and Velo Gas Station settings.';
 switch(error.code){
  case 'contract_not_whitelisted':return 'Allow the Noir payment escrow contract in Velo’s Gas Station policy.';
  case 'daily_cap_exceeded':return 'Velo’s Gas Station reached its daily fee cap.';
  case 'wallet_rate_limited':return 'The payment wallet reached its Velo sponsorship limit.';
  case 'policy_disabled':return 'Enable fee sponsorship in Velo’s Gas Station and save the policy.';
 }
 if(error.status===401)return 'Save a valid Testnet Gas Station key for this Velo project.';
 return 'Check that the Velo Gas Station relayer is funded and sponsorship is enabled for the Noir payment escrow.';
}
function localProject(): { owner: string; projectId: string } {
 const projectFile=resolve(dataDirectory(),'testnet-project.json');
 if(!existsSync(projectFile))return {owner:'',projectId:''};
 const value=JSON.parse(readFileSync(projectFile,'utf8'));
 if(typeof value.owner!=='string'||typeof value.projectId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value.projectId))throw new Error('Set a valid owner public address and Velo project ID in the local Testnet configuration.');
 Keypair.fromPublicKey(value.owner);
 return {owner:value.owner,projectId:value.projectId};
}
function getKey(name:string){const path=resolve(dataDirectory(),name+'.dpapi');if(!existsSync(path))throw new Error('Initialize the Testnet demo accounts first.');return Keypair.fromSecret(unprotect(path));}
export function validateOwnerSetupSignature(signed:string,expectedHash:string,owner:string){
 if(signed.length>60000)throw new Error('Invalid signed transaction.');const tx=TransactionBuilder.fromXDR(signed,Networks.TESTNET);
 if(!('source' in tx)||tx.source!==owner||tx.hash().toString('hex')!==expectedHash||!tx.signatures.some(s=>Keypair.fromPublicKey(owner).verify(tx.hash(),s.signature())))throw new Error('The signed transaction does not match the prepared owner operation.');
 return tx;
}

export const agentSettingsSchema = z.object({
  label: z.string().trim().min(2).max(80),
  maxAmount: z.string().nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export function parseAgentSettings(input: unknown, now = Date.now()) {
  const settings = agentSettingsSchema.parse(input);
  if (settings.expiresAt && Date.parse(settings.expiresAt) <= now) throw new Error('Choose a future authorization expiry.');
  return { ...settings, maxAmount: settings.maxAmount === null ? null : money(units(settings.maxAmount)) };
}

type PaymentRecovery = {
 getGasStatus?: (identity:GasExecutionIdentity)=>Promise<GasSubmitResult>;
 getTransaction?: NoirAgentClient['server']['getTransaction'];
};
export function installTestnet(app:Express,store:Store,auth:RequestHandler,owner:RequestHandler,checkpoint?: () => Promise<void>, recovery:PaymentRecovery={}){
 const noir=new NoirAgentClient({network});let busy=false;
 type Project = { owner: string; projectId: string };
 type WalletConfig = { owner: string; deviceHash: string; asset: string; contracts: typeof EVENT_CONTRACTS; agent?: string; merchant?: string };
 const legacy = () => store.get<WalletConfig>('testnet','config');
 function project(): Project {
  const selected = store.get<Project>('testnet','selection');
  if (selected) return selected;
  const previous = localProject();
  const ownerAddress = legacy()?.owner || previous.owner;
  return {owner:ownerAddress,projectId:ownerAddress===previous.owner?previous.projectId:''};
 }
 function config(): WalletConfig {
  const {owner:address} = project();
  const saved = store.get<WalletConfig>('testnet-wallet',address);
  const previous = legacy();
  const workspace = workspaceStorage.getStore()?.id;
  const deviceScope = workspace ? 'allowance:' + workspace + ':' : 'allowance:';
  return saved || (previous?.owner===address ? previous : {owner:address,deviceHash:address?createHash('sha256').update(deviceScope+address).digest('hex'):'',asset,contracts:EVENT_CONTRACTS});
 }
 function keyName(c: WalletConfig, role: string) {
  return legacy()?.owner===c.owner ? `testnet-${role}` : `testnet-${role}-${c.deviceHash}`;
 }
 function gasPath(active: Project) {
  const scope = createHash('sha256').update(`${active.owner}:${active.projectId}`).digest('hex');
  return resolve(dataDirectory(),`velo-gas-${scope}.dpapi`);
 }
 function availableGasPath(active: Project) {
  if (!active.owner || !active.projectId) return null;
  const scoped = gasPath(active);
  if (existsSync(scoped)) return scoped;
  const previous = localProject();
  const original = resolve(dataDirectory(),'velo-gas.dpapi');
  return active.owner===previous.owner && active.projectId===previous.projectId && existsSync(original) ? original : null;
 }
 function gas(){
  const path = availableGasPath(project());
  if(!path)throw new Error('Save the Testnet Gas key for this wallet and Velo project in Connections.');
  const key=unprotect(path);
  if(!/^tg_test_[a-f0-9]{32}$/.test(key))throw new Error('A Gas Station Testnet key is required.');
  return new Velo({apiKey:key,baseUrl:'https://www.velo-build.dev',environment:'testnet',timeoutMs:30000,maxRetries:0});
 }
 function agentSettings(c: WalletConfig) {
  return store.get<z.infer<typeof agentSettingsSchema>>('testnet-agent-settings', c.owner) || null;
 }
 function saveAgentSettings(address: string, input: unknown) {
  assertIdle();
  if (!address || project().owner !== address) throw new Error('Connect the owner wallet for these agent settings.');
  store.put('testnet-agent-settings', address, parseAgentSettings(input));
 }
 function savedWallets() {
  const saved = new Map(store.list<Project>('testnet-project').map(wallet=>[wallet.owner,wallet]));
  const original=localProject();
  const previous=legacy()?.owner;
  if(original.owner&&(!previous||previous===original.owner)&&!saved.has(original.owner))saved.set(original.owner,original);
  if(previous&&!saved.has(previous))saved.set(previous,{owner:previous,projectId:''});
  return [...saved.values()].filter(wallet=>wallet.owner);
 }
 function safeStatus(){
  const c=config(),active=project();
  const boundSuppliers = store.suppliers().filter(s => {
    const binding = store.get<{merchant: string}>('testnet-supplier', c.owner + ':' + s.id);
    return s.approved && c.merchant && (binding?.merchant || s.destination) === c.merchant;
  }).map(s => s.id);
  return {...c,wallets:savedWallets(),projectId:active.projectId,gasStationUrl:active.projectId?`https://www.velo-build.dev/projects/${active.projectId}/gas`:'',initialized:!!c.agent,gasKeyStored:!!availableGasPath(active),agentSettings:agentSettings(c),boundSuppliers,network:'Stellar Testnet',checks:store.get('testnet-checks',c.owner)||(legacy()?.owner===c.owner?store.get('testnet','checks'):null)||null,operations:store.list<any>('chain-operations').map(({signedXdr,...v})=>v)};
 }
 async function inspect(c: WalletConfig) {
  const contracts = await Promise.all(Object.entries(EVENT_CONTRACTS).map(async ([name,address]) => {
    try { await noir.server.getContractData(address,xdr.ScVal.scvLedgerKeyContractInstance());return {name,address,exists:true}; }
    catch { return {name,address,exists:false}; }
  }));
  const chain: { deviceOwner?: string | null; escrow?: string; policy?: { agent: string; maxAmount: string; asset: string; expiresAt: string | null } | null; error?: string } = {};
  if (c.deviceHash) {
    try {
      chain.deviceOwner = await noir.getDeviceOwner(c.deviceHash);
      if (chain.deviceOwner) {
        const [balance, policy] = await Promise.all([noir.getEscrowBalance(c.deviceHash), noir.getPolicy(c.deviceHash)]);
        chain.escrow = String(balance);
        chain.policy = policy && { ...policy, maxAmount: String(policy.maxAmount), expiresAt: policy.expiresAt?.toISOString() || null };
      }
    } catch {
      chain.error = 'Could not read the current Noir contract state.';
    }
  }
  const checks={contracts,...chain,checkedAt:new Date().toISOString()};
  store.put('testnet-checks',c.owner,checks);
  return checks;
 }
 function hasUnsettledPayment() {
  return store.list<{state:string;result?:{status:string}}>('chain-operations').some(operation => !settled(operation));
 }
 function assertIdle() {
  if(busy)throw new Error('Wait for the current Testnet operation to finish.');
 }
 const exclusive = (handler: RequestHandler): RequestHandler => async (req,res,next) => {
  assertIdle();
  busy=true;
  try { await handler(req,res,next); } finally { busy=false; }
 };
 async function settleClaim(op:any,r:SpendRequest,actor:string) {
  const c=config();
  const finish=()=>{op.state='claimed';delete op.error;store.db.exec('BEGIN IMMEDIATE');try{store.put('chain-operations',r.id,op);r.status='paid';r.receipt=op.claimHash;store.saveRequest(r);store.db.prepare("UPDATE commitments SET state='paid' WHERE request_id=?").run(r.id);store.event('Testnet payment claimed',`Authorization ${op.result.transactionHash}; merchant claim ${op.claimHash}.`,actor,r.id,'chain');store.db.exec('COMMIT');}catch(error){store.db.exec('ROLLBACK');throw error;}return op;};
  if(r.status==='paid')return op;
  if(!c.merchant)throw new Error('The saved demo recipient is unavailable.');
  if(!op.claimHash){
   // Noir claims the merchant's entire pending balance. Never assign a
   // combined payout to one request.
   if(await noir.getPendingBalance(c.merchant)!==BigInt(r.amount)){
    op.state='claim_needs_review';store.put('chain-operations',r.id,op);return op;
   }
   const merchant=getKey(keyName(c,'merchant'));const claimXdr=await noir.prepare(merchant.publicKey(),{kind:'claim',token:asset});const claimTx=TransactionBuilder.fromXDR(claimXdr,Networks.TESTNET);if(!('source' in claimTx)||claimTx.source!==c.merchant)throw new Error('Unexpected merchant transaction.');claimTx.sign(merchant);op.claimHash=claimTx.hash().toString('hex');op.state='claim_submitting';store.put('chain-operations',r.id,op);await checkpoint?.();await noir.submit(claimTx.toXDR());
  }
  const result=await (recovery.getTransaction?.(op.claimHash) ?? noir.server.getTransaction(op.claimHash));
  if(result.status==='SUCCESS'){
   const meta=result.resultMetaXdr;
   const legacyEvents=meta.switch()===3 ? meta.v3().sorobanMeta()?.events() ?? [] : [];
   if(matchesMerchantClaim([...result.events.contractEventsXdr.flat(),...legacyEvents],c.merchant,r.amount))return finish();
  }
  op.state=result.status==='FAILED'?'claim_failed':result.status==='SUCCESS'?'claim_needs_review':'claim_confirmation_pending';
  store.put('chain-operations',r.id,op);return op;
 }
 function failAuthorization(op:any,r:SpendRequest,actor:string,detail:string) {
  op.state='authorization_failed';
  op.error=detail;
  store.db.exec('BEGIN IMMEDIATE');
  try{
   store.put('chain-operations',r.id,op);
   r.status='payment_failed';store.saveRequest(r);
   store.db.prepare("DELETE FROM commitments WHERE request_id=? AND state='reserved'").run(r.id);
   store.event('Testnet payment did not go through',detail,actor,r.id,'chain');
   store.db.exec('COMMIT');
  }catch(error){store.db.exec('ROLLBACK');throw error;}
  return op;
 }
 async function followPayment(op:any,r:SpendRequest,actor:string,result?:GasSubmitResult) {
  // Once Velo's success is saved, later checks can go straight to Stellar.
  if(op.result?.status==='succeeded')return settleClaim(op,r,actor);
  if(!op.identity)return op;
  result ??= await (recovery.getGasStatus?.(op.identity) ?? gas().gas.getStatus(op.identity));
  op.result=result;
  // Velo also calls an in-progress sponsorship "claimed". Keep that state
  // distinct from a completed merchant claim.
  op.state=result.status==='claimed'?'velo_claimed':result.status;
  delete op.error;
  if(!result.reconciliationRequired&&(result.status==='failed'||result.status==='cancelled')){
   return failAuthorization(op,r,actor,'Velo confirmed the authorization did not succeed. Reserved budget was released.');
  }
  store.put('chain-operations',r.id,op);
  if(result.status==='succeeded'){await checkpoint?.();return settleClaim(op,r,actor);}
  return op;
 }
 app.get('/api/testnet',auth,owner,(_req,res)=>res.json(safeStatus()));
 app.post('/api/testnet/wallet',auth,owner,(req,res)=>{
  assertIdle();
  const address=String(req.body.address||'').trim();
  try { Keypair.fromPublicKey(address); } catch { return res.status(400).json({error:'Choose a valid Stellar account address.'}); }
  const current=project();
  const saved=store.get<Project>('testnet-project',address);
  const original=localProject();
  const prior=saved?.projectId ?? (address===original.owner?original.projectId:'');
  const projectId=req.body.projectId===undefined ? prior : String(req.body.projectId).trim();
  if(projectId&&!/^[a-zA-Z0-9_-]{1,100}$/.test(projectId))return res.status(400).json({error:'Enter a valid Velo project ID.'});
  const changed=current.owner!==address||current.projectId!==projectId;
  if(changed&&hasUnsettledPayment())return res.status(409).json({error:'Finish or reconcile the existing Testnet payment before switching wallets or projects.'});
  const selection={owner:address,projectId};
  store.put('testnet-project',address,selection);
  store.put('testnet','selection',selection);
  res.json(safeStatus());
 });
 app.post('/api/testnet/disconnect',auth,owner,(_req,res)=>{
  assertIdle();
  if(hasUnsettledPayment())return res.status(409).json({error:'Reconcile the pending Testnet payment before disconnecting the wallet.'});
  store.put('testnet','selection',{owner:'',projectId:''});
  res.json(safeStatus());
 });
 app.post('/api/testnet/gas-key',auth,owner,(req,res)=>{
  assertIdle();
  const active=project();
  if(!active.owner||!active.projectId||req.body.address!==active.owner||req.body.projectId!==active.projectId)return res.status(409).json({error:'Reload the active wallet and Velo project before saving its Gas key.'});
  if(!protectedStorageReady())throw new Error('Protected storage must be configured before saving a Testnet key.');
  const key=String(req.body.key||'').trim();
  if(!/^tg_test_[a-f0-9]{32}$/.test(key))return res.status(400).json({error:'Enter a scoped Velo Gas Station Testnet key.'});
  mkdirSync(dataDirectory(),{recursive:true});
  writeFileSync(gasPath(active),protect(key),{mode:0o600});
  res.json(safeStatus());
 });
 app.post('/api/testnet/initialize',auth,owner,exclusive(async(_req,res)=>{
  if(!protectedStorageReady())throw new Error('Protected storage must be configured before creating demo accounts.');
  const c=config();if(!c.owner)throw new Error('Connect a Stellar Testnet owner wallet first.');mkdirSync(dataDirectory(),{recursive:true});
  for(const role of ['agent','merchant'] as const){const name=keyName(c,role);const path=resolve(dataDirectory(),name+'.dpapi');if(!existsSync(path))writeFileSync(path,protect(Keypair.random().secret()),{mode:0o600});c[role]=getKey(name).publicKey();}
  store.put('testnet-wallet',c.owner,c);
  await checkpoint?.();
  for(const role of ['agent','merchant'] as const){const response=await fetch('https://friendbot.stellar.org/?addr='+encodeURIComponent(c[role]!),{signal:AbortSignal.timeout(30000)});if(!response.ok&&response.status!==400)throw new Error('The Testnet faucet is unavailable. Public account details were saved; retry later.');}
  store.event('Testnet demo accounts initialized','Dedicated local agent and demo merchant. No real funds.',res.locals.person.name,null,'system');res.json(safeStatus());
 }));
 app.post('/api/testnet/inspect',auth,owner,async(_req,res)=>res.json(await inspect(config())));
 app.post('/api/testnet/agent-settings',auth,owner,(req,res)=>{
  saveAgentSettings(String(req.body.address || ''), req.body.settings);
  res.json(safeStatus());
 });
 app.post('/api/testnet/bind-supplier',auth,owner,(req,res)=>{const c=config();if(!c.merchant)throw new Error('Initialize demo accounts first.');const supplier=store.get<Supplier>('suppliers',String(req.body.supplierId));if(!supplier?.approved)throw new Error('Choose an approved supplier.');store.put('testnet-supplier',c.owner+':'+supplier.id,{merchant:c.merchant});store.event('Demo merchant bound',`${supplier.name} points to the dedicated Testnet demo merchant, not a real shop.`,res.locals.person.name,null,'policy');res.json({ok:true});});
 app.post('/api/testnet/prepare',auth,owner,exclusive(async(req,res)=>{
  const c=config();if(!c.agent)throw new Error('Initialize Testnet demo accounts first.');
  const kind=String(req.body.kind);let op:NoirOperation;
  if(kind==='registerDevice')op={kind,deviceHash:c.deviceHash,agent:c.agent};
  else if(kind==='registerAgent'){
    const saved = agentSettings(c);
    const settings = saved && parseAgentSettings(saved);
    op={kind,deviceHash:c.deviceHash,agent:c.agent,asset,
      maxAmount: settings ? (settings.maxAmount === null ? 0n : BigInt(units(settings.maxAmount))) : BigInt(store.policy().perRequest),
      expiresAt: settings ? (settings.expiresAt ? new Date(settings.expiresAt) : null) : new Date(Date.now()+48*3600000)};
  }
  else if(kind==='revokeAgent'){
    if (hasUnsettledPayment()) throw new Error('Reconcile the pending Testnet payment before revoking the agent.');
    op={kind,deviceHash:c.deviceHash};
  }
  else if(kind==='fundEscrow')op={kind,deviceHash:c.deviceHash,token:asset,amount:BigInt(units(String(req.body.amount)))};
  else if(kind==='defundEscrow'){
    if(hasUnsettledPayment())throw new Error('Reconcile the pending Testnet payment before withdrawing.');
    const amount=BigInt(units(String(req.body.amount)));
    if(await noir.getDeviceOwner(c.deviceHash)!==c.owner)throw new Error('Only the registered device owner can withdraw from escrow.');
    if(amount>await noir.getEscrowBalance(c.deviceHash))throw new Error('Withdrawal exceeds the confirmed escrow balance.');
    op={kind,deviceHash:c.deviceHash,token:asset,amount};
  }
  else throw new Error('Unsupported setup operation.');
  let unsignedXdr: string;
  try { unsignedXdr = await noir.prepare(c.owner, op); }
  catch (error) {
    if (kind === 'registerAgent' && error instanceof Error && error.message.includes('AlreadyRegistered')) {
      throw new Error('Revoke the current Noir authorization before signing a replacement.');
    }
    throw error;
  }
  const tx=TransactionBuilder.fromXDR(unsignedXdr,Networks.TESTNET);const id=randomUUID();store.put('wallet-pending',id,{id,hash:tx.hash().toString('hex'),kind,createdAt:Date.now(),state:'pending',owner:c.owner});res.json({id,unsignedXdr,owner:c.owner,networkPassphrase:Networks.TESTNET,kind});
 }));
 app.post('/api/testnet/submit-setup',auth,owner,exclusive(async(req,res)=>{
  const c=config(),pending=store.get<any>('wallet-pending',String(req.body.id));if(!pending||pending.state!=='pending'||Date.now()-pending.createdAt>300000)throw new Error('Prepare a fresh wallet transaction.');
  if(pending.owner!==c.owner)throw new Error('The active wallet changed. Prepare a fresh wallet transaction.');
  if (['revokeAgent','defundEscrow'].includes(pending.kind) && hasUnsettledPayment()) throw new Error('Reconcile the pending Testnet payment before revoking or withdrawing.');
  const signed=String(req.body.signedXdr||'');validateOwnerSetupSignature(signed,pending.hash,c.owner);
  pending.state='submitting';store.put('wallet-pending',pending.id,pending);await checkpoint?.();const hash=await noir.submit(signed);pending.state='confirmed';pending.hash=hash;store.put('wallet-pending',pending.id,pending);store.event('Testnet setup confirmed',`${pending.kind}: ${hash}`,res.locals.person.name,null,'chain');await inspect(c);res.json({hash});
 }));
 async function approveRequest(id: string, actor: string, note: string, automatic = false) {
  assertIdle();
  busy=true;
  try{
   let r=store.request(id);if(!r||r.mode!=='testnet')throw new Error('Choose a Testnet purchase request.');const existing=store.get<any>('chain-operations',id);
   if(existing){
    if(r.status!=='authorized')return existing;
    if(!existing.identity)throw new Error('No Velo tracking ID was saved. Compare the authorization hash in Connections with the Gas Station receipt before attempting another payment.');
    return await followPayment(existing,r,actor);
   }
   if(automatic && (existing || !store.canAutoApprove(r)))throw new Error('This purchase needs owner review under the current rules.');
   const c=config();const supplier=store.get<Supplier>('suppliers',r.supplierId);const binding=supplier&&store.get<{merchant:string}>('testnet-supplier',c.owner+':'+supplier.id);if(!c.agent||!c.merchant||!supplier?.approved||(binding?.merchant||supplier.destination)!==c.merchant)throw new Error('Bind an approved supplier to the demo merchant first.');
   const velo=gas();
   if(!note.trim())throw new Error('Add a decision note.');const failed=store.checks(r).filter(v=>!v.pass);if(failed.length)throw new Error(failed.map(v=>v.detail).join(' '));if(!['needs_review','blocked'].includes(r.status))throw new Error('Request is not available for payment.');
   const agent=getKey(keyName(c,'agent'));const check=await noir.checkPayment({deviceHash:c.deviceHash,agent:agent.publicKey(),asset,amount:BigInt(r.amount)});if(!check.ok)throw new Error(`Noir refused payment: ${check.reason}`);
   const nonce=BigInt(Math.max(Date.now(),Number(store.setting('chain-nonce')||0)+1));const op:any={id,nonce:String(nonce),state:'reserved',createdAt:new Date().toISOString()};
   store.db.exec('BEGIN IMMEDIATE');
   try {
    const current=store.request(id);
    if(!current||!['needs_review','blocked'].includes(current.status)||store.get('chain-operations',id))throw new Error('This request is no longer available for payment.');
    if(store.checks(current).some(check=>!check.pass))throw new Error('Budget or access changed.');
    if(automatic&&!store.canAutoApprove(current))throw new Error('Automatic approval is no longer permitted.');
    r=current;
    store.setSetting('chain-nonce',String(nonce));
    store.db.prepare("INSERT INTO commitments VALUES(?,?,?,'reserved')").run(r.id,r.projectId,r.amount);
    r.committedAt=new Date().toISOString();
    r.status='authorized';
    r.comment=note.slice(0,1500);
    store.saveRequest(r);
    store.put('chain-operations',id,op);
    store.event(automatic?'Assistant authorized Testnet payment':'Owner authorized Testnet payment',r.comment,actor,r.id,'chain');
    store.db.exec('COMMIT');
   } catch(error) {
    store.db.exec('ROLLBACK');
    throw error;
   }
   let handedOff=false;
   try{
    const unsigned=await noir.prepare(agent.publicKey(),{kind:'authorize',deviceHash:c.deviceHash,merchant:c.merchant,asset,amount:BigInt(r.amount),nonce});const tx=TransactionBuilder.fromXDR(unsigned,Networks.TESTNET);if(!('source' in tx)||tx.source!==agent.publicKey())throw new Error('Unexpected agent transaction.');tx.sign(agent);op.transactionHash=tx.hash().toString('hex');store.put('chain-operations',id,op);
    await checkpoint?.();
    const reservation=await velo.gas.sponsor(tx.toXDR(),{idempotencyKey:'allowance:'+id,correlationId:id});op.identity={requestId:reservation.requestId,transactionHash:reservation.transactionHash};op.state='sponsored';store.put('chain-operations',id,op);
    await checkpoint?.();
    handedOff=true;
    const result=await velo.gas.submit({...op.identity,transactionXdr:tx.toXDR()});
    return await followPayment(op,r,actor,result);
   }catch(e){
    if(!handedOff){
     if(e instanceof VeloError && e.code && /^[a-z0-9_]{1,70}$/.test(e.code))op.providerCode=e.code;
     return failAuthorization(op,r,actor,'Payment could not start. '+sponsorshipFailure(e)+' No payment was submitted and the budget was released.');
    }
    op.error='The payment status could not be confirmed. Allowance will check the existing transaction.';
    op.state='needs_reconciliation';store.put('chain-operations',id,op);return op;
   }
  }finally{busy=false;}
 }
 const checkedAt=new Map<string,number>();
 function paymentProgress(r: SpendRequest) {
  if(r.status!=='authorized'&&r.status!=='payment_failed')return undefined;
  const op=store.get<any>('chain-operations',r.id);
  if(r.status==='payment_failed')return {canCheck:false, label:'Payment failed', detail:op?.error || 'The authorization did not succeed. Your budget is no longer reserved.'};
  if(!op?.identity)return {canCheck:false,label:'Payment needs investigation',detail:'No Velo tracking ID was saved. The owner can compare the authorization hash in Connections with Velo’s receipt.'};
  if(op.state==='claim_failed'||op.state==='claim_needs_review')return {canCheck:false,label:'Recipient claim needs attention',detail:'The authorization succeeded, but Allowance could not confirm a claim for this exact amount. The budget remains reserved.'};
  if(op.result?.status==='succeeded')return {canCheck:true,label:'Waiting for recipient claim',detail:'Velo confirmed authorization. Allowance is checking for the recipient’s Testnet receipt.'};
  return {canCheck:true,label:'Waiting for Velo confirmation',detail:'Approval is recorded. Allowance is checking the existing transaction before it can confirm payment.'};
 }
 app.post('/api/requests/:id/payment-status',auth,async(req,res)=>{
  const r=store.request(String(req.params.id));
  if(!r||(res.locals.person.role!=='owner'&&r.requesterId!==res.locals.person.id))return res.status(404).json({error:'Request not found.'});
  const op=store.get<any>('chain-operations',r.id);
  if(!paymentProgress(r)?.canCheck||!op||busy)return res.json({updated:false});
  const now=Date.now();
  if((checkedAt.get(r.id)||0)>now-12000)return res.json({updated:false});
  for(const [id,time] of checkedAt)if(time<=now-12000)checkedAt.delete(id);
  checkedAt.set(r.id,now);
  busy=true;
  try{await followPayment(op,r,'Payment status check');res.json({updated:true});}
  catch{res.status(502).json({error:'Payment status is temporarily unavailable. No replacement payment was sent.'});}
  finally{busy=false;}
 });
 app.post('/api/requests/:id/testnet',auth,owner,async(req,res)=>{
  if(busy)return res.status(409).json({error:'Another chain operation is running. Wait, then reconcile its status.'});
  const op=await approveRequest(String(req.params.id),res.locals.person.name,String(req.body?.note||''));
  res.status(settled(op)?200:202).json(op);
 });
 return { approveRequest, saveAgentSettings, setupStatus: safeStatus, paymentProgress };
}
