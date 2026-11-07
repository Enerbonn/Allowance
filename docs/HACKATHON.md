# Hackathon integration and Testnet setup

The [builder handbook updated Nov 7](https://docs.google.com/document/d/1FQWX8ICFFuuJHF-2JcQBoLOWOj8aXKEZ7rhQvQv5DK0/edit) is the submission reference. It requires an agentic payment through the Noir SDK on its deployed contracts, use of Velo SDK, Testnet only, a public workspace monorepo, a live website, two-minute video, public pitch deck and registered team identities.

## Current Testnet contracts

Main now uses these Nov 7 handbook addresses, matching the installed Noir SDK defaults:

| Contract | Address |
| --- | --- |
| device_registry | `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5` |
| agent_registry | `CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV` |
| payment_escrow | `CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS` |

## Existing wallets after the update

`stable3` preserves the earlier app at commit `e359837`. The historical video and original receipt use the earlier registration-form deployment. New payments on main use the addresses above.

1. Finish checking any pending earlier payment. It retains its original contract deployment and budget reservation; do not submit another payment to replace an uncertain one.
2. Open Connections with your owner wallet on Testnet. Refresh the Noir setup. The app discards earlier cached balances/permissions from its current progress display; it does not erase their historical records.
3. Use Create/check test payment accounts if needed. Existing protected agent/merchant keys are retained. Register the owner/device on the new contracts, review and sign the agent permission, and deposit new test XLM. Existing escrow funds and authority do not transfer.
4. In your Velo project, add the **new payment escrow address** above to Verify → Contracts and the Gas Station sponsorship allowlist. Keep sponsorship enabled and the relayer funded. The existing project-scoped Testnet Gas key can remain if valid.
5. Refresh Connections and submit a small eligible member request. Confirm the new authorization, recipient claim and dashboard receipt. Old setup signatures prepared before the deployment update are rejected; prepare/sign again.

Earlier contract addresses remain in `LEGACY_CONTRACTS` only for existing payment recovery and historical comparison. Do not register/fund new payments against them. Funds already on an earlier escrow stay there; returning those funds requires owner-signed operations on that earlier deployment, outside the current setup UI. Never run two writing backend versions against the same Supabase snapshot store.

The root README links the implementation and proof. Device registry establishes ownership; agent registry constrains authority; escrow holds funds and records authorization/claim. Velo sponsors/submits payments and supplies recovery status. This build does not use checkout webhooks.

## Wallet and Testnet tutorial on Windows

The local demo works before wallet setup. Use these steps when you want to try the on-chain flow with test XLM. Use a desktop browser with a wallet that supports Stellar Testnet signing. The example uses Varial.

### 1. Create and fund a Stellar Testnet wallet

1. Install **Varial**, previously called Freighter, from its official site. Open the extension and choose to create a wallet. Save the recovery phrase privately and complete the wallet’s confirmation. [Varial wallet](https://varialwallet.com/) · [Stellar’s rename announcement](https://stellar.org/blog/foundation-news/freighter-is-now-varial)
2. In the extension, open **Settings → Network** and set **Current Network** to **Test Net**. Return to your account and copy the public address beginning with `G`.
3. Open the Friendbot address below in a browser, substituting your public address. A successful response funds your account with test XLM. Check the token balance in the extension. The dollar total may still show zero because Testnet XLM has no cash value. [Stellar Testnet and Friendbot](https://developers.stellar.org/docs/networks#friendbot)

   ```text
   https://friendbot.stellar.org/?addr=YOUR_STELLAR_TESTNET_PUBLIC_ADDRESS
   ```

### 2. Connect your wallet in KoaSpend

1. Open [KoaSpend](http://127.0.0.1:4310/) in the browser with your wallet, choose **Business owner** and sign in and open **Connections → Connect the payment path → Connect owner wallet**.
2. Choose your provider from the Stellar Wallets Kit picker and approve the connection in your wallet. KoaSpend remembers the selected public account. Use **Saved wallet** to switch between previously added accounts. Use **Connect or add wallet** to add another or reconnect the selected account before signing. Each keeps its own Noir setup and Velo project. An unresolved Testnet payment must be reconciled before switching or disconnecting.
3. Click **Initialize demo accounts** and **Inspect contracts**. Then use **Register device**, **Review and sign authorization**, and **Review and sign deposit**, in that order. Review each Testnet signature in your wallet. To change an existing authorization, sign its revocation before signing the replacement. After funding, **Manage Noir escrow** shows the last checked balance and lets you review and sign a withdrawal back to the registered owner wallet.

### 3. Link Velo and try a payment

1. In [Velo Build](https://www.velo-build.dev/), create a project with the same wallet and select **Register Project On-Chain**. Sign on Stellar Testnet. Copy a Velo project page URL containing `/projects/<projectId>/` and paste it into **Velo project URL or ID** in KoaSpend. Click **Save project**.
2. Configure **Gas Station** for that project with a funded Testnet relayer, sponsorship enabled and permissions for the Noir contracts. Create a scoped **Testnet Gas** key, enter it in KoaSpend’s password field and click **Save Gas key**. KoaSpend stores it encrypted on the backend. [Velo Gas Station guide](https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/docs/velo-gas-station.md)
3. Choose an approved supplier and select **Use dedicated demo merchant**. Sign in as a member and submit a **Stellar Testnet** request for that supplier and an assigned task. Eligible requests can proceed automatically when enabled; uncertain requests go to the owner for review. Check **Connections** for the authorization and merchant-claim hashes.

If Velo reports **Account not found**, verify Friendbot funded the same public address and that Testnet is selected. If a contract cannot be verified after a Testnet reset, check the organizer’s current contract list before continuing.

KoaSpend marks the request paid after the merchant claim is confirmed. A recorded successful claim is linked in the root README. Repeat the full flow after any contract migration or Testnet reset.

## Blockchain tools and source

| Tool | What it does |
| --- | --- |
| [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit) and [Varial](https://varialwallet.com/) | Connect the owner’s browser wallet and sign the prepared Testnet operations. |
| [Stellar JavaScript SDK](https://github.com/stellar/js-stellar-sdk) and [Stellar Testnet](https://developers.stellar.org/docs/networks) | Build, inspect and submit Stellar transactions, and read the test ledger. |
| [Friendbot](https://github.com/stellar/friendbot) | Funds the owner, agent and demo merchant with test XLM. |
| [Noir](https://github.com/noirx402/noir) and `@noirx402/agent-sdk` | Prepare operations for device registration, agent permissions and escrow. |
| [Velo](https://github.com/Velo-Ecosystem-Collection/Velo) and `@carts1024/velo-sdk` | Register the project and use Gas Station to sponsor and submit the Testnet authorization. |
