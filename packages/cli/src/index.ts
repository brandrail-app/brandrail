import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import {
  check,
  ENGINE_VERSION,
  formatGithubAnnotations,
  formatMarkdown,
  formatPretty,
  diffTokens,
  detectFramework,
  FRAMEWORK_LABEL,
  FRAMEWORKS,
  generateInstructions,
  isFramework,
  formatHandoverHtml,
  LIBRARY_LABEL,
  mergeProjectConfig,
  MIGRATE_AGENT_FILE,
  MIGRATE_SKILL_FILE,
  migrationAgent,
  migrationSkill,
  migrationStatus,
  findTemplate,
  EXPORT_FORMATS,
  exportTokens,
  isExportFormat,
  renderTemplate,
  templateList,
  ruleFileContent,
  tokensCssContent,
  importTokenFiles,
  auditBrandKit,
  type TokenFile,
  mcpClientConfigs,
  mcpLocalConfigs,
  mergeTokens,
  RULE_FILES,
  resolveConfig,
  RULES,
  starterConfig,
  type BrandrailConfig,
  type Framework,
} from "@brandrail/engine";
import { apiBase, fetchBrandKit, uploadReport } from "./api.ts";
import { connect, installKit } from "./connect.ts";
import { credentialsPath, NO_KEY, removeCredential, resolveKey, storedCredential } from "./credentials.ts";
import { runLocalMcp } from "./mcp.ts";
import { collectFiles, CONFIG_FILE, findConfig, readConfig } from "./files.ts";
import { changedLines, repoInfo, stagedLines } from "./git.ts";
import { installHook, uninstallHook } from "./hook.ts";
import { scanPages } from "./scan.ts";

const HELP = `brandrail ${ENGINE_VERSION} — check that UI follows your design system

Usage
  brandrail connect            Sign in through the browser and set this project up: Brand Kit, AI rule files,
                               MCP server for Claude Code / Cursor / Copilot, and the UI kit
  brandrail check [paths...]   Scan files and print violations
  brandrail hook install       Check staged lines before every commit (errors stop the commit); hook uninstall removes it
  brandrail init               Create brandrail.config.json and AI rule files
  brandrail migrate [paths...] What's left on the way to the design system: per library and per file
  brandrail report             Write a shareable HTML handover report (paths and counts, no code)
  brandrail mcp                Run the MCP server on this machine (AI tools start it; code never leaves it)
  brandrail whoami | logout    Show or remove the saved sign-in
  brandrail scan <url>         Check a running page (localhost, staging, behind a login) in a real browser
  brandrail import <files…>   Load tokens into the config: DTCG, Tokens Studio, Figma variables JSON, or Figma's Export modes ZIP
  brandrail rules              List the rules
  brandrail template [name]    Start a page (list, detail, form, settings, dashboard, sign-in) from your components
  brandrail export <formats…>  Write the Brand Kit for other platforms: ios, compose, android-xml, react-native, flutter, css, tailwind, json

Options for check
  --config <file>        Config file (default: nearest brandrail.config.json)
  --format <fmt>         pretty | json | markdown | github   (default: pretty)
  --fail-below <score>   Exit 1 when the brand score is lower (default: off)
  --changed [base]       Only report lines changed vs base branch (default: origin/main)
  --staged               Only the lines staged for the next commit (what the pre-commit hook runs)
  --strict               Exit 1 on any error (warnings never fail)
  --upload               Send the result to Brandrail (needs \`brandrail connect\` or BRANDRAIL_KEY)
  --no-color             Plain output

Options for init
  --from-api             Pull the published Brand Kit (needs \`brandrail connect\` or BRANDRAIL_KEY)
  --no-rules             Don't write AGENTS.md (Codex), CLAUDE.md, Cursor, Copilot, Windsurf, Gemini rule files
  --mcp                  Also add the Brandrail MCP server to .mcp.json, .cursor/mcp.json, .vscode/mcp.json
                         and print the Codex / Windsurf config
  --framework <name>     react | angular | vue | svelte | solid | web-components | html (default: detected from package.json)
  --tokens-css <file>    Where to write the CSS variables (default src/brandrail.tokens.css); --no-tokens-css to skip
  --force                Overwrite an existing brandrail.config.json

Options for connect
  --no-browser           Print the approval link instead of opening it
  --no-install           Don't add @brandrail/kit to package.json
  --remote               Point AI tools at the hosted MCP server instead of the local one
  --framework, --tokens-css, --no-rules   As for init

Options for migrate
  --json                 Machine-readable output
  --top <n>              How many files to list (default 15)
  --upload               Store the result in the dashboard (scores and counts, never code)

Options for report
  --out <file>           Where to write it (default brandrail-report.html)

Options for mcp
  --framework <name>     Override the detected framework
  --report               Also send brand scores (never code) to the dashboard

Options for scan
  --pages <n>            Also scan pages it links to, up to n in total (default 1, max 20)
  --storage-state <file> Playwright storage state with your login cookies
  --wait <ms>            Extra wait after load, for client-rendered apps
  --width <px>           Viewport width (default 1280)
  --format, --fail-below, --upload   As for check
  Needs Playwright: npm i -D playwright && npx playwright install chromium

Options for import
  --replace              Replace the config's tokens instead of merging
  --primitives           Keep raw palette ramps (gray.100…900) that semantic tokens point at

Options for export
  --out <folder>         Where to write (default: here; with several formats, a folder per format)
  --from-api             Use the published Brand Kit instead of brandrail.config.json

Options for template
  --framework <name>     Override the detected framework
  --out <folder>         Where to write the files (default: here)
  --force                Overwrite files that already exist

Environment
  BRANDRAIL_KEY          API key from Dashboard → Connect (CI). Otherwise the key saved by \`brandrail connect\`
  BRANDRAIL_API_URL      Brandrail URL (default ${apiBase()})
`;

type Flags = Record<string, string | boolean>;

function parseArgs(argv: string[]): { cmd: string; positional: string[]; flags: Flags } {
  const [cmd = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--no-")) flags[a.slice(5)] = false;
    else if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      const next = rest[i + 1];
      if (v !== undefined) flags[k] = v;
      else if (next !== undefined && !next.startsWith("-") && ["config", "format", "fail-below", "changed", "pages", "storage-state", "wait", "width", "tokens-css", "framework", "top", "out"].includes(k)) {
        flags[k] = next;
        i++;
      } else flags[k] = true;
    } else positional.push(a);
  }
  return { cmd, positional, flags };
}

const log = (s = "") => process.stderr.write(`${s}\n`);

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function loadConfig(cwd: string, flags: Flags): Promise<{ config: BrandrailConfig; source: string }> {
  const explicit = typeof flags.config === "string" ? resolve(cwd, flags.config) : null;
  const path = explicit ?? findConfig(cwd);
  if (path) return { config: readConfig(path), source: relative(cwd, path) || CONFIG_FILE };
  const key = resolveKey();
  if (key) {
    const { config } = await fetchBrandKit(key);
    return { config, source: `${apiBase()} (published Brand Kit)` };
  }
  throw new Error(`No ${CONFIG_FILE} found. Run \`npx brandrail init\` first, or run \`npx brandrail connect\` to use your published Brand Kit.`);
}

async function cmdCheck(cwd: string, positional: string[], flags: Flags): Promise<number> {
  const { config, source } = await loadConfig(cwd, flags);
  const resolved = resolveConfig(config);
  const root = dirname(typeof flags.config === "string" ? resolve(cwd, flags.config) : findConfig(cwd) ?? join(cwd, CONFIG_FILE));
  const collected = collectFiles(root, positional.map((p) => relative(root, resolve(cwd, p))), resolved.ignore);

  let onlyLines: Map<string, Set<number>> | undefined;
  let files = collected;
  if (flags.staged) {
    // Pre-commit: only the files and lines staged for this commit.
    const staged = stagedLines(root);
    if (!staged) log("warning: couldn't read the staged changes; checking everything");
    else {
      onlyLines = staged;
      files = collected.filter((f) => staged.has(f.path));
      if (!files.length) return 0;
    }
  } else if (flags.changed) {
    const base = typeof flags.changed === "string" ? flags.changed : "origin/main";
    onlyLines = changedLines(root, base) ?? undefined;
    if (!onlyLines) log(`warning: couldn't read git diff against ${base}; checking everything`);
  }

  const report = check(files, resolved, { onlyLines });
  const format = typeof flags.format === "string" ? flags.format : "pretty";
  const threshold = flags["fail-below"] !== undefined ? Number(flags["fail-below"]) : undefined;

  if (format === "json") process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else if (format === "markdown") process.stdout.write(`${formatMarkdown(report, { threshold })}\n`);
  else if (format === "github") process.stdout.write(`${formatGithubAnnotations(report)}\n`);
  else {
    const color = flags.color !== false && process.stdout.isTTY !== false && !process.env.NO_COLOR;
    const kit = `Brand Kit: ${source}${config.tokenVersion ? ` v${config.tokenVersion}` : ""}`;
    log(color ? `\x1b[2m${kit}\x1b[0m` : kit);
    process.stdout.write(`${formatPretty(report, { color })}\n`);
  }

  if (flags.upload) {
    const key = resolveKey();
    if (!key) log(`warning: --upload skipped. ${NO_KEY}`);
    else {
      const repo = repoInfo(root);
      const res = await uploadReport(key, {
        source: process.env.CI ? "ci" : "cli",
        target: { kind: "repo", name: repo.slug.split("/").pop() ?? repo.slug, location: repo.slug },
        ref: repo.branch ?? repo.sha?.slice(0, 7),
        title: flags.changed ? `Changed lines on ${repo.branch ?? "HEAD"}` : `Local check on ${repo.branch ?? "HEAD"}`,
        threshold,
        report,
      });
      log(`Uploaded → ${res.url ?? res.scanId}`);
    }
  }

  if (flags.strict && report.counts.error > 0) {
    log(`\n${report.counts.error} error${report.counts.error === 1 ? "" : "s"} (--strict fails on any error; warnings don't block).`);
    return 1;
  }
  if (threshold !== undefined && report.score < threshold) {
    log(`\nBrand score ${report.score} is below ${threshold}.`);
    return 1;
  }
  return 0;
}

function cmdHook(cwd: string, positional: string[], flags: Flags): number {
  const action = positional[0] ?? "install";
  if (action === "uninstall" || action === "remove") {
    const removed = uninstallHook(cwd);
    log(removed ? `✔ removed the Brandrail check from ${removed}` : "No Brandrail pre-commit hook found.");
    return 0;
  }
  if (action !== "install") throw new Error("Usage: brandrail hook install [--fail-below 80] | brandrail hook uninstall");
  const config = findConfig(cwd);
  if (!config) throw new Error(`No ${CONFIG_FILE} here or above. Run \`brandrail connect\` first.`);
  const failBelow = flags["fail-below"] !== undefined ? Number(flags["fail-below"]) : undefined;
  const r = installHook(cwd, { root: dirname(config), failBelow });
  log(`✔ ${r.kind === "husky" ? "added to Husky's" : "installed the"} pre-commit hook (${r.path})`);
  log("  Each commit now checks the staged lines; errors stop the commit, warnings don't.");
  log("  Skip it once with git commit --no-verify. Remove it with brandrail hook uninstall.");
  return 0;
}

function tokensCssPath(root: string, config: BrandrailConfig, flags: Flags): string {
  if (typeof flags["tokens-css"] === "string") return flags["tokens-css"];
  if (config.tokensCss) return config.tokensCss;
  return existsSync(join(root, "src")) ? "src/brandrail.tokens.css" : "brandrail.tokens.css";
}

/**
 * The tokens file must be a .css file inside the project. A cloned repo's config (or a reply from the server)
 * can't make `init` write anywhere else, e.g. over ~/.bashrc, including through a symlink.
 */
export function safeTokensCssTarget(root: string, rel: string): string {
  const fail = (why: string) => new Error(`Won't write the tokens file to "${rel}": ${why}. Set "tokensCss" in ${CONFIG_FILE} to a .css path inside this project.`);
  if (!rel || isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.includes("\0")) throw fail("it has to be a relative path");
  if (!/\.css$/i.test(rel)) throw fail("it has to end in .css");
  const top = realpathSync(root);
  const abs = resolve(top, rel);
  const inside = (p: string) => p === top || p.startsWith(top + sep);
  if (!inside(abs)) throw fail("it's outside the project");
  // Follow whatever already exists on the way there: no folder or file on the path may lead out of the project.
  let probe = abs;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  if (!inside(realpathSync(probe))) throw fail("it leads outside the project through a link");
  if (existsSync(abs) && lstatSync(abs).isSymbolicLink()) throw fail("it's a link");
  return abs;
}

function writeTokensCss(root: string, rel: string, config: BrandrailConfig, org?: string): boolean {
  const abs = safeTokensCssTarget(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const { css, usesKit } = tokensCssContent(config, org);
  writeFileSync(abs, css);
  return usesKit;
}

function writeRuleFiles(root: string, config: BrandrailConfig, org?: string, tokensCss?: string): string[] {
  const md = generateInstructions(config, { org, tokensCss });
  const written: string[] = [];
  for (const { file, readBy } of RULE_FILES) {
    const abs = join(root, file);
    mkdirSync(dirname(abs), { recursive: true });
    const before = existsSync(abs) ? readFileSync(abs, "utf8") : "";
    writeFileSync(abs, ruleFileContent(file, md, before));
    written.push(`${file}  (${readBy})`);
  }
  // Claude Code migration skill + subagent, with mappings for the UI libraries this project uses.
  const pkg = readJson(join(root, "package.json"));
  for (const [file, content, readBy] of [
    [MIGRATE_SKILL_FILE, migrationSkill(config, { org, pkg }), "Claude Code skill: migrate to the design system"],
    [MIGRATE_AGENT_FILE, migrationAgent({ org }), "Claude Code agent: brandrail-migrator"],
  ] as const) {
    const abs = join(root, file);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    written.push(`${file}  (${readBy})`);
  }
  return written;
}

/** Adds the brandrail server to project MCP configs, keeping any other servers already there. */
function writeMcpConfigs(root: string, framework: Framework, mode: "local" | "remote" = "remote"): void {
  // The framework rides on the URL so every tool call answers in it (React is the default).
  const url = `${apiBase()}/api/mcp${framework === "react" ? "" : `?framework=${framework}`}`;
  const configs = mode === "local" ? mcpLocalConfigs(framework) : mcpClientConfigs(url);
  for (const c of configs) {
    if (!c.projectFile) continue;
    const abs = join(root, c.file);
    mkdirSync(dirname(abs), { recursive: true });
    const ours = JSON.parse(c.content) as Record<string, Record<string, unknown> | unknown[]>;
    let merged = ours;
    if (existsSync(abs)) {
      try {
        const existing = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
        merged = { ...existing } as typeof ours;
        for (const [k, v] of Object.entries(ours)) {
          if (k === "mcpServers" || k === "servers") {
            // Replace our own entry whole (switching between hosted and local mode), keep everyone else's.
            merged[k] = { ...((existing[k] as Record<string, unknown>) ?? {}), ...(v as Record<string, unknown>) };
          } else if (Array.isArray(v)) {
            const prev = (Array.isArray(existing[k]) ? existing[k] : []) as Array<{ id?: string }>;
            merged[k] = [...prev.filter((x) => !v.some((y) => (y as { id?: string }).id === x.id)), ...v];
          } else merged[k] = { ...((existing[k] as Record<string, unknown>) ?? {}), ...v };
        }
      } catch {
        log(`warning: ${c.file} isn't valid JSON; left unchanged`);
        continue;
      }
    }
    writeFileSync(abs, `${JSON.stringify(merged, null, 2)}\n`);
    log(`✔ added brandrail to ${c.file}  (${c.name})`);
  }
  for (const c of configs.filter((x) => !x.projectFile)) {
    log(`\n${c.name}: ${c.command ? `run\n  ${c.command}\nor add` : "add"} to ${c.file}:\n${c.content.replace(/^/gm, "  ")}`);
  }
  if (mode === "remote") log("\nSet BRANDRAIL_KEY in your shell (an API key from Dashboard → Connect) before starting the AI tool.");
  else log("\nThe AI tools start `npx brandrail mcp` on this machine: it uses your saved sign-in, and checks code locally.");
}

/** --framework, else what the config already says, else detected from the nearest package.json. */
function projectFramework(cwd: string, config: BrandrailConfig, flags: Flags): Framework {
  const asked = flags.framework;
  if (typeof asked === "string") {
    if (!isFramework(asked)) throw new Error(`Unknown --framework "${asked}". Use one of: ${FRAMEWORKS.join(", ")}.`);
    return asked;
  }
  if (config.framework && isFramework(config.framework)) return config.framework;
  const pkg = join(cwd, "package.json");
  if (!existsSync(pkg)) return detectFramework(null);
  try {
    return detectFramework(JSON.parse(readFileSync(pkg, "utf8")));
  } catch {
    return "react";
  }
}

async function cmdInit(cwd: string, flags: Flags): Promise<number> {
  const target = join(cwd, CONFIG_FILE);
  let config: BrandrailConfig = starterConfig;
  let org: string | undefined;
  if (flags["from-api"]) {
    const key = resolveKey();
    if (!key) throw new Error(`--from-api: ${NO_KEY}`);
    const pinned = existsSync(target) ? readConfig(target).brandKitVersion : undefined;
    const res = await fetchBrandKit(key, pinned);
    config = { $schema: starterConfig.$schema, ...res.config, ...(pinned ? { brandKitVersion: pinned } : {}) };
    org = res.org;
    if (pinned && res.latestVersion && res.latestVersion !== pinned) log(`Pinned to Brand Kit v${pinned} (v${res.latestVersion} is the latest). Remove "brandKitVersion" from ${CONFIG_FILE} to follow the latest.`);
  }
  if (existsSync(target) && !flags.force && !flags["from-api"]) {
    log(`${CONFIG_FILE} already exists (use --force to overwrite). Updating rule files from it.`);
    config = readConfig(target);
    org ??= config.org;
  } else {
    if (existsSync(target)) {
      // Keep local settings (ignore, rules, tokensCss) when refreshing tokens from the API.
      const prev = readConfig(target);
      config = mergeProjectConfig(prev, config);
    }
    writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
    log(`✔ wrote ${CONFIG_FILE}${org ? ` from ${org}'s Brand Kit` : " (starter tokens — edit them or use --from-api)"}`);
  }
  const framework = projectFramework(cwd, config, flags);
  if (config.framework !== framework) {
    config = { ...config, framework };
    writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  }
  log(`✔ framework: ${FRAMEWORK_LABEL[framework]}${flags.framework ? "" : " (detected; change with --framework)"}`);
  const css = flags["tokens-css"] === false ? undefined : tokensCssPath(cwd, config, flags);
  if (css) {
    const kit = writeTokensCss(cwd, css, config, org);
    log(`✔ wrote ${css}  (the Brand Kit as CSS variables${kit ? ", and @brandrail/kit themed from it" : ""} — import it once at your app entry)`);
  }
  if (flags.rules !== false) for (const f of writeRuleFiles(cwd, config, org, css)) log(`✔ updated ${f}`);
  // Local (stdio) by default, like `connect`: works without an account and keeps code on the machine.
  if (flags.mcp) writeMcpConfigs(cwd, framework, flags.remote ? "remote" : "local");
  log("\nNext: npx brandrail check");
  return 0;
}

/** Sign in through the browser (or reuse the saved sign-in), then set the project up end to end. */
async function cmdConnect(cwd: string, flags: Flags): Promise<number> {
  let org: string | undefined;
  const saved = process.env.BRANDRAIL_KEY ? undefined : storedCredential();
  if (process.env.BRANDRAIL_KEY) log("Using BRANDRAIL_KEY from the environment.");
  else if (saved && !flags.force && Date.parse(saved.expiresAt) > Date.now() + 7 * 864e5) {
    try {
      org = (await fetchBrandKit(saved.key)).org;
      log(`✔ already connected to ${org} (sign in again with --force, or \`brandrail logout\`)`);
    } catch {
      log("The saved sign-in no longer works (revoked or expired). Signing in again.");
    }
  }
  if (!org && !process.env.BRANDRAIL_KEY) {
    log(`Connecting this terminal to Brandrail (${apiBase()}).`);
    const r = await connect({ browser: flags.browser !== false, log });
    org = r.org;
    log(`\n✔ connected to ${org}. The key is saved in ${credentialsPath()} (only you can read it), never in this repo.`);
  }
  await cmdInit(cwd, { ...flags, "from-api": true, mcp: false });
  const config = readConfig(join(cwd, CONFIG_FILE));
  const framework = projectFramework(cwd, config, flags);
  writeMcpConfigs(cwd, framework, flags.remote ? "remote" : "local");
  const usesKit = (config.components ?? []).some((c) => c.importPath === "@brandrail/kit");
  if (usesKit && flags.install !== false) installKit(cwd, log);
  log(`\nDone. Restart your AI tool so it picks up the MCP server, then ask it to build something.`);
  if (framework !== "react" && usesKit) log(`(${framework}: import "@brandrail/kit/elements" once at your app entry — the rule files tell the AI the rest.)`);
  return 0;
}

/** What's left on the way to the design system, per file and per library. */
async function cmdMigrate(cwd: string, positional: string[], flags: Flags): Promise<number> {
  const { config, source } = await loadConfig(cwd, flags);
  const resolved = resolveConfig(config);
  const root = dirname(findConfig(cwd) ?? join(cwd, CONFIG_FILE));
  const files = collectFiles(root, positional.map((p) => relative(root, resolve(cwd, p))), resolved.ignore);
  const s = migrationStatus(files, resolved);
  if (flags.format === "json" || flags.json) {
    process.stdout.write(`${JSON.stringify({ progress: s.progress, filesScanned: s.filesScanned, filesClean: s.filesClean, score: s.report.score, libraries: s.libraries, byRule: s.byRule, files: s.files }, null, 2)}\n`);
  } else {
    const color = flags.color !== false && process.stdout.isTTY !== false && !process.env.NO_COLOR;
    const c = (code: string, t: string) => (color ? `\x1b[${code}m${t}\x1b[0m` : t);
    const bar = (p: number) => `${"█".repeat(Math.round(p / 5))}${"░".repeat(20 - Math.round(p / 5))}`;
    const out: string[] = [];
    out.push(c("2", `Brand Kit: ${source}${config.tokenVersion ? ` v${config.tokenVersion}` : ""}`));
    out.push("");
    out.push(`${c("1", "Design system migration")}  ${bar(s.progress)} ${s.progress}%  (${s.filesClean} of ${s.filesScanned} UI files done · brand score ${s.report.score})`);
    const libs = Object.entries(s.libraries) as Array<[keyof typeof LIBRARY_LABEL, number]>;
    if (libs.length) out.push("", c("1", "Other UI libraries still in use"), ...libs.map(([id, n]) => `  ${LIBRARY_LABEL[id].padEnd(22)} ${String(n).padStart(5)} usages`));
    const top = typeof flags.top === "string" ? Number(flags.top) || 15 : 15;
    if (s.files.length) {
      out.push("", c("1", `Next files (${Math.min(top, s.files.length)} of ${s.files.length} with work left)`));
      for (const f of s.files.slice(0, top)) {
        const what = Object.entries(f.byRule).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(", ");
        out.push(`  ${String(f.findings).padStart(4)}  ${f.path}  ${c("2", what)}`);
      }
      out.push("", `Migrate a batch with your AI tool, e.g. "migrate ${s.files[0]!.path} to the design system"${existsSync(join(root, MIGRATE_SKILL_FILE)) ? " (Claude Code uses the brandrail-migrate skill)" : " — run `npx brandrail connect` first to add the migration skill"}.`);
    } else out.push("", c("32", "✔ Every UI file follows the design system."));
    process.stdout.write(`${out.join("\n")}\n`);
  }
  if (flags.upload) {
    const key = resolveKey();
    if (!key) log(`warning: --upload skipped. ${NO_KEY}`);
    else {
      const repo = repoInfo(root);
      const res = await uploadReport(key, {
        source: process.env.CI ? "ci" : "cli",
        target: { kind: "repo", name: repo.slug.split("/").pop() ?? repo.slug, location: repo.slug },
        ref: repo.branch ?? repo.sha?.slice(0, 7),
        title: `Migration status: ${s.progress}% of UI files done`,
        report: s.report,
      });
      log(`Uploaded → ${res.url ?? res.scanId}`);
    }
  }
  return 0;
}

/** A shareable HTML handover report (paths and counts only, no code). */
async function cmdReport(cwd: string, flags: Flags): Promise<number> {
  const { config } = await loadConfig(cwd, flags);
  const resolved = resolveConfig(config);
  const root = dirname(findConfig(cwd) ?? join(cwd, CONFIG_FILE));
  const s = migrationStatus(collectFiles(root, [], resolved.ignore), resolved);
  const repo = repoInfo(root);
  const out = resolve(cwd, typeof flags.out === "string" ? flags.out : "brandrail-report.html");
  writeFileSync(
    out,
    formatHandoverHtml(s, {
      project: repo.slug,
      org: config.org,
      branch: repo.branch,
      commit: repo.sha,
      kitVersion: config.tokenVersion,
      framework: config.framework ? FRAMEWORK_LABEL[config.framework] : undefined,
    }),
  );
  log(`✔ wrote ${relative(cwd, out)}: ${s.progress}% of UI files on the design system, brand score ${s.report.score}. Open it in a browser, or print it to PDF.`);
  return 0;
}

function cmdWhoami(): number {
  if (process.env.BRANDRAIL_KEY) {
    log(`Using BRANDRAIL_KEY from the environment (${process.env.BRANDRAIL_KEY.slice(0, 12)}…) against ${apiBase()}.`);
    return 0;
  }
  const c = storedCredential();
  if (!c) {
    log(NO_KEY);
    return 1;
  }
  const days = Math.ceil((Date.parse(c.expiresAt) - Date.now()) / 864e5);
  log(`Connected to ${c.org} at ${apiBase()} with key ${c.key.slice(0, 12)}… (${days > 0 ? `expires in ${days} days` : "expired: run brandrail connect"}).`);
  return days > 0 ? 0 : 1;
}

function cmdLogout(): number {
  const removed = removeCredential();
  log(removed ? `✔ removed the saved sign-in for ${apiBase()}. Revoke the key in Dashboard → Connect → API keys if it may have leaked.` : "Not signed in.");
  return 0;
}

async function cmdScan(cwd: string, positional: string[], flags: Flags): Promise<number> {
  const url = positional[0];
  if (!url) throw new Error("Usage: brandrail scan <url> [--pages 3] [--storage-state auth.json] [--upload]");
  const { config, source } = await loadConfig(cwd, flags);
  const num = (k: string, d: number, max: number) => (typeof flags[k] === "string" ? Math.min(Math.max(Number(flags[k]) || d, 0), max) : d);
  log(`Scanning ${url} …`);
  const { report, pages } = await scanPages(
    cwd,
    url,
    config,
    {
      pages: Math.max(1, num("pages", 1, 20)),
      storageState: typeof flags["storage-state"] === "string" ? flags["storage-state"] : undefined,
      waitMs: num("wait", 0, 30_000),
      width: num("width", 1280, 3840) || 1280,
    },
    log,
  );
  const format = typeof flags.format === "string" ? flags.format : "pretty";
  const threshold = flags["fail-below"] !== undefined ? Number(flags["fail-below"]) : undefined;
  if (format === "json") process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else if (format === "markdown") process.stdout.write(`${formatMarkdown(report, { threshold })}\n`);
  else {
    const color = flags.color !== false && process.stdout.isTTY !== false && !process.env.NO_COLOR;
    log(color ? `\x1b[2mBrand Kit: ${source}\x1b[0m` : `Brand Kit: ${source}`);
    process.stdout.write(`${formatPretty(report, { color }).replace(/:0:0\b/g, "")}\n`);
  }
  if (flags.upload) {
    const key = resolveKey();
    if (!key) log(`warning: --upload skipped. ${NO_KEY}`);
    else {
      const first = new URL(pages[0]!.url);
      const res = await uploadReport(key, {
        source: process.env.CI ? "ci" : "cli",
        target: { kind: "url", name: first.host, location: `${first.origin}${first.pathname === "/" ? "" : first.pathname}` },
        ref: first.toString(),
        title: pages.length > 1 ? `${first.host} · ${pages.length} pages` : `${first.host}${first.pathname === "/" ? "" : first.pathname}`,
        threshold,
        report,
      });
      log(`Uploaded → ${res.url ?? res.scanId}`);
    }
  }
  if (threshold !== undefined && report.score < threshold) {
    log(`\nBrand score ${report.score} is below ${threshold}.`);
    return 1;
  }
  return 0;
}

/** JSON files, folders of them, or a ZIP (Figma's "Export modes" gives one JSON per mode). */
function readTokenInputs(cwd: string, inputs: string[]): TokenFile[] {
  const files: TokenFile[] = [];
  const add = (name: string, text: string) => files.push({ name, data: JSON.parse(text) as unknown });
  const walk = (abs: string, rel: string) => {
    if (statSync(abs).isDirectory()) {
      for (const e of readdirSync(abs)) if (!e.startsWith(".")) walk(join(abs, e), rel ? `${rel}/${e}` : e);
    } else if (/\.zip$/i.test(abs)) {
      const entries = unzipSync(new Uint8Array(readFileSync(abs)), { filter: (e) => /\.json$/i.test(e.name) && !/(^|\/)(__MACOSX|\.)/.test(e.name) });
      for (const [name, bytes] of Object.entries(entries)) add(name, strFromU8(bytes));
    } else if (/\.json$/i.test(abs)) {
      add(rel || basename(abs), readFileSync(abs, "utf8"));
    }
  };
  for (const input of inputs) {
    const abs = resolve(cwd, input);
    walk(abs, statSync(abs).isDirectory() ? "" : basename(abs));
  }
  return files;
}

function cmdImport(cwd: string, positional: string[], flags: Flags): number {
  if (!positional.length) throw new Error("Usage: brandrail import <tokens.json | folder | export.zip> [more files…] [--replace] [--primitives]");
  const files = readTokenInputs(cwd, positional);
  if (!files.length) throw new Error("No .json token files found.");
  const res = importTokenFiles(files, { includePrimitives: !!flags.primitives });
  const file = files.length === 1 ? positional[0] : `${files.length} files`;
  const path = (typeof flags.config === "string" ? resolve(cwd, flags.config) : findConfig(cwd)) ?? join(cwd, CONFIG_FILE);
  const config: BrandrailConfig = existsSync(path) ? readConfig(path) : { ...starterConfig, tokens: {} };
  const next = flags.replace ? res.tokens : mergeTokens(config.tokens, res.tokens);
  const d = diffTokens(config.tokens, next);
  writeFileSync(path, `${JSON.stringify({ ...config, tokens: next }, null, 2)}\n`);
  log(`✔ ${res.count} tokens from ${file} (${res.format})${res.primitives ? `, ${res.primitives} palette primitives left out (--primitives to keep)` : ""}`);
  for (const n of res.notes) log(`  · ${n}`);
  for (const i of auditBrandKit(next)) log(`  ${i.severity === "error" ? "✖" : "!"} ${i.message}`);
  log(`✔ ${relative(cwd, path) || CONFIG_FILE}: ${d.changed.length} changed, ${d.added.length} added, ${d.removed.length} removed`);
  log("\nNext: npx brandrail init (to refresh AI rule files), then npx brandrail check");
  return 0;
}

async function cmdExport(cwd: string, positional: string[], flags: Flags): Promise<number> {
  if (!positional.length) {
    process.stdout.write(`Formats:\n${EXPORT_FORMATS.map((f) => `  ${f.id.padEnd(14)} ${f.label}: ${f.description}`).join("\n")}\n\nUsage: brandrail export <format…> [--out <folder>] [--from-api]\n`);
    return 0;
  }
  const bad = positional.filter((f) => !isExportFormat(f));
  if (bad.length) throw new Error(`Unknown format: ${bad.join(", ")}. Use one of: ${EXPORT_FORMATS.map((f) => f.id).join(", ")}.`);
  let config: BrandrailConfig;
  let org: string | undefined;
  if (flags["from-api"]) {
    const key = resolveKey();
    if (!key) throw new Error(`--from-api: ${NO_KEY}`);
    const local = findConfig(cwd);
    const res = await fetchBrandKit(key, local ? readConfig(local).brandKitVersion : undefined);
    config = res.config;
    org = res.org;
  } else {
    ({ config } = await loadConfig(cwd, flags));
    org = config.org;
  }
  const base = resolve(cwd, typeof flags.out === "string" ? flags.out : ".");
  for (const format of new Set(positional)) {
    const r = exportTokens(config.tokens, format as Parameters<typeof exportTokens>[1], { org, version: config.tokenVersion });
    const dir = positional.length > 1 ? join(base, format) : base;
    for (const f of r.files) {
      const p = join(dir, f.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.content);
    }
    log(`✔ ${EXPORT_FORMATS.find((x) => x.id === format)!.label}: ${r.files.map((f) => relative(cwd, join(dir, f.path))).join(", ")}`);
    for (const u of r.usage) log(`  · ${u}`);
  }
  return 0;
}

async function cmdTemplate(cwd: string, positional: string[], flags: Flags): Promise<number> {
  if (!positional.length) {
    process.stdout.write(`Page templates, built from your registry's components:\n${templateList()}\n\nUsage: brandrail template <name> [--framework react|angular|vue|html] [--out <folder>] [--force]\n`);
    return 0;
  }
  const template = findTemplate(positional.join(" "));
  if (!template) throw new Error(`No template matches "${positional.join(" ")}". Run \`brandrail template\` for the list.`);
  const { config } = await loadConfig(cwd, flags);
  const framework = projectFramework(cwd, config, flags);
  const r = renderTemplate(config, template, framework);
  const dir = resolve(cwd, typeof flags.out === "string" ? flags.out : ".");
  const clash = r.files.map((f) => join(dir, f.path)).filter((p) => existsSync(p));
  if (clash.length && !flags.force) throw new Error(`Already exists: ${clash.map((p) => relative(cwd, p)).join(", ")}. Use --out <folder> or --force.`);
  mkdirSync(dir, { recursive: true });
  for (const f of r.files) writeFileSync(join(dir, f.path), f.content);
  log(`✔ ${template.name} (${FRAMEWORK_LABEL[framework]}): ${r.files.map((f) => relative(cwd, join(dir, f.path))).join(", ")}`);
  for (const s of r.setup) log(`  · ${s.replace(/\`/g, "")}`);
  const missing = r.parts.filter((p) => !p.component);
  if (missing.length) log(`  ! No component in your registry for: ${missing.map((p) => p.part).join(", ")}. Those spots have a comment saying what goes there.`);
  log(`\nNext: rename the sample data and labels, then npx brandrail check ${relative(cwd, dir) || "."}`);
  return 0;
}

function cmdRules(): number {
  for (const r of RULES) process.stdout.write(`${r.id.padEnd(28)} ${r.defaultSeverity.padEnd(8)} ${r.description}\n`);
  return 0;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { cmd, positional, flags } = parseArgs(argv);
  const cwd = process.cwd();
  if (flags.version || cmd === "--version" || cmd === "-v") {
    process.stdout.write(`${ENGINE_VERSION}\n`);
    return 0;
  }
  switch (cmd) {
    case "check":
      return cmdCheck(cwd, positional, flags);
    case "init":
      return cmdInit(cwd, flags);
    case "scan":
      return cmdScan(cwd, positional, flags);
    case "import":
      return cmdImport(cwd, positional, flags);
    case "rules":
      return cmdRules();
    case "template":
      return cmdTemplate(cwd, positional, flags);
    case "export":
      return cmdExport(cwd, positional, flags);
    case "connect":
      return cmdConnect(cwd, flags);
    case "mcp":
      return runLocalMcp(cwd, { framework: typeof flags.framework === "string" ? flags.framework : undefined, report: flags.report === true });
    case "migrate":
      return cmdMigrate(cwd, positional, flags);
    case "report":
      return cmdReport(cwd, flags);
    case "hook":
      return cmdHook(cwd, positional, flags);
    case "whoami":
      return cmdWhoami();
    case "logout":
      return cmdLogout();
    default:
      process.stdout.write(HELP);
      return cmd === "help" || cmd === "--help" || cmd === "-h" ? 0 : 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err: Error) => {
    log(`brandrail: ${err.message}`);
    process.exit(2);
  },
);
