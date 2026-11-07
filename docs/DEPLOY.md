# Deploy KoaSpend: Supabase → Render → Vercel

Use one Render backend, Supabase for durable encrypted workspace snapshots, and Vercel for the frontend/API gateway. No laptop, local automation server or tunnel is needed. Keep all payments on Stellar Testnet. The repository is public; host secrets belong only in dashboards.

## 1. Reserve the frontend URL

Import `Enerbonn/Allowance` into Vercel. Root directory: repository root. Framework: Vite, Node 24, install `npm ci`, build `npm run build`, output `dist` (already in `vercel.json`). Copy the final production HTTPS origin with no trailing slash. Initial API calls may fail until the backend is configured.

## 2. Create Supabase persistence

1. Create a Supabase project and save its database password privately.
2. Open Connect → Session pooler. Copy the entire PostgreSQL URI, substitute your database password, and percent-encode reserved password characters. Keep the pooler's host, username and port from the dashboard; do not invent them.
3. Download the root CA from Database Settings → SSL configuration. Keep the entire PEM text, including BEGIN and END lines, for `SUPABASE_CA_CERT`.
4. No public Supabase browser key, Auth integration or storage bucket is required. The backend creates `allowance_private.writer` and `allowance_private.files` automatically using the database login.

The current implementation encrypts/compresses SQLite databases and approved evidence/key files into Postgres snapshots. Use **one backend instance**, with a 64 MiB restored-data cap. This is a small-demo persistence design, not horizontally scalable relational storage. In Table Editor, select `allowance_private` to see snapshot metadata; account/chat rows are encrypted inside snapshots and are viewed through KoaSpend, not as Supabase Auth users.

## 3. Generate private deployment values

Run each command in a trusted local terminal. Store the outputs privately, not in GitHub:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Run it twice: one distinct value for `ALLOWANCE_PROXY_TOKEN`, another for `ALLOWANCE_OWNER_SETUP_TOKEN`. Then generate the encryption key:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Use the last value for `ALLOWANCE_STORAGE_KEY`. **Preserve this key across deployments** and back it up separately from the database. Replacing it cannot decrypt existing records. The owner setup token serves a legacy API; normal owner signup only asks for name, email and password.

## 4. Deploy the Render backend

1. Choose New → Web Service → connect the same GitHub repository, branch `main`, root directory blank, runtime **Docker**. Leave Docker command override blank. Health check: `/api/health`.
2. For a free demo, choose Free and use the Supabase configuration below. **Do not use the root `render.yaml` Blueprint for this free path:** that optional configuration creates a paid persistent disk service.
3. Set these backend environment variables:

| Name | Value |
| --- | --- |
| `ALLOWANCE_PUBLIC_ORIGIN` | Exact production Vercel HTTPS origin |
| `ALLOWANCE_PROXY_TOKEN` | Generated proxy token |
| `ALLOWANCE_OWNER_SETUP_TOKEN` | Different generated setup token |
| `ALLOWANCE_STORAGE_KEY` | Generated 32-byte base64 encryption key |
| `GEMINI_API_KEY` | Your own Google AI Studio key |
| `SUPABASE_DATABASE_URL` | Full private Session pooler URI |
| `SUPABASE_CA_CERT` | Full Supabase CA PEM; literal `\n` is also accepted |

Docker supplies `ALLOWANCE_DATA_DIR=/data`; Render supplies `PORT`. The server binds to `0.0.0.0` in hosted mode. Do not set `ALLOWANCE_DB` with Supabase persistence.

4. Deploy. Confirm `/api/health` responds with `ok: true` and `storage: supabase`. The root Render page is an API label, not the frontend.
5. If TLS fails, check the CA and exact pooler hostname. If authentication fails, verify the encoded database password. Never disable certificate verification to fix this.

Free Render can cold-start. Sleeping does not intentionally delete Supabase records; ephemeral local files alone are not durable. Supabase projects and Gemini have their own free-plan limits.

## 5. Connect Vercel to Render

In Vercel → Settings → Environment Variables → **Production**, set:

| Name | Value |
| --- | --- |
| `ALLOWANCE_BACKEND_URL` | Exact Render HTTPS service origin, no trailing slash |
| `ALLOWANCE_PUBLIC_ORIGIN` | Same Vercel production origin as Render |
| `ALLOWANCE_PROXY_TOKEN` | Same proxy token as Render |

Redeploy Vercel after changing variables. These are server-side gateway values. Never add `VITE_` or `NEXT_PUBLIC_` to secrets. Origin mismatch causes **Origin not allowed**; after renaming your domain, update the origin on **both** hosts and redeploy both. Preview deployment URLs are not automatically authorized.

## 6. Verify the hosted app

1. Open the production Vercel URL and `/api/health`; confirm Supabase persistence.
2. Sign up as a new owner, save the starter policy, add a member, create a project and assign a task. Issue the member code through Team.
3. Test Gemini in Connections. Complete [Testnet wallet/Noir/Velo setup](HACKATHON.md#wallet-and-testnet-tutorial-on-windows). For an existing wallet, follow the contract migration steps before funding.
4. Sign in as the member; submit an eligible request. Check that authorization, claim, receipt and dashboard agree. Test an uncertain request requiring owner review. Never infer payment success just from an approval.
5. Restart Render and verify the same account, policy and request remain. Existing local/tunnel records are not automatically imported into a fresh Supabase project.

GitHub pushes to the configured production branch trigger deployment only when auto-deploy is enabled in each host. A successful Git push is not proof that both deploys passed. Confirm their statuses and test the live URL after changes.

## Optional paid-disk path

`render.yaml` defines a Starter service with a 1 GB persistent disk. That path is paid and can run without Supabase. Supply the origin/proxy values, Gemini key, and a valid **32-byte base64** storage key; review generated values before deploying. Do not run two independently writing backends against one snapshot store.
