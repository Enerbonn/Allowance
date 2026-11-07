import { TESTNET as SDK_TESTNET } from '@noirx402/agent-sdk';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {Store} from './store.ts';
import type {SpendRequest} from './domain.ts';
import type {GasSubmitResult} from '@carts1024/velo-sdk';
import {Account,Address,Asset,Keypair,Networks,Operation,TransactionBuilder,StrKey,nativeToScVal,xdr} from '@stellar/stellar-sdk';
import {validateOwnerSetupSignature,EVENT_CONTRACTS,LEGACY_CONTRACTS,sameContracts,currentContractChecks,paymentContracts,parseAgentSettings,matchesMerchantClaim,matchesAuthorizationReceipt,installTestnet} from './testnet.ts';

test('owner setup signatures bind the exact prepared transaction and Testnet',()=>{
 const owner=Keypair.random(),recipient=Keypair.random();
 const build=(amount:string,networkPassphrase=Networks.TESTNET)=>new TransactionBuilder(new Account(owner.publicKey(),'1'),{fee:'100',networkPassphrase}).addOperation(Operation.payment({destination:recipient.publicKey(),asset:Asset.native(),amount})).setTimeout(120).build();
 const expected=build('1');const hash=expected.hash().toString('hex');assert.throws(()=>validateOwnerSetupSignature(expected.toXDR(),hash,owner.publicKey()),/does not match/);expected.sign(owner);assert.equal(validateOwnerSetupSignature(expected.toXDR(),hash,owner.publicKey()).source,owner.publicKey());
 const altered=build('2');altered.sign(owner);assert.throws(()=>validateOwnerSetupSignature(altered.toXDR(),hash,owner.publicKey()),/does not match/);
 const mainnet=build('1',Networks.PUBLIC);mainnet.sign(owner);assert.throws(()=>validateOwnerSetupSignature(mainnet.toXDR(),hash,owner.publicKey()),/does not match/);
 assert.equal(EVENT_CONTRACTS.deviceRegistry,'CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5');
});

test('Noir agent terms support an explicit cap, no cap and no expiry', () => {
  const now = Date.parse('2026-11-06T00:00:00Z');
  const defaults = { label: 'Studio agent', maxAmount: '15.1000000', expiresAt: '2026-11-07T09:00:00+08:00' };
  assert.deepEqual(parseAgentSettings(defaults, now), { ...defaults, maxAmount: '15.1' });
  assert.deepEqual(parseAgentSettings({ ...defaults, maxAmount: null, expiresAt: null }, now), { label: 'Studio agent', maxAmount: null, expiresAt: null });
  assert.throws(() => parseAgentSettings({ ...defaults, expiresAt: '2026-11-05T23:59:59Z' }, now), /future/);
  assert.throws(() => parseAgentSettings({ ...defaults, maxAmount: '-1' }, now), /positive/);
});

const event=(contract:string,recipient:string,amount:bigint)=>xdr.ContractEvent.fromXDR(new xdr.ContractEvent({
  ext:new xdr.ExtensionPoint(0),contractId:StrKey.decodeContract(contract) as unknown as xdr.Hash,
  type:xdr.ContractEventType.contract(),body:new xdr.ContractEventBody(0,new xdr.ContractEventV0({
   topics:[nativeToScVal('claim',{type:'symbol'}),new Address(recipient).toScVal()],data:nativeToScVal(amount,{type:'i128'}),
  })),
}).toXDR());

test('a successful claim must match the Noir escrow, recipient and exact purchase amount',()=>{
 const merchant=Keypair.random().publicKey();
 assert.equal(matchesMerchantClaim([event(EVENT_CONTRACTS.paymentEscrow,merchant,150000000n)],merchant,150000000),true);
 assert.equal(matchesMerchantClaim([event(EVENT_CONTRACTS.paymentEscrow,merchant,250000000n)],merchant,150000000),false);
 assert.equal(matchesMerchantClaim([event(EVENT_CONTRACTS.agentRegistry,merchant,150000000n)],merchant,150000000),false);
 assert.equal(matchesMerchantClaim([event(EVENT_CONTRACTS.paymentEscrow,Keypair.random().publicKey(),150000000n)],merchant,150000000),false);
});

test('Stellar can recover a submitted fee-bumped authorization only when the exact transaction and Noir event match',async()=>{
 const source=Keypair.random(),merchant=Keypair.random(),sponsor=Keypair.random();
 const amount=10000000,device=Buffer.alloc(32,7);
 const inner=new TransactionBuilder(new Account(source.publicKey(),'1'),{fee:'100',networkPassphrase:Networks.TESTNET})
  .addOperation(Operation.invokeHostFunction({
   func:xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({
    contractAddress:new Address(EVENT_CONTRACTS.paymentEscrow).toScAddress(),functionName:'authorize',args:[],
   })),auth:[],
  })).setTimeout(120).build();
 inner.sign(source);
 const outer=TransactionBuilder.buildFeeBumpTransaction(sponsor.publicKey(),'200',inner,Networks.TESTNET);
 outer.sign(sponsor);
 const authorization=new xdr.ContractEvent({
  ext:new xdr.ExtensionPoint(0),contractId:StrKey.decodeContract(EVENT_CONTRACTS.paymentEscrow) as unknown as xdr.Hash,
  type:xdr.ContractEventType.contract(),body:new xdr.ContractEventBody(0,new xdr.ContractEventV0({
   topics:[nativeToScVal('authorize',{type:'symbol'}),nativeToScVal(device,{type:'bytes'}),new Address(merchant.publicKey()).toScVal()],
   data:nativeToScVal(BigInt(amount),{type:'i128'}),
  })),
 });
 const response={status:'SUCCESS',envelopeXdr:outer.toEnvelope(),resultMetaXdr:{switch:()=>4},
  events:{contractEventsXdr:[[authorization]]}} as unknown as Parameters<typeof matchesAuthorizationReceipt>[0];
 const expected={innerHash:inner.hash().toString('hex'),deviceHash:device.toString('hex'),merchant:merchant.publicKey(),amount};
 assert.equal(matchesAuthorizationReceipt(response,expected),true);
 assert.equal(matchesAuthorizationReceipt(response,{...expected,innerHash:outer.hash().toString('hex')}),false);
 assert.equal(matchesAuthorizationReceipt(response,{...expected,deviceHash:'0'.repeat(64)}),false);
 assert.equal(matchesAuthorizationReceipt(response,{...expected,merchant:source.publicKey()}),false);
 assert.equal(matchesAuthorizationReceipt(response,{...expected,amount:amount+1}),false);
 const store=new Store(':memory:');
 const request:SpendRequest={...store.request('REQ-1044')!,id:'STELLAR-RECOVERY',idempotencyKey:'STELLAR-RECOVERY',mode:'testnet',status:'authorized',receipt:null,amount};
 const identity={requestId:'sponsor-id',transactionHash:expected.innerHash};
 const outerHash=outer.hash().toString('hex'),claimHash='c'.repeat(64);
 store.put('testnet','config',{owner:source.publicKey(),merchant:expected.merchant,deviceHash:expected.deviceHash});
 store.create(request);
 store.db.prepare("INSERT INTO commitments VALUES(?,?,?,'reserved')").run(request.id,request.projectId,request.amount);
 store.put('chain-operations',request.id,{id:request.id,contracts:EVENT_CONTRACTS,state:'submitted',identity,transactionHash:expected.innerHash,claimHash});
 const lookups:string[]=[];
 const stub=(_req:any,_res:any,next:any)=>next();
 const handler=installTestnet(express(),store,stub,stub,undefined,{
  getGasStatus:async id=>{assert.deepEqual(id,identity);return {
   ...identity,object:'gas_submit_result',status:'submitted',outerTransactionHash:outerHash,reservedStroops:'100',
   actualFeeStroops:null,expiresAt:new Date().toISOString(),reconciliationRequired:true,
  };},
  getTransaction:async hash=>{
   lookups.push(hash);
   if(hash===outerHash)return response;
   assert.equal(hash,claimHash);
   return {...response,events:{contractEventsXdr:[[event(EVENT_CONTRACTS.paymentEscrow,expected.merchant,BigInt(amount))]]}} as unknown as typeof response;
  },
 });
 try{
  const paid=await handler.approveRequest(request.id,'Test recovery','');
  assert.equal(paid.result.status,'submitted');
  assert.equal(paid.authorizationProofHash,outerHash);
  assert.equal(store.request(request.id)?.status,'paid');
  assert.equal(store.request(request.id)?.receipt,claimHash);
  await handler.approveRequest(request.id,'Test replay','');
  assert.deepEqual(lookups,[outerHash,claimHash]);
  assert.equal(store.events().filter(e=>e.requestId===request.id&&e.title==='Testnet payment claimed').length,1);
 }finally{store.close();}
});

test('earlier-deployment Velo handoff recovers once, and only a verified Noir claim settles the budget',async()=>{
 const store=new Store(':memory:');
 const merchant=Keypair.random().publicKey();
 store.put('testnet','config',{owner:Keypair.random().publicKey(),merchant});
 const stub=(_req:any,_res:any,next:any)=>next();
 const receipt='a'.repeat(64), hash='b'.repeat(64);
 const result=(status:GasSubmitResult['status'],reconciliationRequired=false)=>({
  object:'gas_submit_result' as const,requestId:'test-reservation',transactionHash:hash,status,
  outerTransactionHash:null,reservedStroops:'100',actualFeeStroops:null,expiresAt:new Date().toISOString(),reconciliationRequired,
 });
 const stages=[result('claimed'),result('submission_unknown',true),result('succeeded'),result('failed',true),result('failed')];
 let receiptVisible=false, statusChecks=0;
 const payment=installTestnet(express(),store,stub,stub,undefined,{
  getGasStatus:async identity=>{
   assert.equal(identity.transactionHash,hash);
   statusChecks++;
   return stages.shift()!;
  },
  getTransaction:async txHash=>{
   assert.equal(txHash,receipt);
   const response=receiptVisible?{
    status:'SUCCESS',resultMetaXdr:{switch:()=>4},
    events:{contractEventsXdr:[[event(LEGACY_CONTRACTS.paymentEscrow,merchant,10000000n)]]},
   }:{status:'NOT_FOUND'};
   return response as unknown as Awaited<ReturnType<import('@noirx402/agent-sdk').NoirAgentClient['server']['getTransaction']>>;
  },
 });
 const reserved=(id:string,claimHash?:string)=>{
  const r:SpendRequest={...store.request('REQ-1044')!,id,mode:'testnet',status:'authorized',idempotencyKey:id,amount:10000000,receipt:null};
  store.create(r);
  store.db.prepare("INSERT INTO commitments VALUES(?,?,?,'reserved')").run(id,r.projectId,r.amount);
  store.put('chain-operations',id,{id,state:'claimed',result:result('claimed'),identity:{requestId:'test-reservation',transactionHash:hash},claimHash});
  return r;
 };
 try {
  const r=reserved('RECOVERY-1',receipt);
  const failed=reserved('RECOVERY-2');
  const total=store.committed(r.projectId);
  assert.equal((await payment.approveRequest(r.id,'Tester','')).state,'velo_claimed');
  assert.equal((await payment.approveRequest(r.id,'Tester','')).state,'submission_unknown');
  assert.equal((await payment.approveRequest(r.id,'Tester','')).state,'claim_confirmation_pending');
  assert.equal(store.request(r.id)?.status,'authorized');
  assert.equal(store.committed(r.projectId),total);
  receiptVisible=true;
  assert.equal((await payment.approveRequest(r.id,'Tester','')).state,'claimed');
  assert.equal((await payment.approveRequest(r.id,'Tester','')).state,'claimed');
  assert.equal(statusChecks,3);
  assert.equal(store.request(r.id)?.receipt,receipt);
  assert.equal(store.events().filter(e=>e.requestId===r.id&&e.title==='Testnet payment claimed').length,1);
  await payment.approveRequest(failed.id,'Tester','');
  assert.equal(store.request(failed.id)?.status,'authorized');
  assert.equal(store.committed(r.projectId),total);
  await payment.approveRequest(failed.id,'Tester','');
  assert.equal(store.request(failed.id)?.status,'payment_failed');
  assert.equal(store.committed(r.projectId),total-failed.amount);
 }finally{store.close();}
});


test('deployment migration rejects stale checks and keeps earlier operations on their own contracts',()=>{
 assert.equal(sameContracts(LEGACY_CONTRACTS),false);
 assert.equal(sameContracts(EVENT_CONTRACTS),true);
 assert.deepEqual(EVENT_CONTRACTS,SDK_TESTNET.contracts);
 assert.deepEqual(paymentContracts({}),LEGACY_CONTRACTS);
 assert.deepEqual(paymentContracts({contracts:EVENT_CONTRACTS}),EVENT_CONTRACTS);
 assert.throws(()=>paymentContracts({contracts:{paymentEscrow:EVENT_CONTRACTS.paymentEscrow}}),/Unknown/);
 assert.equal(currentContractChecks({contracts:Object.entries(LEGACY_CONTRACTS).map(([name,address])=>({name,address,exists:true})),escrow:'99999999999'}),false);
 assert.equal(currentContractChecks({contracts:Object.entries(EVENT_CONTRACTS).map(([name,address])=>({name,address,exists:true}))}),true);
 const merchant=Keypair.random().publicKey();
 const oldClaim=event(LEGACY_CONTRACTS.paymentEscrow,merchant,100n);
 assert.equal(matchesMerchantClaim([oldClaim],merchant,100),false);
 assert.equal(matchesMerchantClaim([oldClaim],merchant,100,LEGACY_CONTRACTS.paymentEscrow),true);
});
