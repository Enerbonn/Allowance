/** Disconnected from the demo payment endpoint. No private keys are accepted by the web UI. */
import { NoirAgentClient, TESTNET } from '@noirx402/agent-sdk';
import { Velo, VeloGasSubmissionUnknownError, type GasExecutionIdentity } from '@carts1024/velo-sdk';
import { EVENT_CONTRACTS } from './testnet.ts';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

export type TestnetConfig = { gasApiKey: string; agentSecret: string; allowedMerchants: string[]; contractsConfirmed: boolean };
export function validateTestnetConfig(c: TestnetConfig) {
  if (!c.contractsConfirmed) throw new Error('Confirm the current Noir Testnet deployment with the organizer first.');
  if (!/^tg_test_[a-f0-9]{32}$/.test(c.gasApiKey)) throw new Error('A Gas-scoped Testnet API key is required.');
  if (!c.allowedMerchants.length) throw new Error('At least one verified merchant is required.');
  if (TESTNET.networkPassphrase !== Networks.TESTNET) throw new Error('Mainnet is not supported by this adapter.');
  Keypair.fromSecret(c.agentSecret);
  for (const address of c.allowedMerchants) Keypair.fromPublicKey(address);
}

export class TestnetAdapter {
  private noir: NoirAgentClient;
  private velo: Velo;
  private signer: Keypair;
  constructor(private config: TestnetConfig) {
    validateTestnetConfig(config);
    this.signer = Keypair.fromSecret(config.agentSecret);
    this.noir = new NoirAgentClient({ network: {...TESTNET,contracts:EVENT_CONTRACTS} });
    this.velo = new Velo({ apiKey: config.gasApiKey, baseUrl: 'https://www.velo-build.dev', environment: 'testnet', timeoutMs: 30000 });
  }
  contracts() { return { ...this.noir.contracts }; }
  async preflight(deviceHash: string, asset: string, amount: bigint) {
    if (!/^[a-f0-9]{64}$/i.test(deviceHash)) throw new Error('Invalid Noir device hash.');
    const owner = await this.noir.getDeviceOwner(deviceHash);
    if (!owner) throw new Error('Register and confirm device ownership before funding or spending.');
    return this.noir.checkPayment({ deviceHash, agent: this.signer.publicKey(), asset, amount });
  }
  async authorize(input: { deviceHash: string; merchant: string; asset: string; amount: bigint; nonce: bigint; operationId: string }, persistRecovery: (identity: GasExecutionIdentity) => Promise<void>) {
    if (!this.config.allowedMerchants.includes(input.merchant)) throw new Error('Merchant is not approved.');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(input.operationId) || input.nonce < 1n) throw new Error('A durable operation ID and monotonic nonce are required.');
    const check = await this.preflight(input.deviceHash, input.asset, input.amount);
    if (!check.ok) throw new Error(`Noir refused this payment: ${check.reason}`);
    const unsigned = await this.noir.prepare(this.signer.publicKey(), { kind: 'authorize', deviceHash: input.deviceHash, merchant: input.merchant, asset: input.asset, amount: input.amount, nonce: input.nonce });
    const transaction = TransactionBuilder.fromXDR(unsigned, Networks.TESTNET);
    if (!('source' in transaction) || transaction.source !== this.signer.publicKey() || transaction.operations.length !== 1 || transaction.operations[0].type !== 'invokeHostFunction') throw new Error('Unexpected transaction shape.');
    transaction.sign(this.signer);
    try {
      const result = await this.velo.gas.sponsorAndSubmit(transaction.toXDR(), { idempotencyKey: `allowance:${input.operationId}`, correlationId: input.operationId });
      await persistRecovery({ requestId: result.requestId, transactionHash: result.transactionHash });
      return result;
    } catch (error) {
      if (error instanceof VeloGasSubmissionUnknownError) { await persistRecovery(error.recovery); return this.velo.gas.getStatus(error.recovery); }
      throw error;
    }
  }
  recover(identity: GasExecutionIdentity) { return this.velo.gas.getStatus(identity); }
}

// An integration must reserve the business allowance BEFORE invoking this adapter,
// serialize agent-account writes, persist safe recovery identity, and reconcile it
// after timeouts. Merchant claim remains a separate merchant-signed operation.
// This module is type-checked and its configuration guards are tested; no complete
// browser/Velo flow through this adapter is implied by the SDK-only migration probe.
