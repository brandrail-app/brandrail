import { resolveConfig } from "./config.ts";
import { FRAMEWORK_LABEL } from "./frameworks.ts";
import { detectLibraries, LIBRARY_LABEL, migrationMapMarkdown, type LibraryId } from "./migrate.ts";
import type { BrandrailConfig, Framework } from "./types.ts";

export const MIGRATE_SKILL_FILE = ".claude/skills/brandrail-migrate/SKILL.md";
export const MIGRATE_AGENT_FILE = ".claude/agents/brandrail-migrator.md";

/**
 * Which libraries' mappings to include: the ones package.json lists, plus Bootstrap (server-rendered pages often
 * load it from a CDN). No package.json (PHP, Twig, plain HTML): every library.
 */
function librariesFor(pkg: unknown): LibraryId[] | undefined {
  if (!pkg) return undefined;
  return [...new Set<LibraryId>([...detectLibraries(pkg as Parameters<typeof detectLibraries>[0]), "bootstrap"])];
}

/** The Claude Code skill that migrates existing UI to the design system, step by step. */
export function migrationSkill(config: BrandrailConfig, opts: { org?: string; pkg?: unknown } = {}): string {
  const fw: Framework = config.framework ?? "react";
  const libs = librariesFor(opts.pkg);
  const ds = opts.org ? `the ${opts.org} design system` : "the design system";
  return `---
name: brandrail-migrate
description: Migrate existing UI in this repo to ${ds}. Replaces Material, MUI, Bootstrap, Ant Design, Chakra, PrimeNG and raw HTML controls with design system components, and hard-coded colours, spacing and fonts with Brand Kit tokens. Use when asked to migrate, reskin, adopt the design system, or clear Brandrail findings across files.
---

# Migrate UI to ${ds}

This is ${fw === "angular" ? "an" : "a"} ${FRAMEWORK_LABEL[fw]} project. The design system rules are in CLAUDE.md / AGENTS.md (section "Design system rules"); follow them.
If the Brandrail MCP server is connected, use \`get_component_docs\` for each component's props and events, and \`validate_snippet\` on every file you change.

## Steps

1. **See what's left**: \`npx brandrail migrate\` lists findings per file, worst first (\`--json\` for a machine-readable list).
2. **Pick a small batch**: the files the user named, or the top 1-5 files from the list. Never the whole repo at once.
3. **Migrate each file**, finding by finding:
   - \`legacy-library\` and \`forbidden-import\`: replace the other library's piece with the component in the table below. Map its props and events
     to the component's (check \`get_component_docs\`), keep every binding, handler, validation and accessibility attribute, then remove the old import.
   - \`prefer-official-component\`: raw \`<button>\`, \`<select>\`, \`<input>\` → the design system component.
   - \`no-hardcoded-color\`, \`spacing-scale\`, \`radius-scale\`, \`font-family\`: use the Brand Kit CSS variables, never new literal values.
   - \`component-props\`: only the props / inputs / events the component lists.
4. **Prove it**: \`npx brandrail check <the files>\` shows none of these findings for them, and the project's own build, lint and tests still pass.
   Look at the screen if you can: the layout should look the same apart from the brand.
5. **Commit the batch** ("Migrate <area> to the design system"), then go back to step 1.
6. **Remove a library** from package.json only when \`npx brandrail migrate\` shows 0 usages of it in the whole repo, and say so in the commit.

## Rules

- Change the look, not the behaviour: no logic, routing, data or API changes in a migration commit.
- If a piece has no design system component (the table says so), build it with semantic HTML and the Brand Kit tokens, and list it in your summary
  so the design system team can add a component.
- Ask before deleting files or changing shared code (layouts, base components) that many screens use.
${fw === "angular" ? "- Angular: every NgModule or standalone component that uses a custom element needs `CUSTOM_ELEMENTS_SCHEMA`; read event values with `$any($event).detail`; bind properties in camelCase (`[selectedDate]`).\n" : ""}
## What replaces what (${FRAMEWORK_LABEL[fw]})

${libs ? `Libraries in this project: ${libs.map((l) => LIBRARY_LABEL[l]).join(", ")}.\n\n` : ""}${migrationMapMarkdown(resolveConfig(config), fw, libs)}
`;
}

/** A Claude Code subagent that migrates one batch of files with the skill, so the main session stays small. */
export function migrationAgent(opts: { org?: string } = {}): string {
  return `---
name: brandrail-migrator
description: Migrates a batch of UI files to ${opts.org ? `the ${opts.org}` : "the"} design system using the brandrail-migrate skill. Use for "migrate <files or folder> to the design system", one batch per call.
tools: Read, Edit, Write, Grep, Glob, Bash
---

You migrate UI code to the design system. Follow the \`brandrail-migrate\` skill exactly (.claude/skills/brandrail-migrate/SKILL.md).

For the files or folder you're given:
1. Run \`npx brandrail check <paths>\` to list the findings.
2. Migrate every finding in those files, keeping behaviour identical.
3. Run \`npx brandrail check <paths>\` again until it's clean, then the project's build or tests if they're quick.
4. Reply with: files changed, findings fixed, anything that had no design system component, and anything you weren't sure about.

Don't touch files outside the batch. Don't commit unless you were asked to.
`;
}
