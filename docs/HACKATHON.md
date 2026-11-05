# Velo x Noir hackathon

This mapping uses the organizer’s announcement and contract list supplied in the registration form. Follow the organizer’s current instructions for registration, eligibility and submission. [Event listing](https://luma.com/gjclwpkd)

| Requirement from the organizer | How Allowance addresses it | Verification |
| --- | --- | --- |
| Build an agentic payment | The AI assesses a member’s request and proposes a purchase within owner-defined authority. The backend checks permission and budgets. The owner authorizes the Testnet action. | Owner/member conversations and simulation exercised locally. |
| Use Velo | The backend uses `@carts1024/velo-sdk` to request gas sponsorship and submit the signed Testnet transaction. | Implemented. A successful sponsored payment and claim still need end-to-end verification. |
| Interact with the specified Noir Testnet contracts | Register owner/device association, authorize a limited agent and use escrow for funding, payment authorization and merchant claim. | All three contract instances were verified present by read-only checks on 2026-11-05. Wallet setup and a complete payment remain pending. |

The organizer also directed participants to register their project on Velo and complete the separate registration form in addition to Luma. This repository is the project source. [Velo documentation](https://www.velo-build.dev/docs) · [Noir repository](https://github.com/noirx402/noir)

## Contract IDs used in the code

| Contract | Address supplied in the event form |
| --- | --- |
| `device_registry` | `CB4DPMGOA374JIB2ZVD4AHW5GJKQUYNOFGRYNOJ75EFH2KCJSMHOWIRA` |
| `agent_registry` | `CBTDMJVCFQDIVWZBKAKZ2FQ3UEJNAAUFYCTJ3E4ON2MYXPLPSIXQ25JZ` |
| `payment_escrow` | `CA5S4S7QGHJHJWVJBYL3CXZXZTNGKXMNZVDAEQNN7NUXFP4D7BYK7HIX` |

These override the installed SDK’s bundled defaults. Check the event’s current list before signing a transaction.

## Wallet and Testnet tutorial on Windows

The local demo works before wallet setup. Use these steps when you want to try the on-chain flow with test XLM. Use a desktop browser with Varial installed and run Allowance in that same browser.

### 1. Create and fund a Stellar Testnet wallet

1. Install **Varial**, previously called Freighter, from its official site. Open the extension and choose to create a wallet. Save the recovery phrase privately and complete the wallet’s confirmation. [Varial wallet](https://varialwallet.com/) · [Stellar’s rename announcement](https://stellar.org/blog/foundation-news/freighter-is-now-varial)
2. In the extension, open **Settings → Network** and set **Current Network** to **Test Net**. Return to your account and copy the public address beginning with `G`.
3. Open the Friendbot address below in a browser, substituting your public address. A successful response funds your account with test XLM. Check the token balance in the extension. The dollar total may still show zero because Testnet XLM has no cash value. [Stellar Testnet and Friendbot](https://developers.stellar.org/docs/networks#friendbot)

   ```text
   https://friendbot.stellar.org/?addr=YOUR_STELLAR_TESTNET_PUBLIC_ADDRESS
   ```

### 2. Register your Velo project and connect it to Allowance

1. Open [Velo Build](https://www.velo-build.dev/), connect the same wallet, create a project, then select **Register Project On-Chain**. Review and sign on Stellar Testnet. Copy the project ID from `/projects/<projectId>/...` in the project page URL.
2. In the Allowance repository, create the folder `.local` if needed. Inside it, create `testnet-project.json` with the two public values below.

   ```json
   {
     "owner": "YOUR_STELLAR_TESTNET_PUBLIC_ADDRESS",
     "projectId": "YOUR_VELO_PROJECT_ID"
   }
   ```

3. Open [Allowance](http://127.0.0.1:4310/) in the browser with Varial, sign in as `owner` and go to **Connections → Connect the payment path**. Refresh the page if you just saved the file. The expected wallet address should match Varial.
4. Click **Initialize demo accounts** to fund the local agent and merchant, then **Inspect contracts**. Click **Connect owner wallet** and approve the browser connection. The button changes to **Owner wallet connected**. Connecting the wallet grants address access. The setup operations below prompt for signatures separately.

If Velo reports **Account not found**, verify Friendbot funded the same public address and that Test Net is selected. If Allowance reports a different wallet, switch Varial to the account that registered the Velo project and reconnect. If a contract cannot be verified after a Testnet reset, check the organizer’s current contract list before continuing.

### 3. Try a payment

1. In Allowance, use **Register device**, **Authorize agent for 48 hours**, and **Review & sign deposit**, in that order. Review the operation and test amounts in your wallet before signing each one.
2. In Velo, configure **Gas Station** for your project with a funded Testnet relayer, sponsorship enabled and permissions for the Noir contracts. Create a scoped **Testnet Gas** key. From the repository folder in PowerShell, run `./Save-GasKey.ps1` and enter your key in its hidden prompt. The app stores it encrypted for your Windows user. [Velo Gas Station guide](https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/docs/velo-gas-station.md)
3. Back in Allowance, choose an approved supplier and select **Use dedicated demo merchant**. Sign in as a member and submit a **Stellar Testnet** request for that supplier and an assigned task. Sign back in as owner to review and authorize the request. Check **Connections** for the authorization and merchant-claim hashes.

Allowance marks the request paid after the merchant claim is confirmed. The on-chain flow still needs a successful end-to-end test. Use the local simulation for a demo you can run immediately.

## Blockchain tools and source

| Tool | What it does |
| --- | --- |
| [Varial](https://varialwallet.com/) and [Freighter API](https://github.com/stellar/freighter) | Connect the owner’s browser wallet and sign the prepared Testnet operations. |
| [Stellar JavaScript SDK](https://github.com/stellar/js-stellar-sdk) and [Stellar Testnet](https://developers.stellar.org/docs/networks) | Build, inspect and submit Stellar transactions, and read the test ledger. |
| [Friendbot](https://github.com/stellar/friendbot) | Funds the owner, agent and demo merchant with test XLM. |
| [Noir](https://github.com/noirx402/noir) and `@noirx402/agent-sdk` | Prepare operations for device registration, agent permissions and escrow. |
| [Velo](https://github.com/Velo-Ecosystem-Collection/Velo) and `@carts1024/velo-sdk` | Register the project and use Gas Station to sponsor and submit the Testnet authorization. |
