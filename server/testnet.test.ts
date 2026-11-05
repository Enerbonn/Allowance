import test from 'node:test';
import assert from 'node:assert/strict';
import {Account,Asset,Keypair,Networks,Operation,TransactionBuilder} from '@stellar/stellar-sdk';
import {validateOwnerSetupSignature,EVENT_CONTRACTS} from './testnet.ts';

test('owner setup signatures bind the exact prepared transaction and Testnet',()=>{
 const owner=Keypair.random(),recipient=Keypair.random();
 const build=(amount:string,networkPassphrase=Networks.TESTNET)=>new TransactionBuilder(new Account(owner.publicKey(),'1'),{fee:'100',networkPassphrase}).addOperation(Operation.payment({destination:recipient.publicKey(),asset:Asset.native(),amount})).setTimeout(120).build();
 const expected=build('1');const hash=expected.hash().toString('hex');assert.throws(()=>validateOwnerSetupSignature(expected.toXDR(),hash,owner.publicKey()),/does not match/);expected.sign(owner);assert.equal(validateOwnerSetupSignature(expected.toXDR(),hash,owner.publicKey()).source,owner.publicKey());
 const altered=build('2');altered.sign(owner);assert.throws(()=>validateOwnerSetupSignature(altered.toXDR(),hash,owner.publicKey()),/does not match/);
 const mainnet=build('1',Networks.PUBLIC);mainnet.sign(owner);assert.throws(()=>validateOwnerSetupSignature(mainnet.toXDR(),hash,owner.publicKey()),/does not match/);
 assert.equal(EVENT_CONTRACTS.deviceRegistry,'CB4DPMGOA374JIB2ZVD4AHW5GJKQUYNOFGRYNOJ75EFH2KCJSMHOWIRA');
});
