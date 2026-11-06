# Allowance

An owner sets a budget, assigns work and defines which expenses are eligible. A team member signs in with an owner-issued code, describes a purchase and submits it for review. AI helps with the explanation and draft. The backend enforces identity, assignments, suppliers and budgets and records the decision.

**Current demo** supports owner and member accounts, rules, requests, manual or AI-assisted review and local payment simulation. The Stellar Testnet integration has passed read-only contract checks. A complete authorization and merchant claim still needs an end-to-end test.

## Run on your laptop

Ask the repository owner for access to this private repo. Install [Git](https://git-scm.com/downloads) and [Node.js 24.22.1](https://nodejs.org/en/download), the tested Node version. Run these commands in a terminal:

```powershell
git clone https://github.com/Enerbonn/Allowance.git
cd Allowance
npm ci
npm run build
npm start
```

Open [Allowance on port 4310](http://127.0.0.1:4310/). On Windows, after the first build you can double-click [START.cmd](START.cmd) instead of running `npm start`. Use it again after a reboot. Run `npm run dev` while editing source. To check your installation, run `npm test`.

### Choose how to try it

| I want to… | What I need |
| --- | --- |
| Try the owner and member workflow | **Start here.** Run the commands above, then follow the demo below. No API key, Docker, or wallet needed. |
| Chat with the assistant | Create a Gemini API key, add it to `.env.local`, restart and test the connection. [Gemini quick setup](docs/AI-SETUP.md#option-1-use-gemini-directly) |
| Reproduce the original ChatGPT workflow | Use your own n8n instance and Relmio connection. [Relmio and n8n setup](docs/AI-SETUP.md#option-2-use-chatgpt-through-relmio-and-n8n) |
| Connect a wallet and try Stellar Testnet | Create and fund a test wallet, connect it in Allowance and link a registered Velo project when ready to pay. [Wallet and Testnet tutorial](docs/HACKATHON.md#wallet-and-testnet-tutorial-on-windows) |

### Try both roles

1. Choose **Business owner**. At **Set up owner access**, enter your name and create a private code of at least eight characters. Choose **Business owner** and enter your code when you return. A fresh workspace starts with no sample records.
2. In **Team**, select **Add member**. Use **Ask AI** on that profile if you want help drafting responsibilities and spending limits. Review suggestions before applying them.
3. In **Projects**, create a project with a budget, then assign a task to the member. In **Spending policy**, add an approved supplier and review the spending limits and evidence rules.
4. Back in **Team**, select **Issue code** for the member and save the member ID and private code shown once. Open your account menu and sign out, then choose **Team member** and sign in with their ID and code.
5. Make a request for the assigned task and approved supplier. Choose **Local simulation**. Return as owner, review the checks, and approve an eligible request with a decision note. Open the simulated receipt and check the remaining project balance.

For a prefilled demo, stop the current server and start a separate database from PowerShell. These settings apply to that terminal:

```powershell
$env:ALLOWANCE_DB = '.local/allowance-sample.sqlite'
$env:ALLOWANCE_SAMPLE_DATA = '1'
npm start
```

Close that terminal when you finish the sample demo. Start from a new terminal or use `START.cmd` to return to the default workspace.

Member budgets are lifetime totals across projects. Zero blocks spending while keeping chat access. Clearing the member limit returns to the project limits. Without AI, the request form still works and the owner can review eligible requests manually.

## Tech stack and code map

| Layer | Stack | Entry point |
| --- | --- | --- |
| Browser | React, TypeScript/TSX, CSS, Vite | [src/App.tsx](src/App.tsx), [src/Workspace.tsx](src/Workspace.tsx) |
| Server | Node.js, Express, TypeScript, Zod | [server/index.ts](server/index.ts), [server/app.ts](server/app.ts) |
| Access and AI context | scrypt, server sessions, Markdown instructions | [server/workspace.ts](server/workspace.ts), [server/agent-instructions.md](server/agent-instructions.md) |
| Persistence and checks | SQLite, SQL, integer XLM amounts | [server/store.ts](server/store.ts), [server/domain.ts](server/domain.ts) |
| AI | Gemini API directly, or ChatGPT through n8n and Relmio | [Importable n8n workflow](n8n/allowance-review.json), [AI setup guide](docs/AI-SETUP.md) |
| Testnet | Stellar Wallets Kit, Stellar SDK, Noir Agent SDK, Velo SDK | [src/Testnet.tsx](src/Testnet.tsx), [server/testnet.ts](server/testnet.ts) |

```mermaid
flowchart TD
    U[Owner or team member] --> B[React UI]
    B --> A[Express API verifies identity and permissions]
    A <--> S[(Local SQLite)]
    A <-->|Optional AI| G[Gemini API]
    A -->|Optional original workflow| N[n8n webhook]
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

An API lets the backend send a request to an AI service and receive a structured response. Gemini uses your own Google AI Studio API key. The original route sends a webhook to n8n, which calls Relmio’s local API using a bearer from the Relmio setup. Relmio connects to your authorized ChatGPT account. [AI setup guide](docs/AI-SETUP.md) · [Relmio on GitHub](https://github.com/Demonbane18/relmio)

The project uses these configuration names. Each machine supplies its own values.

| Name | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Your Google AI Studio key. Setting it selects Gemini at startup |
| `GEMINI_MODEL` | Optional model override. Defaults to `gemini-3.1-flash-lite` |
| `N8N_REVIEW_URL` | n8n production webhook URL. Defaults to `http://127.0.0.1:5679/webhook/allowance-review-v1` |
| `ALLOWANCE_N8N_TOKEN` | Shared header token for the app-to-n8n webhook. The app can also read its local token file |
| `RELMIO_BEARER` | Documentation label for your own bearer entered into the n8n OpenAI credential |
| `VELO_GAS_API_KEY` | Documentation label for the Testnet Gas key entered through `Save-GasKey.ps1` on Windows |

The app saves local records in `.local/allowance.sqlite`. The Git ignore rules cover `.local/`, private configuration, encrypted keys, build output and installed packages. Each clone starts with its own database. Keep the server bound to localhost for this demo.

## Hackathon fit

The organizer’s supplied brief asks for an agentic payment built with Velo and interacting with the current Noir Testnet contracts. Allowance uses owner-defined authority, agent-assisted requests and an independently enforced payment policy. See [the rule-by-rule mapping, contract IDs and remaining Testnet proof](docs/HACKATHON.md).
