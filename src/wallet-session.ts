export const TESTNET = 'Test SDF Network ; September 2015';

// These adapters support checking a previously granted connection without prompting.
const silentWallets = new Set(['varial', 'cactuslink', 'dcent', 'scopuly']);

type WalletModule = {
  productId: string;
  getAddress(options: { skipRequestAccess: boolean }): Promise<{ address: string }>;
  getNetwork(): Promise<{ networkPassphrase: string }>;
};

export async function restoreWalletSession(owner: string, getModule: () => Promise<WalletModule>): Promise<string> {
  if (!owner) return '';

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const check = async () => {
    const module = await getModule();
    if (!silentWallets.has(module.productId)) return '';
    const { address } = await module.getAddress({ skipRequestAccess: true });
    if (address !== owner) return '';
    const { networkPassphrase } = await module.getNetwork();
    return networkPassphrase === TESTNET ? address : '';
  };
  try {
    return await Promise.race([
      check(),
      new Promise<string>(resolve => { timeout = setTimeout(() => resolve(''), 2_000); }),
    ]);
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}
