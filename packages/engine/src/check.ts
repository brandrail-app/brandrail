import { resolveConfig, type ResolvedConfig } from "./config.ts";
import { RULES } from "./rules.ts";
import { fileFramework, fileKind, LineIndex, makeIgnore, SCANNABLE, stripComments } from "./source.ts";
import type { BrandrailConfig, Report, Severity, SourceFile, Violation } from "./types.ts";

export const ENGINE_VERSION = "0.10.0";

const WEIGHT: Record<Severity, number> = { error: 4, warning: 1.5, info: 0.25 };

/**
 * 100 with no findings; drops with weighted findings per 1,000 lines of UI code.
 * ~20 weighted points per kLOC ≈ 55.
 */
export function computeScore(counts: Record<Severity, number>, lines: number): number {
  const penalty = counts.error * WEIGHT.error + counts.warning * WEIGHT.warning + counts.info * WEIGHT.info;
  if (penalty === 0) return 100;
  const perK = penalty / Math.max(1, lines / 1000);
  return Math.max(0, Math.min(99, Math.round(100 / (1 + perK / 25))));
}

export function isScannable(path: string, config: ResolvedConfig): boolean {
  return SCANNABLE.has(fileKind(path)) && !makeIgnore(config.ignore)(path);
}

export interface CheckOptions {
  /** Include the offending source line on each violation (default true). */
  snippets?: boolean;
  /** Only report findings on these lines, per file path (e.g. lines changed in a PR). */
  onlyLines?: Map<string, Set<number>>;
}

export function check(files: SourceFile[], configInput: BrandrailConfig | ResolvedConfig, opts: CheckOptions = {}): Report {
  const t0 = Date.now();
  const config = "replaces" in configInput ? configInput : resolveConfig(configInput);
  const ignored = makeIgnore(config.ignore);
  const violations: Violation[] = [];
  let filesScanned = 0;
  let linesScanned = 0;

  for (const file of files) {
    const path = file.path.replace(/\\/g, "/").replace(/^\.\//, "");
    const kind = fileKind(path);
    if (!SCANNABLE.has(kind) || ignored(path)) continue;
    const only = opts.onlyLines?.get(path);
    // In changed-lines mode, files the change didn't touch are out of scope.
    if (opts.onlyLines && (!only || only.size === 0)) continue;
    filesScanned++;
    const idx = new LineIndex(file.content);
    linesScanned += only ? only.size : file.content.split("\n").filter((l) => l.trim()).length;
    const code = stripComments(file.content, kind);
    const framework = fileFramework(path, kind, code, config.framework);
    const seen = new Set<string>();

    for (const rule of RULES) {
      const setting = config.rules[rule.id];
      if (setting === "off" || !rule.kinds.includes(kind)) continue;
      for (const f of rule.check({ path, kind, code, config, framework })) {
        const { line, column } = idx.position(f.offset);
        if (only && !only.has(line)) continue;
        const key = `${rule.id}:${line}:${column}`;
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push({
          ruleId: rule.id,
          severity: setting ?? f.severity ?? rule.defaultSeverity,
          file: path,
          line,
          column,
          message: f.message,
          suggestion: f.suggestion,
          snippet: opts.snippets === false ? undefined : idx.lineText(line).trim().slice(0, 160),
        });
      }
    }
  }

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  const perRule = new Map<string, number>();
  for (const v of violations) {
    counts[v.severity]++;
    perRule.set(v.ruleId, (perRule.get(v.ruleId) ?? 0) + 1);
  }

  return {
    engineVersion: ENGINE_VERSION,
    tokenVersion: config.tokenVersion,
    score: computeScore(counts, linesScanned),
    counts,
    filesScanned,
    linesScanned,
    violations,
    byRule: [...perRule].map(([ruleId, count]) => ({ ruleId, count })).sort((a, b) => b.count - a.count),
    durationMs: Date.now() - t0,
  };
}

/** Convenience for one snippet (MCP validate_snippet, web playground). */
export function checkSnippet(code: string, filename: string, config: BrandrailConfig | ResolvedConfig): Report {
  return check([{ path: filename, content: code }], config);
}
