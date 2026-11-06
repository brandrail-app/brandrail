# Brandrail

Your design system, in every AI coding tool.

AI coding tools don't know your design system, so every screen comes out with different colours, buttons
and spacing. Brandrail's MCP server gives the tool your Brand Kit and components before it writes UI, then
checks what it wrote and returns the fixes, so it corrects itself before you see the code.

- Seven read-only tools: `get_guidelines`, `get_design_tokens`, `find_component`, `get_component_docs`,
  `get_template`, `get_migration_map`, `validate_snippet`.
- Works in React, Angular, Vue, Web Components and plain HTML. The checker also reads Svelte, CSS, PHP, Twig,
  Mustache, Handlebars, Nunjucks and Liquid.
- Runs locally over stdio. Code is checked on your machine and never uploaded.
- Try it with no account: it starts with starter tokens. Connect a free Brandrail account to use your own
  Brand Kit.

## Use it with your AI tool

In each repo:

```bash
npx brandrail connect
```

It signs you in through the browser and writes the MCP config and rule files for Claude Code, Cursor,
Copilot, Codex, Windsurf and Gemini CLI. The files it writes hold no key, so commit them.

Or add the MCP server by hand (works without an account):

```json
{
  "mcpServers": {
    "brandrail": { "command": "npx", "args": ["-y", "brandrail", "mcp"] }
  }
}
```

Cursor install link:

```text
cursor://anysphere.cursor-deeplink/mcp/install?name=brandrail&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImJyYW5kcmFpbCIsIm1jcCJdfQ==
```

Set `BRANDRAIL_KEY` (an API key from Dashboard → Connect) to load your organisation's Brand Kit without
running `connect`. Full docs: https://www.brandrail.com.au/docs/connect

## MCP tools

| Tool | What it does |
| --- | --- |
| `get_guidelines` | The project's design system rules: components to use in its framework, allowed tokens, what the checker enforces. Called once before writing UI. |
| `get_design_tokens` | Every colour, spacing, radius and type token with the CSS variable to use. |
| `find_component` | Finds the component for a need ("date picker", "primary action") with its import, rules and an example. |
| `get_component_docs` | Full docs for one component in the project's framework: import or tag, props, rules, example. |
| `get_template` | A whole page (list, detail, form, settings, dashboard, sign-in) built from your components, with the files to create and the page's rules. |
| `get_migration_map` | What replaces each piece of Material, MUI, Bootstrap, Ant, Chakra or PrimeNG. |
| `validate_snippet` | Runs the checker on generated code and returns a brand score and each fix. |

## The CLI

The same package is a command-line checker:

```bash
npx brandrail check --changed          # only what you changed vs origin/main
npx brandrail scan http://localhost:3000 --pages 3   # a running app, in a real browser
npx brandrail migrate                  # what's left of Material, MUI, Bootstrap and others
```

Every command and option: [packages/cli/README.md](packages/cli/README.md) and https://www.brandrail.com.au/docs/cli

## Privacy

The MCP server and CLI run on your machine. Code is checked locally and never uploaded. With a key, they
fetch your Brand Kit; `--upload` and `--report` send scores and messages to your dashboard, never code.
Security details: https://www.brandrail.com.au/security

## What's in this repo

```text
packages/
  cli/      the `brandrail` npm package: CLI and local MCP server
  mcp/      the MCP server's tools
  engine/   the checker rules engine (pure TypeScript, no runtime dependencies)
mcpb/       MCP bundle for Smithery and desktop apps
plugins/
  cursor/   Cursor plugin: MCP server plus a rule
```

```bash
pnpm install
pnpm test     # engine tests
pnpm build    # → packages/cli/dist/brandrail.mjs
```

## Licence

MIT, see [LICENSE](LICENSE). The Brandrail web app (Brand Kit hosting, repo sync, GitHub App, teams) is a
separate service: https://www.brandrail.com.au/pricing

Questions: hello@brandrail.com.au · Security reports: security@brandrail.com.au
