import { generateInstructions, upsertSection } from "./instructions.ts";
import { kitBridgeCss } from "./kit-bridge.ts";
import { RULE_FILES } from "./mcp-config.ts";
import { MIGRATE_AGENT_FILE, MIGRATE_SKILL_FILE, migrationAgent, migrationSkill } from "./migrate-skill.ts";
import { generateTokensCss } from "./tokens-css.ts";
import type { BrandrailConfig } from "./types.ts";

/**
 * The files Brandrail writes into a project, shared by `brandrail init / connect` (on disk) and the GitHub App
 * (as a pull request), so both produce exactly the same thing.
 */

export const CONFIG_FILE = "brandrail.config.json";
const KIT = "@brandrail/kit";

/** The published Brand Kit over the project's own config: local settings (rules, ignore, tokensCss, framework) stay. */
export function mergeProjectConfig(prev: BrandrailConfig | undefined, kit: BrandrailConfig): BrandrailConfig {
  if (!prev) return kit;
  return {
    ...prev,
    ...kit,
    rules: { ...prev.rules, ...kit.rules },
    ignore: prev.ignore ?? kit.ignore,
    tokensCss: prev.tokensCss,
    framework: prev.framework ?? kit.framework,
    brandKitVersion: prev.brandKitVersion,
  };
}

/** Where the CSS variables go: the config's choice, else src/brandrail.tokens.css when there's a src folder. */
export function defaultTokensCssPath(config: BrandrailConfig, hasSrc: boolean): string {
  return config.tokensCss ?? (hasSrc ? "src/brandrail.tokens.css" : "brandrail.tokens.css");
}

export function tokensCssContent(config: BrandrailConfig, org?: string): { css: string; usesKit: boolean } {
  let css = generateTokensCss(config.tokens, { version: config.tokenVersion, org });
  // Registry uses the Brandrail UI kit: make its components follow the Brand Kit too.
  const usesKit = (config.components ?? []).some((c) => c.importPath === KIT);
  if (usesKit) css += `\n/* ${KIT} follows the Brand Kit: colours, font, spacing, radius and type scale. */\n${kitBridgeCss(config.tokens)}\n`;
  return { css, usesKit };
}

const CURSOR_GLOBS = "**/*.{tsx,jsx,ts,vue,svelte,html,css,scss,php,twig,hbs,mustache}";

/** A rule file's new content. Cursor and Windsurf files are ours whole (front-matter first); others keep their own text. */
export function ruleFileContent(file: string, md: string, before: string): string {
  if (file.endsWith(".mdc")) return `---\ndescription: Design system rules from Brandrail\nglobs: ["${CURSOR_GLOBS}"]\nalwaysApply: true\n---\n\n${md}\n`;
  if (file.startsWith(".windsurf/")) return `---\ntrigger: always_on\n---\n\n${md}\n`;
  return upsertSection(before, md);
}

export interface ProjectFile {
  path: string;
  content: string;
  /** Who reads it, for messages. */
  readBy?: string;
}

/**
 * Every file for a project: brandrail.config.json, the tokens CSS and the AI rule files.
 * `read` returns a file's current content (or undefined), so rule files keep the project's own text.
 * `onlyExistingRules`: update the rule files the project already has, add none (the GitHub App does this).
 */
export function projectFiles(
  config: BrandrailConfig,
  opts: {
    org?: string;
    tokensCss?: string | false;
    read: (path: string) => string | undefined;
    rules?: boolean;
    onlyExistingRules?: boolean;
    /** The project's package.json (parsed), to include only its UI libraries in the migration mappings. */
    pkg?: unknown;
  },
): ProjectFile[] {
  const out: ProjectFile[] = [{ path: CONFIG_FILE, content: `${JSON.stringify(config, null, 2)}\n` }];
  const css = opts.tokensCss === false ? undefined : opts.tokensCss;
  if (css) out.push({ path: css, content: tokensCssContent(config, opts.org).css });
  if (opts.rules !== false) {
    const md = generateInstructions(config, { org: opts.org, tokensCss: css });
    for (const { file, readBy } of RULE_FILES) {
      const before = opts.read(file);
      if (opts.onlyExistingRules && before === undefined) continue;
      out.push({ path: file, content: ruleFileContent(file, md, before ?? ""), readBy });
    }
    // Claude Code: the migration skill and subagent (ours whole, regenerated with the mappings each time).
    const skillExists = opts.read(MIGRATE_SKILL_FILE) !== undefined;
    if (!opts.onlyExistingRules || skillExists) {
      out.push({ path: MIGRATE_SKILL_FILE, content: migrationSkill(config, { org: opts.org, pkg: opts.pkg }), readBy: "Claude Code (skill: migrate to the design system)" });
    }
    if (!opts.onlyExistingRules || opts.read(MIGRATE_AGENT_FILE) !== undefined) {
      out.push({ path: MIGRATE_AGENT_FILE, content: migrationAgent({ org: opts.org }), readBy: "Claude Code (subagent: brandrail-migrator)" });
    }
  }
  return out;
}

/** Added or changed line numbers in one file's unified diff (a GitHub pull request file's `patch`). */
export function changedLinesFromPatch(patch: string | undefined): Set<number> {
  const set = new Set<number>();
  if (!patch) return set;
  let line = 0;
  for (const l of patch.split("\n")) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) {
      line = Number(h[1]);
      continue;
    }
    if (l.startsWith("+")) set.add(line++);
    else if (l.startsWith("-")) continue;
    else line++;
  }
  return set;
}
