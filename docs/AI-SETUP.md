# Set up AI locally

You can run the owner/member demo with local simulation first. Set up AI when you want the assistant to draft profiles, suggest rules, summarize requests or help a member prepare a purchase.

1. Start Docker Desktop and run an n8n instance you control. Follow Relmio’s local instructions for **ChatGPT plan use from local or self-hosted n8n**. Select that n8n Docker network, authorize your own eligible account, and launch its private sidecar. Relmio provides a local bearer for n8n. [Relmio setup](https://relmio.jpfusin.tech/docs/getting-started) · [Docker and n8n guide](https://relmio.jpfusin.tech/docs/vps-and-n8n)
2. In your n8n editor, import [allowance-review.json](../n8n/allowance-review.json). The template includes the six workflow nodes and their wiring.
3. Create or choose your own **OpenAI** credential in n8n. Enter your Relmio bearer in the credential’s API key field. Select that credential in **Relmio model catalog** and **ChatGPT review through Relmio**. Their default URLs use the private Docker hostname `n8n-openai-oauth` and port `10531`. If Relmio shows a different internal URL, update both nodes to use that base URL with `/models` and `/chat/completions` respectively. [Relmio local endpoints](https://relmio.jpfusin.tech/docs/local-endpoints)
4. From the repository directory, generate a fresh webhook token locally:

   ```powershell
   node -e "const fs=require('node:fs');fs.mkdirSync('.local',{recursive:true});fs.writeFileSync('.local/n8n-token.bin',require('node:crypto').randomBytes(32).toString('hex'),{flag:'wx'})"
   Get-Content .local/n8n-token.bin -Raw | Set-Clipboard
   ```

   Use the existing token file if generation reports it already exists. In the **Purchase request** webhook node, select **Header Auth**, create a credential with header name `x-allowance-token`, and paste the locally generated value. The app reads that file automatically. Alternatively, set the same value in the app process’s `ALLOWANCE_N8N_TOKEN` environment variable.
5. Publish the workflow and copy its **production** webhook URL. The default app setting targets port 5679. If your n8n uses a different port or path, set the URL in the same PowerShell window that starts the app:

   ```powershell
   $env:N8N_REVIEW_URL = 'http://127.0.0.1:5678/webhook/allowance-review-v1'
   npm start
   ```

   Restart any already-running app process before changing its environment. Use the n8n port shown on your machine.
6. Sign in to Allowance as owner and open **Connections → Test connection**. Then try **Spend assistant**. If the test fails, check the webhook URL and token, the two model credentials and whether n8n can reach the Relmio container on their private Docker network. [Relmio troubleshooting](https://relmio.jpfusin.tech/docs/troubleshooting)

The webhook token authenticates calls from Allowance to n8n. The Relmio bearer authenticates calls from n8n to the AI gateway. The Velo Gas key belongs to the separate payment path. Enter each value only in the service that uses it. Team member codes stay in the app’s sign-in flow.

The gateway and workflow run locally. ChatGPT inference runs online through the account you authorize. A colleague needs their own Relmio setup and credentials to reproduce this path. The import comes without credential references or execution history.

The standing owner/member instructions live in [agent-instructions.md](../server/agent-instructions.md). **Prepare review** builds the request sent to the model. The backend assembles the scoped context and validates the returned drafts or proposals. Chat and reviewed memory live in the local SQLite database.
