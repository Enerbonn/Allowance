# Set up AI locally

You can run the owner/member demo with local simulation first. Set up AI when you want the assistant to draft profiles, suggest rules, summarize requests or help a member prepare a purchase.

## Use Gemini directly

1. Run Allowance once using the [quick start](../README.md#run-on-your-laptop).
2. Sign in to Google AI Studio and create your own Gemini API key. Check that your project has access to the free tier for Gemini 3.1 Flash-Lite. Availability and quotas depend on your account and region. [Create an API key](https://aistudio.google.com/api-keys) · [Google pricing and free-tier details](https://ai.google.dev/gemini-api/docs/pricing)
3. In your code editor, create a file called **`.env.local`** beside `package.json`. Add the following line, replacing the placeholder with your key. On Windows, check that the filename did not get a `.txt` suffix.

   ```dotenv
   GEMINI_API_KEY=YOUR_OWN_GEMINI_API_KEY
   ```

4. Stop Allowance with Ctrl+C in its terminal, or use `./Stop.ps1` if you started it with the Windows launcher. Start it again with `npm start` or [START.cmd](../START.cmd).
5. Sign in as owner and open **Connections → Test connection**. The card should say **Google Gemini** and show a verified response. Open **Spend assistant** to try it.

Gemini receives the conversation and relevant workspace context over the internet. Use fictional records for a classroom demo and keep the key in the Git-ignored `.env.local` file. If the test reports a quota error, check your Google project’s usage or continue with manual review. Set `GEMINI_MODEL` only if you need a different JSON-capable Gemini model available to your project. [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)


Owner/member instructions live in [agent-instructions.md](../server/agent-instructions.md). The backend assembles scoped context and validates returned drafts and proposals. Chats and reviewed memory use the configured database. Hosted deployments use Supabase persistence.
