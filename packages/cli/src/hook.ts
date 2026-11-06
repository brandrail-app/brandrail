import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative } from "node:path";

/**
 * `brandrail hook install | uninstall`: a git pre-commit hook that checks only the staged lines and stops the commit
 * on errors (warnings never block). Works with plain git hooks, Husky (.husky/pre-commit) and core.hooksPath. Our
 * lines sit between markers, so an existing hook keeps its own commands and uninstall removes only ours.
 */
export const HOOK_START = "# >>> brandrail (npx brandrail hook uninstall to remove)";
export const HOOK_END = "# <<< brandrail";

export const hookBlock = (cmd: string) =>
  [
    HOOK_START,
    `${cmd} || { echo ""; echo "Brandrail: fix the errors above (or commit with --no-verify to skip this once)."; exit 1; }`,
    HOOK_END,
  ].join("\n");

const git = (args: string[], cwd: string): string | null => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

/** Where the pre-commit hook lives: Husky's file, core.hooksPath, or .git/hooks. */
export function hookFile(cwd: string): { path: string; kind: "husky" | "git" } | null {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  if (!top) return null;
  if (existsSync(join(top, ".husky"))) return { path: join(top, ".husky", "pre-commit"), kind: "husky" };
  const custom = git(["config", "core.hooksPath"], cwd);
  if (custom && !/\.husky/.test(custom)) return { path: join(isAbsolute(custom) ? custom : join(top, custom), "pre-commit"), kind: "git" };
  const hooks = git(["rev-parse", "--git-path", "hooks"], cwd);
  if (!hooks) return null;
  return { path: join(isAbsolute(hooks) ? hooks : join(cwd, hooks), "pre-commit"), kind: "git" };
}

/** Removes our block from a hook's text. */
export function withoutBlock(text: string): string {
  const start = text.indexOf(HOOK_START);
  const end = text.indexOf(HOOK_END);
  if (start === -1 || end === -1 || end < start) return text;
  return (text.slice(0, start) + text.slice(end + HOOK_END.length)).replace(/\n{3,}/g, "\n\n");
}

/** Adds (or replaces) our block in a hook's text, keeping everything else. */
export function withBlock(text: string, block: string, kind: "husky" | "git"): string {
  const base = withoutBlock(text).trimEnd();
  if (!base) return kind === "husky" ? `${block}\n` : `#!/bin/sh\n${block}\n`;
  return `${base}\n\n${block}\n`;
}

export function installHook(cwd: string, opts: { root: string; failBelow?: number }): { path: string; kind: string } {
  const where = hookFile(cwd);
  if (!where) throw new Error("This isn't a git repository (no .git found).");
  // The hook runs from the repo root; the check must run where brandrail.config.json is.
  const top = git(["rev-parse", "--show-toplevel"], cwd) ?? cwd;
  const sub = relative(top, opts.root);
  const cd = sub && !sub.startsWith("..") ? `cd "${sub}" && ` : "";
  const cmd = `${cd}npx --yes brandrail check --staged --strict${opts.failBelow !== undefined ? ` --fail-below ${opts.failBelow}` : ""}`;
  const before = existsSync(where.path) ? readFileSync(where.path, "utf8") : "";
  mkdirSync(join(where.path, ".."), { recursive: true });
  writeFileSync(where.path, withBlock(before, hookBlock(cmd), where.kind));
  try {
    chmodSync(where.path, 0o755);
  } catch {
    /* Windows */
  }
  return { path: relative(cwd, where.path) || where.path, kind: where.kind };
}

export function uninstallHook(cwd: string): string | null {
  const where = hookFile(cwd);
  if (!where || !existsSync(where.path)) return null;
  const before = readFileSync(where.path, "utf8");
  if (!before.includes(HOOK_START)) return null;
  writeFileSync(where.path, withoutBlock(before));
  return relative(cwd, where.path) || where.path;
}
