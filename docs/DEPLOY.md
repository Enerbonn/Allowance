# Deploy Allowance on Vercel and Render

Vercel serves the browser app and forwards its API calls to Render. Render runs one copy of the backend with a persistent disk for SQLite, evidence and encrypted Testnet keys. Each deployment contains one owner workspace. Start with fictional records and use Stellar Testnet for the on-chain demo.

## 1. Create the Vercel project

1. In Vercel, import your private Allowance GitHub repository. Use the repository root and Node.js 24. The checked-in vercel.json sets up the Vite build, output folder and API gateway.
2. Copy the permanent production origin from the project dashboard, such as https://your-allowance.vercel.app. Use the full HTTPS origin with no trailing slash. The frontend may show a connection error until Render and the gateway are configured.
3. Generate a random proxy token. On Windows, the following puts one in your clipboard without printing it.

   ~~~powershell
   node -p "require('node:crypto').randomBytes(32).toString('hex')" | Set-Clipboard
   ~~~

## 2. Create the Render backend

1. In Render, choose **New → Blueprint** and connect the same GitHub repository. Review the Starter web service and 1 GB disk defined in render.yaml. Render requires a paid service to attach a disk. The disk mounts at /data. [Render persistent disks](https://render.com/docs/disks)
2. Supply the two values prompted by the Blueprint.

   | Setting | Value |
   | --- | --- |
   | ALLOWANCE_PUBLIC_ORIGIN | The permanent Vercel HTTPS origin from step 1 |
   | ALLOWANCE_PROXY_TOKEN | The random token from your clipboard. Paste the same value in Vercel later |

   Render generates ALLOWANCE_OWNER_SETUP_TOKEN and ALLOWANCE_STORAGE_KEY. Keep both in Render. The setup token protects first signup. The storage key protects Testnet agent, demo merchant and Gas credentials on disk. Keep an encrypted backup of the disk and store the encryption key separately.
3. If you want the assistant online, set GEMINI_API_KEY in Render. A Relmio and n8n instance on your laptop is a separate local setup. A hosted n8n workflow is optional and needs an HTTPS webhook accessible from Render plus its own ALLOWANCE_N8N_TOKEN. [Assistant setup](AI-SETUP.md)
4. Wait until Render marks the service live. Open the service's /api/health endpoint and look for ok: true.

### If you created a Web Service manually

Select **Docker** for the runtime and leave the Docker command override blank. In **Environment**, set the same public origin and proxy token as above. Generate a separate `ALLOWANCE_OWNER_SETUP_TOKEN` using the hex command in step 1. Run this command once to copy a different key for `ALLOWANCE_STORAGE_KEY`:

~~~powershell
node -p "require('node:crypto').randomBytes(32).toString('base64')" | Set-Clipboard
~~~

Save and redeploy, then check `/api/health`. If Render reports a port scan timeout and detects a localhost listener, check `ALLOWANCE_PUBLIC_ORIGIN` first. The Docker image supplies `/data` and reads Render's `PORT` when hosted mode is configured. A Free Web Service uses temporary storage. Use a persistent deployment for funded Testnet escrow. On a Free Web Service, the wallet setup, protected local agent keys, and request records reset when Render spins down, restarts, or redeploys the service. [Free Web Service limits](https://render.com/docs/free#local-files-lost-on-redeploy)

## 3. Connect the gateway and create the owner

1. Set these variables in the Vercel project's **Production** environment, then redeploy the frontend.

   | Setting | Value |
   | --- | --- |
   | ALLOWANCE_BACKEND_URL | The HTTPS Render service origin, for example https://your-allowance-api.onrender.com |
   | ALLOWANCE_PUBLIC_ORIGIN | The exact same Vercel production origin used in Render |
   | ALLOWANCE_PROXY_TOKEN | The exact same proxy token stored in Render |

2. Open the Vercel production URL and choose **Business owner**. Enter your email, a private access code and the owner setup token from Render. After signup, only an authenticated owner can add staff and issue access codes.
3. Add a test member and issue a code. Connect a dedicated Stellar Testnet wallet, finish the payment setup, and verify one end-to-end Testnet purchase before the demo. If you enable the assistant, verify the connection from **Connections**. Follow the [wallet walkthrough](HACKATHON.md#wallet-and-testnet-tutorial-on-windows) for Testnet.

Use the production URL for this workspace. Preview URLs need a separate configured origin and backend if you want to test them with real sessions. Render's single service instance owns the disk. Back up the disk and test a restore before storing any team data you need to retain. The first deployment starts with a fresh workspace. Create fresh Testnet demo accounts there because Windows-protected keys belong to the original laptop.
