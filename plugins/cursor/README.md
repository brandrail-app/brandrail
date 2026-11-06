# Brandrail for Cursor

Adds the Brandrail MCP server and a rule that tells the agent to use it whenever it writes UI.

- `mcp.json` starts `npx -y brandrail mcp` (local, stdio; code never leaves your machine).
- `rules/brandrail.mdc` asks the agent to read your design system before writing UI and to check its work after.

Without an account the server uses starter tokens. For your own Brand Kit, run `npx brandrail connect` in the
repo, or set `BRANDRAIL_KEY`. Docs: https://www.brandrail.com.au/docs/connect
