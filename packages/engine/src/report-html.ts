import { LIBRARY_LABEL, type LibraryId } from "./migrate.ts";
import type { MigrationStatus } from "./migrate-status.ts";
import { RULES } from "./rules.ts";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ruleTitle = (id: string) => RULES.find((r) => r.id === id)?.title ?? id;

export interface HandoverMeta {
  project: string;
  org?: string;
  branch?: string;
  commit?: string;
  kitVersion?: string;
  framework?: string;
  generatedAt?: string;
  /** Earlier measurements, oldest first, for the trend line. */
  history?: Array<{ at: string; progress: number; score: number }>;
}

/**
 * A self-contained HTML handover report: where the codebase stands on the design system, what's left and where,
 * and how to finish. File paths and counts only, never code, so it can be shared with anyone.
 */
export function formatHandoverHtml(s: MigrationStatus, meta: HandoverMeta): string {
  const when = meta.generatedAt ?? new Date().toISOString();
  const date = new Date(when).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  const libs = Object.entries(s.libraries) as Array<[LibraryId, number]>;
  const rules = Object.entries(s.byRule).sort((a, b) => b[1] - a[1]);
  const total = rules.reduce((a, [, n]) => a + n, 0);
  const tone = (n: number) => (n >= 90 ? "good" : n >= 70 ? "warn" : "bad");
  const trend = meta.history?.length
    ? `<section><h2>Progress over time</h2><table><thead><tr><th>Date</th><th class="n">Files done</th><th class="n">Brand score</th></tr></thead><tbody>${[...meta.history, { at: when, progress: s.progress, score: s.report.score }]
        .map((h) => `<tr><td>${esc(new Date(h.at).toLocaleDateString("en-AU"))}</td><td class="n">${h.progress}%</td><td class="n">${h.score}</td></tr>`)
        .join("")}</tbody></table></section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design system handover — ${esc(meta.project)}</title>
<style>
  :root { --fg:#1f2328; --muted:#59636e; --line:#d1d9e0; --bg:#fff; --subtle:#f6f8fa; --good:#1a7f37; --warn:#9a6700; --bad:#cf222e; --accent:#0969da; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e6edf3; --muted:#9198a1; --line:#3d444d; --bg:#0d1117; --subtle:#151b23; --good:#3fb950; --warn:#d29922; --bad:#f85149; --accent:#4493f8; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 40px 16px 64px; }
  h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 32px 0 8px; }
  .meta { color: var(--muted); margin: 0 0 24px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; background: var(--subtle); }
  .card p { margin: 0; color: var(--muted); font-size: 12px; } .card b { display: block; font-size: 26px; margin-top: 2px; }
  .good { color: var(--good); } .warn { color: var(--warn); } .bad { color: var(--bad); }
  .bar { height: 10px; border-radius: 5px; background: var(--line); overflow: hidden; margin-top: 8px; }
  .bar span { display: block; height: 100%; background: var(--good); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; } .n { text-align: right; font-variant-numeric: tabular-nums; }
  code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--subtle); padding: 1px 4px; border-radius: 4px; }
  ol li { margin: 4px 0; } footer { margin-top: 40px; color: var(--muted); font-size: 12px; }
  @media print { body { font-size: 12px; } main { padding: 0; } .card { break-inside: avoid; } }
</style>
</head>
<body>
<main>
<h1>Design system handover: ${esc(meta.project)}</h1>
<p class="meta">${esc(date)}${meta.org ? ` · ${esc(meta.org)} design system` : ""}${meta.kitVersion ? ` · Brand Kit v${esc(meta.kitVersion)}` : ""}${meta.framework ? ` · ${esc(meta.framework)}` : ""}${meta.branch ? ` · branch <code>${esc(meta.branch)}</code>` : ""}${meta.commit ? ` @ <code>${esc(meta.commit.slice(0, 7))}</code>` : ""}</p>

<div class="cards">
  <div class="card"><p>Files on the design system</p><b class="${tone(s.progress)}">${s.progress}%</b><div class="bar"><span style="width:${s.progress}%"></span></div></div>
  <div class="card"><p>Brand score</p><b class="${tone(s.report.score)}">${s.report.score}/100</b></div>
  <div class="card"><p>UI files done</p><b>${s.filesClean} / ${s.filesScanned}</b></div>
  <div class="card"><p>Findings left</p><b class="${total ? "warn" : "good"}">${total}</b></div>
</div>

${libs.length ? `<section><h2>Other UI libraries still in use</h2><table><thead><tr><th>Library</th><th class="n">Usages left</th></tr></thead><tbody>${libs.map(([id, n]) => `<tr><td>${esc(LIBRARY_LABEL[id])}</td><td class="n">${n}</td></tr>`).join("")}</tbody></table></section>` : `<section><h2>Other UI libraries</h2><p class="good">None left in the code.</p></section>`}

<section><h2>What's left, by kind</h2>${rules.length ? `<table><thead><tr><th>Finding</th><th>Rule</th><th class="n">Count</th></tr></thead><tbody>${rules.map(([id, n]) => `<tr><td>${esc(ruleTitle(id))}</td><td><code>${esc(id)}</code></td><td class="n">${n}</td></tr>`).join("")}</tbody></table>` : `<p class="good">Nothing: every UI file follows the design system.</p>`}</section>

${s.files.length ? `<section><h2>Files with the most work left</h2><table><thead><tr><th>File</th><th>Libraries</th><th class="n">Findings</th></tr></thead><tbody>${s.files
    .slice(0, 40)
    .map((f) => `<tr><td><code>${esc(f.path)}</code></td><td>${esc(f.libraries.map((l) => LIBRARY_LABEL[l]).join(", "))}</td><td class="n">${f.findings}</td></tr>`)
    .join("")}</tbody></table>${s.files.length > 40 ? `<p class="meta">…and ${s.files.length - 40} more files.</p>` : ""}</section>` : ""}

${trend}

<section><h2>How to finish</h2><ol>
  <li>Run <code>npx brandrail connect</code> in the repo once (rule files, MCP server and the migration skill for AI tools).</li>
  <li>Ask the AI tool: <em>"migrate ${esc(s.files[0]?.path ?? "the next files")} to the design system"</em>. In Claude Code the <code>brandrail-migrate</code> skill and <code>brandrail-migrator</code> agent do it in small, checked batches.</li>
  <li>Track progress with <code>npx brandrail migrate</code>; make the GitHub check required once the score holds above the team's threshold.</li>
  <li>Remove each old library from <code>package.json</code> when it shows 0 usages here.</li>
</ol></section>

<footer>Generated by <svg width="14" height="14" viewBox="0 0 32 32" aria-hidden="true" style="vertical-align:-2px;margin-right:4px"><rect width="32" height="32" rx="8" fill="#2fc985"/><path fill="#0d1117" fill-rule="evenodd" d="M8.4 7.3999999999999995a1.8 1.8 0 0 1 3.6 0V14.2H18.200000000000003a5.4 5.4 0 0 1 5.4 5.4V21.0a5.4 5.4 0 0 1 -5.4 5.4H8.4ZM12.0 17.8H18.2a1.8000000000000003 1.8000000000000003 0 0 1 1.8000000000000003 1.8000000000000003V20.999999999999996a1.8000000000000003 1.8000000000000003 0 0 1 -1.8000000000000003 1.8000000000000003H12.0Z"/></svg>Brandrail (<code>npx brandrail report</code>). Only file paths and counts are included: no source code.</footer>
</main>
</body>
</html>
`;
}
