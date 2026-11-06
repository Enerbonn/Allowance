import test from 'node:test';
import assert from 'node:assert/strict';
import {Account,Asset,Keypair,Networks,Operation,TransactionBuilder} from '@stellar/stellar-sdk';
import {validateOwnerSetupSignature,EVENT_CONTRACTS,parseAgentSettings} from './testnet.ts';

test('owner setup signatures bind the exact prepared transaction and Testnet',()=>{
 const owner=Keypair.random(),recipient=Keypair.random();
 const build=(amount:string,networkPassphrase=Networks.TESTNET)=>new TransactionBuilder(new Account(owner.publicKey(),'1'),{fee:'100',networkPassphrase}).addOperation(Operation.payment({destination:recipient.publicKey(),asset:Asset.native(),amount})).setTimeout(120).build();
 const expected=build('1');const hash=expected.hash().toString('hex');assert.throws(()=>validateOwnerSetupSignature(expected.toXDR(),hash,owner.publicKey()),/does not match/);expected.sign(owner);assert.equal(validateOwnerSetupSignature(expected.toXDR(),hash,owner.publicKey()).source,owner.publicKey());
 const altered=build('2');altered.sign(owner);assert.throws(()=>validateOwnerSetupSignature(altered.toXDR(),hash,owner.publicKey()),/does not match/);
 const mainnet=build('1',Networks.PUBLIC);mainnet.sign(owner);assert.throws(()=>validateOwnerSetupSignature(mainnet.toXDR(),hash,owner.publicKey()),/does not match/);
 assert.equal(EVENT_CONTRACTS.deviceRegistry,'CB4DPMGOA374JIB2ZVD4AHW5GJKQUYNOFGRYNOJ75EFH2KCJSMHOWIRA');
});

test('Noir agent terms support an explicit cap, no cap and no expiry', () => {
  const now = Date.parse('2026-11-06T00:00:00Z');
  const defaults = { label: 'Studio agent', maxAmount: '15.1000000', expiresAt: '2026-11-07T09:00:00+08:00' };
  assert.deepEqual(parseAgentSettings(defaults, now), { ...defaults, maxAmount: '15.1' });
  assert.deepEqual(parseAgentSettings({ ...defaults, maxAmount: null, expiresAt: null }, now), { label: 'Studio agent', maxAmount: null, expiresAt: null });
  assert.throws(() => parseAgentSettings({ ...defaults, expiresAt: '2026-11-05T23:59:59Z' }, now), /future/);
  assert.throws(() => parseAgentSettings({ ...defaults, maxAmount: '-1' }, now), /positive/);
});
