import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileKind, makeIgnore, type BrandrailConfig, type SourceFile } from "@brandrail/engine";

export const CONFIG_FILE = "brandrail.config.json";
const MAX_FILE_BYTES = 512 * 1024;

/** Walks `paths` (files or directories) under `root`, skipping ignored and non-UI files. */
export function collectFiles(root: string, paths: string[], ignoreGlobs: string[]): SourceFile[] {
  const ignored = makeIgnore(ignoreGlobs);
  const out: SourceFile[] = [];
  const rel = (p: string) => relative(root, p).split(sep).join("/");

  const visit = (abs: string) => {
    const r = rel(abs);
    let st;
    try {
      st = statSync(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      const name = abs.split(sep).pop() ?? "";
      if (r && (ignored(`${r}/`) || ignored(`${r}/x`) || (name.startsWith(".") && name !== "." && name !== ".github"))) return;
      for (const entry of readdirSync(abs)) visit(join(abs, entry));
      return;
    }
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return;
    if (fileKind(r) === "other" || ignored(r)) return;
    out.push({ path: r, content: readFileSync(abs, "utf8") });
  };

  for (const p of paths.length ? paths : ["."]) visit(resolve(root, p));
  return out;
}

/** Finds brandrail.config.json in `start` or any parent directory. */
export function findConfig(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readConfig(path: string): BrandrailConfig {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as BrandrailConfig;
  if (!parsed || typeof parsed !== "object" || !parsed.tokens) {
    throw new Error(`${path} has no "tokens". Run \`brandrail init\` to create one.`);
  }
  return parsed;
}
