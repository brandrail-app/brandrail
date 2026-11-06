import { execFileSync } from "node:child_process";

const git = (args: string[], cwd: string): string | null => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

export interface RepoInfo {
  /** owner/repo when the remote is GitHub-like, else the remote URL or folder name */
  slug: string;
  branch?: string;
  sha?: string;
}

export function repoInfo(cwd: string): RepoInfo {
  const remote = git(["remote", "get-url", "origin"], cwd);
  const m = remote?.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  const folder = cwd.split(/[\\/]/).pop() ?? "repo";
  return {
    slug: m?.[1] ?? remote ?? folder,
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"], cwd) ?? undefined,
    sha: git(["rev-parse", "HEAD"], cwd) ?? undefined,
  };
}

/** Parses `git diff -U0` output into added/changed line numbers per file. */
export function parseChangedLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let file: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      file = p === "/dev/null" ? null : p.replace(/^b\//, "");
      if (file && !out.has(file)) out.set(file, new Set());
      continue;
    }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && file) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      const set = out.get(file)!;
      for (let i = 0; i < count; i++) set.add(start + i);
    }
  }
  return out;
}

/** Lines added or changed relative to `base` (merge-base), or null if git isn't available. */
export function changedLines(cwd: string, base: string): Map<string, Set<number>> | null {
  const mergeBase = git(["merge-base", base, "HEAD"], cwd) ?? base;
  // --relative: paths relative to cwd (the config's folder), so a monorepo app folder matches its own files.
  const diff = git(["diff", "--relative", "-U0", "--no-color", "--diff-filter=AMR", mergeBase], cwd);
  return diff === null ? null : parseChangedLines(diff);
}

/** Lines added or changed in what's staged for the next commit (for the pre-commit hook), or null without git. */
export function stagedLines(cwd: string): Map<string, Set<number>> | null {
  const diff = git(["diff", "--cached", "--relative", "-U0", "--no-color", "--diff-filter=AMR"], cwd);
  return diff === null ? null : parseChangedLines(diff);
}
