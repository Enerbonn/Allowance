# Koa AI setup

1. Install and start the app using [Run it locally](../README.md#run-it-locally).
2. Create your own key in [Google AI Studio](https://aistudio.google.com/api-keys).
3. Set `GEMINI_API_KEY` in `.env.local` for local use or Render Environment for the hosted backend. Never set it in Vercel browser variables.
4. Restart the local server or redeploy Render. Sign in as owner and open Connections → Test connection.
5. Use Koa Workspace Assistant for setup/settings or Koa Purchase Assistant as a member. Proposals are validated and previewed before applying/submitting.

`GEMINI_MODEL` optionally selects a JSON-capable model available to your project. Quotas and availability vary. HTTP 429 usually needs quota/backoff checks; 503 can be provider unavailability. A key change does not guarantee a busy model becomes available. Manual forms remain usable; unavailable/uncertain assessments go to owner review, not fabricated approval.

[System instructions](../server/agent-instructions.md) and [review instructions](../server/review-instructions.md) are versioned source. Chats, sessions, requests and reviewed context live in the configured database. Retrieval is permission-scoped recent/keyword context; there is no required vector database or external automation service.
