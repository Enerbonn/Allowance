import type {Express,RequestHandler} from 'express';
import {NoirAgentClient,TESTNET,type NoirOperation} from '@noirx402/agent-sdk';
import {Keypair,Networks,Asset,TransactionBuilder,xdr} from '@stellar/stellar-sdk';
import {Velo} from '@carts1024/velo-sdk';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Store} from './store.ts';
import {dataDirectory, protect, protectedStorageReady, unprotect} from './protected-storage.ts';
import { z } from 'zod';
import {money,units,type Supplier} from './domain.ts';

export const EVENT_CONTRACTS={deviceRegistry:'CB4DPMGOA374JIB2ZVD4AHW5GJKQUYNOFGRYNOJ75EFH2KCJSMHOWIRA',agentRegistry:'CBTDMJVCFQDIVWZBKAKZ2FQ3UEJNAAUFYCTJ3E4ON2MYXPLPSIXQ25JZ',paymentEscrow:'CA5S4S7QGHJHJWVJBYL3CXZXZTNGKXMNZVDAEQNN7NUXFP4D7BYK7HIX'};
const network={...TESTNET,contracts:EVENT_CONTRACTS};
const asset=Asset.native().contractId(Networks.TESTNET);
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

export function installTestnet(app:Express,store:Store,auth:RequestHandler,owner:RequestHandler){
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
  return saved || (previous?.owner===address ? previous : {owner:address,deviceHash:address?createHash('sha256').update('allowance:'+address).digest('hex'):'',asset,contracts:EVENT_CONTRACTS});
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
 function safeStatus(){
  const c=config(),active=project();
  const boundSuppliers = store.suppliers().filter(s => {
    const binding = store.get<{merchant: string}>('testnet-supplier', c.owner + ':' + s.id);
    return s.approved && c.merchant && (binding?.merchant || s.destination) === c.merchant;
  }).map(s => s.id);
  return {...c,projectId:active.projectId,gasStationUrl:active.projectId?`https://www.velo-build.dev/projects/${active.projectId}/gas`:'',initialized:!!c.agent,gasKeyStored:!!availableGasPath(active),agentSettings:agentSettings(c),boundSuppliers,network:'Stellar Testnet',checks:store.get('testnet-checks',c.owner)||(legacy()?.owner===c.owner?store.get('testnet','checks'):null)||null,operations:store.list<any>('chain-operations').map(({signedXdr,...v})=>v)};
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
  return store.list<{ state: string }>('chain-operations').some(operation => operation.state !== 'claimed');
 }
 function assertIdle() {
  if(busy)throw new Error('Wait for the current Testnet operation to finish.');
 }
 const exclusive = (handler: RequestHandler): RequestHandler => async (req,res,next) => {
  assertIdle();
  busy=true;
  try { await handler(req,res,next); } finally { busy=false; }
 };
 async function settleClaim(op:any,r:any,actor:string) {
  const c=config();
  const finish=()=>{op.state='claimed';store.put('chain-operations',r.id,op);r.status='paid';r.receipt=op.claimHash;store.saveRequest(r);store.db.prepare("UPDATE commitments SET state='paid' WHERE request_id=?").run(r.id);store.event('Testnet payment claimed',`Authorization ${op.result.transactionHash}; merchant claim ${op.claimHash}.`,actor,r.id,'chain');return op;};
  if(op.state==='claimed')return op;
  if(op.claimHash){const result=await noir.server.getTransaction(op.claimHash);if(result.status==='SUCCESS')return finish();op.state=result.status==='FAILED'?'claim_failed':'claim_confirmation_pending';store.put('chain-operations',r.id,op);return op;}
  const merchant=getKey(keyName(c,'merchant'));const claimXdr=await noir.prepare(merchant.publicKey(),{kind:'claim',token:asset});const claimTx=TransactionBuilder.fromXDR(claimXdr,Networks.TESTNET);if(!('source' in claimTx)||claimTx.source!==c.merchant)throw new Error('Unexpected merchant transaction.');claimTx.sign(merchant);op.claimHash=claimTx.hash().toString('hex');op.state='claim_submitting';store.put('chain-operations',r.id,op);await noir.submit(claimTx.toXDR());return finish();
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
  for(const role of ['agent','merchant'] as const){const response=await fetch('https://friendbot.stellar.org/?addr='+encodeURIComponent(c[role]!),{signal:AbortSignal.timeout(30000)});if(!response.ok&&response.status!==400)throw new Error('The Testnet faucet is unavailable. Public account details were saved; retry later.');}
  store.event('Testnet demo accounts initialized','Dedicated local agent and demo merchant. No real funds.',res.locals.person.name,null,'system');res.json(safeStatus());
 }));
 app.post('/api/testnet/inspect',auth,owner,async(_req,res)=>res.json(await inspect(config())));
 app.post('/api/testnet/agent-settings',auth,owner,(req,res)=>{
  saveAgentSettings(String(req.body.address || ''), req.body.settings);
  res.json(safeStatus());
 });
 app.post('/api/testnet/bind-supplier',auth,owner,(req,res)=>{const c=config();if(!c.merchant)throw new Error('Initialize demo accounts first.');const supplier=store.get<Supplier>('suppliers',String(req.body.supplierId));if(!supplier?.approved)throw new Error('Choose an approved supplier.');store.put('testnet-supplier',c.owner+':'+supplier.id,{merchant:c.merchant});store.event('Demo merchant bound',`${supplier.name} points to the dedicated Testnet demo merchant, not a real shop.`,res.locals.person.name,null,'policy');res.json({ok:true});});
 app.post('/api/testnet/prepare',auth,owner,async(req,res)=>{
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
  else throw new Error('Unsupported setup operation.');
  let unsignedXdr: string;
  try { unsignedXdr = await noir.prepare(c.owner, op); }
  catch (error) {
    if (kind === 'registerAgent' && error instanceof Error && error.message.includes('AlreadyRegistered')) {
      throw new Error('Revoke the current Noir authorization before signing a replacement.');
    }
    throw error;
  }
  const tx=TransactionBuilder.fromXDR(unsignedXdr,Networks.TESTNET);const id=randomUUID();store.put('wallet-pending',id,{id,hash:tx.hash().toString('hex'),kind,createdAt:Date.now(),state:'pending'});res.json({id,unsignedXdr,owner:c.owner,networkPassphrase:Networks.TESTNET,kind});
 });
 app.post('/api/testnet/submit-setup',auth,owner,exclusive(async(req,res)=>{
  const c=config(),pending=store.get<any>('wallet-pending',String(req.body.id));if(!pending||pending.state!=='pending'||Date.now()-pending.createdAt>300000)throw new Error('Prepare a fresh wallet transaction.');
  if (pending.kind === 'revokeAgent' && hasUnsettledPayment()) throw new Error('Reconcile the pending Testnet payment before revoking the agent.');
  const signed=String(req.body.signedXdr||'');validateOwnerSetupSignature(signed,pending.hash,c.owner);
  pending.state='submitting';store.put('wallet-pending',pending.id,pending);const hash=await noir.submit(signed);pending.state='confirmed';pending.hash=hash;store.put('wallet-pending',pending.id,pending);store.event('Testnet setup confirmed',`${pending.kind}: ${hash}`,res.locals.person.name,null,'chain');await inspect(c);res.json({hash});
 }));
 app.post('/api/requests/:id/testnet',auth,owner,async(req,res)=>{
  if(busy)return res.status(409).json({error:'Another chain operation is running. Wait, then reconcile its status.'});busy=true;
  try{
   const id=String(req.params.id),r=store.request(id);if(!r||r.mode!=='testnet')throw new Error('Choose a Testnet purchase request.');const existing=store.get<any>('chain-operations',id);if(existing?.state==='claimed')return res.json(existing);
   const c=config();const supplier=store.get<Supplier>('suppliers',r.supplierId);const binding=supplier&&store.get<{merchant:string}>('testnet-supplier',c.owner+':'+supplier.id);if(!c.agent||!c.merchant||!supplier?.approved||(binding?.merchant||supplier.destination)!==c.merchant)throw new Error('Bind an approved supplier to the demo merchant first.');
   const velo=gas();
   if(existing){if(!existing.identity)throw new Error('An earlier operation requires manual reconciliation; no duplicate submission was made.');const result=await velo.gas.getStatus(existing.identity);existing.result=result;existing.state=result.status;store.put('chain-operations',id,existing);return res.json(result.status==='succeeded'?await settleClaim(existing,r,res.locals.person.name):existing);}
   if(!String(req.body.note||'').trim())throw new Error('Add an owner decision note.');const failed=store.checks(r).filter(v=>!v.pass);if(failed.length)throw new Error(failed.map(v=>v.detail).join(' '));if(!['needs_review','blocked'].includes(r.status))throw new Error('Request is not available for payment.');
   const agent=getKey(keyName(c,'agent'));const check=await noir.checkPayment({deviceHash:c.deviceHash,agent:agent.publicKey(),asset,amount:BigInt(r.amount)});if(!check.ok)throw new Error(`Noir refused payment: ${check.reason}`);
   const nonce=BigInt(Math.max(Date.now(),Number(store.setting('chain-nonce')||0)+1));const op:any={id,nonce:String(nonce),state:'reserved',createdAt:new Date().toISOString()};
   store.db.exec('BEGIN IMMEDIATE');try{const again=store.checks(r).filter(v=>!v.pass);if(again.length)throw new Error('Budget or access changed.');store.setSetting('chain-nonce',String(nonce));store.db.prepare("INSERT INTO commitments VALUES(?,?,?,'reserved')").run(r.id,r.projectId,r.amount);r.status='authorized';r.comment=String(req.body.note).slice(0,1500);store.saveRequest(r);store.put('chain-operations',id,op);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}
   try{
    const unsigned=await noir.prepare(agent.publicKey(),{kind:'authorize',deviceHash:c.deviceHash,merchant:c.merchant,asset,amount:BigInt(r.amount),nonce});const tx=TransactionBuilder.fromXDR(unsigned,Networks.TESTNET);if(!('source' in tx)||tx.source!==agent.publicKey())throw new Error('Unexpected agent transaction.');tx.sign(agent);op.transactionHash=tx.hash().toString('hex');store.put('chain-operations',id,op);
    const reservation=await velo.gas.sponsor(tx.toXDR(),{idempotencyKey:'allowance:'+id,correlationId:id});op.identity={requestId:reservation.requestId,transactionHash:reservation.transactionHash};op.state='sponsored';store.put('chain-operations',id,op);
    const result=await velo.gas.submit({...op.identity,transactionXdr:tx.toXDR()});op.result=result;op.state=result.status;store.put('chain-operations',id,op);
    if(result.status!=='succeeded')return res.status(202).json(op);
    res.json(await settleClaim(op,r,res.locals.person.name));
   }catch(e){op.error=e instanceof Error?e.message:'Testnet operation failed.';op.state='needs_reconciliation';store.put('chain-operations',id,op);throw new Error(op.error+' The allowance reservation remains held; no automatic retry was made.');}
  }finally{busy=false;}
 });
 return { saveAgentSettings, setupStatus: safeStatus };
}
