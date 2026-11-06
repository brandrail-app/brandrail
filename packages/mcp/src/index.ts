import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  availableFrameworks,
  bindingHowTo,
  check,
  ENGINE_VERSION,
  findComponentByName,
  fileKind,
  findComponents,
  findTemplate,
  PAGE_TEMPLATES,
  templateList,
  templateMarkdown,
  FRAMEWORK_LABEL,
  FRAMEWORKS,
  generateInstructions,
  LIBRARY_LABEL,
  migrationMapMarkdown,
  resolveUsage,
  type LibraryId,
  resolveConfig,
  type BrandrailConfig,
  type ComponentEntry,
  type Framework,
  type Report,
} from "@brandrail/engine";

export interface McpContext {
  org: string;
  config: BrandrailConfig;
  /** False when the org hasn't published a Brand Kit and starter tokens are in use. */
  published: boolean;
  /** The project's framework, from the MCP URL (?framework=angular). Tools can override it per call. */
  framework?: Framework;
  /** Stores a validate_snippet result as an "AI tool" scan. Best effort. */
  record?: (report: Report, meta: { filename: string; project?: string }) => Promise<void>;
}

type Leaf = { path: string; type?: string; value: unknown; description?: string; dark?: unknown };
function leaves(doc: unknown, prefix = "", out: Leaf[] = []): Leaf[] {
  if (!doc || typeof doc !== "object") return out;
  const o = doc as Record<string, unknown>;
  if ("$value" in o) {
    const ext = (o.$extensions as Record<string, { modes?: { dark?: unknown } }> | undefined)?.["dev.brandrail"];
    out.push({ path: prefix, type: o.$type as string | undefined, value: o.$value, description: o.$description as string | undefined, dark: ext?.modes?.dark });
    return out;
  }
  for (const [k, v] of Object.entries(o)) if (!k.startsWith("$")) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const CATEGORY: Record<string, (l: Leaf) => boolean> = {
  color: (l) => l.type === "color" || l.path.startsWith("color."),
  spacing: (l) => /^(space|spacing)\./.test(l.path),
  radius: (l) => /^(radius|radii)\./.test(l.path),
  typography: (l) => l.path.startsWith("font.") || l.type === "fontFamily",
};

const cssVar = (path: string) => `var(--${path.replace(/\./g, "-")})`;

function componentDoc(c: ComponentEntry, fw: Framework): string {
  const u = resolveUsage(c, fw);
  const others = availableFrameworks(c).filter((f) => f !== fw).map((f) => FRAMEWORK_LABEL[f]);
  const title = `### ${c.name}${c.status && c.status !== "stable" ? ` (${c.status})` : ""}`;
  if (c.status === "deprecated") {
    const d = c.deprecation ?? {};
    return [
      title,
      "",
      `Deprecated${d.removeAfter ? `: removed after ${d.removeAfter}` : ""}. Don't use it in new code${d.replacement ? `; use ${d.replacement} (get_component_docs "${d.replacement}")` : ""}.${d.reason ? ` ${d.reason}` : ""}`,
      "When you edit code that uses it, switch to the replacement.",
    ].join("\n");
  }
  if (!u) {
    return [
      title,
      "",
      `No ${FRAMEWORK_LABEL[fw]} version in the registry${others.length ? ` (only ${others.join(", ")})` : ""}. Don't import it here: build this with semantic HTML and the design tokens, and don't install another UI library.`,
      ...(c.description ? ["", c.description] : []),
      ...(c.usageRules?.length ? ["", "Rules (apply to what you build instead):", ...c.usageRules.map((r) => `- ${r}`)] : []),
    ].join("\n");
  }
  const lines = [title];
  if (u.importLine) lines.push(`\`${u.importLine}\``);
  if (fw !== "react") lines.push(`${FRAMEWORK_LABEL[fw]}: \`<${u.tag}>\`${u.via ? " (the web component)" : ""}`);
  if (u.setup) lines.push(`Setup: ${u.setup}`);
  if (c.description) lines.push("", c.description);
  if (c.replaces?.length) lines.push("", `Use instead of: ${c.replaces.map((t) => `<${t}>`).join(", ")}`);
  if (c.aliases?.length) lines.push(`Also known as: ${c.aliases.join(", ")}`);
  if (c.usageRules?.length) lines.push("", "Rules:", ...c.usageRules.map((r) => `- ${r}`));
  if (u.props?.length) {
    lines.push("", "Props (these are the only props it accepts; * = required):");
    for (const p of u.props) lines.push(`- \`${p.name}${p.required ? "*" : ""}\`${p.type ? `: ${p.type}` : ""}${p.description ? ` — ${p.description}` : ""}`);
    if (c.htmlAttributes && fw === "react") lines.push(`- Also accepts native <${c.htmlAttributes}> attributes (id, aria-*, data-*, on* handlers…).`);
  }
  if (u.events?.length) {
    lines.push("", "Events:");
    for (const e of u.events) lines.push(`- \`${e.name}\`${e.detail ? ` — ${u.customElement || u.via ? "event.detail: " : ""}${e.detail}` : ""}`);
  }
  const binding = bindingHowTo(u);
  if (binding.length) lines.push("", ...binding);
  if (u.example) lines.push("", "Example:", "```" + u.lang, u.example, "```");
  if (others.length) lines.push("", `Also available for: ${others.join(", ")}.`);
  return lines.join("\n");
}

const frameworkInput = z
  .enum(FRAMEWORKS as [Framework, ...Framework[]])
  .optional()
  .describe("The project's UI framework (from its package.json: @angular/core → angular, vue → vue, svelte → svelte, solid-js → solid, react → react). Defaults to the one set for this connection.");

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function createBrandrailMcp(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: "brandrail", title: `Brandrail — ${ctx.org} design system`, version: ENGINE_VERSION },
    {
      instructions:
        `Design system for ${ctx.org}. Before writing UI: call get_guidelines once. For a new page or screen, start from get_template. Use find_component for every UI element ` +
        `(pass \`framework\` — angular, vue, svelte, solid, react, web-components or html — when the project isn't ${ctx.framework ? FRAMEWORK_LABEL[ctx.framework] : "React"}) ` +
        `(use only the props it lists) and get_design_tokens for colours/spacing. After writing UI: call validate_snippet once with ` +
        `all changed files and fix every violation before finishing.`,
    },
  );
  const resolved = resolveConfig(ctx.config);
  const fwOf = (f?: Framework): Framework => f ?? ctx.framework ?? "react";
  const kitNote = ctx.published ? "" : "\n\n_Note: this organisation hasn't published a Brand Kit yet, so starter tokens are shown._";

  server.registerTool(
    "get_guidelines",
    {
      title: "Get design system guidelines",
      description: "The organisation's design system rules for AI coding: components to use (in the project's framework), allowed colour/spacing tokens, and what the Checker enforces. Call once before writing UI.",
      inputSchema: { framework: frameworkInput },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ framework }) => text(generateInstructions(ctx.config, { org: ctx.org, framework: fwOf(framework) }) + kitNote),
  );

  server.registerTool(
    "get_design_tokens",
    {
      title: "Get design tokens",
      description: "Brand Kit tokens with the CSS variable to use for each. Never hard-code colours, spacing, radius or fonts; use these variables.",
      inputSchema: { category: z.enum(["all", "color", "spacing", "radius", "typography"]).default("all").describe("Which tokens to return") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ category }) => {
      const all = leaves(ctx.config.tokens);
      const pick = category === "all" ? all : all.filter(CATEGORY[category]!);
      const lines = [`# ${ctx.org} design tokens${ctx.config.tokenVersion ? ` (Brand Kit v${ctx.config.tokenVersion})` : ""}`, ""];
      lines.push("| Token | Use | Value | Meaning |", "| --- | --- | --- | --- |");
      for (const l of pick) {
        const dep = resolved.deprecatedTokens.get(`--${l.path.replace(/\./g, "-")}`);
        const note = dep ? `**Deprecated**${dep.replacement ? `: use \`${cssVar(dep.replacement)}\`` : ""}${dep.removeAfter ? ` (removed after ${dep.removeAfter})` : ""}.` : (l.description ?? "");
        lines.push(`| ${l.path} | \`${cssVar(l.path)}\` | ${String(l.value)}${l.dark ? ` (dark ${String(l.dark)})` : ""} | ${note} |`);
      }
      if (pick.some((l) => l.dark)) lines.push("", "Colours with a dark value switch automatically: always use the variable, never the hex, so both themes work.");
      if (category === "all" || category === "spacing") lines.push("", `Allowed spacing (px): ${resolved.spacing.filter((s) => s > 2).join(", ")}`);
      if (category === "all" || category === "radius") lines.push(`Allowed radius (px): ${resolved.radii.filter((r) => r > 0 && r < 999).join(", ")}`);
      return text(lines.join("\n") + kitNote);
    },
  );

  server.registerTool(
    "find_component",
    {
      title: "Find a design system component",
      description: 'Finds the component to use for a UI need, e.g. "date picker", "primary action", "modal", "dropdown of countries". Returns the import, rules and an example. Always use these instead of raw HTML elements or other UI libraries.',
      inputSchema: {
        intent: z.string().min(1).max(300).describe("What you need, in plain words"),
        limit: z.number().int().min(1).max(10).default(3),
        framework: frameworkInput,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ intent, limit, framework }) => {
      const matches = findComponents(ctx.config, intent, limit);
      if (matches.length === 0) {
        const names = (ctx.config.components ?? []).map((c) => c.name);
        return text(
          names.length
            ? `No component matches "${intent}". Available components: ${names.join(", ")}. If none fits, compose from these and design tokens; don't import another UI library.`
            : `The ${ctx.org} registry has no components yet. Use design tokens (get_design_tokens) and semantic HTML.`,
        );
      }
      const fw = fwOf(framework);
      // Components with a version for this framework first.
      const ranked = [...matches].sort((a, b) => Number(!resolveUsage(a.component, fw)) - Number(!resolveUsage(b.component, fw)));
      return text(ranked.map((m) => componentDoc(m.component, fw)).join("\n\n---\n\n"));
    },
  );

  server.registerTool(
    "get_component_docs",
    {
      title: "Get component docs",
      description: "Full docs for one component by name or alias, in the project's framework: import, tag, setup, what it replaces, usage rules and example.",
      inputSchema: { name: z.string().min(1).max(80).describe('Component name, e.g. "Button" or an alias like "Modal"'), framework: frameworkInput },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name, framework }) => {
      const c = findComponentByName(ctx.config, name);
      if (!c) {
        const names = (ctx.config.components ?? []).map((x) => x.name).join(", ");
        return { ...text(`No component called "${name}". Available: ${names || "none"}.`), isError: true };
      }
      return text(componentDoc(c, fwOf(framework)));
    },
  );

  server.registerTool(
    "get_template",
    {
      title: "Start a page from a template",
      description:
        "A whole page (list, detail, form, settings, dashboard, sign-in) built from this organisation's components and spacing scale, in the project's framework: the files to create, " +
        "which component fills each part, and the page's rules (states, layout, accessibility). Call before building a new page or screen; rename the sample data and keep the structure. " +
        "Without a name, lists the templates.",
      inputSchema: {
        name: z.string().max(80).optional().describe(`Template name or what the page is, e.g. "list", "login", "admin index". One of: ${PAGE_TEMPLATES.map((t) => t.id).join(", ")}`),
        framework: frameworkInput,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name, framework }) => {
      if (!name?.trim()) return text(`# Page templates\n\n${templateList()}\n\nCall get_template with a name to get the files.`);
      const t = findTemplate(name);
      if (!t) return { ...text(`No template matches "${name}". Templates:\n${templateList()}\n\nIf none fits, start from the closest one, or compose the page from find_component results and the layout rules in get_guidelines.`), isError: true };
      return text(templateMarkdown(ctx.config, t, fwOf(framework), ctx.org) + kitNote);
    },
  );

  server.registerTool(
    "get_migration_map",
    {
      title: "Map another UI library to the design system",
      description:
        "What replaces each piece of Angular Material, MUI, Bootstrap, Ant Design, Chakra, React Bootstrap or PrimeNG in this design system, in the project's framework. " +
        "Call before migrating code that uses one of those libraries; keep behaviour identical and use get_component_docs for props and events.",
      inputSchema: {
        libraries: z
          .array(z.enum(Object.keys(LIBRARY_LABEL) as [LibraryId, ...LibraryId[]]))
          .optional()
          .describe("Only these libraries (default: all)"),
        framework: frameworkInput,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ libraries, framework }) => text(`# Migration map (${FRAMEWORK_LABEL[fwOf(framework)]})\n\n${migrationMapMarkdown(resolved, fwOf(framework), libraries)}`),
  );

  server.registerTool(
    "validate_snippet",
    {
      title: "Validate UI code against the design system",
      description:
        "Runs the Brandrail Checker on UI code you wrote (TSX/JSX, Angular components and templates, Vue, Svelte, HTML, CSS, PHP, Twig, Mustache/Handlebars). Returns a brand score and each violation with the fix. " +
        "Call once after writing UI with every file you changed in `files`, and fix every error and warning before finishing.",
      inputSchema: {
        files: z
          .array(z.object({ filename: z.string().min(1).max(200), code: z.string().min(1).max(100_000) }))
          .min(1)
          .max(20)
          .optional()
          .describe("Every file you changed, checked together as one result. Preferred over code/filename."),
        code: z.string().min(1).max(100_000).optional().describe("A single file or snippet (when not using files)"),
        filename: z.string().max(200).default("snippet.tsx").describe("File name for code; the extension decides how it's parsed"),
        project: z.string().max(120).optional().describe("Repo or app name, e.g. customer-portal (shown in the dashboard)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ files, code, filename, project }) => {
      const input = files?.length ? files : code ? [{ filename, code }] : [];
      if (!input.length) return { ...text("Pass `files` (preferred) or `code`."), isError: true };
      const named = input.map((f) => ({
        path: fileKind(f.filename) !== "other" ? f.filename : `${f.filename}.tsx`,
        content: f.code,
      }));
      const report = check(named, ctx.config);
      const label = named.length === 1 ? named[0]!.path : `${named.length} files (${named.map((f) => f.path.split("/").pop()).join(", ")})`;
      await ctx.record?.(report, { filename: label, project }).catch(() => undefined);
      if (report.violations.length === 0) {
        return text(`✅ Brand score ${report.score}/100 — no violations in ${label}. This code follows the ${ctx.org} design system.`);
      }
      const many = named.length > 1;
      const lines = [
        `Brand score ${report.score}/100 — ${report.counts.error} errors, ${report.counts.warning} warnings, ${report.counts.info} info.`,
        "",
        ...report.violations.map(
          (v) => `- [${v.severity}] ${many ? `${v.file}:` : "line "}${v.line}: ${v.message}${v.suggestion ? ` → ${v.suggestion}` : ""} (${v.ruleId})`,
        ),
        "",
        "Fix every error and warning, then call validate_snippet again with the same files.",
      ];
      return text(lines.join("\n") + kitNote);
    },
  );

  return server;
}
