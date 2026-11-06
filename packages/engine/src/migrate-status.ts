import { check } from "./check.ts";
import { resolveConfig, type ResolvedConfig } from "./config.ts";
import { LIBRARY_LABEL, type LibraryId } from "./migrate.ts";
import { RULES } from "./rules.ts";
import type { BrandrailConfig, Report, SourceFile } from "./types.ts";

/** Findings that are migration work (everything the Checker reports except image alt text). */
const MIGRATION_RULES = new Set(RULES.map((r) => r.id).filter((id) => id !== "img-alt"));

export interface MigrationFile {
  path: string;
  findings: number;
  byRule: Record<string, number>;
  libraries: LibraryId[];
}

export interface MigrationStatus {
  report: Report;
  /** UI files with at least one migration finding, most findings first. */
  files: MigrationFile[];
  filesScanned: number;
  filesClean: number;
  /** 0-100: share of UI files with no migration findings. */
  progress: number;
  /** Usages of each other UI library still in the code. */
  libraries: Partial<Record<LibraryId, number>>;
  byRule: Record<string, number>;
}

const LABEL_TO_ID = new Map(Object.entries(LIBRARY_LABEL).map(([id, label]) => [label, id as LibraryId]));

/** Where a codebase stands on the way to the design system: what's left, per file and per library. */
export function migrationStatus(files: SourceFile[], configInput: BrandrailConfig | ResolvedConfig): MigrationStatus {
  const config = "replaces" in configInput ? configInput : resolveConfig(configInput);
  const report = check(files, config, { snippets: false });
  const per = new Map<string, MigrationFile>();
  const libraries: Partial<Record<LibraryId, number>> = {};
  const byRule: Record<string, number> = {};
  for (const v of report.violations) {
    if (!MIGRATION_RULES.has(v.ruleId)) continue;
    byRule[v.ruleId] = (byRule[v.ruleId] ?? 0) + 1;
    const f = per.get(v.file) ?? { path: v.file, findings: 0, byRule: {}, libraries: [] };
    f.findings++;
    f.byRule[v.ruleId] = (f.byRule[v.ruleId] ?? 0) + 1;
    if (v.ruleId === "legacy-library") {
      const label = /\(([^()]*(?:\([^()]*\))?[^()]*)\) should be/.exec(v.message)?.[1];
      const id = label ? LABEL_TO_ID.get(label) : undefined;
      if (id) {
        libraries[id] = (libraries[id] ?? 0) + 1;
        if (!f.libraries.includes(id)) f.libraries.push(id);
      }
    }
    per.set(v.file, f);
  }
  const list = [...per.values()].sort((a, b) => b.findings - a.findings || a.path.localeCompare(b.path));
  const filesClean = Math.max(0, report.filesScanned - list.length);
  return {
    report,
    files: list,
    filesScanned: report.filesScanned,
    filesClean,
    progress: report.filesScanned ? Math.round((filesClean / report.filesScanned) * 100) : 100,
    libraries,
    byRule,
  };
}
