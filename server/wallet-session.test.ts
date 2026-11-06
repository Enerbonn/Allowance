import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreWalletSession, TESTNET } from '../src/wallet-session';

const owner = 'saved-owner';
const testnet = { networkPassphrase: TESTNET };

test('restores a previously authorized Testnet wallet without requesting access', async () => {
  for (const productId of ['varial', 'cactuslink', 'dcent', 'scopuly']) {
    assert.equal(await restoreWalletSession(owner, async () => ({
      productId,
      getAddress: async options => {
        assert.deepEqual(options, { skipRequestAccess: true });
        return { address: owner };
      },
      getNetwork: async () => testnet,
    })), owner);
  }
});

test('a different wallet, wrong network, or unavailable extension cannot restore', async () => {
  const module = {
    productId: 'varial',
    getAddress: async () => ({ address: owner }),
    getNetwork: async () => testnet,
  };
  assert.equal(await restoreWalletSession(owner, async () => ({
    ...module, getAddress: async () => ({ address: 'different-account' }),
  })), '');
  assert.equal(await restoreWalletSession(owner, async () => ({
    ...module, getNetwork: async () => ({ networkPassphrase: 'Public Global Stellar Network ; September 2015' }),
  })), '');
  assert.equal(await restoreWalletSession(owner, async () => ({
    ...module, getAddress: async () => { throw new Error('Locked'); },
  })), '');
  assert.equal(await restoreWalletSession(owner, async () => { throw new Error('No selected wallet'); }), '');
});

test('a disconnected workspace or unsupported wallet never checks extension access', async () => {
  const getModule = async () => ({
    productId: 'hardware-wallet',
    getAddress: async () => ({ address: owner }),
    getNetwork: async () => testnet,
  });
  let moduleReads = 0;
  assert.equal(await restoreWalletSession('', async () => { moduleReads++; return getModule(); }), '');
  assert.equal(moduleReads, 0);

  let extensionReads = 0;
  assert.equal(await restoreWalletSession(owner, async () => ({
    ...await getModule(),
    getAddress: async () => { extensionReads++; return { address: owner }; },
  })), '');
  assert.equal(extensionReads, 0);
});
