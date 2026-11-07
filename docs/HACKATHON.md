# Hackathon integration and Testnet setup

The [builder handbook updated Nov 7](https://docs.google.com/document/d/1FQWX8ICFFuuJHF-2JcQBoLOWOj8aXKEZ7rhQvQv5DK0/edit) is the submission reference. It requires an agentic payment through the Noir SDK on its deployed contracts, use of Velo SDK, Testnet only, a public workspace monorepo, a live website, two-minute video, public pitch deck and registered team identities.

## Important contract mismatch

The build and recorded demo use these **earlier registration-form** IDs, explicitly configured at [server/testnet.ts:13](../server/testnet.ts#L13):

| Contract | Recorded demo / current code |
| --- | --- |
| device_registry | `CB4DPMGOA374JIB2ZVD4AHW5GJKQUYNOFGRYNOJ75EFH2KCJSMHOWIRA` |
| agent_registry | `CBTDMJVCFQDIVWZBKAKZ2FQ3UEJNAAUFYCTJ3E4ON2MYXPLPSIXQ25JZ` |
| payment_escrow | `CA5S4S7QGHJHJWVJBYL3CXZXZTNGKXMNZVDAEQNN7NUXFP4D7BYK7HIX` |

The newer handbook requires:

| Contract | Nov 7 handbook deployment |
| --- | --- |
| device_registry | `CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5` |
| agent_registry | `CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV` |
| payment_escrow | `CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS` |

**Do not claim updated-contract compliance from the earlier receipt.** Confirm the applicable IDs with the organizer. Migrating requires checking SDK compatibility, registering/authorizing/funding against the new contracts, updating Velo's allowlist, and obtaining fresh authorization/claim proof. Existing escrow and authority are not transferred by changing an address in source. This documentation pass preserves the working payment configuration.

The root README links the real Noir/Velo code paths, historical proof and limitations. Device registry establishes ownership; agent registry constrains authority; escrow holds funds and records authorization/claim. Velo sponsors/submits the payment and provides recovery status. This build does not use Velo checkout webhooks.

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
