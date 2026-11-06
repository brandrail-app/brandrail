import { flattenTokens } from "./tokens.ts";
import { resolveConfig } from "./config.ts";
import { RULES } from "./rules.ts";
import { bindingHowTo, FRAMEWORK_LABEL, markup, resolveUsage } from "./frameworks.ts";
import { deprecationLine } from "./governance.ts";
import type { BrandrailConfig, Framework } from "./types.ts";

const KIT_PACKAGE = "@brandrail/kit";

export const RULES_START = "<!-- brandrail:start -->";
export const RULES_END = "<!-- brandrail:end -->";

/**
 * Markdown instructions for AI coding tools (CLAUDE.md, AGENTS.md, Cursor rules, Copilot instructions).
 * Generated from the Brand Kit so every tool gets the same, current rules.
 */
export function generateInstructions(config: BrandrailConfig, opts: { org?: string; tokensCss?: string; framework?: Framework } = {}): string {
  const r = resolveConfig(config);
  const fw: Framework = opts.framework ?? config.framework ?? "react";
  const lines: string[] = [];
  lines.push(`# Design system rules${opts.org ? ` — ${opts.org}` : ""}`);
  lines.push("");
  lines.push(
    `All UI in this repo must follow the Brand Kit${r.tokenVersion ? ` (v${r.tokenVersion})` : ""}. These rules are checked on every pull request by Brandrail.`,
  );
  lines.push("");
  const usesKit = fw === "react" && r.components.some((c) => c.importPath === KIT_PACKAGE);
  // Angular, Vue, HTML: the kit's custom elements (@brandrail/kit/elements).
  const usesKitElements = fw !== "react" && r.components.some((c) => resolveUsage(c, fw)?.importLine?.includes(`"${KIT_PACKAGE}/`));
  if (opts.tokensCss || usesKit || usesKitElements) {
    lines.push("## Setup");
    if (usesKit || usesKitElements) lines.push(`- The kit comes from npm: \`npm i ${KIT_PACKAGE}\` (once per app, if it isn't in package.json yet).`);
    if (usesKitElements) {
      lines.push(`- \`import "${KIT_PACKAGE}/elements";\` once at the app entry registers every \`<br-*>\` element. Don't import the React components from \`${KIT_PACKAGE}\` in this project.`);
    }
    if (opts.tokensCss) {
      lines.push(`- \`${opts.tokensCss}\` defines every CSS variable below (light and dark). Import it once at the app entry, before other styles. Don't edit it: it's generated from the Brand Kit.`);
    }
    if (usesKit) {
      lines.push(`- Import \`${KIT_PACKAGE}/styles.css\` once at the app entry. Pass \`theme="brandrail"\` to kit components, and \`colorMode={ColorMode.DARK}\` (from \`${KIT_PACKAGE}\`) for dark mode. The Brand Kit styles them through the CSS variables; don't override their colours, spacing or fonts with your own CSS.`);
    }
    lines.push("");
  }
  const active = r.components.filter((c) => c.status !== "deprecated");
  if (active.length) {
    const usable = active.map((c) => ({ c, u: resolveUsage(c, fw) }));
    const here = usable.filter((x) => x.u);
    const missing = usable.filter((x) => !x.u).map((x) => x.c.name);
    lines.push("## Components");
    if (fw !== "react") lines.push(`This is a${fw === "angular" ? "n" : ""} ${FRAMEWORK_LABEL[fw]} project: use the ${FRAMEWORK_LABEL[fw]} form of each component shown here.`);
    if (here.length) lines.push("Always use these components. Never re-create them with raw HTML elements:");
    for (const { c, u } of here) {
      const tags = [...r.replaces].filter(([, v]) => v === c).map(([t]) => `<${t}>`);
      const props = u!.props?.length ? ` — props: ${u!.props.map((p) => (p.required ? `${p.name}*` : p.name)).join(", ")}` : "";
      const how = fw === "react" ? `\`${c.name}\` from \`${c.importPath}\`` : `\`${markup(u!)}\`${u!.importLine ? ` (\`${u!.importLine}\`)` : ""}`;
      lines.push(`- ${how}${fw === "react" ? "" : ` — ${c.name}`}${tags.length ? ` (instead of ${tags.join(", ")})` : ""}${props}`);
    }
    const evented = here.find((x) => x.u!.events?.length && (x.u!.customElement || x.u!.via));
    if (evented && fw !== "react") {
      lines.push(`- Events: ${here.filter((x) => x.u!.events?.length).slice(0, 12).map((x) => `\`<${x.u!.tag}>\` ${x.u!.events!.map((e) => `\`${e.name}\``).join(", ")}`).join("; ")}.`);
      for (const b of bindingHowTo(evented.u!)) lines.push(`- ${b}`);
    }
    const setups = [...new Set(here.map((x) => x.u!.setup).filter(Boolean))];
    if (setups.length && setups.length <= 3) for (const s of setups) lines.push(`- Setup: ${s}`);
    else if (setups.length) lines.push("- Each component's setup is in its docs (MCP `get_component_docs`).");
    if (here.some((x) => x.u!.props?.length)) {
      lines.push("");
      lines.push("Pass only the props listed for each component (* = required). Any other prop is a type error and fails the check: if you need something a component doesn't take, look for a related component (often one with a longer name, like AvatarLabel next to Avatar) or compose it with design tokens.");
    }
    if (missing.length) {
      lines.push("");
      lines.push(`No ${FRAMEWORK_LABEL[fw]} version yet: ${missing.join(", ")}. Build these with semantic HTML and the design tokens below; don't install another UI library.`);
    }
    lines.push("");
  }
  if (r.colors.length) {
    lines.push("## Colours");
    lines.push("Use CSS variables only. Never write hex, rgb() or hsl() values, and never use Tailwind palette classes like `bg-blue-500`.");
    for (const c of r.colors) {
      if (c.mode || r.deprecatedTokens.has(c.cssVar)) continue;
      const dark = r.colors.find((d) => d.mode === "dark" && d.path === c.path);
      lines.push(`- \`var(${c.cssVar})\` — ${c.path} (${c.hex}${dark ? `, dark ${dark.hex}` : ""})`);
    }
    lines.push("");
  }
  lines.push("## Spacing, radius and type");
  const named = (prefix: RegExp) =>
    flattenTokens(config.tokens)
      .filter((t) => prefix.test(t.path))
      .map((t) => `\`var(--${t.path.replace(/\./g, "-")})\` ${t.value}`);
  const spaceVars = named(/^(space|spacing)\./);
  const radiusVars = named(/^radius\./);
  const sizeVars = named(/^font\.size\./);
  lines.push(`- Spacing (padding, margin, gap) must be one of: ${r.spacing.filter((s) => s > 2).map((s) => `${s}px`).join(", ")}.${spaceVars.length ? ` Prefer the variables: ${spaceVars.join(", ")}.` : ""}`);
  lines.push(`- Corner radius must be one of: ${r.radii.filter((x) => x > 0 && x < 999).map((x) => `${x}px`).join(", ")} (or fully rounded).${radiusVars.length ? ` Variables: ${radiusVars.join(", ")}.` : ""}`);
  if (sizeVars.length) lines.push(`- Font sizes come from the type scale: ${sizeVars.join(", ")}. Matching line heights are \`--font-line-height-*\`.`);
  if (r.fonts.length) lines.push(`- Fonts: use ${r.fontVars.map((v) => `\`var(${v})\``).join(" or ")}; never set another font-family.`);
  lines.push("");
  const depComps = r.components.filter((c) => c.status === "deprecated");
  if (r.deprecatedTokens.size || depComps.length) {
    lines.push("## Deprecated: don't use in new code");
    lines.push("These still work until their removal date. Use the replacement, and switch existing uses when you touch that code (the Checker warns on each).");
    for (const d of r.deprecatedTokens.values()) lines.push(`- ${deprecationLine(d, true)}`);
    for (const c of depComps) lines.push(`- ${deprecationLine({ path: c.name, ...c.deprecation }, false)}`);
    lines.push("");
  }
  lines.push("## New pages");
  lines.push("- Building a new page or screen? Start from a page template: MCP `get_template` (list, detail, form, settings, dashboard, sign-in) or `npx brandrail template <name>`. It's built from these components and the spacing scale, and lists the page's rules (states, layout, accessibility). Rename its sample data; keep its structure.");
  lines.push("");
  lines.push("## Migrating existing UI");
  lines.push("- Code that still uses Material, MUI, Bootstrap, Ant Design, Chakra, PrimeNG or raw HTML controls is migration work (`legacy-library` findings). `npx brandrail migrate` lists what's left per file. In Claude Code, use the `brandrail-migrate` skill (or the `brandrail-migrator` agent) and work in small batches; keep behaviour identical.");
  lines.push("");
  lines.push("## Before you finish");
  lines.push("- If the Brandrail MCP server is connected, call `validate_snippet` on the UI you wrote and fix every violation.");
  lines.push("- Otherwise run `npx brandrail check` and fix errors before committing.");
  lines.push("");
  lines.push("<details><summary>Checked rules</summary>");
  lines.push("");
  for (const rule of RULES) {
    if (r.rules[rule.id] === "off") continue;
    lines.push(`- **${rule.title}** (\`${rule.id}\`): ${rule.description}`);
  }
  lines.push("");
  lines.push("</details>");
  return lines.join("\n");
}

/** Insert or replace the Brandrail section inside an existing file's content. */
export function upsertSection(existing: string, section: string): string {
  const block = `${RULES_START}\n${section}\n${RULES_END}`;
  const start = existing.indexOf(RULES_START);
  const end = existing.indexOf(RULES_END);
  if (start !== -1 && end > start) return existing.slice(0, start) + block + existing.slice(end + RULES_END.length);
  return existing.trim() ? `${existing.trimEnd()}\n\n${block}\n` : `${block}\n`;
}
