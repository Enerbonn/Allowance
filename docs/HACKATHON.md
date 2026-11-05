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

## Optional Testnet setup on Windows

1. Register your own Velo Testnet project and fund your own Stellar Testnet owner wallet. Create `.local/testnet-project.json` inside this repository with your **public** wallet address and your Velo project ID from the project URL:

   ```json
   {
     "owner": "YOUR_STELLAR_TESTNET_PUBLIC_ADDRESS",
     "projectId": "YOUR_VELO_PROJECT_ID"
   }
   ```

2. Configure the Gas Station relayer, sponsorship policy and contract permissions for that project. Run `./Save-GasKey.ps1` and enter your own scoped Testnet Gas key in its hidden prompt. The app stores the result with Windows user-bound encryption. [Velo Gas Station guide](https://github.com/Velo-Ecosystem-Collection/Velo/blob/main/docs/velo-gas-station.md)
3. In Allowance **Connections**, initialize the local agent/demo merchant, inspect the contracts and connect the registered owner wallet in the browser with the compatible wallet extension.
4. Review and sign device registration, bounded agent authorization and an escrow deposit. Bind an approved demo supplier to the demo merchant.
5. Submit a **Stellar Testnet** member request. The owner reviews and authorizes it. Capture authorization and merchant-claim transaction evidence and check the ledger against the app receipt.

The app records a Testnet request as paid after merchant claim confirmation. A simulation receipt shows the app workflow. Blockchain proof requires the on-chain authorization and claim.
