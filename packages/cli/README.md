<p align="center">
  <a href="https://www.brandrail.com.au">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://www.brandrail.com.au/logo/brandrail-logo-on-dark.svg">
      <img alt="Brandrail" src="https://www.brandrail.com.au/logo/brandrail-logo-on-light.svg" height="48">
    </picture>
  </a>
</p>

# brandrail

Keep AI-generated UI on-brand. `brandrail` checks code and live pages against your design system
(Brand Kit), and writes your rules into the files AI coding tools read.

```bash
npx brandrail init            # brandrail.config.json, src/brandrail.tokens.css + AGENTS.md, CLAUDE.md, Cursor/Copilot/Windsurf/Gemini rules
npx brandrail check           # violations + brand score for this repo
npx brandrail scan <url>      # check a running page in a real browser
```

## With a Brandrail account

```bash
npx brandrail connect                     # sign in through the browser; sets up the Brand Kit, AI rule files,
                                          # the MCP server for Claude Code / Cursor / Copilot, and the UI kit
npx brandrail check --changed --upload    # only changed lines, results in the dashboard
```

`connect` makes an API key on your machine and saves it in `~/.config/brandrail/credentials.json` (mode 600);
Brandrail only ever receives its hash, and the files it writes into the repo hold no key. AI tools start
`npx brandrail mcp`, which checks code on your machine: code is never uploaded. In CI, set `BRANDRAIL_KEY` instead.

## MCP server

`brandrail mcp` is an MCP server for Claude Code, Cursor, Copilot, Codex, Windsurf and any other MCP client.
It runs on your machine over stdio; code is checked locally and never uploaded. It works without an account,
using starter tokens; connect an account (or set `BRANDRAIL_KEY`) to use your own Brand Kit.

```json
{
  "mcpServers": {
    "brandrail": { "command": "npx", "args": ["-y", "brandrail", "mcp"] }
  }
}
```

`npx brandrail connect` writes this config for you, plus the rule files each AI tool reads.

| Tool | What it does |
| --- | --- |
| `get_guidelines` | The project's design system rules: components to use in its framework, allowed tokens, what the checker enforces. Called once before writing UI. |
| `get_design_tokens` | Every colour, spacing, radius and type token with the CSS variable to use. |
| `find_component` | Finds the component for a need ("date picker", "primary action") with its import, rules and an example. |
| `get_component_docs` | Full docs for one component in the project's framework: import or tag, props, rules, example. |
| `get_template` | A whole page (list, detail, form, settings, dashboard, sign-in) built from your components, with the files to create and the page's rules. |
| `get_migration_map` | What replaces each piece of Material, MUI, Bootstrap, Ant, Chakra or PrimeNG. |
| `validate_snippet` | Runs the checker on generated code and returns a brand score and each fix. |

All tools are read-only. Docs: https://www.brandrail.com.au/docs/connect

## Commands

| Command | |
| --- | --- |
| `check [paths]` | `--format pretty\|json\|markdown\|github`, `--fail-below 80`, `--changed [base]`, `--upload` |
| `scan <url>` | `--pages 3`, `--storage-state auth.json` (pages behind a login), `--wait 2000`, `--upload`. Needs `npm i -D playwright && npx playwright install chromium` |
| `init` | `--from-api`, `--mcp`, `--tokens-css <file>`, `--no-rules`, `--force`. Writes the Brand Kit as CSS variables; import that file once at your app entry |
| `import <tokens.json>` | DTCG, Tokens Studio or Figma variables JSON into the config. `--replace`, `--primitives` |
| `rules` | List the rules |
| `connect` | `--no-browser`, `--no-install`, `--remote` (hosted MCP server), `--framework`, `--force` (sign in again) |
| `mcp` | The MCP server over stdio, for AI tools. `--framework`, `--report` (send scores, never code) |
| `migrate [paths]` | What's left on the way to the design system: other UI libraries (Material, MUI, Bootstrap, Ant Design, Chakra, PrimeNG) per library and per file. `--json`, `--top 30`, `--upload` |
| `report` | A shareable HTML handover report (paths and counts, never code). `--out file.html` |
| `whoami`, `logout` | Show or remove the saved sign-in |

Nothing is uploaded unless you pass `--upload`, and code snippets are never uploaded.

## Licence

MIT. The Brandrail web app and dashboard are a separate, paid service: https://www.brandrail.com.au/pricing
