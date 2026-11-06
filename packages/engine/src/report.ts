import { RULES } from "./rules.ts";
import type { Report, Severity, Violation } from "./types.ts";

const RENDERED_ONLY: Record<string, string> = { "text-contrast": "Low text contrast", "font-size-scale": "Off-scale font size", "page-rendered": "Blank page" };
const title = (id: string) => RULES.find((r) => r.id === id)?.title ?? RENDERED_ONLY[id] ?? id;

/* ---------------- terminal ---------------- */

const ansi = (on: boolean) => {
  const w = (code: string) => (s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { red: w("31"), yellow: w("33"), cyan: w("36"), green: w("32"), dim: w("2"), bold: w("1") };
};

const rendered = (r: Report) => r.violations.length > 0 && r.violations.every((v) => v.line === 0);

export function formatPretty(report: Report, { color = true, max = 200 }: { color?: boolean; max?: number } = {}): string {
  const c = ansi(color);
  const sev: Record<Severity, (s: string) => string> = { error: c.red, warning: c.yellow, info: c.cyan };
  const lines: string[] = [];
  let lastFile = "";
  for (const v of report.violations.slice(0, max)) {
    if (v.file !== lastFile) {
      lines.push("", c.bold(v.file));
      lastFile = v.file;
    }
    const rendered = v.line === 0;
    lines.push(`  ${c.dim(rendered ? "".padEnd(8) : `${v.line}:${v.column}`.padEnd(8))} ${sev[v.severity](v.severity.padEnd(7))} ${v.message}  ${c.dim(v.ruleId)}`);
    if (v.suggestion) lines.push(`  ${" ".repeat(16)} ${c.green("→")} ${v.suggestion}`);
    if (rendered && v.snippet) lines.push(`  ${" ".repeat(16)} ${c.dim(`on ${v.snippet}`)}`);
  }
  if (report.violations.length > max) lines.push("", c.dim(`… and ${report.violations.length - max} more`));
  const s = report.score;
  const scoreStr = s >= 80 ? c.green(String(s)) : s >= 65 ? c.yellow(String(s)) : c.red(String(s));
  lines.push(
    "",
    `${c.bold("Brand score")} ${scoreStr}/100  ${c.dim("·")} ${c.red(`${report.counts.error} errors`)} ${c.dim("·")} ${c.yellow(`${report.counts.warning} warnings`)} ${c.dim("·")} ${c.cyan(`${report.counts.info} info`)}`,
    c.dim(`${report.filesScanned} ${rendered(report) ? "pages" : "files"}, ${report.linesScanned} ${rendered(report) ? "elements" : "lines"} in ${report.durationMs}ms${report.tokenVersion ? ` · Brand Kit v${report.tokenVersion}` : ""}`),
  );
  return lines.join("\n");
}

/* ---------------- GitHub annotations ---------------- */

const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s: string) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

export function formatGithubAnnotations(report: Report, max = 50): string {
  const level: Record<Severity, string> = { error: "error", warning: "warning", info: "notice" };
  return report.violations
    .slice(0, max)
    .map(
      (v) =>
        `::${level[v.severity]} file=${escProp(v.file)},line=${v.line},col=${v.column},title=${escProp(`Brandrail: ${title(v.ruleId)}`)}::${esc(
          v.suggestion ? `${v.message}. ${v.suggestion}` : v.message,
        )}`,
    )
    .join("\n");
}

/* ---------------- Markdown (PR comment / job summary) ---------------- */

export const COMMENT_MARKER = "<!-- brandrail-report -->";

export function formatMarkdown(
  report: Report,
  opts: { threshold?: number; fileUrl?: (v: Violation) => string | undefined; maxRows?: number; dashboardUrl?: string } = {},
): string {
  const { threshold, maxRows = 30 } = opts;
  const pass = threshold === undefined || report.score >= threshold;
  const badge = report.violations.length === 0 ? "🟢" : pass ? "🟡" : "🔴";
  const out: string[] = [COMMENT_MARKER];
  out.push(`## ${badge} Brand score: **${report.score}**/100${threshold !== undefined ? ` (threshold ${threshold})` : ""}`);
  out.push("");
  out.push(
    `**${report.counts.error}** errors · **${report.counts.warning}** warnings · **${report.counts.info}** info — ${report.filesScanned} files scanned${
      report.tokenVersion ? ` against Brand Kit v${report.tokenVersion}` : ""
    }`,
  );
  if (report.violations.length === 0) {
    out.push("", "Everything uses approved tokens and components. ✨");
  } else {
    if (report.byRule.length) {
      out.push("", "| Rule | Count |", "| --- | ---: |");
      for (const r of report.byRule) out.push(`| ${title(r.ruleId)} \`${r.ruleId}\` | ${r.count} |`);
    }
    out.push("", "<details><summary>Violations</summary>", "", "| | Location | Issue | Fix |", "| --- | --- | --- | --- |");
    const icon: Record<Severity, string> = { error: "🔴", warning: "🟡", info: "🔵" };
    for (const v of report.violations.slice(0, maxRows)) {
      const loc = v.line === 0 ? `${v.file} ${v.snippet ?? ""}`.trim() : `${v.file}:${v.line}`;
      const url = opts.fileUrl?.(v);
      const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
      out.push(`| ${icon[v.severity]} | ${url ? `[\`${loc}\`](${url})` : `\`${loc}\``} | ${cell(v.message)} | ${cell(v.suggestion ?? "")} |`);
    }
    if (report.violations.length > maxRows) out.push("", `…and ${report.violations.length - maxRows} more.`);
    out.push("", "</details>");
  }
  out.push("", `<sub>Brandrail engine ${report.engineVersion}${opts.dashboardUrl ? ` · [Open in Brandrail](${opts.dashboardUrl})` : ""}</sub>`);
  return out.join("\n");
}
