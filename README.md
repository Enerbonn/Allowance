# Allowance

An owner sets a budget, assigns work and defines which expenses are eligible. A team member signs in with an owner-issued code, describes a purchase and submits it for review. AI helps with the explanation and draft. The backend enforces identity, assignments, suppliers and budgets and records the decision.

**Current demo** supports owner and member accounts, rules, requests, manual or AI-assisted review and local payment simulation. The Stellar Testnet integration has passed read-only contract checks. A complete authorization and merchant claim still needs an end-to-end test.

## Run on your laptop

Install Git and **Node.js 24.22.1**. This is the tested Node version for the locked dependencies. Check with `node -v`.

```powershell
git clone https://github.com/Enerbonn/Allowance.git
cd Allowance
npm ci
npm test
npm run build
npm start
```

Open [Allowance on port 4310](http://127.0.0.1:4310/). On Windows, after the first build you can double-click [START.cmd](START.cmd) instead of running `npm start`. Use it again after a reboot. Run `npm run dev` while editing source. The launcher starts the app. Start Docker and your n8n/Relmio containers separately when you want AI.

### Try both roles

1. Create the owner profile and private access code. The login ID for this role is **`owner`**. The name you enter is a display name.
2. Open **Team**. Try the sample member Maya Chen, or create a new member and assign a task in **Projects**. Edit their role, responsibilities, categories and allowance. Select **Issue code** and privately copy both the member ID and the code shown once.
3. Sign out and sign in with the member credentials. Request a business purchase for an assigned task. Try a 25 XLM font license from the sample supplier Type Foundry for the Northstar brand identity. Choose **Local simulation**. A sample quote link such as `https://typefoundry.example/quote/font25` is suitable for the demo.
4. Sign in as owner, open the request and review the checks. If eligible, approve it with a decision note and inspect the simulated receipt and updated balance. Try a purchase beyond the allowance to see a policy block.

Member budgets are lifetime totals across projects. Zero blocks spending while keeping chat access. Clearing the member limit returns to the project limits. Without AI, the request form still works and the owner can review eligible requests manually.

## Tech stack and code map

| Layer | Stack | Entry point |
| --- | --- | --- |
| Browser | React, TypeScript/TSX, CSS, Vite | [src/App.tsx](src/App.tsx), [src/Workspace.tsx](src/Workspace.tsx) |
| Server | Node.js, Express, TypeScript, Zod | [server/index.ts](server/index.ts), [server/app.ts](server/app.ts) |
| Access and AI context | scrypt, server sessions, Markdown instructions | [server/workspace.ts](server/workspace.ts), [server/agent-instructions.md](server/agent-instructions.md) |
| Persistence and checks | SQLite, SQL, integer XLM amounts | [server/store.ts](server/store.ts), [server/domain.ts](server/domain.ts) |
| AI | Docker, n8n, Relmio, ChatGPT | [Importable n8n workflow](n8n/allowance-review.json), [AI setup guide](docs/AI-SETUP.md) |
| Testnet | Freighter-compatible wallet API, Stellar SDK, Noir Agent SDK, Velo SDK | [src/Testnet.tsx](src/Testnet.tsx), [server/testnet.ts](server/testnet.ts) |

```mermaid
flowchart TD
    U[Owner or team member] --> B[React UI]
    B --> A[Express API verifies identity and permissions]
    A <--> S[(Local SQLite)]
    A --> N[n8n webhook]
    N --> R[Private Relmio gateway]
    R --> M[ChatGPT inference]
    M -. structured reply .-> R
    R -. JSON .-> N
    N -. draft or recommendation .-> A
    A --> P{Independent spending checks}
    P -- blocked or unclear --> O[Block or owner review]
    P -- eligible demo --> D[Simulated receipt]
    P -- owner-approved Testnet --> V[Velo Gas sponsorship and submission]
    V --> E[Noir escrow authorization on Stellar Testnet]
    E --> C[Merchant claim and confirmation]
```

The backend selects records for the authenticated role and sends relevant history and reviewed memory notes to the workflow. Suggestions wait for a user action before changing a profile, policy or memory. The owner can ask for status updates. Members receive context for their assigned work. Purchase evidence files are available for human review. The AI sees metadata about whether evidence was supplied.

Before spending, the backend checks membership, assignment, supplier, category, evidence and available budgets. It uses **integer stroops** for exact amounts, **SQLite transactions** for competing approvals, and **idempotency keys** to prevent duplicate requests. Uncertain Testnet outcomes keep a reservation for reconciliation.

## AI credentials and APIs

An API is how services communicate. Our app calls an **n8n webhook**, n8n calls **Relmio’s local OpenAI-compatible API**, and Relmio uses the account holder’s authorized ChatGPT connection for inference. Follow the linked setup guide and create your own n8n credential with Relmio’s local bearer. The Relmio route uses that bearer instead of a separate OpenAI Platform API key. [Official Relmio local setup](https://relmio.jpfusin.tech/docs/getting-started) · [Setup for this repository](docs/AI-SETUP.md)

The project uses these configuration names. Each machine supplies its own values.

| Name | Purpose |
| --- | --- |
| `N8N_REVIEW_URL` | n8n production webhook URL. Defaults to `http://127.0.0.1:5679/webhook/allowance-review-v1` |
| `ALLOWANCE_N8N_TOKEN` | Shared header token for the app-to-n8n webhook. The app can also read its local token file |
| `RELMIO_BEARER` | Documentation label for your own bearer entered into the n8n OpenAI credential |
| `VELO_GAS_API_KEY` | Documentation label for the Testnet Gas key entered through `Save-GasKey.ps1` on Windows |

The app saves local records in `.local/allowance.sqlite`. The Git ignore rules cover `.local/`, private configuration, encrypted keys, build output and installed packages. Each clone starts with its own database. Keep the server bound to localhost for this demo.

## Hackathon fit

The organizer’s supplied brief asks for an agentic payment built with Velo and interacting with the current Noir Testnet contracts. Allowance uses owner-defined authority, agent-assisted requests and an independently enforced payment policy. See [the rule-by-rule mapping, contract IDs and remaining Testnet proof](docs/HACKATHON.md).
