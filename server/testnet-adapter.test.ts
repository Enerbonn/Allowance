import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { validateTestnetConfig } from './testnet-adapter.ts';

test('disconnected Testnet adapter refuses unconfirmed contracts and non-Testnet keys', () => {
  const agent = Keypair.random(), merchant = Keypair.random();
  const config = { gasApiKey: 'tg_test_' + 'a'.repeat(32), agentSecret: agent.secret(), allowedMerchants: [merchant.publicKey()], contractsConfirmed: true };
  assert.doesNotThrow(() => validateTestnetConfig(config));
  assert.throws(() => validateTestnetConfig({ ...config, contractsConfirmed: false }), /Confirm/);
  assert.throws(() => validateTestnetConfig({ ...config, gasApiKey: 'pk_production' }), /Testnet/);
  assert.throws(() => validateTestnetConfig({ ...config, allowedMerchants: [] }), /merchant/);
});
